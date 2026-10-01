import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { parseStrictJsonText } from "./json-utils.js";

type Fail = (code: string) => never;
type Validate<T> = (value: unknown) => asserts value is T;
const loadedBytes = new WeakMap<object, { file: string; raw: Buffer; validateState: unknown }>();

export const storageObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const storageText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
export const storageTimestamp = (value: unknown): boolean =>
  typeof value === "string" && value === value.trim()
  && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && Number.isFinite(Date.parse(value))
  && new Date(`${value.slice(0, 10)}T00:00:00.000Z`).toISOString().startsWith(value.slice(0, 10));

async function requireUnlocked(file: string, fail: Fail): Promise<void> {
  try {
    await lstat(`${file}.lock`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    fail("LOCK_UNAVAILABLE");
  }
  fail("LOCK_UNAVAILABLE");
}

function parseState<T extends object>(raw: Buffer, validateState: Validate<T>, fail: Fail): T {
  let state: unknown;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
    state = parseStrictJsonText<unknown>(decoded, "ORDER_STATE_JSON_INVALID");
  } catch {
    fail("JSON_INVALID");
  }
  validateState(state);
  return state;
}

export async function loadValidatedOrderState<T extends object>(file: string, validateState: Validate<T>, fail: Fail): Promise<T> {
  await requireUnlocked(file, fail);
  let raw: Buffer;
  try {
    raw = await readFile(file);
  } catch {
    fail("READ_FAILED");
  }
  const state = parseState(raw, validateState, fail);
  await requireUnlocked(file, fail);
  loadedBytes.set(state, { file, raw, validateState });
  return state;
}

export async function saveValidatedOrderState<T extends object>(file: string, state: T, validateState: Validate<T>, fail: Fail): Promise<void> {
  validateState(state);
  const before = loadedBytes.get(state);
  if (!before || before.file !== file || before.validateState !== validateState) fail("UNLOADED_STATE");
  const lockPath = `${file}.lock`;
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch {
    fail("LOCK_UNAVAILABLE");
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle;
  let created = false;
  let committed = false;
  let durable = false;
  try {
    const raw = Buffer.from(JSON.stringify(state, null, 2), "utf8");
    handle = await open(temporary, "wx", 0o600);
    created = true;
    await handle.writeFile(raw);
    await handle.sync();
    await handle.close();
    handle = undefined;
    const written = await readFile(temporary);
    if (!written.equals(raw)) fail("WRITE_VERIFY_FAILED");
    parseState(written, validateState, fail);
    if (!(await readFile(file)).equals(before.raw)) fail("STORE_CHANGED");
    await rename(temporary, file);
    committed = true;
    const directory = await open(dirname(file), "r");
    try { await directory.sync(); }
    finally { await directory.close(); }
    durable = true;
    loadedBytes.set(state, { file, raw, validateState });
  } catch {
    // Never include filesystem errors, paths, or serialized state in public failures.
    fail(committed ? "COMMIT_UNCERTAIN" : "WRITE_FAILED");
  } finally {
    try {
      await handle?.close();
      if (created && !committed) await unlink(temporary);
      await lock.close();
      // An uncertain commit must remain blocked; never retry or roll it back silently.
      if (!committed || durable) await unlink(lockPath);
    } catch {
      fail("CLEANUP_FAILED");
    }
  }
}
