import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { operationalFixture, invocationFixture, initialReceipts, hash } from './fixtures/scoped-paper-adapter.mjs';
import { mapPreflightEvidence } from './lib/scoped-paper-evidence.mjs';
import * as controller from './lib/scoped-closeout-contract.mjs';

const m = await import('./lib/scoped-paper-operational.mjs').catch(e => {
  if (e.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw e;
});
for (const name of ['validateOperationalConfiguration', 'authorizeOperationalInvocation', 'bindOperationalObservation', 'assertOperationalInvocation'])
  assert.equal(typeof m[name], 'function', `${name} must exist`);

if (!process.argv.includes('--fixture-child')) {
  const f = operationalFixture();
  assert.equal(m.validateOperationalConfiguration(f.config).status, 'PASS');
  assert.throws(() => m.authorizeOperationalInvocation(f), /ACTUAL_PROCESS_FLAGS_BLOCKED/);
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--fixture-child'], {
    encoding: 'utf8', env: { PATH: process.env.PATH, NODE_OPTIONS: process.env.NODE_OPTIONS ?? '',
      ALPHA_ENV: 'PAPER', READ_ONLY: 'false', EXEC_ENABLED: 'true', LIVE_ORDER_SUBMIT_ENABLED: 'false', MARKET_GUARD_MODE: 'observe' },
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  process.stdout.write(child.stdout);
} else {
  const authorize = f => m.authorizeOperationalInvocation({ config: f.config, approval: f.approval, clock: f.clock });
  const observe = async (f, scope, generation) => {
    const proof = structuredClone(f.bindings.proof);
    Object.assign(proof, { stableScopeSha256: hash(f.config), sourceGeneration: generation,
      sourceContractSha256: f.config.sourcePolicy.contractFile.sha256,
      riskPolicySha256: f.config.sourcePolicy.riskPolicyFile.sha256,
      clockPolicySha256: f.config.sourcePolicy.clockPolicyFile.sha256 });
    const bindings = { ...f.config.accountBinding, proof, proofSha256: hash(proof) };
    const snapshot = mapPreflightEvidence({ scope, receipts: await initialReceipts(f), bindings, clock: f.clock });
    return { sourceGeneration: generation, snapshot, bindings };
  };
  let f = operationalFixture(), cap = authorize(f);
  let scope = controller.validateObservedCloseoutInput(f.input, cap);
  assert.strictEqual(controller.validateObservedCloseoutInput(f.input, cap), scope);
  assert.throws(() => controller.validateObservedCloseoutInput(f.input, structuredClone(cap)), /AUTHORITY/);
  const first = await observe(f, scope, 1), stableHash = hash(f.config);
  assert.equal(controller.evaluateCloseoutSnapshot(scope, first.snapshot, { now: f.clock.now(), elapsedMs: 0 }).status, 'BLOCKED');
  assert.equal(m.bindOperationalObservation(cap, { scope, observation: first, clock: f.clock }), true);
  assert.equal(m.assertOperationalInvocation(cap, { config: f.config, clock: f.clock }), true);
  assert.equal(controller.evaluateCloseoutSnapshot(scope, first.snapshot, { now: f.clock.now(), elapsedMs: 0 }).status, 'READY_REPORT_ONLY');
  const second = await observe(f, scope, 2);
  assert.equal(m.bindOperationalObservation(cap, { scope, observation: second, clock: f.clock }), true);
  assert.equal(hash(f.config), stableHash, 'fresh observation does not rewrite the approved scope');
  assert.equal(controller.evaluateCloseoutSnapshot(scope, first.snapshot, { now: f.clock.now(), elapsedMs: 0 }).status, 'BLOCKED');
  assert.equal(controller.evaluateCloseoutSnapshot(scope, second.snapshot, { now: f.clock.now(), elapsedMs: 0 }).status, 'READY_REPORT_ONLY');
  assert.throws(() => m.bindOperationalObservation(cap, { scope, observation: first, clock: f.clock }), /GENERATION/);
  assert.throws(() => m.assertOperationalInvocation(cap, { config: f.config, clock: f.clock }), /SOURCE_BINDING/,
    'rejected replacement must not silently reuse the old send proof');
  assert.equal(controller.evaluateCloseoutSnapshot(scope, second.snapshot, { now: f.clock.now(), elapsedMs: 0 }).status, 'BLOCKED');
  const third = await observe(f, scope, 3);
  assert.throws(() => m.bindOperationalObservation(cap, { scope, observation: structuredClone(third), clock: f.clock }), /OBSERVATION/);
  assert.throws(() => m.bindOperationalObservation(structuredClone(cap), { scope, observation: third, clock: f.clock }), /AUTHORITY/);
  const other = operationalFixture(), otherCap = authorize(other);
  const otherScope = controller.validateObservedCloseoutInput(other.input, otherCap);
  assert.throws(() => m.bindOperationalObservation(cap, { scope: otherScope, observation: third, clock: f.clock }), /SCOPE/);

  let mutations = 0;
  function changed(v) { return typeof v === 'string' ? `${v}x` : typeof v === 'number' ? v + 1 : !v; }
  const leaves = (value, at = []) => Object.entries(value).flatMap(([k, v]) =>
    v && typeof v === 'object' ? leaves(v, [...at, k]) : [[...at, k]]);
  for (const keys of leaves(f.config)) {
    const altered = structuredClone(f.config), target = keys.slice(0, -1).reduce((v, k) => v[k], altered);
    target[keys.at(-1)] = changed(target[keys.at(-1)]);
    assert.throws(() => m.authorizeOperationalInvocation({ config: altered, approval: f.approval, clock: f.clock }),
      /^Error: SCOPED_CLOSEOUT_/, `fixed field ${keys.join('.')} must invalidate authority`);
    assert.throws(() => m.assertOperationalInvocation(cap, { config: altered, clock: f.clock }), /AUTHORITY/);
    mutations++;
  }
  for (const field of Object.keys(f.config)) {
    const removed = structuredClone(f.config); delete removed[field];
    assert.equal(m.validateOperationalConfiguration(removed).status, 'BLOCKED');
  }
  assert.equal(m.validateOperationalConfiguration({ ...f.config, hiddenFallback: true }).status, 'BLOCKED');
  assert.throws(() => m.authorizeOperationalInvocation({ ...f, approval: invocationFixture().approval }), /AUTHORITY/);
  assert.throws(() => controller.authorizeScopedPaperInvocation(f), /CONFIG/);
  const notified = operationalFixture();
  notified.config.notifications = { destinationSha256: hash('fixture-destination'), sourceRunId: '123', headSha: 'a'.repeat(40) };
  notified.approval.stableScopeSha256 = hash(notified.config);
  assert.equal(m.validateOperationalConfiguration(notified.config).status, 'PASS');
  assert.ok(authorize(notified));
  notified.config.notifications.destinationSha256 = hash('other-destination');
  assert.throws(() => authorize(notified), /AUTHORITY/);

  for (const change of [
    v => { v.config.sourcePolicy.feed = 'unknown'; },
    v => { v.config.sourcePolicy.quoteCoverage = 'NBBO'; },
    v => { v.config.sourcePolicy.acceptsNonNbboPaperEvidence = false; },
    v => { v.config.sourcePolicy.contractFile.path = 'relative.json'; },
    v => { v.config.accountBinding.rawAccountHashBasis = 'SYMBOL_ONLY'; },
    v => { v.config.custody.basis = 'CACHE_RESTORED'; },
    v => { v.config.oversight.handoffDeadline = '2026-10-09T15:06:00.000Z'; },
    v => { v.config.oversight.requestBudget.total = 18; },
    v => { v.config.oversight.maxCycles = Infinity; },
    v => { v.config.oversight.intervalMs = 0; },
    v => { v.config.oversight.handoffDeadline = '2026-10-09T15:00:00.000Z'; },
  ]) {
    const invalid = operationalFixture(); change(invalid); invalid.approval.stableScopeSha256 = hash(invalid.config);
    assert.equal(m.validateOperationalConfiguration(invalid.config).status, 'BLOCKED');
  }
  for (const mutate of [
    o => { o.bindings.rawAccountIdSha256 = hash('wrong'); },
    o => { o.bindings.proof.feed = 'sip'; },
    o => { o.bindings.proof.sourceContractSha256 = hash('wrong'); },
    o => { o.bindings.proof.stableScopeSha256 = hash('wrong'); },
    o => { o.bindings.proof.sourceGeneration = 7; },
    o => { o.bindings.proof.assets[0].halt.status = 'UNKNOWN'; },
    o => { o.bindings.proof.assets[0].halt.observedAt = '2026-10-09T14:59:29.000Z'; },
    o => { o.bindings.proof.assets[0].risk.status = 'UNKNOWN'; },
  ]) {
    f = operationalFixture(); cap = authorize(f); scope = controller.validateObservedCloseoutInput(f.input, cap);
    const obs = await observe(f, scope, 1); mutate(obs); obs.bindings.proofSha256 = hash(obs.bindings.proof);
    assert.throws(() => m.bindOperationalObservation(cap, { scope, observation: obs, clock: f.clock }), /OBSERVATION|SOURCE|BINDING/);
  }
  f = operationalFixture(); cap = authorize(f); scope = controller.validateObservedCloseoutInput(f.input, cap);
  const last = await observe(f, scope, 1);
  m.bindOperationalObservation(cap, { scope, observation: last, clock: f.clock });
  last.bindings.proof.assets[0].halt.status = 'UNKNOWN';
  assert.equal(m.assertOperationalInvocation(cap, { config: f.config, clock: f.clock }), true,
    'mutating the caller object cannot mutate the captured binding');
  assert.throws(() => m.assertOperationalInvocation(cap, { config: f.config,
    clock: { ...f.clock, now: () => '2026-10-09T15:00:31.000Z' } }), /SOURCE|EXPIRED/);
  const drifting = operationalFixture(); let elapsed = 0;
  drifting.clock.monotonicMs = () => elapsed;
  const driftingCap = authorize(drifting), driftingScope = controller.validateObservedCloseoutInput(drifting.input, driftingCap);
  m.bindOperationalObservation(driftingCap, { scope: driftingScope, observation: await observe(drifting, driftingScope, 1), clock: drifting.clock });
  elapsed = 10;
  assert.equal(m.assertOperationalInvocation(driftingCap, { config: drifting.config, clock: drifting.clock }), true);
  elapsed = 9;
  assert.throws(() => m.assertOperationalInvocation(driftingCap, { config: drifting.config, clock: drifting.clock }), /EXPIRED/,
    'monotonic time cannot regress even while it remains after invocation start');
  for (const [key, value] of [['READ_ONLY', 'true'], ['EXEC_ENABLED', 'false'], ['ALPHA_ENV', 'LIVE'],
    ['LIVE_ORDER_SUBMIT_ENABLED', 'true'], ['GUARD_EXECUTE_FLATTEN', 'true']]) {
    const previous = process.env[key]; process.env[key] = value;
    assert.throws(() => m.assertOperationalInvocation(cap, { config: f.config, clock: f.clock }), /FLAGS/);
    if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
  }
  console.log(`scoped operational authority: PASS (${mutations} stable-field mutations, sealed generation refresh, legacy isolation, no real network)`);
}
