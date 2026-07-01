import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import electron from "electron";

const mainEntry = join(process.cwd(), "out", "main", "index.js");

await access(mainEntry);

const child = spawn(electron, [mainEntry], {
  env: {
    ...process.env,
    DRAFT_COACH_SMOKE: "1",
    ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
const timeout = setTimeout(() => {
  child.kill("SIGTERM");
  console.error("Electron smoke timed out");
  process.exitCode = 1;
}, 30_000);

child.stdout.on("data", (chunk) => {
  output += chunk.toString();
  process.stdout.write(chunk);
});

child.stderr.on("data", (chunk) => {
  output += chunk.toString();
  process.stderr.write(chunk);
});

child.on("exit", (code) => {
  clearTimeout(timeout);

  if (code !== 0) {
    console.error(`Electron smoke exited with code ${code}`);
    process.exitCode = code ?? 1;
    return;
  }

  if (!output.includes("[Smoke] window.api.ping() -> pong")) {
    console.error("Electron smoke did not confirm preload IPC");
    process.exitCode = 1;
  }
});
