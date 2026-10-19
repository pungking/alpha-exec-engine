import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256Canonical } from './lib/active-position-limited-recovery.mjs';
import { decimalRatio, compare } from './lib/closeout-decimal.mjs';
import { validateScopedManagementRecord } from '../dist/src/scoped-management-record.js';
import { isObservedSnapshot } from './lib/scoped-paper-evidence.mjs';

const SCHEMA = 'paper-order-notification-v1';
const RECEIPT_SCHEMA = 'paper-order-notification-receipts-v1';
const HASH = /^[a-f0-9]{64}$/;
const SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;
const ACCEPTED = new Set(['new', 'accepted']);
const END = new Set(['canceled', 'rejected', 'expired']);
const TERMINAL = new Set(['filled', ...END]);
const TEXT = Object.freeze({
  ORDER_ACCEPTED: '주문 접수 관측 (체결 아님)',
  ORDER_PARTIALLY_FILLED: '부분 체결 관측',
  ORDER_FILLED: '전량 체결 관측 (포지션 종결 판정과 별개)',
  ORDER_CANCELED: '취소 상태 관측 (이 알림은 취소를 실행하지 않음)',
  ORDER_REJECTED: '주문 거절 관측 (상세 사유는 broker 확인 필요)',
  ORDER_EXPIRED: '주문 만료 관측',
  PROTECTION_CHILDREN_OBSERVED: '연결된 stop/target 주문 관측 (보호 적정성 별도 검증)',
  PROTECTION_CHILDREN_TERMINAL_OBSERVED: '보호 주문 종료 및 잔여 포지션 없음 관측 (청산 정합 판정과 별개)',
  PROTECTION_REVIEW_REQUIRED: '연결된 보호 주문 증거 불완전: 확인 필요',
  POSITION_CLOSEOUT_RECONCILED: '청산 완료: 체결/잔여 포지션/종결 정합 확인',
  MANAGEMENT_POSITION_FLAT_RECONCILED: '제한관리 정리: 전량 체결/잔여 없음 확인 (원래 전략 귀속 및 실현손익 미검증)',
  MANAGEMENT_TERMINAL_RESIDUAL: '주문 종결 후 잔여 노출 관측 (자동 재주문 없음)',
  SCOPED_CLOSEOUT_STOPPED: '제한관리 정리 중단: 추가 주문 없음, 미해결 상태 확인 필요',
  SCOPED_OVERSIGHT_UNRESOLVED: '감시 종료: 미해결 주문/노출은 운영자 확인 필요 (자동 취소/재주문 없음)'
});
const SCOPED_ALERTS = new Set(['SCOPED_CLOSEOUT_STOPPED', 'SCOPED_OVERSIGHT_UNRESOLVED']);
const number = value => value === null || value === undefined || String(value).trim() === '' ? NaN : Number(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validTime = (value, end) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.parse(end);
const entries = state => object(state?.orders) ? Object.entries(state.orders).filter(([, row]) => object(row)) : [];

function normalizeOrder(raw, observedAt) {
  if (!object(raw) || typeof raw.id !== 'string' || !raw.id.trim() || !SYMBOL.test(raw.symbol)
      || !['buy', 'sell'].includes(raw.side) || !validTime(raw.updated_at, observedAt)) return null;
  const qty = number(raw.qty), filled = number(raw.filled_qty);
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(filled) || filled < 0 || filled > qty) return null;
  if (filled > 0 && !(Number.isFinite(number(raw.filled_avg_price)) && number(raw.filled_avg_price) > 0)) return null;
  let type;
  if (ACCEPTED.has(raw.status) && filled === 0) type = 'ORDER_ACCEPTED';
  else if (raw.status === 'partially_filled' && filled > 0 && filled < qty) type = 'ORDER_PARTIALLY_FILLED';
  else if (raw.status === 'filled' && filled === qty && validTime(raw.filled_at, observedAt)) type = 'ORDER_FILLED';
  else if (END.has(raw.status)) type = `ORDER_${raw.status.toUpperCase()}`;
  else return null;
  return { id: raw.id, client: raw.client_order_id || null, symbol: raw.symbol, side: raw.side, type, qty, filled };
}

function flatten(orders) {
  const result = [];
  const visit = (row, depth = 0) => {
    if (depth > 2 || result.length >= 3000) throw Error('SNAPSHOT_BOUNDS_INVALID');
    result.push(row);
    if (Array.isArray(row?.legs)) for (const leg of row.legs) visit(leg, depth + 1);
  };
  orders.forEach(row => visit(row));
  return result;
}

function flatWithoutOpenEvidence(symbol, input, allOpen, all, validGroups) {
  return !input.positions.some(row => row.symbol === symbol && number(row.qty) !== 0)
    && !allOpen.some(row => row?.symbol === symbol)
    && !all.some(row => row?.symbol === symbol && (!TERMINAL.has(row.status) || !validGroups.get(row.id)
      || (Array.isArray(row.legs) && row.legs.some(child => child?.symbol !== symbol
        || !TERMINAL.has(child?.status) || !validGroups.get(child?.id)))));
}

function closeoutVerified(raw, input, allOpen, all, validGroups) {
  const matches = entries(input.orderLedger).filter(([, row]) => row.brokerOrderId === raw.id);
  if (matches.length !== 1) return false;
  const [key, ledger] = matches[0];
  const releases = Array.isArray(input.orderIdempotency?.releases) ? input.orderIdempotency.releases.filter(object).map(row => [row.key, row]) : [];
  const idempotencyMatches = [...entries(input.orderIdempotency), ...releases].filter(([, row]) => row.brokerOrderId === raw.id);
  if (idempotencyMatches.length !== 1 || idempotencyMatches[0][0] !== key || ledger.idempotencyKey !== key) return false;
  const idem = idempotencyMatches[0][1];
  for (const row of [ledger, idem]) {
    if (row.recordKind !== undefined || !raw.client_order_id || row.clientOrderId !== raw.client_order_id || row.symbol !== raw.symbol
        || row.actionType !== 'EXIT_FULL' || row.executionSide !== raw.side
        || number(row.submittedQty) !== number(raw.filled_qty) || row.recoveryMode === 'ACTIVE_POSITION_LIMITED_CONTROL') return false;
  }
  if (ledger.status !== 'filled' || idem.brokerStatus !== 'filled' || !HASH.test(ledger.stage6Hash)
      || ledger.stage6Hash !== idem.stage6Hash) return false;
  if (!flatWithoutOpenEvidence(raw.symbol, input, allOpen, all, validGroups)) return false;
  const pnlRows = (Array.isArray(input.realizedPnl?.rows) ? input.realizedPnl.rows : []).filter(row => row?.symbol === raw.symbol);
  if (pnlRows.length !== 1) return false;
  const pnl = pnlRows[0];
  return pnl.sourceType === 'ALPACA_PAPER_BROKER_FILLS' && pnl.status === 'VERIFIED_NET_REALIZED_PNL'
    && ((raw.side === 'sell' && pnl.direction === 'long') || (raw.side === 'buy' && pnl.direction === 'short'))
    && pnl.realizedPnlVerified === true && pnl.terminalExit === true && pnl.partialExit === false
    && pnl.residualSignedQuantity === 0 && pnl.idempotencyVerdict === 'PASS' && !pnl.recoveryMode
    && pnl.costDoubleCountViolation === false && pnl.matchedQuantity > 0
    && pnl.entryFillProvenance === 'BROKER_FILLED_AVG_PRICE' && pnl.exitFillProvenance === 'BROKER_FILLED_AVG_PRICE';
}

function managementFlatVerified(raw, input, allOpen, all, validGroups) {
  const matches = entries(input.orderLedger).filter(([, r]) => r.brokerOrderId === raw.id);
  const peers = entries(input.orderIdempotency).filter(([, r]) => r.brokerOrderId === raw.id);
  if (matches.length !== 1 || peers.length !== 1 || matches[0][0] !== peers[0][0]) return false;
  const [key, r] = matches[0];
  if (!validateScopedManagementRecord(key, r) || sha256Canonical(r) !== sha256Canonical(peers[0][1])
    || r.submissionPhase !== 'FLAT_RECONCILED' || raw.side !== 'sell'
    || !raw.client_order_id || r.clientOrderId !== raw.client_order_id || !raw.asset_id || r.assetId !== raw.asset_id
    || r.accountSha256 !== sha256Canonical(['PAPER', input.accountId])
    || !validTime(r.createdAt, r.updatedAt) || !validTime(r.updatedAt, input.observedAt)
    || (input.orderIdempotency.releases || []).some(v => v?.key === key || v?.brokerOrderId === raw.id)) return false;
  // Missing or contradictory asset identity is not proof of a flat position.
  if ([...input.positions, ...all].some(v => typeof v?.asset_id !== 'string' || !v.asset_id
      || ((v.asset_id === r.assetId) !== (v.symbol === raw.symbol)))
    || input.positions.some(v => v.asset_id === r.assetId && number(v.qty) !== 0)
    || allOpen.some(v => v.asset_id === r.assetId)) return false;
  try {
    if (compare(decimalRatio(r.qty), decimalRatio(raw.qty)) !== 0
      || compare(decimalRatio(r.filledQty), decimalRatio(raw.filled_qty)) !== 0) return false;
  } catch { return false; }
  return flatWithoutOpenEvidence(raw.symbol, input, allOpen, all, validGroups);
}

function protectionObservation(raw, group, input, allOpen, all, validGroups) {
  const childSets = group.filter(item => Array.isArray(item.legs) && item.legs.length);
  const children = childSets[0].legs;
  const shapeValid = childSets.every(item => sha256Canonical(item.legs) === sha256Canonical(children))
    && children.length === 2 && new Set(children.map(child => child?.id)).size === 2
    && children.every(child => child && validGroups.get(child.id) && child.symbol === raw.symbol
      && child.side !== raw.side && number(child.qty) === number(raw.filled_qty))
    && children.some(child => ['stop', 'stop_limit'].includes(child.type)) && children.some(child => child.type === 'limit');
  const terminal = shapeValid && children.every(child => TERMINAL.has(child.status))
    && flatWithoutOpenEvidence(raw.symbol, input, allOpen, all, validGroups);
  const active = shapeValid && children.every(child => normalizeOrder(child, input.observedAt)?.type === 'ORDER_ACCEPTED');
  return { type: terminal ? 'PROTECTION_CHILDREN_TERMINAL_OBSERVED' : active ? 'PROTECTION_CHILDREN_OBSERVED' : 'PROTECTION_REVIEW_REQUIRED',
    detail: children.map(child => [child?.id ?? null, child?.status ?? null, child?.type ?? null])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))) };
}

export function buildNotificationSnapshot(input) {
  const result = { schemaVersion: SCHEMA, status: 'EVIDENCE_UNAVAILABLE', sourceRunId: input.runId,
    headSha: input.headSha, observedAt: input.observedAt, accountSha256: null, events: [], excludedRows: 0,
    rawResponseStored: false, executionAuthorized: false };
  if (input.paper !== true || input.complete !== true || typeof input.accountId !== 'string' || !input.accountId.trim()
      || !/^\d+$/.test(input.runId) || !/^[a-f0-9]{40}$/.test(input.headSha) || !validTime(input.observedAt, input.observedAt)
      || !Array.isArray(input.positions) || !Array.isArray(input.openOrders) || !Array.isArray(input.closedOrders)
      || input.openOrders.length >= 500 || input.closedOrders.length >= 500
      || input.positions.some(row => !SYMBOL.test(row?.symbol) || !Number.isFinite(number(row?.qty)))) return result;
  result.accountSha256 = sha256Canonical(['PAPER', input.accountId]);
  let allOpen, all;
  try { allOpen = flatten(input.openOrders); all = [...allOpen, ...flatten(input.closedOrders)]; }
  catch { return result; }
  const groups = new Map();
  for (const raw of all) {
    if (!raw?.id) { result.excludedRows++; continue; }
    const group = groups.get(raw.id) || [];
    group.push(raw); groups.set(raw.id, group);
  }
  const add = (raw, type, detail = []) => {
    const eventKey = sha256Canonical([result.accountSha256, raw.id, type, raw.side, number(raw.filled_qty), detail]);
    result.events.push({ eventKey, type, symbol: raw.symbol, side: raw.side });
  };
  const validGroups = new Map([...groups].map(([id, group]) => {
    const normalized = group.map(row => normalizeOrder(row, input.observedAt));
    return [id, normalized.every(Boolean) && new Set(normalized.map(row => sha256Canonical(row))).size === 1];
  }));
  for (const group of groups.values()) {
    if (!validGroups.get(group[0].id)) {
      result.excludedRows++; continue;
    }
    const raw = group[0], row = normalizeOrder(raw, input.observedAt);
    add(raw, row.type);
    if (END.has(raw.status) && row.filled > 0 && (row.filled < row.qty || validTime(raw.filled_at, input.observedAt))) {
      add(raw, row.filled < row.qty ? 'ORDER_PARTIALLY_FILLED' : 'ORDER_FILLED');
    }
    if (row.type === 'ORDER_FILLED' && closeoutVerified(raw, input, allOpen, all, validGroups)) add(raw, 'POSITION_CLOSEOUT_RECONCILED');
    if (row.type === 'ORDER_FILLED' && managementFlatVerified(raw, input, allOpen, all, validGroups)) add(raw, 'MANAGEMENT_POSITION_FLAT_RECONCILED');
    if (row.type === 'ORDER_FILLED' && group.some(item => Array.isArray(item.legs) && item.legs.length)) {
      const protection = protectionObservation(raw, group, input, allOpen, all, validGroups);
      add(raw, protection.type, protection.detail);
    }
  }
  result.events.sort((a, b) => a.eventKey.localeCompare(b.eventKey));
  result.status = 'OBSERVATIONS_READY';
  return result;
}

export function buildScopedNotificationSnapshot({ scope, records, storeReceipt, observations, sourceRunId, headSha, observedAt }) {
  const result = { schemaVersion: SCHEMA, status: 'EVIDENCE_UNAVAILABLE', observationBasis: 'BOUNDED_SCOPED_CLOSEOUT',
    sourceRunId, headSha, observedAt, accountSha256: scope?.accountSha256, events: [], excludedRows: 0,
    rawResponseStored: false, executionAuthorized: false };
  if (!HASH.test(scope?.accountSha256) || !HASH.test(scope?.termsSha256) || !/^\d+$/.test(sourceRunId)
    || !/^[a-f0-9]{40}$/.test(headSha) || !validTime(observedAt, observedAt) || !Array.isArray(records) || records.length > 5
    || !Array.isArray(scope?.terms?.targets) || scope.terms.targets.length !== 5
    || (records.length && (storeReceipt?.recordsSha256 !== sha256Canonical(records)
      || !HASH.test(storeReceipt?.storeHashes?.orderLedger) || !HASH.test(storeReceipt?.storeHashes?.orderIdempotency)))) return result;
  const events = new Map(), portfolio = observations?.portfolio;
  const scopeSha256 = sha256Canonical([scope.attemptId, scope.accountSha256, scope.termsSha256]);
  if (portfolio !== undefined && (!isObservedSnapshot(portfolio) || portfolio.kind !== 'SCOPED_OVERSIGHT_PORTFOLIO'
    || portfolio.scopeSha256 !== scopeSha256 || sha256Canonical(scope.terms) !== scope.termsSha256 || !validTime(portfolio.observedAt, observedAt)
    || Date.parse(observedAt) - Date.parse(portfolio.observedAt) > scope.terms.maxEvidenceAgeSeconds * 1000
    || records.some(r => portfolio.recordHashes[r.exitIdempotencyKey] !== sha256Canonical(r)))) return result;
  for (const r of records) {
    const t = scope.terms.targets.find(t => t.exitIdempotencyKey === r?.exitIdempotencyKey);
    const symbols = (observations?.symbols ?? []).filter(s => s.assetId === r?.assetId);
    if (!validateScopedManagementRecord(r?.exitIdempotencyKey, r) || !t || symbols.length !== 1 || !SYMBOL.test(symbols[0].symbol)
      || r.attemptId !== scope.attemptId || r.accountSha256 !== scope.accountSha256 || r.termsSha256 !== scope.termsSha256
      || r.managementAuthoritySha256 !== scope.authoritySha256 || r.originalIdentitySha256 !== t.originalIdentitySha256
      || r.assetId !== t.assetId || r.clientOrderId !== t.clientOrderId || r.qty !== t.qty
      || !validTime(r.updatedAt, observedAt)) return result;
    for (const h of r.history) {
      const types = h.brokerStatus ? [`ORDER_${h.brokerStatus.toUpperCase()}`] : [];
      if (h.phase === 'FLAT_RECONCILED') types.push('MANAGEMENT_POSITION_FLAT_RECONCILED');
      for (const type of types) {
        if (!Object.hasOwn(TEXT, type)) return result;
        const eventKey = sha256Canonical([scope.attemptId, r.exitIdempotencyKey, type, h.filledQty]);
        events.set(eventKey, { eventKey, type, symbol: symbols[0].symbol, side: 'sell' });
      }
    }
    // Fresh sealed portfolio evidence may report flatness without rewriting sticky STOPPED history.
    const type = portfolio?.flatKeys.includes(r.exitIdempotencyKey) ? 'MANAGEMENT_POSITION_FLAT_RECONCILED'
      : portfolio?.residualKeys.includes(r.exitIdempotencyKey) ? 'MANAGEMENT_TERMINAL_RESIDUAL' : null;
    if (type) {
      const eventKey = sha256Canonical([scope.attemptId, r.exitIdempotencyKey, type, r.filledQty]);
      events.set(eventKey, { eventKey, type, symbol: symbols[0].symbol, side: 'sell' });
    }
  }
  for (const [field, type] of [['stoppedReason', 'SCOPED_CLOSEOUT_STOPPED'], ['handoffReason', 'SCOPED_OVERSIGHT_UNRESOLVED']]) {
    if (observations?.[field] === undefined) continue;
    if (!/^SCOPED_(?:CLOSEOUT|STORE|ADAPTER|EVIDENCE)_[A-Z_]+$/.test(observations[field])) return result;
    const eventKey = sha256Canonical([scopeSha256, type]);
    events.set(eventKey, { eventKey, type, scopeSha256, reason: observations[field] });
  }
  if (events.size > 21) return result;
  return { ...result, status: 'OBSERVATIONS_READY', events: [...events.values()].sort((a, b) => a.eventKey.localeCompare(b.eventKey)) };
}

export function formatNotification(events, observationBasis) {
  const scoped = observationBasis === 'BOUNDED_SCOPED_CLOSEOUT';
  const ordered = [...events.filter(event => SCOPED_ALERTS.has(event.type)), ...events.filter(event => !SCOPED_ALERTS.has(event.type))];
  const rows = ordered.slice(0, 16).map(event => SCOPED_ALERTS.has(event.type)
    ? `${TEXT[event.type]} (${event.reason})` : `${event.symbol} [${event.side}]: ${TEXT[event.type]}`);
  if (events.length > 16) rows.push(`추가 상태 변화 ${events.length - 16}건 (동일 관측 묶음)`);
  return ['[PAPER] Broker 상태 변화', ...rows, scoped ? '승인된 제한관리 범위의 단일 관측이며 계좌 전체 이력이 아닙니다.' : '기존 주기 수집 결과이며 실시간 스트림이 아닙니다.',
    '계좌 관측 알림입니다. 자동 전략 주문 귀속은 별도 검증 대상입니다.',
    '추천/모의 체결을 실제 체결로 표시하지 않습니다. 이 알림은 주문을 실행하지 않습니다.'].join('\n');
}

function validSnapshot(snapshot) {
  return snapshot?.schemaVersion === SCHEMA && snapshot.status === 'OBSERVATIONS_READY' && HASH.test(snapshot.accountSha256)
    && Array.isArray(snapshot.events) && snapshot.events.length <= 12000
    && snapshot.events.every(e => object(e) && HASH.test(e.eventKey) && Object.hasOwn(TEXT, e.type)
      && (SCOPED_ALERTS.has(e.type) ? snapshot.observationBasis === 'BOUNDED_SCOPED_CLOSEOUT'
        && HASH.test(e.scopeSha256) && /^SCOPED_(?:CLOSEOUT|STORE|ADAPTER|EVIDENCE)_[A-Z_]+$/.test(e.reason) && e.symbol === undefined && e.side === undefined
        : SYMBOL.test(e.symbol) && ['buy', 'sell'].includes(e.side)))
    && new Set(snapshot.events.map(e => e.eventKey)).size === snapshot.events.length;
}

function validReceipt(state) {
  return object(state) && state.schemaVersion === RECEIPT_SCHEMA && HASH.test(state.accountSha256)
    && Array.isArray(state.seen) && state.seen.length <= 50000 && state.seen.every(hash => HASH.test(hash))
    && new Set(state.seen).size === state.seen.length
    && Array.isArray(state.attempts) && state.attempts.length <= 10000
    && state.attempts.every(row => object(row) && HASH.test(row.batchSha256) && /^\d+$/.test(row.runId)
      && /^[a-f0-9]{40}$/.test(row.headSha) && validTime(row.observedAt, row.observedAt)
      && Number.isSafeInteger(row.eventCount) && row.eventCount > 0
      && ['RESERVED', 'DELIVERED', 'UNCERTAIN'].includes(row.status))
    && ['BASELINED', 'RESERVED', 'DELIVERED', 'UNCERTAIN'].includes(state.lastDelivery)
    && Buffer.byteLength(JSON.stringify(state), 'utf8') + 1 <= 4000000;
}

function atomicReceipt(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(value)}\n`);
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, file);
    const parent = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

// Reservation before send prevents automatic replay after an ambiguous response.
// This is not exactly-once delivery: filesystem/cache and Telegram cannot commit together.
export async function deliverNotifications({ snapshot, receiptPath, send }) {
  const safe = (status, eventCount = 0) => ({ status, eventCount, brokerRequests: 0, orderMutation: false });
  if (!validSnapshot(snapshot)) return safe('EVIDENCE_UNAVAILABLE');
  const lock = `${receiptPath}.lock`;
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); }
  catch { return safe('RECEIPT_LOCKED'); }
  try {
    let state;
    let stat;
    try { stat = fs.lstatSync(receiptPath); } catch (error) { if (error.code !== 'ENOENT') return safe('RECEIPT_INVALID'); }
    if (stat) {
      try {
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4000000) return safe('RECEIPT_INVALID');
        state = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
        if (!validReceipt(state)) return safe('RECEIPT_INVALID');
      } catch { return safe('RECEIPT_INVALID'); }
      if (state.accountSha256 !== snapshot.accountSha256) return safe('ACCOUNT_MISMATCH');
    } else {
      atomicReceipt(receiptPath, { schemaVersion: RECEIPT_SCHEMA, accountSha256: snapshot.accountSha256,
        seen: snapshot.events.map(e => e.eventKey).sort(), lastDelivery: 'BASELINED', attempts: [] });
      return safe('BASELINE_RECORDED');
    }
    const prior = new Set(state.seen);
    const events = snapshot.events.filter(event => !prior.has(event.eventKey));
    if (!events.length) return safe('NO_CHANGE');
    const attempt = { batchSha256: sha256Canonical(events.map(e => e.eventKey)), runId: snapshot.sourceRunId,
      headSha: snapshot.headSha, observedAt: snapshot.observedAt, eventCount: events.length, status: 'RESERVED' };
    const next = { ...state, seen: [...state.seen, ...events.map(e => e.eventKey)].sort(),
      lastDelivery: 'RESERVED', attempts: [...state.attempts, attempt] };
    if (!validReceipt(next)) return safe('RECEIPT_CAPACITY_REACHED');
    atomicReceipt(receiptPath, next);
    try {
      const response = await send(formatNotification(events, snapshot.observationBasis));
      next.lastDelivery = response?.ok === true ? 'DELIVERED' : 'UNCERTAIN';
    } catch { next.lastDelivery = 'UNCERTAIN'; }
    attempt.status = next.lastDelivery;
    atomicReceipt(receiptPath, next);
    return safe(next.lastDelivery === 'DELIVERED' ? 'DELIVERED' : 'DELIVERY_UNCERTAIN', events.length);
  } catch { return safe('RECEIPT_WRITE_FAILED'); }
  finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
