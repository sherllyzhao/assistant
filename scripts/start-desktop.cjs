const childProcess = require("node:child_process");
const path = require("node:path");

const electronPath = require("electron");
const appRoot = path.join(__dirname, "..");
const env = { ...process.env };

delete env.ELECTRON_RUN_AS_NODE;

const child = childProcess.spawn(electronPath, [appRoot], {
  cwd: appRoot,
  env,
  stdio: "inherit",
  windowsHide: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
