const fs = require("node:fs");
const path = require("node:path");

const requiredFiles = [
  "package.json",
  "index.html",
  "vite.config.js",
  "electron/main.cjs",
  "electron/preload.cjs",
  "src/main.jsx",
  "src/App.jsx",
  "src/styles.css",
  "src/lib/domain.js",
  "src/lib/storage.js",
  "server/index.cjs",
  ".env.example",
];

const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(process.cwd(), file)));

if (missing.length > 0) {
  console.error(`Missing required files: ${missing.join(", ")}`);
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
const dependencies = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
};

for (const dependency of ["electron", "vite", "react", "react-dom", "lucide-react", "express", "mongodb", "dotenv", "cors"]) {
  if (!dependencies[dependency]) {
    console.error(`Missing dependency declaration: ${dependency}`);
    process.exit(1);
  }
}

console.log("Sherlly project structure check passed.");
