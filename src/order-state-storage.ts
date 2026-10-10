import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { parseStrictJsonText } from "./json-utils.js";
import { AsyncLocalStorage } from 'node:async_hooks';
import { resolve, join } from 'node:path';

type Fail = (code: string) => never;
type Validate<T> = (value: unknown) => asserts value is T;
const loadedBytes = new WeakMap<object, { file: string; raw: Buffer; validateState: unknown }>();
const directoryOwner = new AsyncLocalStorage<{ directory: string; token: string }>();

// The local writer fence does not claim to exclude remote account writers.
export async function withOrderStateDirectoryLock<T>(directory: string, task: () => Promise<T>): Promise<T> {
  const lock = join(resolve(directory), '.scoped-closeout.lock'), token = randomUUID();
  let handle;
  try { handle = await open(lock, 'wx', 0o600); }
  catch { throw new Error('SCOPED_STORE_LOCK_UNAVAILABLE'); }
  let complete = false;
  try {
    await handle.writeFile(token); await handle.sync();
    const parent = await open(directory, 'r');
    try { await parent.sync(); } finally { await parent.close(); }
    const result = await directoryOwner.run({ directory: resolve(directory), token }, task);
    if (await readFile(lock, 'utf8') !== token) throw new Error('SCOPED_STORE_LOCK_CHANGED');
    complete = true;
    return result;
  } finally {
    await handle.close();
    if (complete) await unlink(lock);
  }
}

async function requireDirectoryOwner(file: string, fail: Fail): Promise<void> {
  const directory = resolve(dirname(file)), owner = directoryOwner.getStore();
  let token: string;
  const lock = join(directory, '.scoped-closeout.lock');
  try { await lstat(lock); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && owner?.directory !== directory) return;
    fail('LOCK_UNAVAILABLE');
  }
  try { token = await readFile(lock, 'utf8'); }
  catch { fail('LOCK_UNAVAILABLE'); }
  if (owner?.directory !== directory || owner.token !== token) fail('LOCK_UNAVAILABLE');
}

export const storageObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const storageText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
export const storageTimestamp = (value: unknown): boolean =>
  typeof value === "string" && value === value.trim()
  && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && Number.isFinite(Date.parse(value))
  && new Date(`${value.slice(0, 10)}T00:00:00.000Z`).toISOString().startsWith(value.slice(0, 10));

async function requireUnlocked(file: string, fail: Fail): Promise<void> {
  await requireDirectoryOwner(file, fail);
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
  await requireDirectoryOwner(file, fail);
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
    await requireDirectoryOwner(file, fail);
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
    // A failed unlink must not strand open handles; keep the lock on uncertainty.
    const closed = await Promise.allSettled([handle?.close(), lock.close()]);
    let cleanupFailed = closed.some(result => result.status === 'rejected');
    try { if (created && !committed) await unlink(temporary); }
    catch { cleanupFailed = true; }
    try { if (!cleanupFailed && (!committed || durable)) await unlink(lockPath); }
    catch { cleanupFailed = true; }
    if (cleanupFailed) fail('CLEANUP_FAILED');
  }
}
