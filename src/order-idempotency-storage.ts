import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { LifecycleActionType } from "../config/policy.js";
import { parseStrictJsonText } from "./json-utils.js";

export type OrderLifecycleStatus =
  | "planned"
  | "submitted"
  | "accepted"
  | "partially_filled"
  | "filled"
  | "canceled"
  | "rejected"
  | "expired";

export type OrderIdempotencyEntry = {
  symbol: string;
  side: "buy";
  executionSide?: "buy" | "sell" | null;
  actionType?: LifecycleActionType;
  submittedQty?: number | null;
  stage6Hash: string;
  stage6File: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  clientOrderId?: string;
  brokerOrderId?: string | null;
  brokerStatus?: OrderLifecycleStatus | null;
  brokerCheckedAt?: string;
  recoveryMode?: "ACTIVE_POSITION_LIMITED_CONTROL";
  originalIdempotencyEvidenceStatus?: string;
  recoveryEvidenceSha256?: string;
  recoveryRecordedAt?: string;
  recoveryRecordedAtIsOriginalTimestamp?: false;
  entryAllowed?: false;
  scaleInAllowed?: false;
  riskIncreasingActionAllowed?: false;
  reportOnlyExitEvaluationAllowed?: true;
  brokerSubmitAllowed?: false;
  realizedPnlVerified?: false;
  historicalEvidenceNormalized?: false;
};

export type OrderIdempotencyReleaseRecord = {
  key: string;
  symbol: string;
  side: "buy";
  executionSide?: "buy" | "sell" | null;
  actionType?: LifecycleActionType;
  submittedQty?: number | null;
  stage6Hash: string;
  stage6File: string;
  clientOrderId: string | null;
  brokerOrderId: string | null;
  brokerStatus: OrderLifecycleStatus | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  releasedAt: string;
  reason: string;
  recoveryMode?: "ACTIVE_POSITION_LIMITED_CONTROL";
  brokerSubmitAllowed?: false;
  realizedPnlVerified?: false;
  historicalEvidenceNormalized?: false;
};

export type OrderIdempotencyState = {
  orders: Record<string, OrderIdempotencyEntry>;
  releases: OrderIdempotencyReleaseRecord[];
  updatedAt: string;
};

export class OrderIdempotencyStorageError extends Error {
  constructor(code: string) {
    super(`ORDER_IDEMPOTENCY_${code}`);
    this.name = "OrderIdempotencyStorageError";
  }
}
const loadedBytes = new WeakMap<OrderIdempotencyState, { file: string; raw: Buffer }>();
function fail(code: string): never { throw new OrderIdempotencyStorageError(code); }
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const timestamp = (value: unknown): boolean =>
  typeof value === "string" && value === value.trim()
  && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && Number.isFinite(Date.parse(value))
  && new Date(`${value.slice(0, 10)}T00:00:00.000Z`).toISOString().startsWith(value.slice(0, 10));
const nullableTimestamp = (value: unknown): boolean => value === null || timestamp(value);
const optionalText = (value: unknown): boolean => value === undefined || value === null || text(value);
const brokerStatuses = new Set(["planned", "submitted", "accepted", "partially_filled", "filled", "canceled", "rejected", "expired"]);
const actions = new Set(["ENTRY_NEW", "HOLD_WAIT", "SCALE_UP", "SCALE_DOWN", "EXIT_PARTIAL", "EXIT_FULL"]);

function validRecord(value: unknown, release: boolean): boolean {
  if (!object(value) || !text(value.symbol) || value.side !== "buy"
    || !text(value.stage6Hash) || !text(value.stage6File)
    || !nullableTimestamp(value.firstSeenAt) || !nullableTimestamp(value.lastSeenAt)
    || !optionalText(value.clientOrderId) || !optionalText(value.brokerOrderId)
    || (value.executionSide != null && (typeof value.executionSide !== "string" || !["buy", "sell"].includes(value.executionSide)))
    || (value.actionType !== undefined && (typeof value.actionType !== "string" || !actions.has(value.actionType)))
    || (value.brokerStatus != null && (typeof value.brokerStatus !== "string" || !brokerStatuses.has(value.brokerStatus)))
    || (value.brokerCheckedAt !== undefined && !timestamp(value.brokerCheckedAt))
    || (value.submittedQty != null && (typeof value.submittedQty !== "number" || !Number.isFinite(value.submittedQty) || value.submittedQty < 0))) return false;
  if (release && (!text(value.key) || !timestamp(value.releasedAt) || !text(value.reason)
    || value.clientOrderId === undefined || value.brokerOrderId === undefined || value.brokerStatus === undefined)) return false;
  if (value.recoveryMode === undefined) return ![
    "originalIdempotencyEvidenceStatus", "recoveryEvidenceSha256", "recoveryRecordedAt",
    "recoveryRecordedAtIsOriginalTimestamp", "entryAllowed", "scaleInAllowed", "riskIncreasingActionAllowed",
    "reportOnlyExitEvaluationAllowed", "brokerSubmitAllowed", "realizedPnlVerified", "historicalEvidenceNormalized"
  ].some((key) => Object.hasOwn(value, key));
  if (value.recoveryMode !== "ACTIVE_POSITION_LIMITED_CONTROL"
    || value.brokerSubmitAllowed !== false || value.realizedPnlVerified !== false
    || value.historicalEvidenceNormalized !== false) return false;
  return release || (text(value.originalIdempotencyEvidenceStatus)
    && typeof value.recoveryEvidenceSha256 === "string" && /^[a-f0-9]{64}$/.test(value.recoveryEvidenceSha256)
    && timestamp(value.recoveryRecordedAt) && value.recoveryRecordedAtIsOriginalTimestamp === false
    && value.entryAllowed === false && value.scaleInAllowed === false
    && value.riskIncreasingActionAllowed === false && value.reportOnlyExitEvaluationAllowed === true);
}

function validateState(value: unknown): asserts value is OrderIdempotencyState {
  if (!object(value) || !object(value.orders) || !Array.isArray(value.releases)
    || !(timestamp(value.updatedAt) || (value.updatedAt === "" && Object.keys(value.orders).length === 0 && value.releases.length === 0))
    || Object.entries(value.orders).some(([key, row]) => !text(key)
      || ["__proto__", "constructor", "prototype"].includes(key) || !validRecord(row, false))
    || value.releases.some((row) => !validRecord(row, true))) fail("SCHEMA_INVALID");
}

async function requireUnlocked(file: string): Promise<void> {
  try {
    await lstat(`${file}.lock`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    fail("LOCK_UNAVAILABLE");
  }
  fail("LOCK_UNAVAILABLE");
}

function parseState(raw: Buffer): OrderIdempotencyState {
  let state: unknown;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
    state = parseStrictJsonText<unknown>(decoded, "ORDER_IDEMPOTENCY_JSON_INVALID");
  } catch {
    fail("JSON_INVALID");
  }
  validateState(state);
  return state;
}

export async function loadOrderIdempotencyState(file: string): Promise<OrderIdempotencyState> {
  await requireUnlocked(file);
  let raw: Buffer;
  try {
    raw = await readFile(file);
  } catch {
    fail("READ_FAILED");
  }
  const state = parseState(raw);
  await requireUnlocked(file);
  loadedBytes.set(state, { file, raw });
  return state;
}

export async function saveOrderIdempotencyState(file: string, state: OrderIdempotencyState): Promise<void> {
  validateState(state);
  const before = loadedBytes.get(state);
  if (!before || before.file !== file) fail("UNLOADED_STATE");
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
    parseState(written);
    if (!(await readFile(file)).equals(before.raw)) fail("STORE_CHANGED");
    await rename(temporary, file);
    committed = true;
    const directory = await open(dirname(file), "r");
    try { await directory.sync(); }
    finally { await directory.close(); }
    durable = true;
    loadedBytes.set(state, { file, raw });
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
