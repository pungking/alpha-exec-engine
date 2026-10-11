import { storageObject as object, storageTimestamp as timestamp } from './order-state-storage.js';

export type ManagementPhase = 'RESERVED' | 'ATTEMPTED' | 'OBSERVED' | 'FLAT_RECONCILED' | 'STOPPED';
type ObservationStatus = 'accepted' | 'partially_filled' | 'filled' | 'canceled' | 'rejected' | 'expired' | null;
export type ScopedManagementRecord = {
  recordKind: 'SCOPED_MANAGEMENT_EXIT_V1'; schemaVersion: 1;
  attemptId: string; managementAuthoritySha256: string; termsSha256: string; accountSha256: string;
  originalIdentitySha256: string; exitIdempotencyKey: string; clientOrderId: string; assetId: string;
  side: 'sell'; actionType: 'EXIT_FULL'; qty: string; limitPrice: string;
  observedEvidenceSha256: string; requestSha256: string | null;
  preWriteHashes: { orderLedger: string; orderIdempotency: string };
  createdAt: string; updatedAt: string; submissionPhase: ManagementPhase;
  brokerOrderId: string | null; brokerStatus: ObservationStatus; filledQty: string;
  originalOwnershipVerified: false; realizedPnlVerified: false;
  historicalEvidenceNormalized: false; brokerSubmitAllowed: false;
  history: { at: string; phase: ManagementPhase; evidenceSha256: string; brokerStatus: ObservationStatus; filledQty: string }[];
};
const fields = 'recordKind schemaVersion attemptId managementAuthoritySha256 termsSha256 accountSha256 originalIdentitySha256 exitIdempotencyKey clientOrderId assetId side actionType qty limitPrice observedEvidenceSha256 requestSha256 preWriteHashes createdAt updatedAt submissionPhase brokerOrderId brokerStatus filledQty originalOwnershipVerified realizedPnlVerified historicalEvidenceNormalized brokerSubmitAllowed history';
const exact = (v: Record<string, unknown>, keys: string): boolean => Object.keys(v).sort().join(',') === keys.split(' ').sort().join(',');
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(v)
  && !['__proto__', 'constructor', 'prototype'].includes(v);
const decimal = (v: unknown): v is string => typeof v === 'string' && /^(?:0|[1-9]\d{0,15})(?:\.\d{1,9})?$/.test(v);
const units = (v: string): bigint => { const [w, f = ''] = v.split('.'); return BigInt(w + f.padEnd(9, '0')); };
const statuses = new Set<unknown>([null, 'accepted', 'partially_filled', 'filled', 'canceled', 'rejected', 'expired']);
const edges: Record<ManagementPhase, string[]> = { RESERVED: ['ATTEMPTED'], ATTEMPTED: ['OBSERVED', 'STOPPED'],
  OBSERVED: ['OBSERVED', 'STOPPED', 'FLAT_RECONCILED'], STOPPED: ['STOPPED'], FLAT_RECONCILED: [] };

export function validateScopedManagementRecord(key: string, value: unknown): value is ScopedManagementRecord {
  if (!object(value) || !exact(value, fields) || value.recordKind !== 'SCOPED_MANAGEMENT_EXIT_V1' || value.schemaVersion !== 1
    || value.exitIdempotencyKey !== key || !['attemptId', 'exitIdempotencyKey', 'clientOrderId', 'assetId'].every(k => id(value[k]))
    || (value.clientOrderId as string).length > 48 || value.side !== 'sell' || value.actionType !== 'EXIT_FULL'
    || !['managementAuthoritySha256', 'termsSha256', 'accountSha256', 'originalIdentitySha256', 'observedEvidenceSha256'].every(k => hash(value[k]))
    || !object(value.preWriteHashes) || !exact(value.preWriteHashes, 'orderLedger orderIdempotency') || !Object.values(value.preWriteHashes).every(hash)
    || !['originalOwnershipVerified', 'realizedPnlVerified', 'historicalEvidenceNormalized', 'brokerSubmitAllowed'].every(k => value[k] === false)
    || !decimal(value.qty) || units(value.qty) <= 0n || !decimal(value.limitPrice) || units(value.limitPrice) <= 0n
    || !decimal(value.filledQty) || units(value.filledQty) > units(value.qty)
    || !timestamp(value.createdAt) || !timestamp(value.updatedAt) || !statuses.has(value.brokerStatus)
    || (value.brokerOrderId !== null && !id(value.brokerOrderId)) || !Array.isArray(value.history) || value.history.length < 1 || value.history.length > 16) return false;
  let previous: Record<string, unknown> | null = null;
  for (const e of value.history) {
    if (!object(e) || !exact(e, 'at phase evidenceSha256 brokerStatus filledQty') || !timestamp(e.at) || !hash(e.evidenceSha256)
      || !statuses.has(e.brokerStatus) || !decimal(e.filledQty) || units(e.filledQty) > units(value.qty)) return false;
    if (!previous) {
      if (e.phase !== 'RESERVED' || e.at !== value.createdAt || e.brokerStatus !== null || units(e.filledQty) !== 0n) return false;
    } else if (!edges[previous.phase as ManagementPhase]?.includes(e.phase as string)
      || Date.parse(e.at as string) < Date.parse(previous.at as string) || units(e.filledQty) < units(previous.filledQty as string)
      || (['filled', 'canceled', 'rejected', 'expired'].includes(previous.brokerStatus as string) && e.brokerStatus !== previous.brokerStatus)) return false;
    if (e.brokerStatus === 'filled' && units(e.filledQty) !== units(value.qty)) return false;
    if (e.brokerStatus === 'partially_filled' && (units(e.filledQty) === 0n || units(e.filledQty) >= units(value.qty))) return false;
    if ([null, 'accepted', 'rejected'].includes(e.brokerStatus as null | string) && units(e.filledQty) !== 0n) return false;
    if (e.phase === 'FLAT_RECONCILED' && e.brokerStatus !== 'filled') return false;
    if (e.phase === 'ATTEMPTED' && e.brokerStatus !== null) return false;
    if (e.phase === 'OBSERVED' && e.brokerStatus === null) return false;
    previous = e;
  }
  const last = previous!;
  return last.phase === value.submissionPhase && last.at === value.updatedAt && last.brokerStatus === value.brokerStatus
    && last.filledQty === value.filledQty && last.evidenceSha256 === value.observedEvidenceSha256
    && (value.submissionPhase === 'RESERVED' ? value.requestSha256 === null : hash(value.requestSha256))
    && (value.brokerStatus === null ? value.brokerOrderId === null : id(value.brokerOrderId));
}
