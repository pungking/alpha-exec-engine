import assert from 'node:assert/strict';
import { sha256Canonical as hash } from './lib/active-position-limited-recovery.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { attendedFixture } from './fixtures/scoped-paper-adapter.mjs';
import { limitedManagementRecord } from './fixtures/scoped-closeout.mjs';
import * as operational from './lib/scoped-paper-operational.mjs';
import * as contract from './lib/scoped-closeout-contract.mjs';
import { createScopedPaperTransport } from './lib/scoped-paper-transport.mjs';

let riskModule;
try { riskModule = await import('./lib/scoped-paper-risk-evidence.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
assert.equal(typeof riskModule?.replayAttendedRisk, 'function', 'measured risk replay must exist, not a PASS label');
const { replayAttendedRisk } = riskModule;
const at = '2026-10-09T15:00:00.000Z';
const start = '2026-10-08T20:00:00.000Z';
const sessions = ['2026-10-06T20:00:00.000Z', '2026-10-07T20:00:00.000Z', start];
let checks = 0, authorityChildChecks = 0;

function fixture() {
  const assetIds = Array.from({ length: 5 }, (_, i) => `fixture-asset-${i}`);
  return {
    decisionAt: at,
    policy: { schemaVersion: 'scoped-paper-risk-policy-v1', policySourceSha256: hash('fixture-risk-policy'),
      accountSha256: hash('fixture-account'), termsSha256: hash('fixture-terms'), limits: {
      maxPositionPct: '10', maxSectorPct: '25', maxPortfolioExposurePct: '40',
      maxDailyLossPct: '5', maxDrawdownPct: '10', maxVolatilityPct: '30',
      minAverageDailyDollarVolumeUsd: '100000', minEarningsDistanceDays: '7',
    } },
    definition: { schemaVersion: 'attended-risk-measurement-v1', marketTimezone: 'America/New_York',
      portfolioAssetIds: assetIds, dailyLossStartAt: start, equitySampleTimes: [start, at],
      marketSessions: sessions, maxEvidenceAgeMs: 30000,
      volatility: { lookbackSessions: 3, minimumReturns: 2, annualizationFactor: 252, returnBasis: 'SIMPLE_PRICE_RETURN' },
      dollarVolume: { lookbackSessions: 3, minimumObservations: 3, adjustmentBasis: 'RAW_PRICE_RAW_VOLUME' },
      priceAdjustmentBasis: 'SPLIT_ADJUSTED_PRICE' },
    sourceRecords: { schemaVersion: 'attended-risk-records-v1', accountSha256: hash('fixture-account'),
      termsSha256: hash('fixture-terms'), sourceHashes: [hash('fixture-original-records')],
      availableAt: at, validUntil: '2026-10-09T15:00:30.000Z',
      sectors: assetIds.map((assetId, i) => ({ assetId, sector: `fixture-sector-${i}` })),
      equity: [{ at: start, equityUsd: '10000' }, { at, equityUsd: '10000' }],
      cashFlows: { coverageStart: start, coverageEnd: at, rows: [] },
      bars: assetIds.map(assetId => ({ assetId, priceAdjustmentBasis: 'SPLIT_ADJUSTED_PRICE',
        volumeAdjustmentBasis: 'RAW_PRICE_RAW_VOLUME', rows: sessions.map(time => ({ at: time,
          adjustedClose: '100', rawClose: '100', rawVolume: '2000' })) })),
      earnings: assetIds.map(assetId => ({ assetId, eventAt: '2026-11-09T21:00:00.000Z',
        publishedAt: '2026-10-08T12:00:00.000Z' })),
    },
    currentAccount: { accountSha256: hash('fixture-account'), currency: 'USD', equityUsd: '10000', observedAt: at },
    currentPositions: assetIds.map(assetId => ({ assetId, side: 'long', qty: '2', marketValueUsd: '200', observedAt: at })),
  };
}
function result(change) {
  const input = fixture(); change?.(input);
  const before = hash(input), out = replayAttendedRisk(input);
  assert.equal(hash(input), before, 'risk replay cannot mutate inputs');
  assert.equal(out.sourceVerified, false, 'arithmetic never proves provenance');
  assert.equal(out.executionAuthorized, false);
  assert.equal(Object.isFrozen(out), true); checks += 4;
  return out;
}
function blocked(name, change, reason) {
  const out = result(change);
  assert.equal(out.status, 'BLOCKED', name);
  if (reason) assert.ok(out.reasons.includes(reason), `${name}: ${out.reasons}`);
  checks += 2;
}

const good = result();
assert.equal(good.status, 'RISK_REPLAY_PASS_NOT_SOURCE_VERIFIED');
assert.equal(good.measurements.length, 8);
assert.deepEqual(good.reasons, []);
assert.deepEqual(good, result()); checks += 4;
const delayed = result(x => {
  const observedAt = '2026-10-09T14:59:59.500Z';
  x.currentAccount.observedAt = observedAt;
  x.definition.equitySampleTimes[1] = observedAt;
  x.sourceRecords.equity[1].at = observedAt;
  x.sourceRecords.cashFlows.coverageEnd = observedAt;
});
assert.equal(delayed.status, good.status, 'receipt latency must not require fabricated current timestamps');
assert.equal(delayed.measurements[0].evaluatedAt, at);
assert.ok(delayed.measurements[0].sourceAsOf.includes('2026-10-09T14:59:59.500Z')); checks += 3;
blocked('daily loss baseline cannot equal the current sample after receipt delay', x => {
  const observedAt = '2026-10-09T14:59:59.500Z';
  x.currentAccount.observedAt = observedAt;
  x.definition.equitySampleTimes[1] = observedAt;
  x.definition.dailyLossStartAt = observedAt;
  x.sourceRecords.equity[1].at = observedAt;
  x.sourceRecords.cashFlows.coverageEnd = observedAt;
}, 'SCOPED_RISK_TIME_GRID_INVALID');
const value = dimension => good.measurements.find(m => m.dimension === dimension).value;
assert.deepEqual(value('maxPortfolioExposurePct'), { numerator: '10', denominator: '1' });
assert.deepEqual(value('maxDailyLossPct'), { numerator: '0', denominator: '1' }); checks += 2;
for (const key of Object.keys(fixture().policy.limits)) {
  blocked(`missing limit ${key}`, x => { delete x.policy.limits[key]; });
}
for (const field of ['sectors', 'equity', 'cashFlows', 'bars', 'earnings']) {
  blocked(`missing required risk input ${field}`, x => { delete x.sourceRecords[field]; });
}
blocked('PASS label is not measurements', x => { x.sourceRecords = { status: 'PASS' }; });
blocked('unknown source schema', x => { x.sourceRecords.schemaVersion = 'unknown'; });
blocked('account mismatch', x => { x.currentAccount.accountSha256 = hash('another'); });
blocked('terms mismatch', x => { x.sourceRecords.termsSha256 = hash('another'); });
blocked('zero equity', x => { x.currentAccount.equityUsd = '0'; });
blocked('negative equity', x => { x.currentAccount.equityUsd = '-1'; });
blocked('duplicate position', x => { x.currentPositions[1].assetId = x.currentPositions[0].assetId; });
blocked('unscoped position', x => { x.currentPositions[0].assetId = 'manual-position'; });
blocked('missing position', x => { x.currentPositions.pop(); });
blocked('missing sector', x => { x.sourceRecords.sectors.pop(); });
blocked('stale current account', x => { x.currentAccount.observedAt = '2026-10-09T14:59:29.999Z'; });
blocked('future current position', x => { x.currentPositions[0].observedAt = '2026-10-09T15:00:00.001Z'; });
blocked('source not yet available', x => { x.sourceRecords.availableAt = '2026-10-09T15:00:01.000Z'; });
blocked('source expired', x => { x.sourceRecords.validUntil = '2026-10-09T14:59:59.999Z'; });
blocked('missing cashflow coverage', x => { x.sourceRecords.cashFlows.coverageEnd = start; });
blocked('missing equity observation', x => { x.sourceRecords.equity.shift(); });
blocked('duplicate equity time', x => { x.sourceRecords.equity[1].at = start; });
blocked('current equity disagreement', x => { x.sourceRecords.equity[1].equityUsd = '9999'; });
blocked('bar gap', x => { x.sourceRecords.bars[0].rows.pop(); });
blocked('mixed adjustment', x => { x.sourceRecords.bars[0].priceAdjustmentBasis = 'UNKNOWN'; });
blocked('future bar', x => { x.sourceRecords.bars[0].rows[2].at = '2026-10-10T20:00:00.000Z'; });
blocked('earnings published after decision', x => { x.sourceRecords.earnings[0].publishedAt = '2026-10-10T12:00:00.000Z'; });
blocked('earnings missing', x => { x.sourceRecords.earnings.pop(); });
blocked('earnings near event', x => { x.sourceRecords.earnings[0].eventAt = '2026-10-12T12:00:00.000Z'; }, 'SCOPED_RISK_MIN_EARNINGS_DISTANCE_DAYS');
blocked('earnings past event', x => { x.sourceRecords.earnings[0].eventAt = '2026-10-08T12:00:00.000Z'; });

assert.equal(result(x => { x.policy.limits.maxPositionPct = '2'; }).status, good.status); checks++;
blocked('one decimal unit above position cap', x => { x.currentPositions[0].marketValueUsd = '200.000000001';
  x.policy.limits.maxPositionPct = '2'; }, 'SCOPED_RISK_MAX_POSITION_PCT');
blocked('sector cap', x => { for (const s of x.sourceRecords.sectors) s.sector = 'same';
  x.policy.limits.maxSectorPct = '9'; }, 'SCOPED_RISK_MAX_SECTOR_PCT');
blocked('portfolio cap', x => { x.policy.limits.maxPortfolioExposurePct = '9'; }, 'SCOPED_RISK_MAX_PORTFOLIO_EXPOSURE_PCT');
blocked('daily loss and drawdown', x => { x.currentAccount.equityUsd = '8000';
  x.sourceRecords.equity[1].equityUsd = '8000'; }, 'SCOPED_RISK_MAX_DAILY_LOSS_PCT');
blocked('drawdown includes earlier peak', x => { x.definition.equitySampleTimes.splice(1, 0, '2026-10-09T14:00:00.000Z');
  x.sourceRecords.equity.splice(1, 0, { at: '2026-10-09T14:00:00.000Z', equityUsd: '20000' }); }, 'SCOPED_RISK_MAX_DRAWDOWN_PCT');
const deposit = result(x => { x.currentAccount.equityUsd = '11000'; x.sourceRecords.equity[1].equityUsd = '11000';
  x.sourceRecords.cashFlows.rows.push({ eventSha256: hash('fixture-deposit'), at: '2026-10-09T14:00:00.000Z', amountUsd: '1000' }); });
assert.equal(deposit.status, good.status);
assert.deepEqual(deposit.measurements.find(m => m.dimension === 'maxDailyLossPct').value, value('maxDailyLossPct')); checks += 2;
blocked('cash movement cannot hide trading loss', x => { x.currentAccount.equityUsd = '10000';
  x.sourceRecords.cashFlows.rows.push({ eventSha256: hash('fixture-deposit'), at: '2026-10-09T14:00:00.000Z', amountUsd: '1000' }); }, 'SCOPED_RISK_MAX_DAILY_LOSS_PCT');
blocked('volatility cap', x => { x.sourceRecords.bars[0].rows[1].adjustedClose = '200'; }, 'SCOPED_RISK_MAX_VOLATILITY_PCT');
const exactVariance = x => {
  x.definition.volatility.annualizationFactor = 2;
  x.policy.limits.maxVolatilityPct = '20';
  x.sourceRecords.bars[0].rows[1].adjustedClose = '110';
  x.sourceRecords.bars[0].rows[2].adjustedClose = '99';
};
assert.equal(result(exactVariance).status, good.status); checks++;
blocked('variance one unit beyond cap without sqrt rounding', x => { exactVariance(x);
  x.policy.limits.maxVolatilityPct = '19.999999999'; }, 'SCOPED_RISK_MAX_VOLATILITY_PCT');
blocked('duplicate cashflow event', x => {
  x.sourceRecords.cashFlows.rows = Array(2).fill({ eventSha256: hash('same-event'), at: '2026-10-09T14:00:00.000Z', amountUsd: '1' });
});
blocked('dollar volume minimum', x => { x.sourceRecords.bars[0].rows[0].rawVolume = '0';
  x.sourceRecords.bars[0].rows[1].rawVolume = '0'; }, 'SCOPED_RISK_MIN_AVERAGE_DAILY_DOLLAR_VOLUME_USD');

function intervalRow(x, startAt, endAt, netExternalFlowUsd, index = 0) {
  return { startAt, endAt, netExternalFlowUsd,
    sourceRecordReferences: [{ sourceSha256: x.sourceRecords.sourceHashes[0], jsonPointer: `/externalFlows/${index}` }] };
}
function useIntervals(x) {
  x.definition.schemaVersion = 'attended-risk-measurement-v2';
  x.sourceRecords.schemaVersion = 'attended-risk-records-v2';
  x.sourceRecords.cashFlows = { coverageStart: start, coverageEnd: at, currency: 'USD',
    flowBasis: 'EXTERNAL_CAPITAL_ONLY', rows: [intervalRow(x, start, at, '0')] };
}
const intervalGood = result(useIntervals);
assert.equal(intervalGood.status, good.status, 'explicit covered zero intervals must support V2 replay');
assert.deepEqual(intervalGood, good, 'V2 representation must not change V1 risk values or authority'); checks += 2;
function intervalBlocked(name, change, reason) {
  blocked(name, x => { useIntervals(x); change(x); }, reason);
}
intervalBlocked('V1 definition cannot interpret interval records', x => { x.definition.schemaVersion = 'attended-risk-measurement-v1'; });
intervalBlocked('V2 definition cannot interpret V1 events', x => { x.sourceRecords.schemaVersion = 'attended-risk-records-v1'; });
intervalBlocked('unknown measurement version rejects', x => { x.definition.schemaVersion = 'attended-risk-measurement-v3'; });
intervalBlocked('missing interval is not explicit zero', x => { x.sourceRecords.cashFlows.rows = []; });
intervalBlocked('SDK empty map cannot prove no flows', x => { x.sourceRecords.cashFlows.rows = {}; });
intervalBlocked('interval currency mismatch', x => { x.sourceRecords.cashFlows.currency = 'EUR'; });
intervalBlocked('all activity is not external capital', x => { x.sourceRecords.cashFlows.flowBasis = 'ALL_ACCOUNT_ACTIVITY'; });
intervalBlocked('interval cannot manufacture event time', x => { x.sourceRecords.cashFlows.rows[0].at = at; });
intervalBlocked('interval reference absent', x => { x.sourceRecords.cashFlows.rows[0].sourceRecordReferences = []; });
intervalBlocked('interval reference unpinned', x => { x.sourceRecords.cashFlows.rows[0].sourceRecordReferences[0].sourceSha256 = hash('unbound'); });
intervalBlocked('invalid original-record pointer', x => { x.sourceRecords.cashFlows.rows[0].sourceRecordReferences[0].jsonPointer = '/invalid~2'; });
intervalBlocked('local complete flag is not source proof', x => { x.sourceRecords.cashFlows.complete = true; });
const midpoint = '2026-10-09T14:00:00.000Z';
const splitIntervals = x => { x.sourceRecords.cashFlows.rows = [intervalRow(x, start, midpoint, '0'), intervalRow(x, midpoint, at, '0', 1)]; };
assert.deepEqual(result(x => { useIntervals(x); splitIntervals(x); }), good, 'finer aligned intervals sum once'); checks++;
intervalBlocked('duplicate interval', x => { x.sourceRecords.cashFlows.rows.push(structuredClone(x.sourceRecords.cashFlows.rows[0])); });
intervalBlocked('overlapping intervals', x => { splitIntervals(x); x.sourceRecords.cashFlows.rows[1].startAt = start; });
intervalBlocked('internal interval gap', x => { splitIntervals(x); x.sourceRecords.cashFlows.rows[1].startAt = '2026-10-09T14:00:00.001Z'; });
intervalBlocked('reversed interval', x => { x.sourceRecords.cashFlows.rows[0].startAt = at; });
intervalBlocked('same original record cannot be counted twice', x => { splitIntervals(x);
  x.sourceRecords.cashFlows.rows[1].sourceRecordReferences = structuredClone(x.sourceRecords.cashFlows.rows[0].sourceRecordReferences); });
intervalBlocked('ancestor and descendant originals overlap', x => { splitIntervals(x);
  x.sourceRecords.cashFlows.rows[0].sourceRecordReferences[0].jsonPointer = '/externalFlows'; });
intervalBlocked('duplicate corroborating originals', x => { const r = x.sourceRecords.cashFlows.rows[0];
  r.sourceRecordReferences.push(structuredClone(r.sourceRecordReferences[0])); });
intervalBlocked('coarse zero bucket cannot hide policy sample peak', x => {
  x.definition.equitySampleTimes.splice(1, 0, midpoint);
  x.sourceRecords.equity.splice(1, 0, { at: midpoint, equityUsd: '20000' });
}, 'SCOPED_RISK_INTERVAL_POLICY_BOUNDARY_CROSSED');
intervalBlocked('fresh current account does not cover missing ten-second tail', x => {
  x.sourceRecords.cashFlows.coverageEnd = '2026-10-09T14:59:50.000Z';
  x.sourceRecords.cashFlows.rows[0].endAt = x.sourceRecords.cashFlows.coverageEnd;
}, 'SCOPED_RISK_CURRENT_RISK_GAP_UNPROVEN');
intervalBlocked('claimed current coverage cannot replace a missing tail row', x => {
  x.sourceRecords.cashFlows.rows[0].endAt = '2026-10-09T14:59:50.000Z';
}, 'SCOPED_RISK_CURRENT_RISK_GAP_UNPROVEN');
intervalBlocked('partial future bucket cannot be truncated', x => { x.sourceRecords.cashFlows.rows[0].endAt = '2026-10-09T15:00:01.000Z'; });
intervalBlocked('future coverage cannot be substituted for current', x => { x.sourceRecords.cashFlows.coverageEnd = '2026-10-09T15:00:01.000Z'; });
intervalBlocked('date-only flow boundary cannot become an instant', x => { x.sourceRecords.cashFlows.rows[0].startAt = '2026-10-08'; });
intervalBlocked('source interval-start label cannot stand in for endpoint', x => { x.sourceRecords.cashFlows.rows[0].endAt = start; });
intervalBlocked('late available original rejects', x => { x.sourceRecords.availableAt = '2026-10-09T15:00:00.001Z'; });
const tailCovered = result(x => { useIntervals(x); const boundary = '2026-10-09T14:59:50.000Z';
  x.sourceRecords.cashFlows.rows = [intervalRow(x, start, boundary, '0'), intervalRow(x, boundary, at, '0', 1)]; });
assert.deepEqual(tailCovered, good, 'supported explicit zero tail remains replayable, not source verified'); checks++;
const intervalDelayed = result(x => {
  useIntervals(x); const observedAt = '2026-10-09T14:59:59.500Z';
  x.currentAccount.observedAt = observedAt; x.definition.equitySampleTimes[1] = observedAt;
  x.sourceRecords.equity[1].at = observedAt; x.sourceRecords.cashFlows.coverageEnd = observedAt;
  x.sourceRecords.cashFlows.rows[0].endAt = observedAt;
});
assert.deepEqual(intervalDelayed, delayed, 'account cutoff remains distinct from decision time in V2'); checks++;
const splitMoney = result(x => {
  useIntervals(x); x.currentAccount.equityUsd = '9998.125'; x.sourceRecords.equity[1].equityUsd = '9998.125';
  x.sourceRecords.cashFlows.rows = [intervalRow(x, start, midpoint, '12.25'), intervalRow(x, midpoint, at, '-4.125', 1)];
});
assert.deepEqual(splitMoney.measurements.find(m => m.dimension === 'maxDailyLossPct').value,
  { numerator: '1', denominator: '10' }, 'signed finer intervals sum exactly, without float rounding'); checks++;
const innerDailyStart = result(x => {
  useIntervals(x); x.currentAccount.equityUsd = '10700'; x.sourceRecords.equity[1].equityUsd = '10700';
  x.definition.equitySampleTimes.splice(1, 0, midpoint); x.definition.dailyLossStartAt = midpoint;
  x.sourceRecords.equity.splice(1, 0, { at: midpoint, equityUsd: '11000' });
  x.sourceRecords.cashFlows.rows = [intervalRow(x, start, midpoint, '1000'), intervalRow(x, midpoint, at, '-200', 1)];
});
assert.deepEqual(innerDailyStart.measurements.find(m => m.dimension === 'maxDailyLossPct').value,
  { numerator: '10', denominator: '11' }, 'daily loss excludes capital before its unchanged baseline');
assert.deepEqual(innerDailyStart.measurements.find(m => m.dimension === 'maxDrawdownPct').value,
  { numerator: '1', denominator: '1' }, 'drawdown still covers the whole approved equity window'); checks += 2;
const corroborated = result(x => {
  useIntervals(x); x.currentAccount.equityUsd = '11000'; x.sourceRecords.equity[1].equityUsd = '11000';
  x.sourceRecords.cashFlows.rows[0].netExternalFlowUsd = '1000';
  x.sourceRecords.cashFlows.rows[0].sourceRecordReferences.push({ sourceSha256: x.sourceRecords.sourceHashes[0], jsonPointer: '/activities/0' });
});
assert.deepEqual(corroborated.measurements.find(m => m.dimension === 'maxDailyLossPct').value,
  { numerator: '0', denominator: '1' }, 'corroborating references do not multiply the single interval amount'); checks++;
intervalBlocked('unbounded interval list rejects', x => { x.sourceRecords.cashFlows.rows = Array(5001).fill(x.sourceRecords.cashFlows.rows[0]); });
intervalBlocked('unbounded source reference list rejects', x => { const r = x.sourceRecords.cashFlows.rows[0];
  r.sourceRecordReferences = Array(5001).fill(r.sourceRecordReferences[0]); });
intervalBlocked('nonpositive adjusted equity rejects', x => { x.sourceRecords.cashFlows.rows[0].netExternalFlowUsd = '10000'; },
  'SCOPED_RISK_ADJUSTED_EQUITY_INVALID');
intervalBlocked('future current account rejects', x => { x.currentAccount.observedAt = '2026-10-09T15:00:00.001Z'; });
intervalBlocked('coarse interval cannot cross daily loss baseline', x => {
  x.definition.equitySampleTimes.splice(1, 0, midpoint); x.definition.dailyLossStartAt = midpoint;
  x.sourceRecords.equity.splice(1, 0, { at: midpoint, equityUsd: '10000' });
}, 'SCOPED_RISK_INTERVAL_POLICY_BOUNDARY_CROSSED');
// Explicit fixture endpoints exercise offset/short-session shapes, not calendar-source authenticity.
for (const [before, after, bars] of [
  ['2026-03-06T21:00:00.000Z', '2026-03-09T14:00:00.000Z', ['2026-03-04T21:00:00.000Z', '2026-03-05T21:00:00.000Z', '2026-03-06T21:00:00.000Z']],
  ['2026-10-30T20:00:00.000Z', '2026-11-02T15:00:00.000Z', ['2026-10-28T20:00:00.000Z', '2026-10-29T20:00:00.000Z', '2026-10-30T20:00:00.000Z']],
  ['2026-07-02T17:00:00.000Z', '2026-07-06T14:00:00.000Z', ['2026-06-30T20:00:00.000Z', '2026-07-01T20:00:00.000Z', '2026-07-02T17:00:00.000Z']],
]) {
  const setTimes = x => {
    x.decisionAt = after; x.currentAccount.observedAt = after;
    x.currentPositions.forEach(r => { r.observedAt = after; });
    x.definition.dailyLossStartAt = before; x.definition.equitySampleTimes = [before, after]; x.definition.marketSessions = bars;
    x.sourceRecords.availableAt = after; x.sourceRecords.validUntil = new Date(Date.parse(after) + 30000).toISOString();
    x.sourceRecords.equity = [{ at: before, equityUsd: '10000' }, { at: after, equityUsd: '10000' }];
    x.sourceRecords.bars.forEach(b => b.rows.forEach((r, i) => { r.at = bars[i]; }));
    x.sourceRecords.earnings.forEach(r => { r.publishedAt = before; r.eventAt = new Date(Date.parse(after) + 31 * 86400000).toISOString(); });
    x.sourceRecords.cashFlows = { coverageStart: before, coverageEnd: after, rows: [] };
  };
  const eventResult = result(setTimes);
  const intervalResult = result(x => { setTimes(x); useIntervals(x);
    x.sourceRecords.cashFlows.coverageStart = before; x.sourceRecords.cashFlows.coverageEnd = after;
    x.sourceRecords.cashFlows.rows = [intervalRow(x, before, after, '0')]; });
  assert.equal(eventResult.status, good.status); assert.deepEqual(intervalResult, eventResult); checks += 2;
}
for (const [flow, currentEquity, expectedLoss] of [
  ['1000', '11000', ['0', '1']], ['-1000', '9000', ['0', '1']],
  ['0', '9990', ['1', '10']], ['0', '10020', ['0', '1']], ['8.125', '9998.125', ['1', '10']],
]) {
  const eventInput = x => { x.currentAccount.equityUsd = currentEquity; x.sourceRecords.equity[1].equityUsd = currentEquity;
    x.sourceRecords.cashFlows.rows = [{ eventSha256: hash('exact-event'), at: midpoint, amountUsd: flow }]; };
  const eventResult = result(eventInput);
  const intervalResult = result(x => { eventInput(x); useIntervals(x); x.sourceRecords.cashFlows.rows[0].netExternalFlowUsd = flow; });
  assert.deepEqual(intervalResult, eventResult, 'deposit/withdrawal/returns preserve exact-event result');
  assert.deepEqual(intervalResult.measurements.find(m => m.dimension === 'maxDailyLossPct').value,
    { numerator: expectedLoss[0], denominator: expectedLoss[1] }); checks += 2;
}
for (const boundary of [start, midpoint, at]) {
  const eventResult = result(x => {
    x.definition.equitySampleTimes.splice(1, 0, midpoint);
    x.sourceRecords.equity.splice(1, 0, { at: midpoint, equityUsd: '11000' });
    x.sourceRecords.cashFlows.rows = [{ eventSha256: hash('boundary-event'), at: boundary, amountUsd: '1000' }];
  });
  const intervalResult = result(x => {
    useIntervals(x); x.definition.equitySampleTimes.splice(1, 0, midpoint);
    x.sourceRecords.equity.splice(1, 0, { at: midpoint, equityUsd: '11000' });
    x.sourceRecords.cashFlows.rows = [intervalRow(x, start, midpoint, boundary === midpoint ? '1000' : '0'),
      intervalRow(x, midpoint, at, boundary === at ? '1000' : '0', 1)];
  });
  assert.deepEqual(intervalResult, eventResult, 'intervals are left-open/right-closed on unchanged policy grid'); checks++;
}
assert.deepEqual(result(useIntervals), intervalGood, 'V2 deterministic replay');
assert.ok(!JSON.stringify(intervalGood).includes('externalFlows'), 'original row references stay out of aggregate'); checks += 2;
assert.equal(JSON.stringify(good).includes('fixture-asset'), false);
assert.equal(JSON.stringify(good).includes('fixture-sector'), false); checks += 2;
assert.equal(typeof operational.validateAttendedConfiguration, 'function', 'separate purpose configuration required');
assert.equal(typeof contract.authorizeAttendedInvocation, 'function');
const attended = attendedFixture();
assert.equal(operational.validateAttendedConfiguration(attended.config).status, 'PASS');
assert.equal(operational.validateOperationalConfiguration(attended.config).status, 'BLOCKED');
assert.equal(contract.validateScopedPaperConfiguration(attended.config).status, 'BLOCKED'); checks += 5;
for (const change of [c => { c.validationScope = 'UNATTENDED'; }, c => { c.input.environment = 'LIVE'; },
  c => { c.sourcePolicy.contractFile = c.sourcePolicy.validationPolicyFile; }, c => { delete c.sourcePolicy.riskSourceInventoryFile; },
  c => { c.sourcePolicy.feed = 'sip'; }, c => { c.oversight.requestBudget.total++; }]) {
  const c = structuredClone(attended.config); change(c);
  assert.equal(operational.validateAttendedConfiguration(c).status, 'BLOCKED'); checks++;
}
const authorize = f => contract.authorizeAttendedInvocation({ config: f.config, approval: f.approval, clock: f.clock });
if (!process.argv.includes('--attended-authority-child')) {
  assert.throws(() => authorize(attended), /ACTUAL_PROCESS_FLAGS_BLOCKED/); checks++;
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--attended-authority-child'], {
    encoding: 'utf8', env: { PATH: process.env.PATH, NODE_OPTIONS: process.env.NODE_OPTIONS ?? '',
      ALPHA_ENV: 'PAPER', READ_ONLY: 'false', EXEC_ENABLED: 'true', LIVE_ORDER_SUBMIT_ENABLED: 'false', MARKET_GUARD_MODE: 'observe' },
  });
  assert.equal(child.status, 0, child.stderr || child.stdout); checks++;
  const childResult = JSON.parse(child.stdout.trim().split('\n').at(-1));
  assert.equal(childResult.status, 'ATTENDED_RISK_AUTHORITY_SUBCONTRACT_PASS');
  authorityChildChecks = childResult.checks;
} else {
  const capability = authorize(attended);
  const scope = contract.validateObservedCloseoutInput(attended.config.input, capability);
  assert.equal(Object.isFrozen(scope), true);
  assert.throws(() => contract.assertAttendedInvocation(capability, attended), /SOURCE_BINDING_INVALID/);
  assert.throws(() => contract.assertOperationalInvocation(capability, attended), /AUTHORITY_INVALID/);
  assert.throws(() => contract.assertScopedPaperInvocation(capability, attended), /AUTHORITY_INVALID/);
  assert.throws(() => contract.validateObservedCloseoutInput(attended.config.input, structuredClone(capability)), /AUTHORITY_INVALID/); checks += 5;
  for (const change of [a => { a.kind = 'DIRECT_SCOPED_OPERATIONAL_INVOCATION'; }, a => { a.validationScope = 'UNATTENDED'; },
    a => { a.externalTradingStatus = 'NOT_HALTED'; }, a => { a.stableScopeSha256 = hash('drift'); },
    a => { a.expiresAt = '2026-10-09T14:00:00.000Z'; }]) {
    const f = attendedFixture(); change(f.approval);
    assert.throws(() => authorize(f), /AUTHORITY_INVALID|AUTHORITY_EXPIRED/); checks++;
  }
  contract.retireAttendedSubmission(capability, 'OPERATOR_STOP');
  contract.retireAttendedSubmission(capability, 'OPERATOR_STOP');
  assert.throws(() => contract.assertAttendedInvocation(capability, attended), /SUBMISSION_RETIRED/);
  assert.throws(() => contract.validateObservedCloseoutInput(attended.config.input, capability), /AUTHORITY_INVALID/); checks += 2;

  assert.equal(typeof contract.handoffAttendedObservation, 'function', 'retired submit authority must retain only its original bounded observation'); checks++;
  const observationRows = f => f.input.terms.targets.map((_, i) => ({ ...limitedManagementRecord(i),
    accountSha256: f.input.accountSha256, managementAuthoritySha256: f.input.authoritySha256,
    preWriteHashes: f.input.preWriteHashes }));
  const attemptedRows = f => {
    const rows = observationRows(f), first = rows[0];
    first.submissionPhase = 'ATTEMPTED'; first.requestSha256 = hash('fixture-request');
    first.history.push({ ...first.history[0], phase: 'ATTEMPTED' });
    return rows;
  };
  for (const reason of ['OPERATOR_STOP', 'AUTHORITY_EXPIRED', 'EVIDENCE_INVALID']) {
    const f = attendedFixture(), cap = authorize(f), records = attemptedRows(f);
    const args = { config: f.config, records, expectedHashes: f.input.preWriteHashes, clock: f.clock };
    contract.retireAttendedSubmission(cap, reason);
    assert.throws(() => contract.handoffOperationalObservation(cap, args), /AUTHORITY_INVALID/);
    const handoff = contract.handoffAttendedObservation(cap, args);
    assert.equal(contract.takeOperationalObservationAuthority(structuredClone(handoff), records, f.clock), null);
    const inherited = contract.takeOperationalObservationAuthority(handoff, records, f.clock);
    assert.equal(inherited.binding.config.validationScope, 'ATTENDED_PAPER_LIFECYCLE_ONLY');
    assert.ok(inherited.assertActive() > 0);
    assert.throws(() => contract.assertAttendedInvocation(cap, f), /SUBMISSION_RETIRED/);
    assert.throws(() => contract.handoffAttendedObservation(cap, args), /OBSERVATION_AUTHORITY_CONSUMED/);
    assert.throws(() => contract.takeOperationalObservationAuthority(handoff, records, f.clock), /OBSERVATION_AUTHORITY_CONSUMED/);
    contract.retireAttendedSubmission(cap, 'PROCESS_TERMINATION');
    contract.retireAttendedSubmission(cap, 'OPERATOR_STOP');
    assert.throws(() => inherited.assertActive(), /OBSERVATION_RETIRED/); checks += 8;
  }
  for (const reason of ['OPERATOR_ABSENT', 'PROCESS_TERMINATION']) {
    const f = attendedFixture(), cap = authorize(f);
    contract.retireAttendedSubmission(cap, reason);
    assert.throws(() => contract.handoffAttendedObservation(cap, { config: f.config, records: attemptedRows(f),
      expectedHashes: f.input.preWriteHashes, clock: f.clock }), /OBSERVATION_RETIRED/); checks++;
  }
  for (const mode of ['no-attempt', 'wrong-purpose', 'config-drift', 'record-drift', 'expired-window']) {
    const f = attendedFixture(), cap = authorize(f), records = mode === 'no-attempt' ? observationRows(f) : attemptedRows(f);
    const args = { config: f.config, records, expectedHashes: f.input.preWriteHashes, clock: f.clock };
    if (mode === 'wrong-purpose') {
      for (const r of records) { r.recordKind = 'SCOPED_MANAGEMENT_EXIT_V1'; r.schemaVersion = 1;
        delete r.brokerEventTimestamps; delete r.validationScope; delete r.externalTradingStatus; }
    }
    if (mode === 'config-drift') args.config = { ...f.config, validationScope: 'OTHER' };
    if (mode === 'record-drift') records[0].accountSha256 = hash('wrong-account');
    if (mode === 'expired-window') f.clock.now = () => '2026-10-09T15:05:00.000Z';
    assert.throws(() => contract.handoffAttendedObservation(cap, args), /SCOPED_CLOSEOUT_/); checks++;
  }
  assert.equal(typeof contract.withAttendedStopSignals, 'function', 'authorized caller must own and remove its interrupt listeners'); checks++;
  const deliverSignal = signal => new Promise((resolve, reject) => {
    const delivered = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { process.off(signal, delivered); reject(Error('fixture-signal-timeout')); }, 3000);
    process.once(signal, delivered); process.kill(process.pid, signal);
  });
  for (const mode of ['first-interrupt', 'second-interrupt', 'terminate', 'throw', 'complete', 'nested']) {
    const f = attendedFixture(), cap = authorize(f);
    const before = Object.fromEntries(['SIGINT', 'SIGTERM'].map(s => [s, process.listeners(s)]));
    let stopped;
    const run = contract.withAttendedStopSignals(cap, f, async stopSignal => {
      stopped = stopSignal;
      assert.equal(Object.isFrozen(stopSignal), true);
      assert.equal(stopSignal.submissionStopped, false);
      assert.equal(stopSignal.observationStopped, false);
      for (const signal of ['SIGINT', 'SIGTERM']) assert.equal(process.listenerCount(signal), before[signal].length + 1);
      if (mode === 'throw') throw Error('fixture-work-failed');
      if (mode === 'nested') await assert.rejects(contract.withAttendedStopSignals(cap, f, async () => {
        assert.fail('same capability must not own overlapping listeners');
      }), /STOP_SIGNAL_BINDING_ACTIVE/);
      if (mode.includes('interrupt')) {
        await deliverSignal('SIGINT');
        assert.equal(stopSignal.submissionStopped, true);
        assert.equal(stopSignal.observationStopped, false);
        assert.throws(() => contract.assertAttendedInvocation(cap, f), /SUBMISSION_RETIRED/);
        if (mode === 'second-interrupt') await deliverSignal('SIGINT');
      }
      if (mode === 'terminate') await deliverSignal('SIGTERM');
      if (['terminate', 'second-interrupt'].includes(mode)) {
        assert.equal(stopSignal.observationStopped, true);
        contract.retireAttendedSubmission(cap, 'OPERATOR_STOP');
        assert.equal(stopSignal.observationStopped, true);
      }
      return 'fixture-work-complete';
    });
    if (mode === 'throw') await assert.rejects(run, /fixture-work-failed/);
    else assert.equal(await run, 'fixture-work-complete');
    for (const signal of ['SIGINT', 'SIGTERM']) assert.deepEqual(process.listeners(signal), before[signal]);
    assert.equal(stopped.submissionStopped, true, 'return/throw never leaves submission authority reusable');
    assert.throws(() => contract.assertAttendedInvocation(cap, f), /SUBMISSION_RETIRED/);
    await assert.rejects(contract.withAttendedStopSignals(cap, f, () => assert.fail('closed caller cannot reopen')), /SUBMISSION_RETIRED/);
    checks += 15;
  }
  for (const mode of ['clone', 'legacy', 'config-drift', 'flags', 'expired']) {
    const f = attendedFixture(), cap = authorize(f), before = ['SIGINT', 'SIGTERM'].map(s => process.listeners(s));
    let actual = cap;
    if (mode === 'clone') actual = structuredClone(cap);
    if (mode === 'legacy') actual = {};
    if (mode === 'config-drift') f.config.validationScope = 'UNATTENDED';
    if (mode === 'expired') f.clock.now = () => '2026-10-09T15:05:00.000Z';
    if (mode === 'flags') process.env.READ_ONLY = 'true';
    try {
      await assert.rejects(contract.withAttendedStopSignals(actual, f, () => assert.fail('invalid authority cannot install listeners')),
        /AUTHORITY_INVALID|AUTHORITY_EXPIRED|ACTUAL_PROCESS_FLAGS_BLOCKED/);
      assert.deepEqual(['SIGINT', 'SIGTERM'].map(s => process.listeners(s)), before); checks += 2;
    } finally { process.env.READ_ONLY = 'false'; }
  }
  for (const mode of ['expired', 'clock-regression', 'monotonic-invalid', 'flags', 'config-drift', 'missing-observation']) {
    const f = attendedFixture(), cap = authorize(f);
    contract.validateObservedCloseoutInput(f.input, cap);
    const now = f.clock.now, mono = f.clock.monotonicMs;
    if (mode === 'expired') f.clock.now = () => '2026-10-09T15:05:00.000Z';
    if (mode === 'clock-regression') f.clock.now = () => '2026-10-09T14:59:59.999Z';
    if (mode === 'monotonic-invalid') f.clock.monotonicMs = () => NaN;
    if (mode === 'flags') process.env.READ_ONLY = 'true';
    if (mode === 'config-drift') f.config.validationScope = 'UNATTENDED';
    try { assert.throws(() => contract.assertAttendedInvocation(cap, f), /SCOPED_CLOSEOUT_/); }
    finally { f.clock.now = now; f.clock.monotonicMs = mono; process.env.READ_ONLY = 'false';
      f.config.validationScope = 'ATTENDED_PAPER_LIFECYCLE_ONLY'; }
    assert.throws(() => contract.assertAttendedInvocation(cap, f), /SUBMISSION_RETIRED/,
      `${mode}: correcting an invalid input must not reactivate the same submit capability`);
    assert.throws(() => contract.validateObservedCloseoutInput(f.input, cap), /AUTHORITY_INVALID/); checks += 3;
  }
  for (const mode of ['before-wire', 'in-flight']) {
    const f = attendedFixture(), cap = authorize(f), calls = [];
    await contract.withAttendedStopSignals(cap, f, async stopSignal => {
      const t = createScopedPaperTransport({ clock: f.clock, deadlineMs: 300000,
        credentials: { key: 'fixture-key', secret: 'fixture-secret' },
        beforeSubmit: async () => { if (mode === 'before-wire') await deliverSignal('SIGINT'); return true; },
        beforeWire: () => !stopSignal.submissionStopped,
        fetchImpl: async (_url, options) => {
          calls.push(options.method);
          if (options.method === 'POST') await deliverSignal('SIGINT');
          return new Response('{}');
        } });
      const submit = { group: 'submit', phase: 'submit', routeInput: {}, body: { symbol: 'FIXTURE', qty: '2', side: 'sell',
        type: 'limit', time_in_force: 'day', limit_price: '99.9', client_order_id: 'fixture-client', extended_hours: false } };
      const outcome = await t.request(submit);
      assert.equal(stopSignal.submissionStopped, true); assert.equal(stopSignal.observationStopped, false);
      assert.equal(t.counts().submit, mode === 'before-wire' ? 0 : 1);
      if (mode === 'before-wire') {
        assert.equal(outcome.error, 'SUBMIT_WIRE_GATE_REQUIRED');
        assert.equal((await t.request({ group: 'clock', phase: 'postcheck', routeInput: {} })).error, 'TRANSPORT_STOPPED');
        assert.deepEqual(calls, []);
      } else {
        assert.equal(outcome.error, null, 'interrupt cannot erase a possibly accepted wire');
        assert.equal((await t.request(submit)).error, 'SUBMIT_WIRE_GATE_REQUIRED');
        assert.equal(t.counts().submit, 1);
        assert.equal((await t.request({ group: 'clock', phase: 'postcheck', routeInput: {} })).error, null);
        assert.deepEqual(calls, ['POST', 'GET']);
      }
      checks += mode === 'before-wire' ? 6 : 8;
    });
  }
}
console.log(JSON.stringify({ status: 'ATTENDED_RISK_AUTHORITY_SUBCONTRACT_PASS', checks, authorityChildChecks,
  sourceAuthenticationProven: false, lifecycleIntegrationComplete: false, brokerRequests: 0 }));
