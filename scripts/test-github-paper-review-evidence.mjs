import assert from 'node:assert/strict';
import {
  inspectGithubPaperReviewEvidence, readGithubPaperReviewEvidence,
} from './lib/github-paper-review-evidence.mjs';

const BASE_SHA = 'a'.repeat(40);
const SCOPE_SHA = 'b'.repeat(64);
const TOKEN = 'only-for-synthetic-offline-fixtures';
const ENV_ID = 26847620868;
const paths = [
  '.github/workflows/paper-oco-submit-canary.yml',
  '.github/workflows/persistent-oco-repair-submit.yml',
  '.github/workflows/ledger-filled-migration.yml',
  '.github/workflows/paper-five-row-active-limited-state-recovery.yml',
];
const base = (workflowPath = paths[0]) => ({
  expected: { runId: '123456789', codeSha: BASE_SHA, workflowPath, accountScopeSha256: SCOPE_SHA },
  run: { id: 123456789, run_attempt: 1, event: 'workflow_dispatch',
    head_branch: 'main', head_sha: BASE_SHA, path: workflowPath,
    repository: { full_name: 'pungking/alpha-exec-engine' },
    head_repository: { full_name: 'pungking/alpha-exec-engine' }, pull_requests: [] },
  reviews: [{ state: 'approved', user: { login: 'pungking', id: 10 },
    environments: [{ id: ENV_ID, name: 'PAPER_CUSTODY_APPROVAL' }] }],
});
let checks = 0, providerCalls = 0;
function verify(x, code, bound = !code) {
  const out = inspectGithubPaperReviewEvidence(x);
  assert.equal(out.operationalEligible, false);
  assert.equal(out.brokerSubmitAuthorized, false);
  assert.equal(out.stateMutationAuthorized, false);
  assert.equal(out.writerClaimVerified, false);
  assert.equal(out.custodyScopeVerified, false);
  assert.equal(out.environmentConfigurationVerified, false);
  assert.equal(out.reviewHistoryBound, bound);
  if (code) {
    assert.equal(out.status, 'DENY_REVIEW_EVIDENCE_INVALID');
    assert.ok(out.findings.includes(code), JSON.stringify(out.findings));
  } else {
    assert.deepEqual(out.findings, []);
    assert.equal(out.status, 'HOLD_REVIEW_EVIDENCE_NOT_OPERATIONAL_AUTHORITY');
  }
  checks++;
}
function mutate(fn, code) { const x = base(); fn(x); verify(x, code); }
for (const path of paths) verify(base(path));
verify(base());
for (const bad of [null, false, '', 123, {}, []]) verify(bad, 'EXPECTED_BOUNDARY_INVALID');
mutate(x => { x.expected.accountScopeSha256 = 'bad'; }, 'EXPECTED_BOUNDARY_INVALID');
mutate(x => { x.expected.codeSha = 'bad'; }, 'EXPECTED_BOUNDARY_INVALID');
mutate(x => { x.expected.runId = '0'; }, 'EXPECTED_BOUNDARY_INVALID');
mutate(x => { x.expected.workflowPath = '.github/workflows/dry-run.yml'; }, 'EXPECTED_BOUNDARY_INVALID');
mutate(x => { x.expected.unexpected = true; }, 'EXPECTED_BOUNDARY_INVALID');
for (const [key, bad] of [
  ['id', 123456788], ['run_attempt', 2], ['event', 'schedule'],
  ['head_branch', 'paper-state'], ['head_sha', 'c'.repeat(40)],
  ['path', '.github/workflows/dry-run.yml'], ['pull_requests', [{}]],
])
  mutate(x => { x.run[key] = bad; }, 'RUN_BOUNDARY_INVALID');
mutate(x => { x.run.repository.full_name = 'fork/engine'; }, 'RUN_BOUNDARY_INVALID');
mutate(x => { x.run.head_repository.full_name = 'fork/engine'; }, 'RUN_BOUNDARY_INVALID');
for (const [key, val] of [
  ['login', 'untrusted'], ['id', 0], ['id', '10'],
])
  mutate(x => { x.reviews[0].user[key] = val; }, 'REVIEWER_OR_STATE_INVALID');
mutate(x => { x.reviews[0].environments[0].id++; }, 'REVIEW_COUNT_INVALID');
mutate(x => { x.reviews[0].environments[0].name = 'UNPROTECTED'; }, 'REVIEW_COUNT_INVALID');
mutate(x => { x.reviews = []; }, 'REVIEW_COUNT_INVALID');
mutate(x => { x.reviews = null; }, 'REVIEW_HISTORY_INVALID');
mutate(x => { x.reviews = [{}]; }, 'REVIEW_HISTORY_INVALID');
mutate(x => { x.reviews[0].state = 'rejected'; }, 'REVIEW_REJECTED');
mutate(x => { x.reviews[0].state = 'pending'; }, 'REVIEWER_OR_STATE_INVALID');
mutate(x => { x.reviews.push(structuredClone(x.reviews[0])); }, 'REVIEW_COUNT_INVALID');
mutate(x => { x.reviews.push({ ...x.reviews[0], state: 'rejected' }); }, 'REVIEW_REJECTED');
mutate(x => { x.reviews.push({ state: 'approved', user: { login: 'other', id: 12 }, environments: [{ id: 0, name: 'OTHER' }] }); }, undefined);
const sample = base();
const redacted = inspectGithubPaperReviewEvidence({ ...sample,
  expected: { ...sample.expected, accountScopeSha256: 'secret-should-not-log' } });
assert.ok(!JSON.stringify(redacted).includes('secret-should-not-log')); checks++;

function harness({ run, reviews, response = 200, corrupt = false, wrongRoute = false } = {}) {
  const sample = base();
  let calls = 0;
  const client = async (url, init) => {
    calls++; providerCalls++;
    const root = 'https://api.github.com/repos/pungking/alpha-exec-engine/actions/runs/123456789';
    assert.ok(url === root || url === root + '/approvals');
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Bearer ' + TOKEN);
    assert.equal(init.cache, 'no-store');
    const value = url.endsWith('/approvals') ? (reviews ?? sample.reviews) : (run ?? sample.run);
    return new Response(corrupt ? '{invalid' : JSON.stringify(value), { status: response });
  };
  return { fetchImpl: client, get calls() { return calls; } };
}
const run = async (client, other = {}) => {
  const sample = base();
  return readGithubPaperReviewEvidence({
    expected: sample.expected, fetchImpl: client.fetchImpl, token: TOKEN, ...other,
  });
};
const expectCode = async (client, code, other = {}) => {
  const out = await run(client, other);
  assert.equal(out.status, 'DENY_REVIEW_EVIDENCE_INVALID');
  assert.ok(out.findings.includes(code), JSON.stringify(out.findings));
  assert.equal(out.brokerSubmitAuthorized, false);
  assert.equal(out.stateMutationAuthorized, false);
  checks++;
};
const good = harness();
const goodResult = await run(good);
assert.equal(goodResult.reviewHistoryBound, true);
assert.equal(goodResult.operationalEligible, false);
assert.equal(goodResult.status, 'HOLD_REVIEW_EVIDENCE_NOT_OPERATIONAL_AUTHORITY');
assert.equal(good.calls, 2); checks += 4;
const wrong = harness({ run: { ...base().run, run_attempt: 2 } });
await expectCode(wrong, 'RUN_BOUNDARY_INVALID'); assert.equal(wrong.calls, 1); checks++;
const pending = harness({ reviews: [] });
await expectCode(pending, 'REVIEW_COUNT_INVALID');
await expectCode(harness({ response: 403 }), 'RESPONSE_INVALID');
await expectCode(harness({ corrupt: true }), 'JSON_INVALID');
await expectCode(harness(), 'CONFIG_INVALID', { token: 'bad' });
await expectCode(harness(), 'CONFIG_INVALID', { expected: { ...base().expected, workflowPath: 'untrusted.yml' } });
const throwClient = { fetchImpl: async () => { providerCalls++; throw Error('sensitive remote response secret'); } };
await expectCode(throwClient, 'REQUEST_FAILED');
const spoof = { fetchImpl: async () => ({ status: 200, text: async () => JSON.stringify(base().run) }) };
await expectCode(spoof, 'RESPONSE_INVALID');
const over = { fetchImpl: async () => new Response('{}', {
  status: 200, headers: { 'content-length': String(1024 * 1024 + 1) },
}) };
await expectCode(over, 'RESPONSE_TOO_LARGE');
assert.ok(providerCalls > 0); checks++;
console.log(JSON.stringify({ status: 'OFFLINE_GITHUB_PAPER_REVIEW_EVIDENCE_PASS',
  checks, externalGithubRequests: 0, brokerRequests: 0, operationalEligibilityGranted: 0 }));
