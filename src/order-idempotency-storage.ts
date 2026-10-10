import type { LifecycleActionType } from "../config/policy.js";
import { validateScopedManagementRecord, type ScopedManagementRecord } from './scoped-management-record.js';
import { loadValidatedOrderState, saveValidatedOrderState, storageObject as object, storageText as text, storageTimestamp as timestamp } from "./order-state-storage.js";

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
function fail(code: string): never { throw new OrderIdempotencyStorageError(code); }
const nullableTimestamp = (value: unknown): boolean => value === null || timestamp(value);
const optionalText = (value: unknown): boolean => value === undefined || value === null || text(value);
export const brokerStatuses = new Set(["planned", "submitted", "accepted", "partially_filled", "filled", "canceled", "rejected", "expired"]);
export const actions = new Set(["ENTRY_NEW", "HOLD_WAIT", "SCALE_UP", "SCALE_DOWN", "EXIT_PARTIAL", "EXIT_FULL"]);

function validRecord(value: unknown, release: boolean): boolean {
  if (!object(value) || Object.hasOwn(value, 'recordKind') || !text(value.symbol) || value.side !== "buy"
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

export async function loadOrderIdempotencyState(file: string): Promise<OrderIdempotencyState> {
  return loadValidatedOrderState(file, validateState, fail);
}

export async function saveOrderIdempotencyState(file: string, state: OrderIdempotencyState): Promise<void> {
  return saveValidatedOrderState(file, state, validateState, fail);
}

export type ScopedOrderIdempotencyState = Omit<OrderIdempotencyState, 'orders'> & { orders: Record<string, OrderIdempotencyEntry | ScopedManagementRecord> };
function validateScopedState(value: unknown): asserts value is ScopedOrderIdempotencyState {
  if (!object(value) || !object(value.orders)) fail('SCHEMA_INVALID');
  const legacy = Object.fromEntries(Object.entries(value.orders).filter(([key, row]) => {
    if (object(row) && Object.hasOwn(row, 'recordKind')) {
      if (!validateScopedManagementRecord(key, row)) fail('SCHEMA_INVALID');
      return false;
    }
    return true;
  }));
  if (Object.keys(value.orders).length && !timestamp(value.updatedAt)) fail('SCHEMA_INVALID');
  validateState({ ...value, orders: legacy });
}
export const loadScopedOrderIdempotencyState = (file: string): Promise<ScopedOrderIdempotencyState> => loadValidatedOrderState(file, validateScopedState, fail);
export const saveScopedOrderIdempotencyState = (file: string, state: ScopedOrderIdempotencyState): Promise<void> => saveValidatedOrderState(file, state, validateScopedState, fail);
