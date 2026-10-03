import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256Canonical } from './lib/active-position-limited-recovery.mjs';

const SCHEMA = 'paper-order-notification-v1';
const RECEIPT_SCHEMA = 'paper-order-notification-receipts-v1';
const HASH = /^[a-f0-9]{64}$/;
const SYMBOL = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;
const ACCEPTED = new Set(['new', 'accepted']);
const END = new Set(['canceled', 'rejected', 'expired']);
const TEXT = Object.freeze({
  ORDER_ACCEPTED: '주문 접수 관측 (체결 아님)',
  ORDER_PARTIALLY_FILLED: '부분 체결 관측',
  ORDER_FILLED: '전량 체결 관측 (포지션 종결 판정과 별개)',
  ORDER_CANCELED: '취소 상태 관측 (이 알림은 취소를 실행하지 않음)',
  ORDER_REJECTED: '주문 거절 관측 (상세 사유는 broker 확인 필요)',
  ORDER_EXPIRED: '주문 만료 관측',
  PROTECTION_CHILDREN_OBSERVED: '연결된 stop/target 주문 관측 (보호 적정성 별도 검증)',
  PROTECTION_REVIEW_REQUIRED: '연결된 보호 주문 증거 불완전: 확인 필요',
  POSITION_CLOSEOUT_RECONCILED: '청산 완료: 체결/잔여 포지션/종결 정합 확인'
});
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

function closeoutVerified(raw, input, allOpen) {
  const matches = entries(input.orderLedger).filter(([, row]) => row.brokerOrderId === raw.id);
  if (matches.length !== 1) return false;
  const [key, ledger] = matches[0];
  const releases = Array.isArray(input.orderIdempotency?.releases) ? input.orderIdempotency.releases.filter(object).map(row => [row.key, row]) : [];
  const idempotencyMatches = [...entries(input.orderIdempotency), ...releases].filter(([, row]) => row.brokerOrderId === raw.id);
  if (idempotencyMatches.length !== 1 || idempotencyMatches[0][0] !== key || ledger.idempotencyKey !== key) return false;
  const idem = idempotencyMatches[0][1];
  for (const row of [ledger, idem]) {
    if (!raw.client_order_id || row.clientOrderId !== raw.client_order_id || row.symbol !== raw.symbol
        || row.actionType !== 'EXIT_FULL' || row.executionSide !== raw.side
        || number(row.submittedQty) !== number(raw.filled_qty) || row.recoveryMode === 'ACTIVE_POSITION_LIMITED_CONTROL') return false;
  }
  if (ledger.status !== 'filled' || idem.brokerStatus !== 'filled' || !HASH.test(ledger.stage6Hash)
      || ledger.stage6Hash !== idem.stage6Hash) return false;
  if (input.positions.some(row => row.symbol === raw.symbol && number(row.qty) !== 0)
      || allOpen.some(row => row.symbol === raw.symbol)) return false;
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
  for (const group of groups.values()) {
    const normalized = group.map(row => normalizeOrder(row, input.observedAt));
    if (normalized.some(row => !row) || new Set(normalized.map(row => sha256Canonical(row))).size !== 1) {
      result.excludedRows++; continue;
    }
    const raw = group[0], row = normalized[0];
    add(raw, row.type);
    if (END.has(raw.status) && row.filled > 0 && (row.filled < row.qty || validTime(raw.filled_at, input.observedAt))) {
      add(raw, row.filled < row.qty ? 'ORDER_PARTIALLY_FILLED' : 'ORDER_FILLED');
    }
    if (row.type === 'ORDER_FILLED' && closeoutVerified(raw, input, allOpen)) add(raw, 'POSITION_CLOSEOUT_RECONCILED');
    if (row.type === 'ORDER_FILLED' && group.some(item => Array.isArray(item.legs) && item.legs.length)) {
      const childSets = group.filter(item => Array.isArray(item.legs) && item.legs.length);
      const children = childSets[0].legs;
      const childrenValid = childSets.every(item => sha256Canonical(item.legs) === sha256Canonical(children))
        && children.length === 2 && new Set(children.map(child => child.id)).size === 2
        && children.every(child => normalizeOrder(child, input.observedAt)?.type === 'ORDER_ACCEPTED'
          && child.symbol === raw.symbol && child.side !== raw.side && number(child.qty) === row.filled)
        && children.some(child => ['stop', 'stop_limit'].includes(child.type)) && children.some(child => child.type === 'limit');
      add(raw, childrenValid ? 'PROTECTION_CHILDREN_OBSERVED' : 'PROTECTION_REVIEW_REQUIRED',
        children.map(child => [child.id, child.status, child.type]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    }
  }
  result.events.sort((a, b) => a.eventKey.localeCompare(b.eventKey));
  result.status = 'OBSERVATIONS_READY';
  return result;
}

export function formatNotification(events) {
  const rows = events.slice(0, 16).map(event => `${event.symbol} [${event.side}]: ${TEXT[event.type]}`);
  if (events.length > 16) rows.push(`추가 상태 변화 ${events.length - 16}건 (동일 관측 묶음)`);
  return ['[PAPER] Broker 상태 변화', ...rows, '기존 주기 수집 결과이며 실시간 스트림이 아닙니다.',
    '계좌 관측 알림입니다. 자동 전략 주문 귀속은 별도 검증 대상입니다.',
    '추천/모의 체결을 실제 체결로 표시하지 않습니다. 이 알림은 주문을 실행하지 않습니다.'].join('\n');
}

function validSnapshot(snapshot) {
  return snapshot?.schemaVersion === SCHEMA && snapshot.status === 'OBSERVATIONS_READY' && HASH.test(snapshot.accountSha256)
    && Array.isArray(snapshot.events) && snapshot.events.length <= 12000
    && snapshot.events.every(e => object(e) && HASH.test(e.eventKey) && Object.hasOwn(TEXT, e.type) && SYMBOL.test(e.symbol) && ['buy', 'sell'].includes(e.side))
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
      const response = await send(formatNotification(events));
      next.lastDelivery = response?.ok === true ? 'DELIVERED' : 'UNCERTAIN';
    } catch { next.lastDelivery = 'UNCERTAIN'; }
    attempt.status = next.lastDelivery;
    atomicReceipt(receiptPath, next);
    return safe(next.lastDelivery === 'DELIVERED' ? 'DELIVERED' : 'DELIVERY_UNCERTAIN', events.length);
  } catch { return safe('RECEIPT_WRITE_FAILED'); }
  finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
