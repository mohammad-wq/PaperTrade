const fs = require("fs");
const path = require("path");

const pkgPath = path.resolve(__dirname, "..", "node_modules", "@react-pdf", "hyphenate", "package.json");

if (fs.existsSync(pkgPath)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    let modified = false;

    if (pkg.exports && pkg.exports["./*"] && !pkg.exports["./*"].default) {
      pkg.exports["./*"].default = "./lib/*.js";
      modified = true;
    }
    if (pkg.exports && pkg.exports["."] && !pkg.exports["."].default) {
      pkg.exports["."].default = "./lib/index.js";
      modified = true;
    }

    if (modified) {
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), "utf8");
      console.log("[patch-react-pdf] Successfully patched @react-pdf/hyphenate package.json exports");
    } else {
      console.log("[patch-react-pdf] @react-pdf/hyphenate already patched");
    }
  } catch (err) {
    console.warn("[patch-react-pdf] Failed to patch @react-pdf/hyphenate:", err.message);
  }
}
