import assert from 'node:assert/strict';
import { fixture, hash } from './fixtures/scoped-closeout.mjs';
import { validateScopedCloseoutInput, evaluateCloseoutSnapshot } from './lib/scoped-closeout-contract.mjs';
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
