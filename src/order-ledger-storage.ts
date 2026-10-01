import type { LifecycleActionType } from "../config/policy.js";
import { actions, brokerStatuses } from "./order-idempotency-storage.js";
import type { OrderLifecycleStatus } from "./order-idempotency-storage.js";
import { loadValidatedOrderState, saveValidatedOrderState, storageObject as object, storageText as text, storageTimestamp as timestamp } from "./order-state-storage.js";

export type OrderLifecycleHistoryEntry = {
  at: string;
  from: OrderLifecycleStatus | null;
  to: OrderLifecycleStatus;
  reason: string;
  source: string;
};

export type OrderLedgerRecord = {
  idempotencyKey: string;
  symbol: string;
  side: "buy";
  executionSide?: "buy" | "sell" | null;
  actionType?: LifecycleActionType;
  submittedQty?: number | null;
  stage6Hash: string;
  stage6File: string;
  mode: string;
  clientOrderId: string;
  status: OrderLifecycleStatus;
  statusReason: string;
  preflightCode: string;
  regimeProfile: "default" | "risk_off";
  notional: number;
  limitPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  brokerOrderId: string | null;
  createdAt: string;
  updatedAt: string;
  history: OrderLifecycleHistoryEntry[];
};

export type OrderLedgerState = {
  orders: Record<string, OrderLedgerRecord>;
  updatedAt: string;
};

export class OrderLedgerStorageError extends Error {
  constructor(code: string) {
    super(`ORDER_LEDGER_${code}`);
    this.name = "OrderLedgerStorageError";
  }
}
function fail(code: string): never { throw new OrderLedgerStorageError(code); }
const status = (value: unknown): boolean => typeof value === "string" && brokerStatuses.has(value);
const finite = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value);

function validRecord(key: string, row: unknown): boolean {
  return object(row) && row.idempotencyKey === key
    && ["symbol", "stage6Hash", "stage6File", "mode", "clientOrderId", "statusReason", "preflightCode"].every((field) => text(row[field]))
    && row.side === "buy" && status(row.status)
    && (row.regimeProfile === "default" || row.regimeProfile === "risk_off")
    && (row.executionSide == null || row.executionSide === "buy" || row.executionSide === "sell")
    && (row.actionType === undefined || (typeof row.actionType === "string" && actions.has(row.actionType)))
    && (row.submittedQty == null || (finite(row.submittedQty) && (row.submittedQty as number) >= 0))
    && ["notional", "limitPrice", "takeProfitPrice", "stopLossPrice"].every((field) => finite(row[field]))
    && (row.brokerOrderId === null || text(row.brokerOrderId))
    && timestamp(row.createdAt) && timestamp(row.updatedAt)
    && Array.isArray(row.history) && row.history.every((event) => object(event)
      && timestamp(event.at) && (event.from === null || status(event.from)) && status(event.to)
      && text(event.reason) && text(event.source));
}

function validateState(value: unknown): asserts value is OrderLedgerState {
  if (!object(value) || !object(value.orders)
    || !(timestamp(value.updatedAt) || (value.updatedAt === "" && Object.keys(value.orders).length === 0))
    || Object.entries(value.orders).some(([key, row]) => !text(key)
      || ["__proto__", "constructor", "prototype"].includes(key) || !validRecord(key, row))) fail("SCHEMA_INVALID");
}

export async function loadOrderLedgerState(file: string): Promise<OrderLedgerState> {
  return loadValidatedOrderState(file, validateState, fail);
}

export async function saveOrderLedgerState(file: string, state: OrderLedgerState): Promise<void> {
  return saveValidatedOrderState(file, state, validateState, fail);
}
