const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const standaloneDir = path.join(rootDir, ".next", "standalone");
const staticSrc = path.join(rootDir, ".next", "static");
const staticDest = path.join(standaloneDir, ".next", "static");
const publicSrc = path.join(rootDir, "public");
const publicDest = path.join(standaloneDir, "public");

if (fs.existsSync(standaloneDir)) {
  if (fs.existsSync(staticSrc)) {
    fs.mkdirSync(path.dirname(staticDest), { recursive: true });
    fs.cpSync(staticSrc, staticDest, { recursive: true });
    console.log("[standalone] Successfully copied .next/static to .next/standalone/.next/static");
  }

  if (fs.existsSync(publicSrc)) {
    fs.mkdirSync(publicDest, { recursive: true });
    fs.cpSync(publicSrc, publicDest, { recursive: true });
    console.log("[standalone] Successfully copied public to .next/standalone/public");
  }

  const scriptsSrc = path.join(rootDir, "scripts");
  const scriptsDest = path.join(standaloneDir, "scripts");
  if (fs.existsSync(scriptsSrc)) {
    fs.mkdirSync(scriptsDest, { recursive: true });
    fs.cpSync(scriptsSrc, scriptsDest, { recursive: true });
    console.log("[standalone] Successfully copied scripts to .next/standalone/scripts");
  }

  const envSrc = path.join(rootDir, ".env");
  const envDest = path.join(standaloneDir, ".env");
  if (fs.existsSync(envSrc) && !fs.existsSync(envDest)) {
    fs.copyFileSync(envSrc, envDest);
    console.log("[standalone] Successfully copied .env to .next/standalone/.env");
  }

  const pdfkitSrc = path.join(rootDir, "node_modules", "pdfkit");
  const pdfkitDest = path.join(standaloneDir, "node_modules", "pdfkit");
  if (fs.existsSync(pdfkitSrc)) {
    fs.mkdirSync(pdfkitDest, { recursive: true });
    fs.cpSync(pdfkitSrc, pdfkitDest, { recursive: true });
    console.log("[standalone] Successfully copied node_modules/pdfkit to .next/standalone/node_modules/pdfkit");
  }

  const reactPdfSrc = path.join(rootDir, "node_modules", "@react-pdf");
  const reactPdfDest = path.join(standaloneDir, "node_modules", "@react-pdf");
  if (fs.existsSync(reactPdfSrc)) {
    fs.mkdirSync(reactPdfDest, { recursive: true });
    fs.cpSync(reactPdfSrc, reactPdfDest, { recursive: true });
    console.log("[standalone] Successfully copied node_modules/@react-pdf to .next/standalone/node_modules/@react-pdf");
  }
}

