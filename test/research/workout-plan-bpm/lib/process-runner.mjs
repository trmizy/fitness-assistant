// Argument-array process execution (no shell, so no quoting hazards on Windows) with a hard timeout and captured output.
// A timed-out or failed process is a RESULT, never an exception the caller can silently drop.
import { execFile } from "node:child_process";

export function runProcess(cmd, args, { timeoutMs = 120000, maxBuffer = 256 * 1024 * 1024, env = {}, cwd } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer, encoding: "utf8", windowsHide: true, killSignal: "SIGKILL", env: { ...process.env, MSYS_NO_PATHCONV: "1", ...env } }, (err, stdout, stderr) => {
      const timedOut = Boolean(err && (err.killed || err.signal === "SIGKILL") && Date.now() - started >= timeoutMs - 50);
      resolve({
        exitCode: err ? (typeof err.code === "number" ? err.code : 1) : 0,
        timedOut,
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        durationMs: Date.now() - started,
      });
    });
    child.on("error", () => { /* surfaced through the callback above */ });
  });
}
