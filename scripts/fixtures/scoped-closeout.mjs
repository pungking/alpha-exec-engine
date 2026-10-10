import { sha256Canonical } from '../lib/active-position-limited-recovery.mjs';

export const hash = value => sha256Canonical(value);
export const at = '2026-10-09T15:00:00.000Z';
export function managementRecord(index = 0) {
  const { input } = fixture(), t = input.terms.targets[index];
  return { recordKind: 'SCOPED_MANAGEMENT_EXIT_V1', schemaVersion: 1, attemptId: input.attemptId,
    managementAuthoritySha256: input.authoritySha256, termsSha256: input.termsSha256,
    accountSha256: input.accountSha256, originalIdentitySha256: t.originalIdentitySha256,
    exitIdempotencyKey: t.exitIdempotencyKey, clientOrderId: t.clientOrderId, assetId: t.assetId,
    side: 'sell', actionType: 'EXIT_FULL', qty: t.qty, limitPrice: '99.9',
    observedEvidenceSha256: hash('evidence'), requestSha256: null, preWriteHashes: input.preWriteHashes,
    createdAt: at, updatedAt: at, submissionPhase: 'RESERVED', brokerOrderId: null,
    brokerStatus: null, filledQty: '0', originalOwnershipVerified: false,
    realizedPnlVerified: false, historicalEvidenceNormalized: false, brokerSubmitAllowed: false,
    history: [{ at, phase: 'RESERVED', evidenceSha256: hash('evidence'), brokerStatus: null, filledQty: '0' }] };
}
export function fixture() {
  const targets = Array.from({ length: 5 }, (_, i) => ({
    originalIdentitySha256: hash(`synthetic-identity-${i}`), assetId: `fixture-asset-${i}`,
    exitIdempotencyKey: `fixture-exit-${i}`, clientOrderId: `fixture-client-${i}`,
    qty: '2', maxNotional: '201',
  }));
  const portfolio = targets.map(t => ({ assetId: t.assetId, qty: t.qty }));
  const terms = { targets, portfolio, maxTotalNotional: '1005', maxSpreadBps: 10,
    maxAdverseBps: 10, maxEvidenceAgeSeconds: 30 };
  const input = { schemaVersion: 1, environment: 'PAPER', evidenceMode: 'SYNTHETIC',
    attemptId: 'fixture-attempt', accountSha256: hash('fixture-account'),
    sourceSha256: hash('fixture-source'), codeSha256: hash('fixture-code'),
    terms, termsSha256: hash(terms),
    authority: { kind: 'SYNTHETIC_ONLY', session: '2026-10-09',
      validFrom: '2026-10-09T14:59:00.000Z', expiresAt: '2026-10-09T15:05:00.000Z',
      acceptsRestingDayOrders: true },
    safeFlags: { readOnly: true, execEnabled: false, liveOrderSubmitEnabled: false, marketGuardMode: 'observe' },
    preWriteHashes: { orderLedger: hash('fixture-ledger'), orderIdempotency: hash('fixture-idempotency') },
  };
  input.authoritySha256 = hash(input.authority);
  const interval = () => ({ basis: 'OBSERVED_GET_INTERVAL', requestedAt: at, retrievedAt: at, responseSha256: hash('fixture-response') });
  const snapshot = { evidenceMode: 'SYNTHETIC', accountSha256: input.accountSha256,
    sourceSha256: input.sourceSha256, portfolio, openOrders: [], complete: true,
    observations: { account: interval(), positions: interval(), orders: interval(), assets: interval(), calendar: interval() },
    clock: { version: 'v2', isOpen: true, timestamp: at, session: '2026-10-09',
      open: '2026-10-09T13:30:00.000Z', close: '2026-10-09T20:00:00.000Z',
      timezone: 'America/New_York', clockAlignment: 'SYNTHETIC_VERIFIED', responseSha256: hash('clock') },
    rows: targets.map(t => ({ originalIdentitySha256: t.originalIdentitySha256, assetId: t.assetId,
      qty: t.qty, bid: '100', ask: '100.01', bidSizeShares: '200', quoteAt: at,
      quoteResponseSha256: hash('quote'), feed: 'sip', currency: 'USD', sizeUnit: 'shares',
      sourceBinding: 'SYNTHETIC_VERIFIED', tick: '0.01', quantityIncrement: '0.000000001',
      fractionable: true, tradable: true, haltStatus: 'NOT_HALTED',
      riskStatus: 'PASS', riskEvidenceSha256: hash('risk') })),
  };
  return { input, snapshot, clock: { now: at, elapsedMs: 0 } };
}
