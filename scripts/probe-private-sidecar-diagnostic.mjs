#!/usr/bin/env node
// Issue #91: bounded, fail-closed classifier with Unix process-group cleanup.
// The classifier and same-group descendants are killed on every exit/failure.
// Never publish private output, subprocess diagnostics, paths, or identifiers.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const UNKNOWN = "UNKNOWN";
const ALLOWED = new Set([
  "ENVIRONMENT_MISSING", "DRIVE_AUTH_FAILURE", "STAGE6_READ_FAILURE",
  "STAGE6_TRIGGER_REJECTED", UNKNOWN,
]);

export async function probeClassifier(command, args, {
  timeoutMs = 2500,
  maxBuffer = 1024,
  env = {},
} = {}) {
  // GitHub's reviewed runner uses Linux. Windows has no Unix killpg boundary.
  if (process.platform === "win32" || !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 || !Number.isSafeInteger(maxBuffer) || maxBuffer < 1) return UNKNOWN;
  return await new Promise(resolve => {
    let child;
    let invalid = false;
    let finished = false;
    let code = null;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const chunks = [];
    let timeoutHandle;
    let failsafeHandle;
    const signals = ["SIGTERM", "SIGINT", "SIGHUP"];
    const onSignal = () => abort();
    const removeSignalHandlers = () => {
      for (const signal of signals) process.removeListener(signal, onSignal);
    };

    const killGroup = () => {
      if (!Number.isInteger(child?.pid) || child.pid <= 0) return;
      try { process.kill(-child.pid, "SIGKILL"); }
      catch (e) { if (e?.code !== "ESRCH") invalid = true; }
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutHandle);
      clearTimeout(failsafeHandle);
      removeSignalHandlers();
      killGroup();
      if (invalid || code !== 0 || stderrBytes !== 0) return resolve(UNKNOWN);
      const output = Buffer.concat(chunks).toString("utf8");
      if (!output.endsWith("\n")) return resolve(UNKNOWN);
      const candidate = output.slice(0, -1);
      resolve(ALLOWED.has(candidate) ? candidate : UNKNOWN);
    };
    const abort = () => {
      invalid = true;
      killGroup();
      child?.stdout?.destroy();
      child?.stderr?.destroy();
      // A descendant that escaped the process group can retain a pipe.
      // A bounded fail-closed return is required even in that case.
      failsafeHandle ??= setTimeout(finish, 200);
    };
    // Preserve process-group cleanup if the outer runner timeout sends TERM.
    for (const signal of signals) process.on(signal, onSignal);
    try {
      // A new Unix session/group isolates kill(-pid) from the runner/producer.
      child = spawn(command, args, {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env,
        windowsHide: true,
      });
    } catch { removeSignalHandlers(); resolve(UNKNOWN); return; }

    child.stdout.on("data", data => {
      stdoutBytes += data.length;
      if (stdoutBytes > maxBuffer) abort();
      else chunks.push(data);
    });
    child.stderr.on("data", data => {
      stderrBytes += data.length;
      if (stderrBytes > maxBuffer) abort();
    });
    child.on("error", abort);
    child.on("exit", (exitCode, signal) => {
      code = exitCode;
      if (signal !== null) invalid = true;
      // Also clean up grandchildren when the direct child exits cleanly.
      killGroup();
    });
    child.on("close", finish);
    timeoutHandle = setTimeout(abort, timeoutMs);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) ===
    fileURLToPath(import.meta.url)) {
  const classifierPath = fileURLToPath(
    new URL("./classify-private-sidecar-failure.mjs", import.meta.url)
  );
  const category = process.argv[2]
    ? await probeClassifier(process.execPath, [classifierPath, process.argv[2]])
    : UNKNOWN;
  process.stdout.write(category + "\n");
}
