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
const MAX_INPUT_BYTES = 16 * 1024 * 1024;

export function classifyPrivateBootstrapLog(source) {
  if (typeof source !== "string") return UNKNOWN;
  const matches = CLASSES.filter(([, pattern]) => pattern.test(source));
  // Multiple known failure categories are ambiguous; never infer precedence.
  return matches.length === 1 ? matches[0][0] : UNKNOWN;
}

// Read a private, single-link regular file through one descriptor. Path names
// are never followed through symbolic links; a changed pathname or inode is
// rejected instead of silently classifying replacement bytes.
function readPrivateLog(file) {
  const flags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
  let fd;
  try {
    const pathBefore = fs.lstatSync(file);
    if (!pathBefore.isFile() || pathBefore.nlink !== 1 || pathBefore.size > MAX_INPUT_BYTES) return null;
    fd = fs.openSync(file, flags);
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size > MAX_INPUT_BYTES ||
        before.dev !== pathBefore.dev || before.ino !== pathBefore.ino) return null;
    // Limit physical reads, even if another process grows the file after fstat.
    const data = Buffer.alloc(before.size + 1);
    let used = 0;
    while (used < data.length) {
      const n = fs.readSync(fd, data, used, data.length - used, null);
      if (n === 0) break;
      used += n;
    }
    const after = fs.fstatSync(fd);
    const pathAfter = fs.lstatSync(file);
    const identical = (a, b) => a.dev === b.dev && a.ino === b.ino &&
      a.mode === b.mode && a.nlink === b.nlink && a.size === b.size &&
      a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
    if (!identical(before, after) || !identical(before, pathAfter) ||
        !pathAfter.isFile() || used !== before.size) return null;
    return data.subarray(0, used).toString("utf8");
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

if (process.argv[1] && process.argv[1].endsWith("/classify-private-sidecar-failure.mjs")) {
  let category = UNKNOWN;
  try {
    const file = process.argv[2];
    if (file) {
      const source = readPrivateLog(file);
      if (source !== null) category = classifyPrivateBootstrapLog(source);
    }
  } catch {
    // Fail closed to UNKNOWN without exposing file paths or exceptions.
  }
  process.stdout.write(category + "\n");
}
