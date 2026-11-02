import { decimalRatio, compare } from './closeout-decimal.mjs';

const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) => object(v) && Object.keys(v).sort().join(' ') === keys.split(' ').sort().join(' ');
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const check = (ok, code) => { if (!ok) throw Error(`SCOPED_RISK_${code}`); };
const time = v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v ? Date.parse(v) : NaN;
const freeze = v => { if (object(v) || Array.isArray(v)) { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
const dimensions = ['maxPositionPct', 'maxSectorPct', 'maxPortfolioExposurePct', 'maxDailyLossPct',
  'maxDrawdownPct', 'maxVolatilityPct', 'minAverageDailyDollarVolumeUsd', 'minEarningsDistanceDays'];
const zero = [0n, 1n], hundred = [100n, 1n];
const reduce = ([n, d]) => {
  check(d > 0n, 'DENOMINATOR_INVALID');
  let a = n < 0n ? -n : n, b = d;
  while (b) [a, b] = [b, a % b];
  return [n / a, d / a];
};
const add = ([a, b], [c, d]) => reduce([a * d + c * b, b * d]);
const sub = (a, [c, d]) => add(a, [-c, d]);
const mul = ([a, b], [c, d]) => reduce([a * c, b * d]);
const div = ([a, b], [c, d]) => { check(c > 0n, 'DENOMINATOR_INVALID'); return reduce([a * d, b * c]); };
const maximum = values => values.reduce((a, b) => compare(a, b) >= 0 ? a : b);
const minimum = values => values.reduce((a, b) => compare(a, b) <= 0 ? a : b);
const sum = values => values.reduce(add, zero);
const pct = (n, d) => mul(div(n, d), hundred);
function decimal(v, { signed = false, allowZero = false } = {}) {
  check(typeof v === 'string' && v.length <= 40
    && (signed ? /^-?(0|[1-9]\d{0,15})(\.\d{1,9})?$/ : /^(0|[1-9]\d{0,15})(\.\d{1,9})?$/).test(v), 'DECIMAL_INVALID');
  const result = reduce(decimalRatio(v));
  check(signed || compare(result, zero) >= (allowZero ? 0 : 1), 'DECIMAL_INVALID');
  return result;
}
function orderedTimes(values) {
  check(Array.isArray(values) && values.length >= 2 && values.length <= 5000, 'TIME_GRID_INVALID');
  const parsed = values.map(time);
  check(parsed.every((v, i) => Number.isFinite(v) && (i === 0 || parsed[i - 1] < v)), 'TIME_GRID_INVALID');
  return parsed;
}
function keyedRows(rows, ids, keys) {
  check(Array.isArray(rows) && rows.length === ids.length && rows.every(r => exact(r, keys)
    && ids.includes(r.assetId)) && new Set(rows.map(r => r.assetId)).size === ids.length, 'ASSET_COVERAGE_INVALID');
  return new Map(rows.map(r => [r.assetId, r]));
}
const ny = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
function marketDay(value) {
  const parts = Object.fromEntries(ny.formatToParts(new Date(value)).map(p => [p.type, p.value]));
  return Date.parse(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
}

function validateDefinition(d, now, accountAt) {
  check(exact(d, 'schemaVersion marketTimezone portfolioAssetIds dailyLossStartAt equitySampleTimes marketSessions maxEvidenceAgeMs volatility dollarVolume priceAdjustmentBasis')
    && ['attended-risk-measurement-v1', 'attended-risk-measurement-v2'].includes(d.schemaVersion)
    && d.marketTimezone === 'America/New_York'
    && Array.isArray(d.portfolioAssetIds) && d.portfolioAssetIds.length > 0 && d.portfolioAssetIds.length <= 500
    && d.portfolioAssetIds.every(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(id))
    && new Set(d.portfolioAssetIds).size === d.portfolioAssetIds.length, 'DEFINITION_INVALID');
  const equityTimes = orderedTimes(d.equitySampleTimes), sessionTimes = orderedTimes(d.marketSessions);
  check(equityTimes.at(-1) === accountAt && equityTimes.includes(time(d.dailyLossStartAt))
    && time(d.dailyLossStartAt) < accountAt && sessionTimes.at(-1) < now
    && sessionTimes.every(t => marketDay(t) < marketDay(now))
    && new Set(sessionTimes.map(marketDay)).size === sessionTimes.length, 'TIME_GRID_INVALID');
  check(Number.isSafeInteger(d.maxEvidenceAgeMs) && d.maxEvidenceAgeMs > 0 && d.maxEvidenceAgeMs <= 30000
    && d.priceAdjustmentBasis === 'SPLIT_ADJUSTED_PRICE', 'DEFINITION_INVALID');
  const v = d.volatility, a = d.dollarVolume;
  check(exact(v, 'lookbackSessions minimumReturns annualizationFactor returnBasis')
    && exact(a, 'lookbackSessions minimumObservations adjustmentBasis'), 'DEFINITION_INVALID');
  check([v.lookbackSessions, v.minimumReturns, v.annualizationFactor, a.lookbackSessions, a.minimumObservations]
    .every(n => Number.isSafeInteger(n) && n > 0 && n <= 5000)
    && v.minimumReturns >= 2 && v.lookbackSessions - 1 >= v.minimumReturns
    && v.lookbackSessions <= sessionTimes.length && a.lookbackSessions >= a.minimumObservations
    && a.lookbackSessions <= sessionTimes.length && v.returnBasis === 'SIMPLE_PRICE_RETURN'
    && a.adjustmentBasis === 'RAW_PRICE_RAW_VOLUME', 'DEFINITION_INVALID');
  return { equityTimes, sessionTimes };
}
function validateInputs({ policy: p, definition: d, sourceRecords: s, currentAccount: a, currentPositions: positions, decisionAt }) {
  const now = time(decisionAt); check(Number.isFinite(now), 'TIME_INVALID');
  check(exact(p, 'schemaVersion policySourceSha256 accountSha256 termsSha256 limits')
    && p.schemaVersion === 'scoped-paper-risk-policy-v1'
    && [p.policySourceSha256, p.accountSha256, p.termsSha256].every(hash)
    && exact(p.limits, dimensions.join(' ')), 'POLICY_INVALID');
  for (const field of dimensions) decimal(p.limits[field]);
  check(/^[1-9]\d*$/.test(p.limits.minEarningsDistanceDays), 'POLICY_INVALID');
  const grids = validateDefinition(d, now, time(a?.observedAt));
  check(exact(s, 'schemaVersion accountSha256 termsSha256 sourceHashes availableAt validUntil sectors equity cashFlows bars earnings')
    && s.schemaVersion === (d.schemaVersion === 'attended-risk-measurement-v2' ? 'attended-risk-records-v2' : 'attended-risk-records-v1')
    && s.accountSha256 === p.accountSha256 && s.termsSha256 === p.termsSha256
    && Array.isArray(s.sourceHashes) && s.sourceHashes.length > 0 && s.sourceHashes.length <= 5000
    && s.sourceHashes.every(hash) && new Set(s.sourceHashes).size === s.sourceHashes.length
    && time(s.availableAt) <= now && now <= time(s.validUntil), 'SOURCE_RECORDS_INVALID');
  const fresh = at => Number.isFinite(time(at)) && time(at) <= now && now - time(at) <= d.maxEvidenceAgeMs;
  check(exact(a, 'accountSha256 currency equityUsd observedAt') && a.accountSha256 === p.accountSha256
    && a.currency === 'USD' && fresh(a.observedAt), 'CURRENT_ACCOUNT_INVALID');
  const equity = decimal(a.equityUsd), ids = d.portfolioAssetIds;
  const current = keyedRows(positions, ids, 'assetId side qty marketValueUsd observedAt');
  for (const r of current.values()) { check(r.side === 'long' && fresh(r.observedAt), 'CURRENT_POSITION_INVALID'); decimal(r.qty); decimal(r.marketValueUsd); }
  return { now, equity, ids, current, ...grids };
}

function exposures(s, ids, current, equity) {
  const sectors = keyedRows(s.sectors, ids, 'assetId sector'), totals = new Map(), values = [];
  for (const id of ids) {
    const sector = sectors.get(id).sector;
    check(typeof sector === 'string' && sector.trim() === sector && sector.length > 0 && sector.length <= 128, 'SECTOR_INVALID');
    const value = decimal(current.get(id).marketValueUsd); values.push(value);
    totals.set(sector, add(totals.get(sector) ?? zero, value));
  }
  return [pct(maximum(values), equity), pct(maximum([...totals.values()]), equity), pct(sum(values), equity)];
}
function eventFlowPrefixes(c, times, now) {
  check(exact(c, 'coverageStart coverageEnd rows') && time(c.coverageStart) <= times[0] && time(c.coverageEnd) >= now
    && time(c.coverageEnd) <= now && Array.isArray(c.rows) && c.rows.length <= 5000, 'CASHFLOW_COVERAGE_INVALID');
  const seen = new Set();
  const flows = c.rows.map(r => {
    check(exact(r, 'eventSha256 at amountUsd') && hash(r.eventSha256) && !seen.has(r.eventSha256)
      && time(r.at) >= time(c.coverageStart) && time(r.at) <= now, 'CASHFLOW_INVALID');
    seen.add(r.eventSha256); return { at: time(r.at), value: decimal(r.amountUsd, { signed: true }) };
  });
  return times.map(at => sum(flows.filter(f => f.at > times[0] && f.at <= at).map(f => f.value)));
}

function intervalReferences(refs, sourceHashes, seen) {
  check(Array.isArray(refs) && refs.length > 0 && refs.length <= 5000, 'INTERVAL_SOURCE_REFERENCE_INVALID');
  for (const r of refs) {
    check(exact(r, 'sourceSha256 jsonPointer') && hash(r.sourceSha256) && sourceHashes.includes(r.sourceSha256)
      && typeof r.jsonPointer === 'string' && r.jsonPointer.length <= 512
      && /^(?:\/(?:[^~\/\x00-\x1f\x7f]|~[01])*)+$/.test(r.jsonPointer), 'INTERVAL_SOURCE_REFERENCE_INVALID');
    check(seen.length < 5000 && !seen.some(previous => previous.sourceSha256 === r.sourceSha256
      && (previous.jsonPointer === r.jsonPointer || previous.jsonPointer.startsWith(`${r.jsonPointer}/`)
        || r.jsonPointer.startsWith(`${previous.jsonPointer}/`))), 'INTERVAL_SOURCE_REFERENCE_REUSED');
    seen.push(r);
  }
}

function intervalFlowPrefixes(c, times, now, sourceHashes) {
  check(exact(c, 'coverageStart coverageEnd currency flowBasis rows') && c.currency === 'USD'
    && c.flowBasis === 'EXTERNAL_CAPITAL_ONLY' && time(c.coverageStart) === times[0]
    && Number.isFinite(time(c.coverageEnd)) && Array.isArray(c.rows) && c.rows.length > 0
    && c.rows.length <= 5000, 'INTERVAL_COVERAGE_INVALID');
  check(time(c.coverageEnd) >= now, 'CURRENT_RISK_GAP_UNPROVEN');
  check(time(c.coverageEnd) === now, 'INTERVAL_COVERAGE_INVALID');
  const prefixes = [zero], seen = [];
  let cursor = times[0], total = zero;
  for (const r of c.rows) {
    check(exact(r, 'startAt endAt netExternalFlowUsd sourceRecordReferences') && time(r.startAt) === cursor
      && Number.isFinite(time(r.endAt)) && time(r.endAt) > cursor && time(r.endAt) <= now,
    'INTERVAL_PARTITION_INVALID');
    check(prefixes.length < times.length && time(r.endAt) <= times[prefixes.length], 'INTERVAL_POLICY_BOUNDARY_CROSSED');
    intervalReferences(r.sourceRecordReferences, sourceHashes, seen);
    total = add(total, decimal(r.netExternalFlowUsd, { signed: true }));
    cursor = time(r.endAt);
    if (cursor === times[prefixes.length]) prefixes.push(total);
  }
  check(cursor === now && prefixes.length === times.length, 'CURRENT_RISK_GAP_UNPROVEN');
  return prefixes;
}

function lossAndDrawdown(s, d, times, now, equity) {
  check(Array.isArray(s.equity) && s.equity.length === times.length
    && s.equity.every((e, i) => exact(e, 'at equityUsd') && time(e.at) === times[i]), 'EQUITY_COVERAGE_INVALID');
  const samples = s.equity.map(e => decimal(e.equityUsd));
  check(compare(samples.at(-1), equity) === 0, 'EQUITY_CURRENT_MISMATCH');
  const flows = d.schemaVersion === 'attended-risk-measurement-v2'
    ? intervalFlowPrefixes(s.cashFlows, times, now, s.sourceHashes) : eventFlowPrefixes(s.cashFlows, times, now);
  const daily = time(d.dailyLossStartAt), start = samples[times.indexOf(daily)];
  const loss = maximum([zero, sub(add(start, sub(flows.at(-1), flows[times.indexOf(daily)])), equity)]);
  const adjusted = samples.map((v, i) => sub(v, flows[i]));
  check(adjusted.every(v => compare(v, zero) > 0), 'ADJUSTED_EQUITY_INVALID');
  const peak = maximum(adjusted);
  return [pct(loss, start), pct(sub(peak, adjusted.at(-1)), peak)];
}
function barMetrics(s, d, ids, times) {
  const groups = keyedRows(s.bars, ids, 'assetId priceAdjustmentBasis volumeAdjustmentBasis rows');
  const variances = [], dollarVolumes = [];
  for (const id of ids) {
    const b = groups.get(id);
    check(b.priceAdjustmentBasis === d.priceAdjustmentBasis && b.volumeAdjustmentBasis === d.dollarVolume.adjustmentBasis
      && Array.isArray(b.rows) && b.rows.length === times.length
      && b.rows.every((r, i) => exact(r, 'at adjustedClose rawClose rawVolume') && time(r.at) === times[i]), 'BAR_COVERAGE_OR_BASIS_INVALID');
    const parsed = b.rows.map(r => ({ close: decimal(r.adjustedClose), dollarVolume: mul(decimal(r.rawClose), decimal(r.rawVolume, { allowZero: true })) }));
    const closes = parsed.slice(-d.volatility.lookbackSessions).map(r => r.close);
    const returns = closes.slice(1).map((value, i) => sub(div(value, closes[i]), [1n, 1n]));
    const mean = div(sum(returns), [BigInt(returns.length), 1n]);
    const variance = div(sum(returns.map(v => { const diff = sub(v, mean); return mul(diff, diff); })), [BigInt(returns.length - 1), 1n]);
    variances.push(mul(variance, [BigInt(d.volatility.annualizationFactor) * 10000n, 1n]));
    dollarVolumes.push(div(sum(parsed.slice(-d.dollarVolume.lookbackSessions).map(r => r.dollarVolume)), [BigInt(d.dollarVolume.lookbackSessions), 1n]));
  }
  return [maximum(variances), minimum(dollarVolumes)];
}
function earningsDistance(s, ids, now) {
  const events = keyedRows(s.earnings, ids, 'assetId eventAt publishedAt');
  return minimum([...events.values()].map(r => {
    check(Number.isFinite(time(r.eventAt)) && time(r.eventAt) >= now && Number.isFinite(time(r.publishedAt))
      && time(r.publishedAt) <= now && time(r.publishedAt) <= time(r.eventAt), 'EARNINGS_LINEAGE_INVALID');
    return [BigInt((marketDay(time(r.eventAt)) - marketDay(now)) / 86400000), 1n];
  }));
}

// Pure replay never authenticates sources or creates execution capability.
export function replayAttendedRisk(input) {
  const safe = { sourceVerified: false, executionAuthorized: false };
  try {
    check(exact(input, 'policy definition sourceRecords currentAccount currentPositions decisionAt'), 'INPUT_INVALID');
    const { now, equity, ids, current, equityTimes, sessionTimes } = validateInputs(input);
    const { policy, definition: d, sourceRecords: s, decisionAt } = input;
    const values = [...exposures(s, ids, current, equity), ...lossAndDrawdown(s, d, equityTimes, time(input.currentAccount.observedAt), equity),
      ...barMetrics(s, d, ids, sessionTimes), earningsDistance(s, ids, now)];
    const reasons = [], sourceHashes = [...s.sourceHashes].sort();
    const measurements = dimensions.map((dimension, i) => {
      let limit = decimal(policy.limits[dimension]);
      if (dimension === 'maxVolatilityPct') limit = mul(limit, limit);
      const valid = dimension.startsWith('min') ? compare(values[i], limit) >= 0 : compare(values[i], limit) <= 0;
      if (!valid) reasons.push(`SCOPED_RISK_${dimension.replace(/[A-Z]/g, c => `_${c}`).toUpperCase()}`);
      return { dimension, valueBasis: dimension === 'maxVolatilityPct' ? 'ANNUALIZED_VARIANCE_PERCENT_SQUARED'
        : dimension === 'minEarningsDistanceDays' ? 'NEW_YORK_CALENDAR_DAYS'
          : dimension === 'minAverageDailyDollarVolumeUsd' ? 'MEAN_RAW_DOLLAR_VOLUME_USD' : 'PERCENT',
      value: { numerator: values[i][0].toString(), denominator: values[i][1].toString() }, sourceHashes, evaluatedAt: decisionAt,
      sourceAsOf: [...new Set([input.currentAccount.observedAt, ...input.currentPositions.map(r => r.observedAt),
        ...d.equitySampleTimes, ...d.marketSessions, s.cashFlows.coverageEnd, ...s.earnings.map(r => r.publishedAt)])].sort() };
    });
    return freeze({ status: reasons.length ? 'BLOCKED' : 'RISK_REPLAY_PASS_NOT_SOURCE_VERIFIED', reasons, measurements, sourceHashes, ...safe });
  } catch (error) {
    const reason = /^SCOPED_RISK_[A-Z_]+$/.test(error?.message) ? error.message : 'SCOPED_RISK_INPUT_INVALID';
    return freeze({ status: 'BLOCKED', reasons: [reason], measurements: [], sourceHashes: [], ...safe });
  }
}
