import assert from 'node:assert/strict';
import { fixture, hash } from './fixtures/scoped-closeout.mjs';
import { validateScopedCloseoutInput, evaluateCloseoutSnapshot, createScopedCloseoutState, advanceScopedCloseout } from './lib/scoped-closeout-contract.mjs';
import { decimalRatio, withinCap, ceilToTick } from './lib/closeout-decimal.mjs';
let checks = 0;
function run(change = () => {}) {
  const f = fixture(); change(f);
  return evaluateCloseoutSnapshot(validateScopedCloseoutInput(f.input), f.snapshot, f.clock);
}
function blocked(change) {
  checks++;
  try { assert.equal(run(change).status, 'BLOCKED'); }
  catch (e) { if (e.name === 'AssertionError') throw e; assert.match(e.message, /^SCOPED_CLOSEOUT_[A-Z_]+$/); }
}
assert.equal(run().status, 'READY_REPORT_ONLY');
assert.equal(run().proposedOrders.length, 5);
assert.equal(run().proposedOrders[0].limitPrice, '99.9'); checks += 3;
for (const change of [
  f => f.input.terms.targets.pop(), f => f.input.termsSha256 = hash('other'),
  f => f.input.authority.allowBuy = true, f => f.input.safeFlags.execEnabled = true,
  f => f.input.safeFlags.readOnly = false, f => f.input.environment = 'LIVE',
  f => f.input.evidenceMode = 'RUNTIME', f => f.snapshot.accountSha256 = hash('other'),
  f => f.snapshot.sourceSha256 = hash('other'), f => f.snapshot.portfolio[0].qty = '3',
  f => f.snapshot.rows[0].originalIdentitySha256 = hash('other'), f => f.snapshot.rows[0].qty = '1',
  f => f.snapshot.openOrders.push({ legs: [{}] }), f => f.snapshot.complete = false,
  f => f.snapshot.clock.version = 'v3', f => f.snapshot.clock.isOpen = false,
  f => f.snapshot.clock.clockAlignment = 'UNVERIFIED', f => f.snapshot.clock.timezone = 'UTC',
  f => f.snapshot.clock.close = '2026-10-09T15:00:16.000Z',
  f => f.clock.elapsedMs = 283001, f => f.clock.now = '2026-10-09T14:59:59.999Z',
  f => f.snapshot.rows[0].quoteAt = '2026-10-09T14:59:29.999Z',
  f => f.snapshot.rows[0].quoteAt = '2026-10-09T15:00:00.001Z',
  f => f.snapshot.observations.positions.requestedAt = '2026-10-09T14:59:29.999Z',
  f => f.snapshot.observations.positions.basis = 'PUBLICATION_TIMESTAMP',
  f => f.snapshot.rows[0].sizeUnit = 'round_lots', f => f.snapshot.rows[0].feed = 'iex',
  f => f.snapshot.rows[0].sourceBinding = 'UNVERIFIED', f => f.snapshot.rows[0].haltStatus = 'UNKNOWN',
  f => f.snapshot.rows[0].riskStatus = 'UNAVAILABLE', f => f.snapshot.rows[0].bidSizeShares = '1',
  f => f.snapshot.rows[0].ask = '100.11', f => f.snapshot.rows[0].ask = '99',
  f => f.snapshot.rows[0].tick = '0.1', f => f.snapshot.rows[0].quoteResponseSha256 = null,
  f => f.snapshot.rows[0].bid = '1e999999', f => f.snapshot.rows[0].ask = 'NaN',
]) blocked(change);
assert.equal(run(f => f.snapshot.rows[0].quoteAt = '2026-10-09T14:59:30.000Z').status, 'READY_REPORT_ONLY'); checks++;
// Decimal arithmetic never uses a binary-float tolerance or rounds quantity down.
assert.equal(withinCap(decimalRatio('0.3000000001'), '0.3'), false);
assert.equal(ceilToTick(decimalRatio('0.99999'), '0.01'), '1');
assert.equal(ceilToTick(decimalRatio('1.00001'), '0.01'), '1.01'); checks += 3;
for (const value of ['Infinity', '', '0x10', '1e999999', '--2', ' 1']) { assert.throws(() => decimalRatio(value)); checks++; }
const f = fixture(); const scope = validateScopedCloseoutInput(f.input);
f.input.terms.targets[0].qty = '999';
assert.equal(scope.terms.targets[0].qty, '2');
assert.throws(() => { scope.terms.targets[0].qty = '9'; }); checks += 2;
console.log(JSON.stringify({ status: 'PASS', suite: 'scoped-closeout-contract', checks, brokerRequests: 0 }));

const base = fixture();
const start = createScopedCloseoutState(validateScopedCloseoutInput(base.input));
const initialized = advanceScopedCloseout(start, { type: 'INITIALIZE', clock: base.clock });
assert.equal(initialized.effects.filter(e => e.type === 'READ').length, 11);
assert.equal(advanceScopedCloseout(start, { type: 'INITIALIZE', clock: base.clock }).state.phase, 'STOPPED');
const responses = effects => effects.filter(e => e.type === 'READ').map(e => ({ group: e.group, complete: true, status: 200, durationMs: 2, bytes: 10, responseSha256: hash(e) }));
let step = advanceScopedCloseout(initialized.state, { type: 'PREFLIGHT', snapshot: base.snapshot, clock: base.clock, responses: responses(initialized.effects) });
assert.equal(step.effects[0].type, 'RESERVE_ALL');
const receipt = s => ({ recordsSha256: hash(s.pendingRecords), storeHashes: { orderLedger: hash('l'), orderIdempotency: hash('i') } });
step = advanceScopedCloseout(step.state, { type: 'RESERVED', receipt: receipt(step.state), clock: base.clock });
step = advanceScopedCloseout(step.state, { type: 'PREFLIGHT', snapshot: base.snapshot, clock: base.clock, responses: responses(step.effects) });
assert.equal(step.effects[0].type, 'RECORD_ATTEMPT');
step = advanceScopedCloseout(step.state, { type: 'ATTEMPT_RECORDED', receipt: receipt(step.state), clock: base.clock });
assert.equal(step.effects[0].type, 'PROPOSE_LIMIT_ORDER');
assert.equal(step.state.counts.submit, 1);
const stopped = advanceScopedCloseout(step.state, { type: 'FAILURE', clock: base.clock });
assert.equal(stopped.state.phase, 'STOPPED');
assert.equal(advanceScopedCloseout(stopped.state, { type: 'INITIALIZE', clock: base.clock }).effects.length, 0);
console.log(JSON.stringify({ status: 'PASS', suite: 'scoped-closeout-transitions', checks: 8, brokerRequests: 0 }));

function flow({ submitStatus = 'filled', postStatus = 'filled', responsePatch = {}, postPatch = () => {}, persistenceFailure = false } = {}) {
  const f = fixture(); let result = { state: createScopedCloseoutState(validateScopedCloseoutInput(f.input)), effects: [] };
  const go = e => { result = advanceScopedCloseout(result.state, { ...e, clock: f.clock }); };
  go({ type: 'INITIALIZE' });
  for (let n = 0; n < 60 && !['STOPPED', 'COMPLETE'].includes(result.state.phase); n++) {
    const { state, effects } = result;
    const row = state.rows[state.index];
    const snapshot = structuredClone(f.snapshot);
    snapshot.portfolio = snapshot.portfolio.filter(p => !Object.hasOwn(state.committed, p.assetId));
    const obs = status => ({ accountSha256: f.input.accountSha256, assetId: row.assetId, clientOrderId: row.clientOrderId,
      brokerOrderId: `broker-fixture-${state.index}`, brokerStatus: status,
      filledQty: status === 'filled' ? '2' : ['partially_filled', 'canceled'].includes(status) ? '0.5' : '0' });
    switch (state.phase) {
      case 'INITIAL_PREFLIGHT': case 'REVALIDATING': go({ type: 'PREFLIGHT', snapshot, responses: responses(effects) }); break;
      case 'RESERVING': go({ type: 'RESERVED', receipt: receipt(state) }); break;
      case 'ATTEMPT_PERSIST': go({ type: persistenceFailure ? 'FAILURE' : 'ATTEMPT_RECORDED', receipt: receipt(state) }); break;
      case 'SUBMITTING': go({ type: 'SUBMIT_RESULT', observation: obs(submitStatus), response: {
        complete: true, status: 200, durationMs: 1, bytes: 10, responseSha256: hash('submit'), ...responsePatch } }); break;
      case 'OBSERVATION_PERSIST': go({ type: 'OBSERVATION_RECORDED', receipt: receipt(state) }); break;
      case 'POSTCHECK': {
        if (postStatus === 'filled') snapshot.portfolio = snapshot.portfolio.filter(p => p.assetId !== row.assetId);
        const event = { type: 'POSTCHECK', snapshot, responses: responses(effects), observation: obs(postStatus) };
        postPatch(event); go(event); break;
      }
      case 'FINAL_PERSIST': go({ type: 'FINAL_RECORDED', receipt: receipt(state) }); break;
      default: assert.fail('Unexpected fixture phase');
    }
  }
  return result;
}
for (const submitStatus of ['accepted', 'filled']) {
  const done = flow({ submitStatus });
  assert.equal(done.state.phase, 'COMPLETE');
  assert.deepEqual(done.state.counts, { account: 6, positions: 11, orders: 11, clock: 11, calendar: 1, assets: 10, lookup: 5, quotes: 6, submit: 5 });
  assert.equal(done.state.rows.filter(r => r.submissionPhase === 'FLAT_RECONCILED').length, 5); checks += 3;
}
for (const scenario of [
  { submitStatus: 'partially_filled', postStatus: 'canceled' }, { submitStatus: 'accepted', postStatus: 'accepted' },
  ...[{ status: 429 }, { status: 403 }, { status: 500 }, { complete: false }, { durationMs: 3001 }, { bytes: 8388609 }].map(responsePatch => ({ responsePatch })),
  { postPatch: e => e.responses[0].status = 404 }, { postPatch: e => e.snapshot.openOrders.push({ protective: true }) },
  { postPatch: e => e.observation.brokerOrderId = 'different-broker' },
]) {
  const result = flow(scenario);
  assert.equal(result.state.phase, 'STOPPED'); assert.equal(result.state.counts.submit, 1); checks += 2;
  assert.equal(result.state.rows.slice(1).every(r => r.submissionPhase === 'RESERVED'), true); checks++;
}
assert.equal(flow({ persistenceFailure: true }).state.counts.submit, 0); checks++;
// Cap checks use ask, not the discounted sell floor, and do not release committed notional.
blocked(f => { f.input.terms.targets[0].maxNotional = '200'; f.input.termsSha256 = hash(f.input.terms); });
blocked(f => { f.input.terms.maxTotalNotional = '1000'; f.input.termsSha256 = hash(f.input.terms); });
const fractional = fixture();
fractional.input.terms.targets[0].qty = fractional.input.terms.portfolio[0].qty = fractional.snapshot.rows[0].qty = '0.123456789';
fractional.input.termsSha256 = hash(fractional.input.terms);
assert.equal(evaluateCloseoutSnapshot(validateScopedCloseoutInput(fractional.input), fractional.snapshot, fractional.clock).status, 'READY_REPORT_ONLY'); checks++;
fractional.snapshot.rows[0].quantityIncrement = '0.01';
assert.equal(evaluateCloseoutSnapshot(validateScopedCloseoutInput(fractional.input), fractional.snapshot, fractional.clock).status, 'BLOCKED'); checks++;
console.log(JSON.stringify({ status: 'PASS', suite: 'scoped-closeout-failure-matrix', checks, brokerRequests: 0 }));
