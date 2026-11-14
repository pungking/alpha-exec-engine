#!/usr/bin/env node
// Closed vocabulary only: no source lines, identifiers, paths or exception text escape.
import fs from "node:fs";

const CLASSES = Object.freeze([
  ["ENVIRONMENT_MISSING", /^\[ENV_GUARD\] FAIL missing=/m],
  ["DRIVE_AUTH_FAILURE", /^\[DRY_RUN\] FAIL Google token refresh (?:failed \(\d{3}\)|response missing access_token)/m],
  ["STAGE6_READ_FAILURE", /^\[DRY_RUN\] FAIL (?:Drive (?:list|download) failed \(\d{3}\)|No STAGE6_ALPHA_FINAL_\* file found in GDRIVE_STAGE6_FOLDER)/m],
  ["STAGE6_TRIGGER_REJECTED", /^\[TRIGGER_VALIDATE\] fail (?:missing|invalid|stage6 hash mismatch|stage6 file mismatch)/m],
]);
const UNKNOWN = "UNKNOWN";

export function classifyPrivateBootstrapLog(source) {
  if (typeof source !== "string") return UNKNOWN;
  const matches = CLASSES.filter(([, pattern]) => pattern.test(source));
  // Multiple known failure categories are ambiguous; never infer precedence.
  return matches.length === 1 ? matches[0][0] : UNKNOWN;
}

if (process.argv[1] && process.argv[1].endsWith("/classify-private-sidecar-failure.mjs")) {
  let category = UNKNOWN;
  try {
    const file = process.argv[2];
    if (file && fs.statSync(file).size <= 16 * 1024 * 1024) {
      category = classifyPrivateBootstrapLog(fs.readFileSync(file, "utf8"));
    }
  } catch {
    // Fail closed to UNKNOWN without exposing file paths or exceptions.
  }
  process.stdout.write(category + "\n");
}
