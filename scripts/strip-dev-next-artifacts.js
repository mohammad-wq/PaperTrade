/**
 * Remove .next/dev before production build so corrupted dev-only type validators
 * do not break `next build` typecheck (tsconfig includes .next/dev/types).
 */
const fs = require("fs");
const path = require("path");

const devDir = path.join(__dirname, "..", ".next", "dev");
if (fs.existsSync(devDir)) {
  fs.rmSync(devDir, { recursive: true, force: true });
}
