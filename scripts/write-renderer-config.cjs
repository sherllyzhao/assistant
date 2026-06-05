const fs = require("node:fs");
const path = require("node:path");

const appRoot = path.join(__dirname, "..");
const configPath = path.join(appRoot, "electron", "renderer-config.json");
const requireRendererUrl = process.argv.includes("--require-url");

require("dotenv").config({ path: path.join(appRoot, ".env"), quiet: true });

function normalizeRendererUrl(value) {
  const url = String(value || "").trim();

  if (!url) {
    return "";
  }

  try {
    const parsedUrl = new URL(url);

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("renderer url must use http or https");
    }

    return parsedUrl.toString().replace(/\/$/, "");
  } catch (error) {
    throw new Error(`Invalid SHERLLY_RENDERER_URL: ${error.message}`);
  }
}

const productionRendererUrl = normalizeRendererUrl(
  process.env.SHERLLY_RENDERER_URL || process.env.ELECTRON_RENDERER_URL || "",
);

if (requireRendererUrl && !productionRendererUrl) {
  console.error("SHERLLY_RENDERER_URL is required for desktop release builds.");
  process.exit(1);
}

fs.writeFileSync(
  configPath,
  `${JSON.stringify({ productionRendererUrl }, null, 2)}\n`,
  "utf8",
);

if (productionRendererUrl) {
  console.log(`Wrote production renderer URL: ${productionRendererUrl}`);
} else {
  console.log("Wrote empty production renderer URL; packaged app will use bundled dist fallback.");
}
