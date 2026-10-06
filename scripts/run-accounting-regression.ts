/**
 * Phase 11: orchestrate accounting/inventory regression scripts
 */
import { spawnSync } from "child_process";
import path from "path";

const scripts = [
  "test-phase1-post-journal.ts",
  "test-phase2-fifo.ts",
  "test-phase3-sales-cogs.ts",
];

let failed = false;
for (const script of scripts) {
  const full = path.join(__dirname, script);
  console.log(`\n--- Running ${script} ---`);
  const res = spawnSync("npx", ["tsx", full], { stdio: "inherit", shell: true });
  if (res.status !== 0) failed = true;
}

if (failed) {
  console.error("\nAccounting regression suite FAILED.");
  process.exit(1);
}
console.log("\nAccounting regression suite passed.");
