import { sha256Canonical as digest } from './active-position-limited-recovery.mjs';
import { decimalRatio as ratio, decimalText, withinCap, add, multiply, compare, ceilToTick } from './closeout-decimal.mjs';
import { assessSourceBindings, isObservedSnapshot } from './scoped-paper-evidence.mjs';
import { validateOperationalConfiguration } from './scoped-paper-operational.mjs';
import path from 'node:path';

const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, names) => object(v) && Object.keys(v).sort().join(',') === names.split(' ').sort().join(',');
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const id = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(v)
  && !['__proto__', 'constructor', 'prototype'].includes(v);
const positive = v => typeof v === 'string' && /^(?:0|[1-9]\d{0,15})(?:\.\d{1,9})?$/.test(v) && ratio(v)[0] > 0n;
const time = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v ? Date.parse(v) : NaN;
const requireContract = (ok, code) => { if (!ok) throw new Error(`SCOPED_CLOSEOUT_${code}`); };
const freeze = value => { if (object(value) || Array.isArray(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const scopes = new WeakSet();
const capabilities = new WeakMap(), observedBindings = new WeakMap();
const observed = scope => scope.evidenceMode === 'PAPER_OBSERVED';
const bindingStatus = scope => observed(scope) ? 'PAPER_OBSERVED_VERIFIED' : 'SYNTHETIC_VERIFIED';
const nyDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const sessionMatches = (c, now, session) => [now, c?.open, c?.close, c?.timestamp].every(v =>
  Number.isFinite(time(v)) && nyDate.format(new Date(v)) === session);
export const BUDGET = Object.freeze({ account: 6, positions: 11, orders: 11, clock: 11, calendar: 1, assets: 10, lookup: 5, quotes: 6, submit: 5 });
export const SAFETY = Object.freeze({ brokerSubmitAllowed: false, wouldCreateBrokerPayload: false,
  originalOwnershipVerified: false, realizedPnlVerified: false, historicalEvidenceNormalized: false });

export function validateScopedCloseoutInput(input) {
  return validateInput(input, false);
}
function validateInput(input, real) {
  requireContract(exact(input, 'schemaVersion environment evidenceMode attemptId accountSha256 sourceSha256 codeSha256 terms termsSha256 authority authoritySha256 safeFlags preWriteHashes'), 'INPUT_INVALID');
  requireContract(input.schemaVersion === (real ? 2 : 1) && input.environment === 'PAPER'
    && input.evidenceMode === (real ? 'PAPER_OBSERVED' : 'SYNTHETIC'), 'MODE_INVALID');
  requireContract(id(input.attemptId) && ['accountSha256', 'sourceSha256', 'codeSha256', 'termsSha256', 'authoritySha256'].every(k => hash(input[k])), 'PIN_INVALID');
  requireContract(exact(input.safeFlags, 'readOnly execEnabled liveOrderSubmitEnabled marketGuardMode')
    && input.safeFlags.readOnly === !real && input.safeFlags.execEnabled === real
    && input.safeFlags.liveOrderSubmitEnabled === false && input.safeFlags.marketGuardMode === 'observe', 'SAFE_FLAGS_REQUIRED');
  const a = input.authority, t = input.terms;
  requireContract(exact(a, 'kind session validFrom expiresAt acceptsRestingDayOrders') && a.kind === (real ? 'SCOPED_MANAGEMENT_PAPER_ONLY' : 'SYNTHETIC_ONLY')
    && /^\d{4}-\d\d-\d\d$/.test(a.session) && time(a.expiresAt) > time(a.validFrom)
    && a.acceptsRestingDayOrders === true && digest(a) === input.authoritySha256, 'AUTHORITY_INVALID');
  requireContract(exact(input.preWriteHashes, 'orderLedger orderIdempotency') && Object.values(input.preWriteHashes).every(hash), 'STORE_PIN_INVALID');
  requireContract(exact(t, 'targets portfolio maxTotalNotional maxSpreadBps maxAdverseBps maxEvidenceAgeSeconds')
    && digest(t) === input.termsSha256 && t.maxSpreadBps === 10 && t.maxAdverseBps === 10
    && t.maxEvidenceAgeSeconds === 30 && positive(t.maxTotalNotional), 'TERMS_INVALID');
  requireContract(Array.isArray(t.targets) && t.targets.length === 5 && t.targets.every(r =>
    exact(r, 'originalIdentitySha256 assetId exitIdempotencyKey clientOrderId qty maxNotional')
    && hash(r.originalIdentitySha256) && ['assetId', 'exitIdempotencyKey', 'clientOrderId'].every(k => id(r[k]))
    && r.clientOrderId.length <= 48 && positive(r.qty) && positive(r.maxNotional)), 'FIVE_TARGETS_REQUIRED');
  for (const key of ['originalIdentitySha256', 'assetId', 'exitIdempotencyKey', 'clientOrderId'])
    requireContract(new Set(t.targets.map(r => r[key])).size === 5, 'DUPLICATE_IDENTITY');
  requireContract(Array.isArray(t.portfolio) && t.portfolio.length >= 5 && t.portfolio.length < 500
    && t.portfolio.every(p => exact(p, 'assetId qty') && id(p.assetId) && positive(p.qty))
    && new Set(t.portfolio.map(p => p.assetId)).size === t.portfolio.length
    && t.targets.every(r => t.portfolio.some(p => p.assetId === r.assetId && p.qty === r.qty)), 'PORTFOLIO_INVALID');
  const scope = freeze(structuredClone(input)); scopes.add(scope); return scope;
}

export function validateScopedPaperAuthorityFields(config) {
  if (config.notifications !== undefined) requireContract(exact(config.notifications, 'destinationSha256 sourceRunId headSha')
    && hash(config.notifications.destinationSha256) && /^\d+$/.test(config.notifications.sourceRunId)
    && /^[a-f0-9]{40}$/.test(config.notifications.headSha), 'NOTIFICATION_AUTHORITY_INVALID');
  validateInput(config.input, true);
  requireContract(typeof config.directory === 'string' && path.isAbsolute(config.directory)
    && exact(config.sourceFile, 'path sha256') && path.isAbsolute(config.sourceFile.path)
    && config.sourceFile.sha256 === config.input.sourceSha256, 'SOURCE_PIN_INVALID');
  requireContract(Array.isArray(config.codeFiles) && config.codeFiles.length > 0
    && config.codeFiles.every(f => exact(f, 'path sha256') && path.isAbsolute(f.path) && hash(f.sha256))
    && new Set(config.codeFiles.map(f => f.path)).size === config.codeFiles.length
    && digest(config.codeFiles) === config.input.codeSha256, 'CODE_PIN_INVALID');
  const w = config.writerExclusion;
  requireContract(exact(w, 'basis evidenceSha256 accountSha256 session expiresAt')
    && w.basis === 'REVIEWED_ACCOUNT_WIDE_WRITER_EXCLUSION' && hash(w.evidenceSha256)
    && w.accountSha256 === config.input.accountSha256 && w.session === config.input.authority.session
    && time(w.expiresAt) >= time(config.input.authority.expiresAt), 'WRITER_EXCLUSION_INVALID');
}
export function validateScopedPaperConfiguration(config) {
  try {
    requireContract(exact(config, `input bindings directory sourceFile codeFiles writerExclusion${config?.notifications === undefined ? '' : ' notifications'}`), 'CONFIG_INVALID');
    validateScopedPaperAuthorityFields(config);
    const b = config.bindings;
    requireContract(exact(b, 'proof proofSha256 rawAccountIdSha256 rawAccountHashBasis accountHashBasis')
      && hash(b.proofSha256) && digest(b.proof) === b.proofSha256 && hash(b.rawAccountIdSha256)
      && b.rawAccountHashBasis === 'RAW_ACCOUNT_ID_UTF8' && b.accountHashBasis === 'CANONICAL_PAPER_ACCOUNT_ID', 'SOURCE_BINDING_INVALID');
    return freeze({ status: 'PASS', reasons: [], evidenceHashes: [digest(config)] });
  } catch (error) {
    return freeze({ status: 'BLOCKED', reasons: [/^SCOPED_CLOSEOUT_[A-Z_]+$/.test(error?.message) ? error.message : 'SCOPED_CLOSEOUT_CONFIG_INVALID'], evidenceHashes: [] });
  }
}
function processGate() {
  const e = process.env;
  requireContract(e.ALPHA_ENV === 'PAPER' && e.READ_ONLY === 'false' && e.EXEC_ENABLED === 'true'
    && e.LIVE_ORDER_SUBMIT_ENABLED === 'false' && e.MARKET_GUARD_MODE === 'observe'
    && ['FORCE_SEND_ONCE', 'GUARD_EXECUTE_TIGHTEN_STOPS', 'GUARD_EXECUTE_REDUCE_POSITIONS', 'GUARD_EXECUTE_FLATTEN']
      .every(k => e[k] === undefined || e[k] === 'false'), 'ACTUAL_PROCESS_FLAGS_BLOCKED');
  requireContract(['ALPACA_BASE_URL', 'ALPACA_API_BASE_URL'].every(k => !e[k] || e[k] === 'https://paper-api.alpaca.markets'), 'ORIGIN_INVALID');
}
export function authorizeScopedPaperInvocation({ config, approval, clock }) {
  const assessment = validateScopedPaperConfiguration(config);
  requireContract(assessment.status === 'PASS', 'CONFIG_INVALID'); processGate();
  requireContract(exact(approval, 'kind phrase configSha256 approvedAt expiresAt rollbackPlanSha256')
    && approval.kind === 'DIRECT_SCOPED_OPERATOR_INVOCATION' && approval.phrase === 'CONFIRM LIVE EXECUTION'
    && approval.configSha256 === digest(config) && hash(approval.rollbackPlanSha256)
    && time(approval.approvedAt) <= time(clock.now()) && time(config.input.authority.validFrom) <= time(clock.now())
    && time(approval.expiresAt) - time(clock.now()) >= 17000
    && time(approval.expiresAt) <= time(config.input.authority.expiresAt), 'AUTHORITY_INVALID');
  requireContract(assessSourceBindings(config.bindings, config.input, clock).status === 'PASS', 'SOURCE_BINDING_INVALID');
  const capability = Object.freeze({});
  capabilities.set(capability, freeze({ config: structuredClone(config), approval: structuredClone(approval) }));
  return capability;
}
export function assertScopedPaperInvocation(capability, { config, clock }) {
  const saved = capabilities.get(capability);
  if (saved?.mode === 'OPERATIONAL') return assertOperationalInvocation(capability, { config, clock });
  requireContract(saved && digest(saved.config) === digest(config), 'AUTHORITY_INVALID');
  processGate();
  requireContract(time(saved.approval.approvedAt) <= time(clock.now()) && time(config.input.authority.validFrom) <= time(clock.now())
    && time(saved.approval.expiresAt) - time(clock.now()) >= 17000
    && assessSourceBindings(config.bindings, config.input, clock).status === 'PASS', 'AUTHORITY_EXPIRED');
  return true;
}
export function validateObservedCloseoutInput(input, capability) {
  const saved = capabilities.get(capability);
  requireContract(saved && digest(saved.config.input) === digest(input), 'AUTHORITY_INVALID');
  if (saved.mode === 'OPERATIONAL') {
    saved.scope ??= validateInput(input, true);
    return saved.scope;
  }
  const scope = validateInput(input, true);
  observedBindings.set(scope, { sha256: saved.config.bindings.proofSha256, feed: saved.config.bindings.proof.feed }); return scope;
}
function snapshotMatches(scope, snapshot) {
  const binding = observedBindings.get(scope);
  return snapshot?.evidenceMode === scope.evidenceMode && (!observed(scope)
    || (isObservedSnapshot(snapshot) && snapshot.sourceBindingsSha256 === binding?.sha256
      && (!binding?.operational || binding.snapshot === snapshot)));
}

export function authorizeOperationalInvocation({ config, approval, clock }) {
  requireContract(validateOperationalConfiguration(config).status === 'PASS', 'CONFIG_INVALID');
  processGate();
  requireContract(exact(approval, 'kind phrase stableScopeSha256 approvedAt expiresAt rollbackPlanSha256')
    && approval.kind === 'DIRECT_SCOPED_OPERATIONAL_INVOCATION' && approval.phrase === 'CONFIRM LIVE EXECUTION'
    && approval.stableScopeSha256 === digest(config) && hash(approval.rollbackPlanSha256)
    && time(approval.expiresAt) <= time(config.input.authority.expiresAt), 'AUTHORITY_INVALID');
  const saved = { mode: 'OPERATIONAL', config: freeze(structuredClone(config)), approval: freeze(structuredClone(approval)),
    start: clock.monotonicMs(), lastElapsed: 0, lastNow: time(clock.now()), generation: 0, scope: null, current: null };
  checkOperationalTime(saved, clock);
  const capability = Object.freeze({}); capabilities.set(capability, saved); return capability;
}
function checkOperationalTime(saved, clock) {
  const now = time(clock.now()), elapsed = clock.monotonicMs() - saved.start;
  requireContract(Number.isFinite(elapsed) && elapsed >= saved.lastElapsed && elapsed <= 283000
    && now >= saved.lastNow && now >= time(saved.approval.approvedAt)
    && now >= time(saved.config.input.authority.validFrom)
    && time(saved.approval.expiresAt) - now >= 17000, 'AUTHORITY_EXPIRED');
  saved.lastNow = now; saved.lastElapsed = elapsed;
}
function operationalCapability(capability, config, clock) {
  const saved = capabilities.get(capability);
  requireContract(saved?.mode === 'OPERATIONAL' && (!config || digest(config) === digest(saved.config)), 'AUTHORITY_INVALID');
  processGate(); checkOperationalTime(saved, clock); return saved;
}
export function assertOperationalInvocation(capability, { config, clock }) {
  const saved = operationalCapability(capability, config, clock);
  requireContract(saved.current && assessSourceBindings(saved.current, saved.scope, clock).status === 'PASS', 'SOURCE_BINDING_INVALID');
  return true;
}
export function bindOperationalObservation(capability, { scope, observation, clock }) {
  const saved = operationalCapability(capability, null, clock);
  requireContract(saved.scope === scope && scopes.has(scope), 'SCOPE_INVALID');
  // A rejected replacement invalidates the old send proof, rather than silently falling back to it.
  saved.current = null; observedBindings.delete(scope);
  requireContract(exact(observation, 'sourceGeneration snapshot bindings') && Number.isSafeInteger(observation.sourceGeneration)
    && observation.sourceGeneration === saved.generation + 1, 'GENERATION_INVALID');
  const { snapshot, bindings } = observation, p = bindings?.proof, policy = saved.config.sourcePolicy;
  requireContract(isObservedSnapshot(snapshot) && snapshot.complete === true && snapshot.accountSha256 === scope.accountSha256
    && snapshot.sourceSha256 === scope.sourceSha256 && snapshot.sourceBindingsSha256 === bindings?.proofSha256, 'OBSERVATION_INVALID');
  requireContract(exact(bindings, 'proof proofSha256 rawAccountIdSha256 rawAccountHashBasis accountHashBasis')
    && digest({ rawAccountIdSha256: bindings.rawAccountIdSha256, rawAccountHashBasis: bindings.rawAccountHashBasis,
      accountHashBasis: bindings.accountHashBasis }) === digest(saved.config.accountBinding)
    && p?.stableScopeSha256 === digest(saved.config) && p.sourceGeneration === observation.sourceGeneration
    && p.sourceContractSha256 === policy.contractFile.sha256 && p.riskPolicySha256 === policy.riskPolicyFile.sha256
    && p.clockPolicySha256 === policy.clockPolicyFile.sha256 && p.feed === policy.feed && p.currency === policy.currency
    && (p.feed !== 'iex' || (p.quoteCoverage === policy.quoteCoverage && p.acceptsNonNbboPaperEvidence === true))
    && assessSourceBindings(bindings, scope, clock).status === 'PASS', 'SOURCE_BINDING_INVALID');
  saved.current = freeze(structuredClone(bindings)); saved.generation = observation.sourceGeneration;
  observedBindings.set(scope, { sha256: bindings.proofSha256, feed: p.feed, snapshot, operational: true });
  return true;
}

function validateTime(scope, snapshot, clock) {
  const now = time(clock?.now), c = snapshot.clock, a = scope.authority;
  requireContract(Number.isFinite(now) && Number.isFinite(clock.elapsedMs) && clock.elapsedMs >= 0 && clock.elapsedMs <= 283000, 'DEADLINE_INVALID');
  requireContract(now >= time(a.validFrom) && time(a.expiresAt) - now >= 17000, 'AUTHORITY_EXPIRED');
  requireContract(object(c) && c.version === 'v2' && c.isOpen === true && c.timezone === 'America/New_York'
    && c.clockAlignment === bindingStatus(scope) && hash(c.responseSha256) && c.session === a.session
    && sessionMatches(c, clock.now, a.session)
    && time(c.open) <= now && time(c.close) - now >= 17000, 'MARKET_SESSION_INVALID');
  requireContract(Number.isFinite(time(c.timestamp)) && time(c.timestamp) <= now && now - time(c.timestamp) <= 30000, 'CLOCK_STALE');
  requireContract(exact(snapshot.observations, 'account positions orders assets calendar'), 'OBSERVATIONS_INVALID');
  const intervals = Object.entries(snapshot.observations).flatMap(([key, value]) => {
    if (observed(scope) && key === 'assets') {
      requireContract(exact(value, 'basis receipts') && value.basis === 'OBSERVED_GET_SET'
        && Array.isArray(value.receipts) && value.receipts.length === 5, 'OBSERVATIONS_INVALID');
      return value.receipts;
    }
    return [value];
  });
  for (const o of intervals) requireContract(exact(o, 'basis requestedAt retrievedAt responseSha256')
    && o.basis === 'OBSERVED_GET_INTERVAL' && hash(o.responseSha256)
    && time(o.requestedAt) <= time(o.retrievedAt) && time(o.retrievedAt) <= now
    && now - time(o.requestedAt) <= 30000 && time(o.retrievedAt) - time(o.requestedAt) <= 3000, 'OBSERVATION_STALE');
}

function priceOrder(scope, target, row, now) {
  requireContract(object(row) && row.assetId === target.assetId && row.originalIdentitySha256 === target.originalIdentitySha256
    && row.qty === target.qty, 'ROW_IDENTITY_INVALID');
  requireContract(['bid', 'ask', 'bidSizeShares', 'tick', 'quantityIncrement'].every(k => positive(row[k])), 'DECIMAL_INVALID');
  requireContract(row.feed === (observed(scope) ? observedBindings.get(scope)?.feed : 'sip')
    && (row.feed !== 'iex' || row.quoteCoverage === 'IEX_SINGLE_EXCHANGE') && row.currency === 'USD' && row.sizeUnit === 'shares'
    && row.sourceBinding === bindingStatus(scope) && hash(row.quoteResponseSha256)
    && row.tradable === true && row.haltStatus === 'NOT_HALTED' && row.riskStatus === 'PASS' && hash(row.riskEvidenceSha256), 'SOURCE_OR_RISK_INVALID');
  requireContract(time(row.quoteAt) <= now && now - time(row.quoteAt) <= 30000, 'QUOTE_STALE');
  const bid = ratio(row.bid), ask = ratio(row.ask), qty = ratio(row.qty), step = ratio(row.quantityIncrement);
  requireContract(compare(ask, bid) >= 0 && compare(qty, ratio(row.bidSizeShares)) <= 0, 'LIQUIDITY_INVALID');
  requireContract(row.tick === (compare(bid, [1n, 1n]) >= 0 ? '0.01' : '0.0001')
    && qty[0] * step[1] % (qty[1] * step[0]) === 0n
    && (qty[0] % qty[1] === 0n || row.fractionable === true), 'INCREMENT_INVALID');
  const spread = [20000n * (ask[0] * bid[1] - bid[0] * ask[1]), ask[0] * bid[1] + bid[0] * ask[1]];
  requireContract(withinCap(spread, '10'), 'SPREAD_EXCEEDED');
  const floor = multiply(bid, [9990n, 10000n]), limitPrice = ceilToTick(floor, row.tick);
  requireContract(compare(ratio(limitPrice), bid) <= 0 && positive(limitPrice), 'PRICE_FLOOR_INVALID');
  const planned = multiply(ask, qty);
  requireContract(withinCap(planned, target.maxNotional), 'ROW_CAP_EXCEEDED');
  return { exitIdempotencyKey: target.exitIdempotencyKey, clientOrderId: target.clientOrderId,
    assetId: target.assetId, side: 'sell', actionType: 'EXIT_FULL', qty: target.qty,
    limitPrice, type: 'limit', timeInForce: 'day', extendedHours: false,
    plannedNotional: decimalText(planned) };
}

export function evaluateCloseoutSnapshot(scope, snapshot, clock, committed = {}) {
  try {
    requireContract(scopes.has(scope), 'UNVALIDATED_SCOPE');
    requireContract(object(snapshot) && snapshotMatches(scope, snapshot) && snapshot.complete === true
      && snapshot.accountSha256 === scope.accountSha256 && snapshot.sourceSha256 === scope.sourceSha256, 'SNAPSHOT_INVALID');
    validateTime(scope, snapshot, clock);
    const expected = scope.terms.portfolio.filter(p => !Object.hasOwn(committed, p.assetId));
    const canonicalPortfolio = rows => rows.map(r => ({ ...r, qty: decimalText(ratio(r.qty)) })).sort((a, b) => a.assetId.localeCompare(b.assetId));
    requireContract(Array.isArray(snapshot.portfolio) && digest(canonicalPortfolio(snapshot.portfolio)) === digest(canonicalPortfolio(expected)), 'PORTFOLIO_DRIFT');
    requireContract(Array.isArray(snapshot.openOrders) && snapshot.openOrders.length === 0, 'OPEN_ORDER_CONFLICT');
    requireContract(Array.isArray(snapshot.rows) && snapshot.rows.length === 5
      && new Set(snapshot.rows.map(r => r?.assetId)).size === 5, 'ROW_COUNT_INVALID');
    const proposedOrders = scope.terms.targets.filter(t => !Object.hasOwn(committed, t.assetId))
      .map(t => priceOrder(scope, t, snapshot.rows.find(r => r.assetId === t.assetId), time(clock.now)));
    requireContract(object(committed) && Object.keys(committed).every(k => scope.terms.targets.some(t => t.assetId === k)
      && positive(committed[k])), 'COMMITTED_NOTIONAL_INVALID');
    const total = [...Object.values(committed), ...proposedOrders.map(o => o.plannedNotional)].reduce((a, v) => add(a, ratio(v)), [0n, 1n]);
    requireContract(withinCap(total, scope.terms.maxTotalNotional), 'TOTAL_CAP_EXCEEDED');
    return freeze({ status: 'READY_REPORT_ONLY', reasons: [], proposedOrders,
      reservedPlannedNotional: decimalText(total), evidenceSha256: digest(snapshot), ...SAFETY });
  } catch (error) {
    const code = /^SCOPED_CLOSEOUT_[A-Z_]+$/.test(error.message) ? error.message : 'SCOPED_CLOSEOUT_SNAPSHOT_INVALID';
    return freeze({ status: 'BLOCKED', reasons: [code], proposedOrders: [], ...SAFETY });
  }
}

const states = new WeakSet(), consumed = new WeakSet();
const phases = {
  account: ['account'],
  initial: ['positions', 'orders', 'clock', 'calendar', 'assets', 'assets', 'assets', 'assets', 'assets', 'quotes'],
  presubmit: ['account', 'positions', 'orders', 'clock', 'assets', 'quotes'],
  postcheck: ['lookup', 'positions', 'orders', 'clock'],
};
export function createScopedCloseoutState(scope) {
  requireContract(scopes.has(scope), 'UNVALIDATED_SCOPE');
  const state = freeze({ scope, phase: 'CREATED', index: 0, counts: Object.fromEntries(Object.keys(BUDGET).map(k => [k, 0])),
    rows: scope.terms.targets.map(t => ({ assetId: t.assetId, phase: 'NOT_ATTEMPTED' })),
    committed: {}, pendingRecords: [], notificationCount: 0, notificationKeys: [], stickyStop: false, ...SAFETY });
  states.add(state); return state;
}
function reserveRecord(scope, order, at, evidenceSha256) {
  const target = scope.terms.targets.find(t => t.assetId === order.assetId);
  return { recordKind: 'SCOPED_MANAGEMENT_EXIT_V1', schemaVersion: 1, attemptId: scope.attemptId,
    managementAuthoritySha256: scope.authoritySha256, termsSha256: scope.termsSha256,
    accountSha256: scope.accountSha256, originalIdentitySha256: target.originalIdentitySha256,
    exitIdempotencyKey: order.exitIdempotencyKey, clientOrderId: order.clientOrderId, assetId: order.assetId,
    side: 'sell', actionType: 'EXIT_FULL', qty: order.qty, limitPrice: order.limitPrice,
    observedEvidenceSha256: evidenceSha256, requestSha256: null, preWriteHashes: scope.preWriteHashes,
    createdAt: at, updatedAt: at, submissionPhase: 'RESERVED', brokerOrderId: null, brokerStatus: null, filledQty: '0',
    originalOwnershipVerified: false, realizedPnlVerified: false, historicalEvidenceNormalized: false, brokerSubmitAllowed: false,
    history: [{ at, phase: 'RESERVED', evidenceSha256, brokerStatus: null, filledQty: '0' }] };
}
function appendObservation(record, phase, at, evidenceSha256, observation = {}) {
  const r = { ...record, ...observation, updatedAt: at, observedEvidenceSha256: evidenceSha256, submissionPhase: phase };
  r.history = [...record.history, { at, phase, evidenceSha256, brokerStatus: r.brokerStatus, filledQty: r.filledQty }];
  return r;
}
function receiptMatches(state, receipt) {
  requireContract(exact(receipt, 'recordsSha256 storeHashes') && receipt.recordsSha256 === digest(state.pendingRecords)
    && exact(receipt.storeHashes, 'orderLedger orderIdempotency') && Object.values(receipt.storeHashes).every(hash), 'PERSISTENCE_PARITY_INVALID');
}
function reads(state, phase) {
  state.readGroups = phases[phase];
  return phases[phase].map(group => {
    requireContract(++state.counts[group] <= BUDGET[group], 'BUDGET_EXCEEDED');
    return { type: 'READ', group, phase, modeledOnly: true, maxDurationMs: 3000, maxBytes: 8388608 };
  });
}
const transportValid = r => object(r) && r.complete === true && Number.isInteger(r.status) && r.status >= 200 && r.status < 300
  && Number.isFinite(r.durationMs) && r.durationMs >= 0 && r.durationMs <= 3000
  && Number.isInteger(r.bytes) && r.bytes > 0 && r.bytes <= 8388608 && hash(r.responseSha256);
function validateReads(state, responses) {
  requireContract(Array.isArray(responses) && responses.length === state.readGroups.length
    && responses.every((r, i) => r.group === state.readGroups[i] && transportValid(r)), 'READ_FAILED');
}
function observationFor(state, o) {
  const r = state.rows[state.index];
  requireContract(object(o) && o.accountSha256 === state.scope.accountSha256 && o.assetId === r.assetId
    && o.clientOrderId === r.clientOrderId && id(o.brokerOrderId)
    && (r.brokerOrderId === null || r.brokerOrderId === o.brokerOrderId)
    && ['accepted', 'partially_filled', 'filled', 'canceled', 'rejected', 'expired'].includes(o.brokerStatus)
    && typeof o.filledQty === 'string' && /^(?:0|[1-9]\d{0,15})(?:\.\d{1,9})?$/.test(o.filledQty)
    && compare(ratio(o.filledQty), ratio(r.filledQty)) >= 0 && withinCap(ratio(o.filledQty), r.qty), 'BROKER_OBSERVATION_INVALID');
  const full = compare(ratio(o.filledQty), ratio(r.qty)) === 0, any = ratio(o.filledQty)[0] > 0n;
  requireContract((o.brokerStatus !== 'filled' || full) && (o.brokerStatus !== 'partially_filled' || (any && !full))
    && (!['accepted', 'rejected'].includes(o.brokerStatus) || !any)
    && (!['filled', 'canceled', 'rejected', 'expired'].includes(r.brokerStatus) || o.brokerStatus === r.brokerStatus), 'FILL_CONFLICT');
  return { brokerOrderId: o.brokerOrderId, brokerStatus: o.brokerStatus, filledQty: o.filledQty };
}
function postSnapshotValid(state, event, o) {
  const s = event.snapshot, now = time(event.clock.now);
  requireContract(object(s) && s.complete === true && snapshotMatches(state.scope, s)
    && s.accountSha256 === state.scope.accountSha256 && s.sourceSha256 === state.scope.sourceSha256, 'POSTCHECK_INVALID');
  requireContract(o.brokerStatus === 'filled' && Array.isArray(s.openOrders) && s.openOrders.length === 0, 'POSTCHECK_NOT_FLAT');
  const removed = new Set([...Object.keys(state.committed), state.rows[state.index].assetId]);
  const expected = state.scope.terms.portfolio.filter(p => !removed.has(p.assetId));
  const sorted = rows => rows.map(r => ({ ...r, qty: decimalText(ratio(r.qty)) })).sort((a, b) => a.assetId.localeCompare(b.assetId));
  requireContract(Array.isArray(s.portfolio) && digest(sorted(expected)) === digest(sorted(s.portfolio)), 'POSTCHECK_PORTFOLIO_DRIFT');
  requireContract(s.clock?.version === 'v2' && s.clock.isOpen === true && s.clock.session === state.scope.authority.session
    && s.clock.clockAlignment === bindingStatus(state.scope) && s.clock.timezone === 'America/New_York'
    && sessionMatches(s.clock, event.clock.now, state.scope.authority.session)
    && time(state.scope.authority.expiresAt) > now
    && time(s.clock.timestamp) <= now && now - time(s.clock.timestamp) <= 30000
    && time(s.clock.open) <= now && time(s.clock.close) > now, 'POSTCHECK_CLOCK_INVALID');
}

function validatePostRead(state, event, group) {
  const index = phases.postcheck.indexOf(group), r = event.responses?.[index], o = event.snapshot?.observations?.[group];
  const lower = index === 0 ? state.outcomeAt : event.snapshot?.observations?.[phases.postcheck[index - 1]]?.retrievedAt;
  requireContract(r?.group === group && transportValid(r) && exact(o, 'basis requestedAt retrievedAt responseSha256')
    && o.basis === 'OBSERVED_GET_INTERVAL' && o.responseSha256 === r.responseSha256
    && time(o.requestedAt) >= time(lower) && time(o.requestedAt) <= time(o.retrievedAt)
    && time(o.retrievedAt) <= time(event.clock.now) && time(event.clock.now) - time(o.requestedAt) <= 30000
    && time(o.retrievedAt) - time(o.requestedAt) <= 3000, 'POSTCHECK_PROVENANCE_INVALID');
  if (group === 'lookup') requireContract(event.observation?.responseSha256 === r.responseSha256, 'LOOKUP_HASH_INVALID');
  if (group === 'clock') requireContract(event.snapshot?.clock?.responseSha256 === r.responseSha256, 'CLOCK_HASH_INVALID');
}

function notify(state, effects, record) {
  const types = record?.brokerStatus ? [`ORDER_${record.brokerStatus.toUpperCase()}`] : [];
  if (record?.submissionPhase === 'FLAT_RECONCILED') types.push('MANAGEMENT_POSITION_FLAT_RECONCILED');
  if (state.phase === 'STOPPED') types.push('SCOPED_CLOSEOUT_STOPPED');
  for (const eventType of types) {
    const eventKey = digest([state.scope.attemptId, record?.exitIdempotencyKey ?? null, eventType, record?.filledQty ?? null]);
    if (state.notificationKeys.includes(eventKey)) continue;
    requireContract(state.notificationCount < 21, 'NOTIFICATION_BUDGET_EXCEEDED');
    state.notificationKeys.push(eventKey); state.notificationCount++;
    effects.push({ type: 'NOTIFY', eventType, eventKey, modeledOnly: true, evidenceSha256: record ? digest(record) : null });
  }
}

// Inert effects only. This module has no broker, credentials, I/O or activation path.
export function advanceScopedCloseout(previous, event) {
  requireContract(states.has(previous), 'UNVALIDATED_STATE');
  const state = { ...structuredClone(previous), scope: previous.scope,
    ...(observed(previous.scope) && previous.snapshot ? { snapshot: previous.snapshot } : {}) }, effects = [];
  if (previous.phase === 'COMPLETE' || previous.phase === 'STOPPED') return { state: previous, effects };
  try {
    requireContract(!consumed.has(previous), 'STATE_REPLAY'); consumed.add(previous);
    const now = time(event?.clock?.now), elapsed = event?.clock?.elapsedMs;
    requireContract(Number.isFinite(now) && Number.isFinite(elapsed) && elapsed >= (state.lastElapsed ?? 0) && elapsed <= 300000
      && now >= (state.lastNow ?? now), 'CLOCK_OR_ATTEMPT_EXPIRED');
    state.lastNow = now; state.lastElapsed = elapsed;
    if (event.type === 'INITIALIZE' && state.phase === 'CREATED') {
      state.phase = 'ACCOUNT_PREFLIGHT'; effects.push(...reads(state, 'account'));
    } else if (event.type === 'ACCOUNT_READY' && state.phase === 'ACCOUNT_PREFLIGHT') {
      validateReads(state, event.responses);
      requireContract(event.accountSha256 === state.scope.accountSha256, 'ACCOUNT_MISMATCH');
      state.phase = 'INITIAL_PREFLIGHT'; effects.push(...reads(state, 'initial'));
    } else if (event.type === 'PREFLIGHT' && ['INITIAL_PREFLIGHT', 'REVALIDATING'].includes(state.phase)) {
      validateReads(state, event.responses);
      const result = evaluateCloseoutSnapshot(state.scope, event.snapshot, event.clock, state.committed);
      requireContract(result.status === 'READY_REPORT_ONLY', 'PREFLIGHT_BLOCKED');
      state.snapshot = observed(state.scope) ? event.snapshot : structuredClone(event.snapshot);
      if (state.phase === 'INITIAL_PREFLIGHT') {
        state.rows = result.proposedOrders.map(o => reserveRecord(state.scope, o, event.clock.now, result.evidenceSha256));
        state.pendingRecords = state.rows; state.phase = 'RESERVING';
        effects.push({ type: 'RESERVE_ALL', records: state.pendingRecords });
      } else {
        const order = result.proposedOrders.find(o => o.assetId === state.rows[state.index].assetId);
        requireContract(order && state.rows[state.index].submissionPhase === 'RESERVED', 'ATTEMPT_REPLAY');
        state.order = order;
        const r = appendObservation(state.rows[state.index], 'ATTEMPTED', event.clock.now, result.evidenceSha256);
        r.limitPrice = order.limitPrice; r.requestSha256 = digest(order);
        state.pendingRecords = [r]; state.phase = 'ATTEMPT_PERSIST';
        effects.push({ type: 'RECORD_ATTEMPT', record: r });
      }
    } else if (event.type === 'RESERVED' && state.phase === 'RESERVING') {
      receiptMatches(state, event.receipt); state.phase = 'REVALIDATING'; effects.push(...reads(state, 'presubmit'));
    } else if (event.type === 'ATTEMPT_RECORDED' && state.phase === 'ATTEMPT_PERSIST') {
      receiptMatches(state, event.receipt);
      requireContract(evaluateCloseoutSnapshot(state.scope, state.snapshot, event.clock, state.committed).status === 'READY_REPORT_ONLY', 'PRESEND_STALE');
      requireContract(++state.counts.submit <= BUDGET.submit, 'BUDGET_EXCEEDED');
      state.rows[state.index] = state.pendingRecords[0]; state.phase = 'SUBMITTING';
      state.submitElapsed = elapsed;
      effects.push({ type: 'PROPOSE_LIMIT_ORDER', order: state.order, modeledOnly: true, brokerSubmitAllowed: false });
    } else if (event.type === 'SUBMIT_RESULT' && state.phase === 'SUBMITTING') {
      let observation = {}, phase = 'OBSERVED';
      state.outcomeElapsed = elapsed;
      state.outcomeAt = event.clock.now;
      try {
        requireContract(transportValid(event.response) && elapsed - state.submitElapsed <= 3000, 'SUBMIT_UNCERTAIN');
        observation = observationFor(state, event.observation);
        if (!['accepted', 'filled'].includes(observation.brokerStatus)) state.stickyStop = true;
      } catch { state.stickyStop = true; phase = 'STOPPED'; }
      state.pendingRecords = [appendObservation(state.rows[state.index], phase, event.clock.now,
        hash(event.response?.responseSha256) ? event.response.responseSha256 : digest({ status: 'UNAVAILABLE' }), observation)];
      state.phase = 'OBSERVATION_PERSIST'; effects.push({ type: 'RECORD_OBSERVATION', record: state.pendingRecords[0] });
    } else if (event.type === 'OBSERVATION_RECORDED' && state.phase === 'OBSERVATION_PERSIST') {
      receiptMatches(state, event.receipt); state.rows[state.index] = state.pendingRecords[0];
      requireContract(elapsed - state.outcomeElapsed <= 2000, 'POSTCHECK_START_EXPIRED');
      state.phase = 'POSTCHECK'; effects.push(...reads(state, 'postcheck'));
      notify(state, effects, state.rows[state.index]);
    } else if (event.type === 'POSTCHECK' && state.phase === 'POSTCHECK') {
      let observation = {}, lookupVerified = false, phase = 'STOPPED';
      try {
        validatePostRead(state, event, 'lookup'); observation = observationFor(state, event.observation); lookupVerified = true;
      } catch { state.stickyStop = true; }
      // Preserve a verified fill even if a later portfolio/clock read fails.
      try {
        validateReads(state, event.responses);
        requireContract(exact(event.snapshot?.observations, 'lookup positions orders clock'), 'POSTCHECK_PROVENANCE_INVALID');
        for (const group of phases.postcheck) validatePostRead(state, event, group);
        postSnapshotValid(state, event, observation); if (!state.stickyStop) phase = 'FLAT_RECONCILED';
      }
      catch { state.stickyStop = true; }
      if (phase !== 'FLAT_RECONCILED') state.stickyStop = true;
      const evidenceHash = phase === 'FLAT_RECONCILED' ? digest(event.snapshot) : lookupVerified
        ? event.observation.responseSha256 : digest({ status: 'POSTCHECK_UNVERIFIED' });
      state.pendingRecords = [appendObservation(state.rows[state.index], phase, event.clock.now, evidenceHash, observation)];
      state.phase = 'FINAL_PERSIST'; effects.push({ type: 'RECORD_OBSERVATION', record: state.pendingRecords[0] });
    } else if (event.type === 'FINAL_RECORDED' && state.phase === 'FINAL_PERSIST') {
      receiptMatches(state, event.receipt); const r = state.pendingRecords[0]; state.rows[state.index] = r;
      if (state.stickyStop || r.submissionPhase !== 'FLAT_RECONCILED') { state.phase = 'STOPPED'; }
      else {
        state.committed[r.assetId] = state.order.plannedNotional; state.index++;
        if (state.index === 5) state.phase = 'COMPLETE';
        else { state.phase = 'REVALIDATING'; effects.push(...reads(state, 'presubmit')); }
      }
      notify(state, effects, r);
    } else requireContract(false, 'EVENT_INVALID');
  } catch (error) {
    state.phase = 'STOPPED'; state.stickyStop = true;
    state.reason = /^SCOPED_CLOSEOUT_[A-Z_]+$/.test(error.message) ? error.message : 'SCOPED_CLOSEOUT_EVENT_INVALID';
    effects.length = 0;
  }
  const result = freeze(state); states.add(result);
  return { state: result, effects: freeze(effects) };
}
