import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { managementRecord, limitedManagementRecord } from './fixtures/scoped-closeout.mjs';
import { buildPaperExitReadiness } from './build-live-readiness-scorecard.mjs';
import { buildBrokerRealizedPnlSummary } from './build-performance-dashboard.mjs';
import { buildExactPrivateReportState, validateTargets } from './audit-paper-closeout-private-evidence.mjs';
import { sourceJson } from './paper-exact-cache-private-export.mjs';
import { validateScopedManagementRecord } from '../dist/src/scoped-management-record.js';
const record = managementRecord(), orders = { [record.exitIdempotencyKey]: record };
const ledger = { orders, updatedAt: record.updatedAt }, idempotency = { orders, releases: [], updatedAt: record.updatedAt };
const rejected = /SCOPED_MANAGEMENT_REQUIRES_SCOPED_CONSUMER/;
let checks = 0;
for (const run of [
  () => buildPaperExitReadiness({ orderLedger: ledger, orderIdempotency: idempotency }),
  () => buildBrokerRealizedPnlSummary({ orderLedger: ledger, orderIdempotency: idempotency }),
  () => buildExactPrivateReportState({ ledger, idempotency }),
  () => validateTargets([], { orderLedger: ledger, orderIdempotency: idempotency }),
]) { assert.throws(run, rejected); checks++; }
assert.deepEqual(sourceJson(Buffer.from(JSON.stringify(ledger))), ledger); checks++;

for (const terminal of [false, true]) {
  const limited = limitedManagementRecord();
  if (terminal) {
    limited.requestSha256 = 'a'.repeat(64); limited.brokerOrderId = 'fixture-terminal-order';
    limited.brokerStatus = 'filled'; limited.filledQty = limited.qty; limited.submissionPhase = 'FLAT_RECONCILED';
    limited.brokerEventTimestamps = { createdAt: limited.createdAt, updatedAt: limited.updatedAt, filledAt: limited.updatedAt };
    limited.history.push(...['ATTEMPTED', 'OBSERVED', 'FLAT_RECONCILED'].map(phase => ({ ...limited.history[0], phase,
      brokerStatus: phase === 'ATTEMPTED' ? null : 'filled', filledQty: phase === 'ATTEMPTED' ? '0' : limited.qty })));
  }
  assert.equal(validateScopedManagementRecord(limited.exitIdempotencyKey, limited), true); checks++;
  const orders = { [limited.exitIdempotencyKey]: limited };
  const limitedLedger = { ...ledger, orders }, limitedIdempotency = { ...idempotency, orders };
  for (const run of [
    () => buildPaperExitReadiness({ orderLedger: limitedLedger, orderIdempotency: limitedIdempotency }),
    () => buildBrokerRealizedPnlSummary({ orderLedger: limitedLedger, orderIdempotency: limitedIdempotency }),
    () => buildExactPrivateReportState({ ledger: limitedLedger, idempotency: limitedIdempotency }),
    () => validateTargets([], { orderLedger: limitedLedger, orderIdempotency: limitedIdempotency }),
  ]) { assert.throws(run, rejected); checks++; }
}

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scoped-consumers-'));
const cwd = path.join(root, 'a', 'b', 'c'); fs.mkdirSync(cwd, { recursive: true });
const dir = path.join(cwd, 'state'); fs.mkdirSync(dir, { mode: 0o700 });
try {
  const l = JSON.stringify(ledger), i = JSON.stringify(idempotency);
  fs.writeFileSync(path.join(dir, 'order-ledger.json'), l, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'order-idempotency.json'), i, { mode: 0o600 });
  const preload = path.join(root, 'offline.cjs');
  fs.writeFileSync(preload, "const deny=()=>{throw Error('NETWORK_FORBIDDEN')}; global.fetch=deny; for(const m of ['http','https']){require(m).request=deny;require(m).get=deny;} for(const m of ['net','tls']){require(m).connect=deny;require(m).createConnection=deny;}");
  for (const script of ['build-order-state-consistency-report', 'build-position-protection-root-cause-audit',
    'build-live-readiness-scorecard', 'build-performance-dashboard', 'build-broker-fill-state-evidence',
    'build-ledger-terminalization-proposal', 'build-ledger-terminalization-migration-package',
    'build-ledger-filled-migration-plan', 'apply-ledger-filled-migration']) {
    const run = spawnSync(process.execPath, [path.join(repo, 'scripts', `${script}.mjs`)], {
      cwd, encoding: 'utf8', timeout: 10000, env: { PATH: process.env.PATH, HOME: root,
        NODE_OPTIONS: `--require=${preload}`, READ_ONLY: 'true', EXEC_ENABLED: 'false', ALPHA_ENV: 'PAPER' },
    });
    assert.notEqual(run.status, 0, script);
    assert.match(run.stderr + run.stdout, rejected, script);
    assert.equal(fs.readFileSync(path.join(dir, 'order-ledger.json'), 'utf8'), l);
    assert.equal(fs.readFileSync(path.join(dir, 'order-idempotency.json'), 'utf8'), i); checks += 4;
  }
  // Existing migration is not imported/executed: exercise its exact pure planning boundary.
  const source = fs.readFileSync(path.join(repo, 'scripts/apply-active-position-limited-recovery.mjs'), 'utf8');
  const ast = ts.createSourceFile('fixture.mjs', source, ts.ScriptTarget.ES2022, true);
  const init = ast.statements.filter(ts.isVariableStatement).flatMap(n => n.declarationList.declarations).find(n => n.name.getText(ast) === 'buildPlan').initializer;
  const { assertLegacyOrderState } = await import('./lib/active-position-limited-recovery.mjs');
  const buildPlan = vm.runInNewContext(`(${init.getText(ast)})`, { assertLegacyOrderState });
  assert.throws(() => buildPlan({ orderLedger: ledger, idempotency }), rejected); checks++;
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log(JSON.stringify({ status: 'PASS', suite: 'scoped-closeout-consumers', checks, brokerRequests: 0, productionStateWrites: 0 }));
