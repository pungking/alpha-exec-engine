#!/usr/bin/env node
// Issue #91: bounded, fail-closed bridge to the existing private classifier.
// The child is deliberately denied the runner's inherited environment.
// No original logs, subprocess errors, file paths or identifiers are published.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const UNKNOWN = "UNKNOWN";
const ALLOWED = new Set([
  "ENVIRONMENT_MISSING", "DRIVE_AUTH_FAILURE", "STAGE6_READ_FAILURE",
  "STAGE6_TRIGGER_REJECTED", UNKNOWN,
]);

export function probeClassifier(command, args, {
  timeoutMs = 2500,
  maxBuffer = 1024,
  env = {},
} = {}) {
  try {
    const child = spawnSync(command, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer,
      env,
      windowsHide: true,
    });
    if (child.error || child.signal || child.status !== 0 ||
        typeof child.stderr !== "string" || child.stderr !== "" ||
        typeof child.stdout !== "string" || !child.stdout.endsWith("\n")) {
      return UNKNOWN;
    }
    const category = child.stdout.slice(0, -1);
    return ALLOWED.has(category) ? category : UNKNOWN;
  } catch {
    return UNKNOWN;
  }
}

// Avoid executing the CLI during imported synthetic unit tests.
if (process.argv[1] && fileURLToPath(import.meta.url) ===
    fileURLToPath(new URL("file://" + process.argv[1]))) {
  const classifierPath = fileURLToPath(
    new URL("./classify-private-sidecar-failure.mjs", import.meta.url)
  );
  const category = process.argv[2]
    ? probeClassifier(process.execPath, [classifierPath, process.argv[2]])
    : UNKNOWN;
  process.stdout.write(category + "\n");
}
