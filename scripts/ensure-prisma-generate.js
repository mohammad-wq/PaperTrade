/**
 * Run prisma generate unless PaperTrade Next dev still holds the query engine DLL (Windows EPERM).
 */
const path = require("path");
const { execSync, spawnSync } = require("child_process");

const projectRoot = path.join(__dirname, "..");
const rootNorm = projectRoot.replace(/\//g, "\\").toLowerCase();

function findPaperTradeDevPids() {
  try {
    const raw = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name = \'node.exe\'\\" | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"',
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
    const parsed = JSON.parse(raw || "[]");
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.filter((p) => {
      const cmd = (p.CommandLine || "").toLowerCase();
      if (!cmd.includes(rootNorm)) return false;
      return (
        cmd.includes("next dev") ||
        cmd.includes("next/dist/bin/next dev") ||
        cmd.includes("start-server.js") ||
        cmd.includes("turbopack") ||
        (cmd.includes("npm-cli.js") && cmd.includes(" run dev"))
      );
    });
  } catch {
    return [];
  }
}

const devProcs = findPaperTradeDevPids();

if (devProcs.length > 0) {
  const pids = devProcs.map((p) => p.ProcessId).join(", ");
  console.error(
    "\n[build] Cannot run prisma generate while the PaperTrade dev server is running.\n" +
      `        Stop npm run dev first (Node PIDs: ${pids}), then run npm run build again.\n` +
      "        On Windows, a running dev server locks query_engine-windows.dll.node (EPERM).\n",
  );
  process.exit(1);
}

const gen = spawnSync("npx", ["prisma", "generate"], {
  cwd: projectRoot,
  encoding: "utf8",
  shell: true,
  stdio: "inherit",
});

process.exit(gen.status === 0 ? 0 : gen.status ?? 1);
