import path from "path";
import { exec } from "child_process";
import fs from "fs";

export type BackupExecutionResult = {
  success: boolean;
  partial?: boolean;
  localDumpPath?: string;
  filename?: string;
  fileSize?: number;
  fileSizeFormatted?: string;
  retentionCleanedCount?: number;
  remotePath?: string;
  error?: string;
  message?: string;
  tag?: string;
  timestamp?: string;
  local?: Partial<BackupExecutionResult> | null;
  cloud?: Partial<BackupExecutionResult> | null;
};

export type BackupLogEntry = {
  timestamp: string;
  tag: string;
  status: "SUCCESS" | "FAILURE" | "PARTIAL" | "INFO";
  message: string;
  raw: string;
};

const PROJECT_ROOT = process.cwd();

function resolveRunnerScript(): { scriptPath: string; workingDir: string } {
  const cwd = process.cwd();
  const candidates = [
    // 1. If running inside .next/standalone, actual project root is 2 levels up
    path.resolve(cwd, "..", ".."),
    // 2. Current working directory
    // 3. User profile desktop directory if applicable
    ...(process.env.USERPROFILE ? [path.join(process.env.USERPROFILE, "Desktop", "PaperTrade")] : []),
    // 4. Relative to compiled module directory
    path.resolve(__dirname, "..", ".."),
    path.resolve(__dirname, "..", "..", ".."),
    path.resolve(__dirname, "..", "..", "..", ".."),
  ];

  for (const dir of candidates) {
    const candidateScript = path.join(dir, "scripts", "backup-runner.js");
    if (fs.existsSync(candidateScript)) {
      return {
        scriptPath: candidateScript,
        workingDir: dir,
      };
    }
  }

  // Fallback to default
  return {
    scriptPath: path.join(cwd, "scripts", "backup-runner.js"),
    workingDir: cwd,
  };
}

/**
 * Execute local, cloud, or manual backup via the shared runner
 */
export async function executeBackup(type: "local" | "cloud" | "manual"): Promise<BackupExecutionResult> {
  return new Promise((resolve) => {
    const nodeBin = process.execPath || "node";
    const { scriptPath, workingDir } = resolveRunnerScript();
    const cmd = `"${nodeBin}" "${scriptPath}" --type=${type} --json`;

    exec(
      cmd,
      {
        cwd: workingDir,
        timeout: 180000, // 3 minutes timeout
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const timestamp = new Date().toISOString();

        if (stdout && stdout.trim()) {
          try {
            const parsed = JSON.parse(stdout.trim());
            return resolve({
              ...parsed,
              timestamp,
            });
          } catch {
            // Non-JSON output
          }
        }

        if (error) {
          const errMsg = stderr?.trim() || stdout?.trim() || error.message;
          return resolve({
            success: false,
            error: errMsg,
            tag: type.toUpperCase(),
            timestamp,
          });
        }

        return resolve({
          success: true,
          message: stdout?.trim() || "Backup executed successfully",
          tag: type.toUpperCase(),
          timestamp,
        });
      }
    );
  });
}

/**
 * Read the last N log entries from the backup log file
 */
export async function readRecentBackupLogs(limit = 30): Promise<BackupLogEntry[]> {
  try {
    let baseDir: string;
    if (process.env.PAPERTRADE_BACKUP_DIR) {
      baseDir = path.resolve(process.env.PAPERTRADE_BACKUP_DIR);
    } else if (process.platform === "win32") {
      baseDir = "C:\\PaperTradeBackups";
    } else {
      baseDir = path.resolve(PROJECT_ROOT, "backups");
    }

    const logFile = path.join(baseDir, "backup-log.txt");
    if (!fs.existsSync(/*turbopackIgnore: true*/ logFile)) {
      return [];
    }

    const content = await fs.promises.readFile(logFile, "utf8");
    const lines = content.trim().split(/\r?\n/).filter(Boolean);
    const recent = lines.slice(-limit).reverse();

    return recent.map((line) => {
      const match = line.match(/^\[(.*?)\]\s*\[(.*?)\]\s*(SUCCESS|FAILURE|PARTIAL):\s*(.*)$/);
      if (match) {
        return {
          timestamp: match[1],
          tag: match[2],
          status: match[3] as "SUCCESS" | "FAILURE" | "PARTIAL",
          message: match[4],
          raw: line,
        };
      }
      return {
        timestamp: new Date().toISOString(),
        tag: "SYSTEM",
        status: "INFO",
        message: line,
        raw: line,
      };
    });
  } catch (err) {
    console.error("Error reading backup logs:", err);
    return [];
  }
}

