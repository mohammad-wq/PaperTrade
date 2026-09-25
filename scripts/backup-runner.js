#!/usr/bin/env node
/**
 * Paper Trade - Shared Backup & Cloud Sync Runner
 * 
 * Supports:
 *  - Native local pg_dump with custom format (-F c)
 *  - Credentials securely parsed from .env (via PGPASSWORD environment variable)
 *  - 30-day local retention cleanup
 *  - Weekly cloud upload & rolling 3-week archive via rclone to Google Drive
 *  - Manual one-click trigger (both local + cloud)
 *  - Visible logging to C:\PaperTradeBackups\backup-log.txt
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

// Project root directory
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Format Date to YYYY-MM-DD and YYYY-MM-DD_HHMM
 */
function getTimestampParts(d = new Date()) {
  const YYYY = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const DD = String(d.getDate()).padStart(2, '0');
  const HH = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');

  return {
    dateStr: `${YYYY}-${MM}-${DD}`,
    fileStamp: `${YYYY}-${MM}-${DD}_${HH}${mm}`,
    logStamp: `${YYYY}-${MM}-${DD} ${HH}:${mm}:${ss}`,
  };
}

/**
 * Format bytes into human-readable string (KB, MB, GB)
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Read and parse .env file
 */
function parseEnv(root = PROJECT_ROOT) {
  const envCandidates = [
    path.join(root, '.env'),
    path.resolve(root, '..', '..', '.env'),
    'C:\\Users\\dell\\Desktop\\PaperTrade\\.env',
  ];

  const envVars = { ...process.env };

  for (const envPath of envCandidates) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!envVars[key]) {
            envVars[key] = val;
          }
        }
      }
      break;
    }
  }

  return envVars;
}

/**
 * Parse database connection parameters from DATABASE_URL or environment
 */
function getDatabaseConfig(env = parseEnv()) {
  const dbUrl = env.DATABASE_URL;

  if (dbUrl) {
    try {
      const url = new URL(dbUrl);
      return {
        user: decodeURIComponent(url.username || 'postgres'),
        password: decodeURIComponent(url.password || ''),
        host: url.hostname || 'localhost',
        port: url.port || '5432',
        database: url.pathname.replace(/^\//, '') || 'papertrade',
      };
    } catch {
      // Fallback regex if URL parse fails on weird characters
      const regex = /postgresql:\/\/([^:]+):([^@]+)@([^:/]+)(?::(\d+))?\/([^?]+)/;
      const match = dbUrl.match(regex);
      if (match) {
        return {
          user: decodeURIComponent(match[1]),
          password: decodeURIComponent(match[2]),
          host: match[3],
          port: match[4] || '5432',
          database: match[5] || 'papertrade',
        };
      }
    }
  }

  return {
    user: env.PGUSER || 'postgres',
    password: env.PGPASSWORD || '',
    host: env.PGHOST || 'localhost',
    port: env.PGPORT || '5432',
    database: env.PGDATABASE || 'papertrade',
  };
}

/**
 * Locate pg_dump executable on Windows or POSIX
 */
function findPgDump() {
  // Check if pg_dump is directly executable in PATH
  try {
    const checkCmd = process.platform === 'win32' ? 'where pg_dump' : 'which pg_dump';
    const result = execSync(checkCmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (result) {
      return result.split(/\r?\n/)[0].trim();
    }
  } catch {}

  // Standard Windows installation paths
  if (process.platform === 'win32') {
    const standardPaths = [
      'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe',
      'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe',
      'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',
      'C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe',
      'C:\\Program Files\\PostgreSQL\\14\\bin\\pg_dump.exe',
      'C:\\Program Files (x86)\\PostgreSQL\\16\\bin\\pg_dump.exe',
    ];
    for (const p of standardPaths) {
      if (fs.existsSync(p)) return p;
    }
  }

  // Linux / macOS standard paths
  const unixPaths = ['/usr/bin/pg_dump', '/usr/local/bin/pg_dump', '/opt/homebrew/bin/pg_dump'];
  for (const p of unixPaths) {
    if (fs.existsSync(p)) return p;
  }

  return 'pg_dump';
}

/**
 * Locate rclone executable on Windows or POSIX
 */
function findRclone() {
  try {
    const checkCmd = process.platform === 'win32' ? 'where rclone' : 'which rclone';
    const result = execSync(checkCmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (result) {
      return result.split(/\r?\n/)[0].trim();
    }
  } catch {}

  if (process.platform === 'win32') {
    const winPaths = [
      'C:\\rclone\\rclone.exe',
      'C:\\Program Files\\rclone\\rclone.exe',
      path.join(process.env.USERPROFILE || 'C:\\', 'rclone', 'rclone.exe'),
    ];
    for (const p of winPaths) {
      if (fs.existsSync(p)) return p;
    }
  }

  return 'rclone';
}

/**
 * Resolve backup storage paths
 */
function getBackupPaths(env = parseEnv()) {
  let baseDir;
  if (env.PAPERTRADE_BACKUP_DIR) {
    baseDir = path.resolve(env.PAPERTRADE_BACKUP_DIR);
  } else if (process.platform === 'win32') {
    baseDir = 'C:\\PaperTradeBackups';
  } else {
    // Linux / Mac development fallback
    baseDir = path.resolve(PROJECT_ROOT, 'backups');
  }

  const localDir = path.join(baseDir, 'local');
  const logFile = path.join(baseDir, 'backup-log.txt');

  try {
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
  } catch (err) {
    // If permission denied to C:\ on Windows, fallback to project/backups
    if (process.platform === 'win32' && baseDir === 'C:\\PaperTradeBackups') {
      baseDir = path.resolve(PROJECT_ROOT, 'backups');
      const fallbackLocal = path.join(baseDir, 'local');
      fs.mkdirSync(fallbackLocal, { recursive: true });
      return {
        baseDir,
        localDir: fallbackLocal,
        logFile: path.join(baseDir, 'backup-log.txt'),
      };
    }
    throw err;
  }

  return { baseDir, localDir, logFile };
}

/**
 * Clean and flatten log messages into a single line
 */
function sanitizeLogMessage(msg) {
  if (!msg) return '';
  // Remove perl locale warnings if any
  let cleaned = String(msg).replace(/perl: warning:[^\n]*\n?/gi, '');
  // Flatten to single line for log file parsing
  return cleaned.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Append entry to backup-log.txt
 */
function appendLog(logFile, tag, status, message) {
  try {
    const dir = path.dirname(logFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const { logStamp } = getTimestampParts();
    const cleanMsg = sanitizeLogMessage(message);
    const line = `[${logStamp}] [${tag}] ${status}: ${cleanMsg}\n`;
    fs.appendFileSync(logFile, line, 'utf8');
    return line.trim();
  } catch (err) {
    console.error(`[LOG ERROR] Could not write to ${logFile}:`, err.message);
    return null;
  }
}

/**
 * Read the last N lines from backup-log.txt
 */
function readRecentLogs(limit = 30) {
  const { logFile } = getBackupPaths();
  if (!fs.existsSync(logFile)) return [];

  try {
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.trim().split(/\r?\n/).filter(Boolean);
    const recent = lines.slice(-limit).reverse();

    return recent.map((line) => {
      // Line format: [YYYY-MM-DD HH:mm:ss] [TAG] STATUS: details
      const match = line.match(/^\[(.*?)\]\s*\[(.*?)\]\s*(SUCCESS|FAILURE|PARTIAL):\s*(.*)$/);
      if (match) {
        return {
          timestamp: match[1],
          tag: match[2],
          status: match[3],
          message: match[4],
          raw: line,
        };
      }
      return {
        timestamp: new Date().toISOString(),
        tag: 'SYSTEM',
        status: 'INFO',
        message: line,
        raw: line,
      };
    });
  } catch (err) {
    console.error('Failed to read logs:', err.message);
    return [];
  }
}

/**
 * Execute 30-day retention cleanup on local dumps
 */
function cleanRetention(localDir, retentionDays = 30) {
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let deletedCount = 0;

  if (!fs.existsSync(localDir)) return { deletedCount };

  const files = fs.readdirSync(localDir);
  for (const f of files) {
    if (f.endsWith('.dump')) {
      const filePath = path.join(localDir, f);
      try {
        const stats = fs.statSync(filePath);
        if (stats.mtimeMs < cutoffMs) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      } catch {}
    }
  }

  return { deletedCount };
}

/**
 * Find the most recent local backup file created today (or within last 24h)
 */
function findTodayLocalBackup(localDir) {
  if (!fs.existsSync(localDir)) return null;

  const { dateStr } = getTimestampParts();
  const files = fs.readdirSync(localDir);
  const candidateFiles = [];

  for (const f of files) {
    if (f.endsWith('.dump')) {
      const filePath = path.join(localDir, f);
      try {
        const stats = fs.statSync(filePath);
        const ageHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
        // Created today or within last 24 hours, and has non-zero size
        if ((f.includes(dateStr) || ageHours <= 24) && stats.size > 0) {
          candidateFiles.push({ path: filePath, name: f, mtime: stats.mtimeMs, size: stats.size });
        }
      } catch {}
    }
  }

  if (candidateFiles.length === 0) return null;

  // Sort descending by modification time
  candidateFiles.sort((a, b) => b.mtime - a.mtime);
  return candidateFiles[0];
}

/**
 * 1. Run Local Backup (pg_dump custom format -F c)
 */
function runLocalBackup(tag = 'LOCAL') {
  const env = parseEnv();
  const dbConfig = getDatabaseConfig(env);
  const { localDir, logFile } = getBackupPaths(env);
  const pgDumpBin = findPgDump();

  const { fileStamp } = getTimestampParts();
  const filename = `papertrade_${fileStamp}.dump`;
  const targetFile = path.join(localDir, filename);

  const args = [
    '-h', dbConfig.host,
    '-p', String(dbConfig.port),
    '-U', dbConfig.user,
    '-d', dbConfig.database,
    '-F', 'c', // custom format (compressed, supports selective restore)
    '-b',      // include large objects (blobs)
    '-v',      // verbose
    '-f', targetFile,
  ];

  const spawnEnv = {
    ...process.env,
    PGPASSWORD: dbConfig.password,
  };

  const result = spawnSync(pgDumpBin, args, {
    env: spawnEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });

  if (result.error || result.status !== 0) {
    // Clean up empty or corrupted target file if created
    if (fs.existsSync(targetFile)) {
      try { fs.unlinkSync(targetFile); } catch {}
    }

    const errorMsg = result.error
      ? result.error.message
      : result.stderr || result.stdout || `pg_dump exited with code ${result.status}`;
    appendLog(logFile, tag, 'FAILURE', `pg_dump failed: ${errorMsg.trim()}`);
    return {
      success: false,
      error: `pg_dump failed: ${errorMsg.trim()}`,
      tag,
    };
  }

  // Verify created file
  let fileSize = 0;
  let fileSizeFormatted = '0 B';
  if (fs.existsSync(targetFile)) {
    const stat = fs.statSync(targetFile);
    fileSize = stat.size;
    fileSizeFormatted = formatBytes(fileSize);
  }

  // 30-Day Retention Cleanup
  const { deletedCount } = cleanRetention(localDir, 30);
  const retentionMsg = deletedCount > 0
    ? `${deletedCount} file(s) older than 30 days purged`
    : 'no old files to purge';

  appendLog(
    logFile,
    tag,
    'SUCCESS',
    `${filename} (${fileSizeFormatted}) created - Retention: ${retentionMsg}`
  );

  return {
    success: true,
    localDumpPath: targetFile,
    filename,
    fileSize,
    fileSizeFormatted,
    retentionCleanedCount: deletedCount,
    tag,
  };
}

/**
 * 2. Run Weekly Cloud Backup via rclone
 */
function runCloudBackup(tag = 'CLOUD', specificLocalFile = null) {
  const env = parseEnv();
  const { localDir, logFile } = getBackupPaths(env);
  const rcloneBin = findRclone();
  const remoteTarget = env.RCLONE_REMOTE || 'gdrive:PaperTradeBackup';

  // 1. Ensure we have a local dump from today
  let localFileToUpload = specificLocalFile;
  if (!localFileToUpload) {
    const existing = findTodayLocalBackup(localDir);
    if (existing) {
      localFileToUpload = existing.path;
    } else {
      // Generate one
      const localResult = runLocalBackup(tag);
      if (!localResult.success) {
        appendLog(logFile, tag, 'FAILURE', `Could not create local dump for cloud upload: ${localResult.error}`);
        return {
          success: false,
          error: `Could not create local dump for cloud upload: ${localResult.error}`,
          tag,
        };
      }
      localFileToUpload = localResult.localDumpPath;
    }
  }

  if (!fs.existsSync(localFileToUpload)) {
    appendLog(logFile, tag, 'FAILURE', `Local file not found: ${localFileToUpload}`);
    return {
      success: false,
      error: `Local backup file does not exist: ${localFileToUpload}`,
      tag,
    };
  }

  const stat = fs.statSync(localFileToUpload);
  const fileSizeFormatted = formatBytes(stat.size);

  // 2. Check rclone availability
  try {
    const versionCheck = spawnSync(rcloneBin, ['version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 5000,
    });
    if (versionCheck.error || versionCheck.status !== 0) {
      const msg = 'rclone executable not found in PATH or failed to run. Please install rclone and configure Google Drive remote (see SETUP.md).';
      appendLog(logFile, tag, 'FAILURE', msg);
      return { success: false, error: msg, tag };
    }
  } catch (err) {
    const msg = `rclone check failed: ${err.message}. Please install rclone (see SETUP.md).`;
    appendLog(logFile, tag, 'FAILURE', msg);
    return { success: false, error: msg, tag };
  }

  // 3. Verify remote is configured in rclone
  const remoteNameMatch = remoteTarget.match(/^([^:]+:)/);
  const remoteName = remoteNameMatch ? remoteNameMatch[1] : 'gdrive:';
  try {
    const remotesRes = spawnSync(rcloneBin, ['listremotes'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 5000,
    });
    if (remotesRes.status === 0 && remotesRes.stdout) {
      const remotesList = remotesRes.stdout.split(/\r?\n/).map(s => s.trim());
      if (!remotesList.includes(remoteName)) {
        const msg = `Rclone remote '${remoteName}' is not configured. Please run 'rclone config' to set up Google Drive (see SETUP.md).`;
        appendLog(logFile, tag, 'FAILURE', msg);
        return { success: false, error: msg, tag };
      }
    }
  } catch {}

  // 4. Check remote directory list to determine rolling archive
  // Format: gdrive:PaperTradeBackup/
  const normalizedRemote = remoteTarget.endsWith('/') ? remoteTarget : `${remoteTarget}/`;

  const runRcloneCmd = (customArgs, timeoutMs = 60000) => {
    const baseFlags = ['--contimeout=20s', '--timeout=60s'];
    return spawnSync(rcloneBin, [...baseFlags, ...customArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: timeoutMs,
    });
  };

  // Explicitly create the target folder in Google Drive if it doesn't exist
  try {
    runRcloneCmd(['mkdir', normalizedRemote], 45000);
  } catch {}

  let existingRemoteFiles = [];
  try {
    const listResult = runRcloneCmd(['lsf', normalizedRemote], 30000);
    if (listResult.status === 0 && listResult.stdout) {
      existingRemoteFiles = listResult.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }
  } catch (err) {
    // If remote directory does not exist or empty, proceed with upload
  }

  // Rolling Archive Rotation:
  // week 2 -> week 3
  // week 1 -> week 2
  // latest -> week 1
  // new -> latest
  try {
    if (existingRemoteFiles.includes('papertrade_weekly_2.dump')) {
      runRcloneCmd([
        'moveto',
        `${normalizedRemote}papertrade_weekly_2.dump`,
        `${normalizedRemote}papertrade_weekly_3.dump`,
      ], 45000);
    }

    if (existingRemoteFiles.includes('papertrade_weekly_1.dump')) {
      runRcloneCmd([
        'moveto',
        `${normalizedRemote}papertrade_weekly_1.dump`,
        `${normalizedRemote}papertrade_weekly_2.dump`,
      ], 45000);
    }

    if (existingRemoteFiles.includes('papertrade_latest.dump')) {
      runRcloneCmd([
        'moveto',
        `${normalizedRemote}papertrade_latest.dump`,
        `${normalizedRemote}papertrade_weekly_1.dump`,
      ], 45000);
    }

    // Copy new dump to papertrade_latest.dump
    let uploadRes = runRcloneCmd([
      'copyto',
      localFileToUpload,
      `${normalizedRemote}papertrade_latest.dump`,
    ], 120000);

    // Fallback: If copyto failed, attempt copy
    if (uploadRes.error || uploadRes.status !== 0) {
      uploadRes = runRcloneCmd([
        'copy',
        localFileToUpload,
        normalizedRemote,
      ], 120000);
    }

    if (uploadRes.error || uploadRes.status !== 0) {
      const errMsg = uploadRes.error
        ? uploadRes.error.message
        : (uploadRes.stderr || uploadRes.stdout || `rclone exited with code ${uploadRes.status}`);
      appendLog(logFile, tag, 'FAILURE', `rclone upload failed: ${errMsg.trim()}`);
      return {
        success: false,
        error: `rclone upload failed: ${errMsg.trim()}`,
        tag,
      };
    }

    appendLog(
      logFile,
      tag,
      'SUCCESS',
      `Uploaded papertrade_latest.dump (${fileSizeFormatted}) to ${normalizedRemote} (Rolling archive rotated)`
    );

    return {
      success: true,
      remotePath: `${normalizedRemote}papertrade_latest.dump`,
      fileSize: stat.size,
      fileSizeFormatted,
      tag,
    };
  } catch (err) {
    appendLog(logFile, tag, 'FAILURE', `Cloud upload error: ${err.message}`);
    return {
      success: false,
      error: `Cloud upload error: ${err.message}`,
      tag,
    };
  }
}

/**
 * 3. Run Manual Backup (Immediate Local Dump + Cloud Upload)
 */
function runManualBackup() {
  const env = parseEnv();
  const { logFile } = getBackupPaths(env);
  const tag = 'MANUAL';

  // 1. Run fresh local dump
  const localResult = runLocalBackup(tag);
  if (!localResult.success) {
    appendLog(logFile, tag, 'FAILURE', `Manual backup aborted: Local dump failed - ${localResult.error}`);
    return {
      success: false,
      local: localResult,
      cloud: null,
      error: `Local dump failed: ${localResult.error}`,
      tag,
    };
  }

  // 2. Upload to Cloud
  const cloudResult = runCloudBackup(tag, localResult.localDumpPath);

  if (!cloudResult.success) {
    appendLog(
      logFile,
      tag,
      'PARTIAL',
      `Local backup succeeded (${localResult.filename}, ${localResult.fileSizeFormatted}), but Cloud sync failed: ${cloudResult.error}`
    );
    return {
      success: true,
      partial: true,
      local: localResult,
      cloud: cloudResult,
      message: `Local backup created successfully (${localResult.filename}, ${localResult.fileSizeFormatted}), but Cloud upload failed: ${cloudResult.error}`,
      tag,
    };
  }

  appendLog(
    logFile,
    tag,
    'SUCCESS',
    `Local dump (${localResult.filename}, ${localResult.fileSizeFormatted}) + Cloud sync (papertrade_latest.dump) completed successfully`
  );

  return {
    success: true,
    partial: false,
    local: localResult,
    cloud: cloudResult,
    message: `Local backup and Cloud sync completed successfully (${localResult.filename}, ${localResult.fileSizeFormatted})`,
    tag,
  };
}

/**
 * CLI Entrypoint
 */
if (require.main === module) {
  const args = process.argv.slice(2);
  const isJson = args.includes('--json');
  let type = 'local';

  for (const arg of args) {
    if (arg.startsWith('--type=')) {
      type = arg.split('=')[1].toLowerCase();
    }
  }

  let result;
  if (type === 'cloud') {
    result = runCloudBackup('CLOUD');
  } else if (type === 'manual') {
    result = runManualBackup();
  } else {
    result = runLocalBackup('LOCAL');
  }

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.success) {
      console.log(`[SUCCESS] Backup (${type.toUpperCase()}) completed.`);
      if (result.localDumpPath) console.log(` Local file: ${result.localDumpPath}`);
      if (result.remotePath) console.log(` Cloud target: ${result.remotePath}`);
      if (result.fileSizeFormatted) console.log(` Size: ${result.fileSizeFormatted}`);
      if (result.message) console.log(` ${result.message}`);
    } else {
      console.error(`[ERROR] Backup (${type.toUpperCase()}) failed:`, result.error);
    }
  }

  process.exit(result.success ? 0 : 1);
}

module.exports = {
  runLocalBackup,
  runCloudBackup,
  runManualBackup,
  readRecentLogs,
  getBackupPaths,
  getDatabaseConfig,
};
