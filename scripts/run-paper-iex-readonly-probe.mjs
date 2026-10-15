import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readPrivate, readPrivateBytes, validateTargets, ContractError } from './audit-paper-closeout-private-evidence.mjs';
import { sha256Canonical, ACTIVE_POSITION_LIMITED_RECOVERY_MODE } from './lib/active-position-limited-recovery.mjs';
import { createScopedPaperTransport } from './lib/scoped-paper-transport.mjs';
import { evidenceTimestampNs as ns, evidenceTimestampFresh as fresh } from './lib/scoped-paper-evidence.mjs';

export const APPROVAL = 'AUTHORIZE PAPER IEX THREE-GET READ-ONLY ONE-SHOT';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const CODE_FILES = Object.freeze([
  'scripts/run-paper-iex-readonly-probe.mjs', 'scripts/audit-paper-closeout-private-evidence.mjs',
  'scripts/build-live-readiness-scorecard.mjs', 'scripts/lib/position-protection-classification.mjs',
  'scripts/lib/active-position-limited-recovery.mjs', 'scripts/lib/closeout-decimal.mjs',
  'scripts/lib/scoped-paper-transport.mjs', 'scripts/lib/scoped-paper-evidence.mjs', 'scripts/lib/scoped-closeout-contract.mjs',
]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
class ProbeError extends Error {}
const check = (ok, code) => { if (!ok) throw new ProbeError(code); };
const SAFETY = Object.freeze({ readOnly: true, execEnabled: false, liveOrderSubmitEnabled: false,
  brokerSubmitAllowed: false, selectedCandidateCount: 0, stateMutationAttempted: false, brokerMutationAttempted: false,
  rawResponseStored: false, secretStoredOrPrinted: false, actualIdentifiersStoredOrPrinted: false,
  realizedPnlVerified: false, historicalEvidenceNormalized: false, currentStateAuthenticityVerified: false,
  currentPortfolioVerified: false, currentAssetIdentityVerified: false, executionReadinessEvaluated: false,
  quoteSizeUnitsVerified: false, quoteCoverage: 'IEX_SINGLE_EXCHANGE_NOT_NBBO', retryCount: 0,
  paginationUsed: false, fallbackUsed: false, cacheRestored: false, cacheSaved: false });

export function reviewedCodeSha256() {
  return sha256Canonical(Object.fromEntries([...CODE_FILES].sort().map(name => {
    const file = path.join(ROOT, name);
    check(fs.realpathSync(file) === file && fs.lstatSync(file).isFile(), 'REVIEWED_CODE_MISMATCH');
    return [name, sha(fs.readFileSync(file))];
  })));
}
function privateDirectory(directory) {
  check(typeof directory === 'string' && path.isAbsolute(directory), 'DIRECTORY_INVALID');
  const stat = fs.lstatSync(directory);
  check(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid()
    && (stat.mode & 0o077) === 0 && fs.realpathSync(directory) === path.resolve(directory), 'DIRECTORY_INVALID');
}
function writeExclusive(directory, name, value) {
  const tmp = path.join(directory, `${name}.tmp`), file = path.join(directory, name);
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.linkSync(tmp, file); // Atomic visibility without replacing any existing evidence.
  fs.unlinkSync(tmp);
  const dir = fs.openSync(directory, 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
function sourceScope(config) {
  privateDirectory(config.sourceDirectory);
  const m = readPrivate(path.join(config.sourceDirectory, 'source-manifest.json'), config.sourceManifestSha256);
  check(['paper-private-capture-source-v1', 'paper-private-capture-source-v2'].includes(m.schemaVersion)
    && m.environment === 'PAPER' && m.evidenceBasis === 'PRESERVED_STATE_SNAPSHOT'
    && hash(m.expectedPaperAccountSha256) && object(m.files), 'SOURCE_CONTRACT_INVALID');
  const names = Object.keys(m.files);
  check(names.length <= 16 && ['order-ledger.json', 'order-idempotency.json', 'last-dry-exec-preview.json'].every(n => names.includes(n))
    && names.every(n => /^[a-z][a-z0-9-]*\.json$/.test(n) && hash(m.files[n])), 'SOURCE_CONTRACT_INVALID');
  const bytes = Object.fromEntries(names.map(n => [n, readPrivateBytes(path.join(config.sourceDirectory, n), m.files[n])]));
  const ledger = JSON.parse(bytes['order-ledger.json']), idem = JSON.parse(bytes['order-idempotency.json']);
  check(object(ledger?.orders) && object(idem?.orders), 'SOURCE_CONTRACT_INVALID');
  const targets = Object.entries(idem.orders).filter(([, r]) => r?.recoveryMode === ACTIVE_POSITION_LIMITED_RECOVERY_MODE).map(([key, row]) => {
    const matches = Object.entries(ledger.orders).filter(([, l]) => l?.idempotencyKey === key);
    check(matches.length === 1, 'SOURCE_CONTRACT_INVALID');
    return { ledgerKey: matches[0][0], idempotencyKey: key, ledgerRecordSha256: sha256Canonical(matches[0][1]), idempotencyRecordSha256: sha256Canonical(row) };
  });
  check(targets.length === 5, 'TARGET_COUNT_INVALID');
  const checked = validateTargets(targets, { orderLedger: ledger, orderIdempotency: idem });
  const symbols = [...checked.symbols].sort();
  check(symbols.length === 5 && symbols.every(s => /^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(s)), 'SOURCE_CONTRACT_INVALID');
  // Only the exact historical identity subset scopes a quote query. Auxiliary reports are NOT certified.
  return { symbols, expectedAccount: m.expectedPaperAccountSha256, fileCount: names.length,
    missingOriginalBrokerIdRows: checked.missingOriginalBrokerIdRows };
}
function preflight(config, approval, env) {
  check(approval === APPROVAL, 'APPROVAL_REQUIRED');
  check(object(config) && Object.keys(config).sort().join(' ') === 'outputDirectory reviewedCodeSha256 sourceDirectory sourceManifestSha256'
    && hash(config.sourceManifestSha256) && hash(config.reviewedCodeSha256), 'CONFIG_INVALID');
  check(env.ALPHA_ENV === 'PAPER' && env.ALPACA_BASE_URL === 'https://paper-api.alpaca.markets'
    && env.READ_ONLY === 'true' && env.EXEC_ENABLED === 'false' && env.LIVE_ORDER_SUBMIT_ENABLED === 'false'
    && env.MARKET_GUARD_MODE === 'observe' && ['FORCE_SEND_ONCE', 'GUARD_EXECUTE_TIGHTEN_STOPS', 'GUARD_EXECUTE_REDUCE_POSITIONS', 'GUARD_EXECUTE_FLATTEN']
      .every(k => env[k] === 'false'), 'SAFETY_CONFIG_INVALID');
  check(config.reviewedCodeSha256 === reviewedCodeSha256(), 'REVIEWED_CODE_MISMATCH');
  const scope = sourceScope(config);
  check(typeof config.outputDirectory === 'string' && path.isAbsolute(config.outputDirectory), 'DIRECTORY_INVALID');
  const output = path.resolve(config.outputDirectory), source = path.resolve(config.sourceDirectory);
  privateDirectory(path.dirname(output));
  check(output !== source && !output.startsWith(`${source}${path.sep}`), 'DIRECTORY_INVALID');
  try { fs.lstatSync(output); throw new ProbeError('ATTEMPT_EXISTS'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const credentials = { key: env.ALPACA_KEY_ID, secret: env.ALPACA_SECRET_KEY };
  check(Object.values(credentials).every(v => typeof v === 'string' && v.trim()), 'CREDENTIALS_MISSING');
  return { scope, output, credentials };
}
function checkAccount(data, scope) {
  check(object(data) && typeof data.id === 'string' && sha(data.id) === scope.expectedAccount, 'ACCOUNT_PIN_MISMATCH');
  check(data.status === 'ACTIVE' && data.currency === 'USD' && data.trading_blocked === false
    && data.account_blocked === false && data.trade_suspended_by_user === false, 'ACCOUNT_INVALID');
}
function checkClock(data, at) {
  let valid = false;
  try { valid = object(data) && typeof data.is_open === 'boolean' && fresh(data.timestamp, at)
    && ns(data.next_open) > ns(at) && ns(data.next_close) > ns(at)
    && (data.is_open ? ns(data.next_close) < ns(data.next_open) : ns(data.next_open) < ns(data.next_close)); }
  catch { /* Invalid time is classified below. */ }
  check(valid, 'CLOCK_INVALID'); check(data.is_open, 'MARKET_CLOSED');
}
function checkQuotes(data, scope, receivedAt, at) {
  const q = data?.quotes;
  check(object(q) && Object.keys(q).sort().join(' ') === scope.symbols.join(' '), 'QUOTES_INVALID');
  for (const value of Object.values(q)) {
    check(object(value) && fresh(value.t, receivedAt) && fresh(value.t, at) && value.bx === 'V' && value.ax === 'V'
      && ['bp', 'ap', 'bs', 'as'].every(k => typeof value[k] === 'number' && Number.isFinite(value[k]) && value[k] > 0)
      && value.bp <= value.ap && Number.isSafeInteger(value.bs) && Number.isSafeInteger(value.as), 'QUOTES_INVALID');
  }
  return sha256Canonical(scope.symbols.map(s => Object.entries(q[s]).map(([k, v]) => [k, typeof v]).sort(([a], [b]) => a.localeCompare(b))));
}
const TRANSPORT_CODES = new Set(['REQUEST_TIMEOUT', 'HTTP_FAILURE', 'BODY_INVALID', 'RESPONSE_TOO_LARGE', 'JSON_INVALID',
  'CLOCK_INVALID', 'ATTEMPT_EXPIRED', 'TRANSPORT_FAILURE']);
function safeError(error) {
  if (error instanceof ProbeError) return error.message;
  if (error instanceof ContractError || error instanceof SyntaxError) return 'SOURCE_CONTRACT_INVALID';
  if (error?.code === 'EEXIST') return 'ATTEMPT_EXISTS';
  return 'INPUT_IO_OR_INTERNAL_FAILURE';
}
export async function observePaperIex({ config, approval, env = {}, fetchImpl, clock }) {
  let output, created = false, transport;
  const result = { schemaVersion: 'paper-iex-readonly-observation-v1', mode: 'REVIEW_ONLY', status: 'NOT_RUN', ...SAFETY,
    requestCounts: { account: 0, clock: 0, quotes: 0, total: 0 }, requestBudgetCompliant: true,
    historicalTargetRows: 0, quoteRows: 0, accountPinMatched: false, responses: [] };
  try {
    const checked = preflight(config, approval, env), scope = checked.scope; output = checked.output;
    transport = createScopedPaperTransport({ credentials: checked.credentials, fetchImpl, clock, deadlineMs: 300000 });
    fs.mkdirSync(output, { mode: 0o700 }); created = true;
    const parent = fs.openSync(path.dirname(output), 'r');
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
    writeExclusive(output, 'attempt.json', { schemaVersion: result.schemaVersion, status: 'ATTEMPT_RESERVED_NO_RETRY',
      sourceManifestSha256: config.sourceManifestSha256, reviewedCodeSha256: config.reviewedCodeSha256,
      maximumRequests: { account: 1, clock: 1, quotes: 1, total: 3 }, ...SAFETY });
    Object.assign(result, { sourceManifestSha256: config.sourceManifestSha256, reviewedCodeSha256: config.reviewedCodeSha256,
      historicalTargetRows: 5, sourceFileCount: scope.fileCount, missingOriginalBrokerIdRows: scope.missingOriginalBrokerIdRows });
    const read = async group => {
      check(result.requestCounts[group] === 0 && result.requestCounts.total < 3, 'REQUEST_BUDGET_EXCEEDED');
      const r = await transport.request({ group, phase: group === 'account' ? 'account' : 'initial',
        routeInput: group === 'quotes' ? { symbols: scope.symbols, feed: 'iex' } : {} });
      const counts = transport.counts();
      for (const k of Object.keys(result.requestCounts)) result.requestCounts[k] = counts[k];
      result.responses.push({ group, httpStatus: r.status, complete: r.complete, responseSha256: r.responseSha256,
        error: r.error === null ? null : TRANSPORT_CODES.has(r.error) ? r.error : 'TRANSPORT_FAILURE' });
      check(r.error === null, TRANSPORT_CODES.has(r.error) ? r.error : 'TRANSPORT_FAILURE');
      check(r.complete && hash(r.responseSha256) && fresh(r.requestedAt, clock.now()) && fresh(r.retrievedAt, clock.now()), 'RECEIPT_INVALID');
      return r;
    };
    checkAccount((await read('account')).data, scope); result.accountPinMatched = true;
    const clockReceipt = await read('clock'), clockData = clockReceipt.data;
    checkClock(clockData, clockReceipt.retrievedAt); checkClock(clockData, clock.now());
    const quotes = await read('quotes'); checkClock(clockData, clock.now());
    result.quoteShapeSha256 = checkQuotes(quotes.data, scope, quotes.retrievedAt, clock.now()); result.quoteRows = 5;
    result.status = 'OBSERVATION_COMPLETE_UNITS_UNVERIFIED';
  } catch (error) { result.status = safeError(error); }
  result.requestBudgetCompliant = result.requestCounts.total <= 3 && ['account', 'clock', 'quotes'].every(k => result.requestCounts[k] <= 1);
  if (created) {
    try { writeExclusive(output, 'result.json', result); }
    catch { result.status = 'RESULT_PERSISTENCE_FAILED_ATTEMPT_PRESERVED'; }
  }
  return result;
}

export async function main(argv = [], dependencies = {}) {
  if (Array.isArray(argv) && argv.length === 0) return { status: 'NOT_RUN', ...SAFETY, requestCounts: { total: 0 } };
  if (!Array.isArray(argv) || argv.length !== 3 || argv[0] !== '--observe' || !hash(argv[2]))
    return { status: 'ARGUMENTS_INVALID', ...SAFETY, requestCounts: { total: 0 } };
  try {
    const config = readPrivate(argv[1], argv[2]), env = dependencies.env ?? process.env;
    return await observePaperIex({ config, env, approval: env.PAPER_IEX_READONLY_APPROVAL, fetchImpl: dependencies.fetchImpl ?? globalThis.fetch,
      clock: dependencies.clock ?? { now: () => new Date().toISOString(), monotonicMs: () => performance.now() } });
  } catch (error) { return { status: safeError(error), ...SAFETY, requestCounts: { total: 0 } }; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await main(process.argv.slice(2)); process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!['NOT_RUN', 'OBSERVATION_COMPLETE_UNITS_UNVERIFIED', 'MARKET_CLOSED'].includes(result.status)) process.exitCode = 1;
}
