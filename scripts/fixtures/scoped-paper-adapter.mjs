import { createHash } from 'node:crypto';
import { fixture, at, hash } from './scoped-closeout.mjs';
import { createScopedPaperTransport } from '../lib/scoped-paper-transport.mjs';
export { at, hash };
export function paperFixture() {
  const { input } = fixture();
  const accountId = 'fixture-paper-account';
  input.accountSha256 = hash(['PAPER', accountId]);
  const assets = input.terms.targets.map((t, i) => ({ id: t.assetId, symbol: `FIX${i}`, class: 'us_equity',
    status: 'active', tradable: true, fractionable: true }));
  const positions = assets.map(a => ({ asset_id: a.id, symbol: a.symbol, asset_class: 'us_equity', side: 'long', qty: '2' }));
  const clock = { now: () => at, monotonicMs: () => 0 };
  const proof = { basis: 'REVIEWED_SCOPED_SOURCE_EVIDENCE', accountSha256: input.accountSha256,
    session: '2026-10-09', validFrom: '2026-10-09T14:59:59.000Z', expiresAt: '2026-10-09T15:00:30.000Z',
    feed: 'sip', currency: 'USD', feedEntitlementEvidenceSha256: hash('fixture-sip-entitlement'),
    clockAlignmentEvidenceSha256: hash('fixture-clock-alignment'),
    calendar: { open: '2026-10-09T13:30:00.000Z', close: '2026-10-09T20:00:00.000Z' },
    assets: assets.map(a => ({ assetId: a.id, quoteSizeUnit: 'shares', sharesPerUnit: '1',
      sizeEvidenceSha256: hash(['fixture-size', a.id]), quantityIncrement: '0.000000001',
      incrementEvidenceSha256: hash(['fixture-increment', a.id]),
      halt: { status: 'NOT_HALTED', observedAt: at, evidenceSha256: hash(['fixture-halt', a.id]) },
      risk: { status: 'PASS', observedAt: at, termsSha256: input.termsSha256, evidenceSha256: hash(['fixture-risk', a.id]) } })) };
  const bindings = { proof, proofSha256: hash(proof), rawAccountIdSha256: createHash('sha256').update(accountId).digest('hex'),
    rawAccountHashBasis: 'RAW_ACCOUNT_ID_UTF8', accountHashBasis: 'CANONICAL_PAPER_ACCOUNT_ID' };
  const bodies = {
    account: { id: accountId, status: 'ACTIVE', currency: 'USD', trading_blocked: false, account_blocked: false, trade_suspended_by_user: false },
    positions, orders: [], clock: { timestamp: at, is_open: true, next_open: '2026-10-12T13:30:00Z', next_close: '2026-10-09T20:00:00Z' },
    calendar: [{ date: '2026-10-09', open: '09:30', close: '16:00' }], assets,
    quotes: { quotes: Object.fromEntries(assets.map(a => [a.symbol, { t: at, bp: 100, ap: 100.01, bs: 200, as: 300, bx: 'V', ax: 'V', c: [], z: 'C' }])) },
  };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method }); const path = new URL(url).pathname;
    const group = path.includes('/assets/') ? 'assets' : path.endsWith('/quotes/latest') ? 'quotes'
      : path.endsWith('orders:by_client_order_id') ? 'lookup' : path.split('/').at(-1);
    const value = group === 'assets' ? bodies.assets.find(a => a.id === path.split('/').at(-1)) : bodies[group];
    return new Response(JSON.stringify(value));
  };
  return { input, bindings, bodies, assets, clock, fetchImpl, calls, accountId };
}
export async function initialReceipts(f) {
  const transport = createScopedPaperTransport({ credentials: { key: 'fixture-key', secret: 'fixture-secret' },
    fetchImpl: f.fetchImpl, clock: f.clock, deadlineMs: 300000 });
  const receipts = [];
  const read = async (group, routeInput = {}) => receipts.push(await transport.request({ group,
    phase: group === 'account' ? 'account' : 'initial', routeInput }));
  await read('account');
  for (const group of ['positions', 'orders', 'clock']) await read(group);
  await read('calendar', { session: '2026-10-09' });
  for (const asset of f.assets) await read('assets', { assetId: asset.id });
  await read('quotes', { symbols: f.assets.map(a => a.symbol), ...(f.bindings.proof.feed === 'sip' ? {} : { feed: f.bindings.proof.feed }) });
  return receipts;
}
// Synthetic reviewed units only; this fixture does not establish a real account's feed contract.
export function useIexProof(f, unit = 'round_lots', sharesPerUnit = '100') {
  Object.assign(f.bindings.proof, { feed: 'iex', quoteCoverage: 'IEX_SINGLE_EXCHANGE', acceptsNonNbboPaperEvidence: true,
    feedEntitlementEvidenceSha256: hash('fixture-iex-entitlement') });
  for (const a of f.bindings.proof.assets) Object.assign(a, { quoteSizeFeed: 'iex', quoteSizeBasis: 'ALPACA_REST_LATEST_QUOTES',
    quoteSizeUnit: unit, sharesPerUnit, sizeEvidenceSha256: hash(['fixture-iex-size', a.assetId, unit, sharesPerUnit]) });
  f.bindings.proofSha256 = hash(f.bindings.proof);
  return f;
}
export function invocationFixture() {
  const f = paperFixture();
  Object.assign(f.input, { schemaVersion: 2, evidenceMode: 'PAPER_OBSERVED',
    safeFlags: { readOnly: false, execEnabled: true, liveOrderSubmitEnabled: false, marketGuardMode: 'observe' } });
  f.input.authority.kind = 'SCOPED_MANAGEMENT_PAPER_ONLY'; f.input.authoritySha256 = hash(f.input.authority);
  const config = { input: f.input, bindings: f.bindings, directory: '/private/tmp/fixture-scoped-paper-state',
    sourceFile: { path: '/private/tmp/fixture-source.json', sha256: f.input.sourceSha256 },
    codeFiles: [{ path: '/private/tmp/fixture-reviewed-code.mjs', sha256: hash('fixture-code-bytes') }],
    writerExclusion: { basis: 'REVIEWED_ACCOUNT_WIDE_WRITER_EXCLUSION', evidenceSha256: hash('fixture-exclusion'),
      accountSha256: f.input.accountSha256, session: f.input.authority.session, expiresAt: f.input.authority.expiresAt } };
  f.input.codeSha256 = hash(config.codeFiles);
  const approval = { kind: 'DIRECT_SCOPED_OPERATOR_INVOCATION', phrase: 'CONFIRM LIVE EXECUTION',
    configSha256: hash(config), approvedAt: at, expiresAt: f.input.authority.expiresAt, rollbackPlanSha256: hash('fixture-rollback') };
  return { ...f, config, approval };
}
