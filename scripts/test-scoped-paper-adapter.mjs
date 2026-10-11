import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { invocationFixture, initialReceipts, hash } from './fixtures/scoped-paper-adapter.mjs';
import { mapPreflightEvidence } from './lib/scoped-paper-evidence.mjs';
import * as controller from './lib/scoped-closeout-contract.mjs';
const adapter = await import('./lib/scoped-paper-adapter.mjs').catch(e => { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; });
assert.equal(typeof adapter.authorizeScopedPaperInvocation, 'function', 'explicit invocation gate must exist');
if (!process.argv.includes('--fixture-child')) {
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--fixture-child'], { encoding: 'utf8',
    env: { PATH: process.env.PATH, NODE_OPTIONS: process.env.NODE_OPTIONS ?? '', ALPHA_ENV: 'PAPER', READ_ONLY: 'false',
      EXEC_ENABLED: 'true', LIVE_ORDER_SUBMIT_ENABLED: 'false', MARKET_GUARD_MODE: 'observe' } });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  process.stdout.write(child.stdout);
} else {
  let f = invocationFixture();
  assert.equal(adapter.validateScopedPaperConfiguration(f.config).status, 'PASS');
  const capability = adapter.authorizeScopedPaperInvocation({ config: f.config, approval: f.approval, clock: f.clock });
  assert.throws(() => controller.validateObservedCloseoutInput(f.input, structuredClone(capability)), /AUTHORITY/);
  const scope = controller.validateObservedCloseoutInput(f.input, capability);
  const snapshot = mapPreflightEvidence({ scope, receipts: await initialReceipts(f), bindings: f.bindings, clock: f.clock });
  assert.equal(controller.evaluateCloseoutSnapshot(scope, snapshot, { now: f.clock.now(), elapsedMs: 0 }).status, 'READY_REPORT_ONLY');
  assert.equal(controller.evaluateCloseoutSnapshot(scope, structuredClone(snapshot), { now: f.clock.now(), elapsedMs: 0 }).status, 'BLOCKED');
  assert.throws(() => controller.validateScopedCloseoutInput(f.input), /MODE_INVALID/);
  for (const mutate of [
    f => { f.approval.phrase = 'old approval'; }, f => { f.approval.configSha256 = hash('changed'); },
    f => { f.approval.expiresAt = '2026-10-09T14:00:00.000Z'; },
    f => { f.config.writerExclusion = {}; },
    f => { f.config.input.safeFlags.readOnly = true; },
    f => { f.config.bindings.proof.feed = 'iex'; },
    f => { f.config.url = 'https://api.alpaca.markets'; },
  ]) { f = invocationFixture(); mutate(f);
    assert.throws(() => adapter.authorizeScopedPaperInvocation({ config: f.config, approval: f.approval, clock: f.clock }), /^Error: SCOPED_CLOSEOUT_/); }
  for (const [key, value] of [['READ_ONLY', 'true'], ['EXEC_ENABLED', 'false'], ['ALPHA_ENV', 'LIVE'],
    ['LIVE_ORDER_SUBMIT_ENABLED', 'true'], ['ALPACA_BASE_URL', 'https://api.alpaca.markets'], ['GUARD_EXECUTE_FLATTEN', 'true']]) {
    const old = process.env[key]; process.env[key] = value; f = invocationFixture();
    assert.throws(() => adapter.authorizeScopedPaperInvocation({ config: f.config, approval: f.approval, clock: f.clock }), /FLAGS|ORIGIN/);
    if (old === undefined) delete process.env[key]; else process.env[key] = old;
  }
  console.log('scoped PAPER invocation gate: PASS (actual process flags, direct authority, observed v2, v1 invariance)');
}
