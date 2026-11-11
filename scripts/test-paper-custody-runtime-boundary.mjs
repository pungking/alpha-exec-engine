import assert from 'node:assert/strict';
import {
  paperCustodyAccountScopeFingerprint,
  inspectPaperCustodyRuntimeBoundary,
  inspectPaperCustodyReadOnlyPreflight,
} from './lib/paper-custody-runtime-boundary.mjs';
import { inspectGithubPaperReviewEvidence } from './lib/github-paper-review-evidence.mjs';

const REPO = 'pungking/alpha-exec-engine';
const PATH = '.github/workflows/paper-oco-submit-canary.yml';
const RUN = '123456789';
const SHA = 'a'.repeat(40);
const ACCOUNT = 'b'.repeat(64);
const SCOPE = 'c'.repeat(64);
const CODE = 'd'.repeat(64);
const PARENT = 'e'.repeat(40);
const GENESIS = 'f'.repeat(40);
const COMMIT = '1'.repeat(40);
const ENV_ID = 26847620868;
const TOKEN = 'synthetic-offline-github-read-token';
let checks = 0, providerCalls = 0;

function fixture() {
  const scope = { accountSha256: ACCOUNT, scopeSha256: SCOPE, attemptId: 'OFFLINE_3C' };
  const expected = {
    runId: RUN, codeSha: SHA, workflowPath: PATH,
    accountScopeSha256: paperCustodyAccountScopeFingerprint(scope),
  };
  const custodyConfig = {
    schemaVersion: 'github-paper-custody-config-v1',
    repository: REPO, ref: 'refs/heads/paper-state',
    genesisCommit: GENESIS, expectedCommit: PARENT,
    recipientSha256: '2'.repeat(64), accountSha256: ACCOUNT,
    scopeSha256: SCOPE, attemptId: scope.attemptId,
    runId: RUN, runAttempt: 1, workflow: PATH, codeSha256: CODE,
    inputFiles: { 'inputs/source.json': '3'.repeat(64) },
    maxRequests: 256, maxHistory: 32, timeoutMs: 1000,
  };
  const claim = {
    schemaVersion: 'paper-custody-writer-claim-observation-v1',
    ref: 'refs/heads/paper-state', commit: COMMIT,
    parentCommit: PARENT, genesisCommit: GENESIS,
    envelopeSha256: '4'.repeat(64), phase: 'CLAIM', sequence: 1,
    writer: { runId: RUN, runAttempt: 1, workflow: PATH, codeSha256: CODE },
    accountSha256: ACCOUNT, scopeSha256: SCOPE, attemptId: scope.attemptId,
  };
  const run = {
    id: Number(RUN), run_attempt: 1, event: 'workflow_dispatch',
    head_branch: 'main', head_sha: SHA, path: PATH,
    repository: { full_name: REPO }, head_repository: { full_name: REPO },
    pull_requests: [],
  };
  const reviews = [{ state: 'approved', user: { login: 'pungking', id: 10 },
    environments: [{ id: ENV_ID, name: 'PAPER_CUSTODY_APPROVAL' }] }];
  const reviewEvidence = inspectGithubPaperReviewEvidence({ expected, run, reviews });
  const refSnapshot = { ref: 'refs/heads/paper-state', object: { type: 'commit', sha: COMMIT } };
  return { expected, scope, custodyConfig, claim, refSnapshot, reviewEvidence,
    reviewedCodeSha256: CODE, run, reviews };
}
function verify(candidate, reason) {
  const output = inspectPaperCustodyRuntimeBoundary(candidate);
  assert.equal(output.operationalEligible, false);
  assert.equal(output.stateMutationAuthorized, false);
  assert.equal(output.brokerSubmitAuthorized, false);
  assert.equal(output.durableWriterVerified, false);
  assert.equal(output.legacyWritersExcluded, false);
  assert.equal(output.remoteClaimLineageVerified, false);
  assert.equal(output.environmentConfigurationVerified, false);
  assert.equal(output.accountOwnershipVerified, false);
  if (reason) {
    assert.equal(output.status, 'DENY_RUNTIME_BOUNDARY_INVALID');
    assert.equal(output.structuralBindingValid, false);
    assert.ok(output.findings.includes(reason), JSON.stringify(output.findings));
  } else {
    assert.equal(output.status, 'HOLD_BOUNDARY_UNTRUSTED_NOT_AUTHORIZED');
    assert.equal(output.structuralBindingValid, true);
    assert.deepEqual(output.findings, []);
  }
  checks++;
}
const mutate = (change, reason) => { const x = fixture(); change(x); verify(x, reason); };
verify(fixture());
for (const input of [null, undefined, [], 'bad', 0, {}, { random: true }])
  verify(input, 'INPUT_SHAPE_INVALID');
mutate(x => { x.unexpected = 1; }, 'INPUT_SHAPE_INVALID');
for (const [field, value] of [
  ['runId', '0'], ['codeSha', 'invalid'], ['workflowPath', '.github/workflows/dry-run.yml'],
  ['accountScopeSha256', 'invalid'],
])
  mutate(x => { x.expected[field] = value; }, 'EXPECTED_RUN_INVALID');
mutate(x => { x.expected.extra = 'forbidden'; }, 'EXPECTED_RUN_INVALID');
for (const [field, value] of [
  ['accountSha256', 'invalid'], ['scopeSha256', 'invalid'], ['attemptId', '../evil'],
])
  mutate(x => { x.scope[field] = value; }, 'ACCOUNT_SCOPE_INVALID');
mutate(x => { x.scope.extra = 1; }, 'ACCOUNT_SCOPE_INVALID');
mutate(x => { x.scope.attemptId = 'DIFFERENT_ATTEMPT'; }, 'CROSS_SCOPE_RUN_BINDING_INVALID');
mutate(x => { x.expected.accountScopeSha256 = '5'.repeat(64); }, 'CROSS_SCOPE_RUN_BINDING_INVALID');
for (const [field, value] of [
  ['repository', 'untrusted/engine'], ['ref', 'refs/heads/main'], ['runId', '345'],
  ['workflow', '.github/workflows/ledger-filled-migration.yml'],
  ['accountSha256', '5'.repeat(64)], ['scopeSha256', '5'.repeat(64)],
  ['attemptId', 'DIFFERENT'], ['codeSha256', '5'.repeat(64)],
]) mutate(x => { x.custodyConfig[field] = value; }, 'CROSS_SCOPE_RUN_BINDING_INVALID');
mutate(x => { x.custodyConfig.runAttempt = 2; }, 'CUSTODY_CONFIG_INVALID');
mutate(x => { x.custodyConfig.inputFiles = {}; }, 'CUSTODY_CONFIG_INVALID');
mutate(x => { x.reviewedCodeSha256 = 'invalid'; }, 'REVIEWED_CODE_PIN_INVALID');
mutate(x => { x.reviewedCodeSha256 = '5'.repeat(64); }, 'CROSS_SCOPE_RUN_BINDING_INVALID');
for (const [field, value] of [
  ['schemaVersion', 'bad'], ['ref', 'refs/heads/main'],
  ['commit', 'not-a-commit'], ['envelopeSha256', 'invalid'],
  ['phase', 'HANDOFF'], ['sequence', 0],
]) mutate(x => { x.claim[field] = value; }, 'WRITER_CLAIM_FORMAT_INVALID');
mutate(x => { x.claim.parentCommit = x.claim.commit; }, 'WRITER_CLAIM_FORMAT_INVALID');
for (const [field, value] of [
  ['parentCommit', '5'.repeat(40)], ['genesisCommit', '6'.repeat(40)],
  ['accountSha256', '7'.repeat(64)], ['scopeSha256', '7'.repeat(64)],
  ['attemptId', 'ANOTHER'],
]) mutate(x => { x.claim[field] = value; }, 'WRITER_CLAIM_BINDING_INVALID');
for (const [field, value] of [
  ['runId', '345'], ['workflow', '.github/workflows/ledger-filled-migration.yml'],
  ['codeSha256', '5'.repeat(64)],
]) mutate(x => { x.claim.writer[field] = value; }, 'WRITER_CLAIM_BINDING_INVALID');
mutate(x => { x.claim.writer.runAttempt = 2; }, 'WRITER_CLAIM_FORMAT_INVALID');
mutate(x => { x.claim.unexpected = 1; }, 'WRITER_CLAIM_FORMAT_INVALID');
mutate(x => { x.claim.writer.unexpected = 1; }, 'WRITER_CLAIM_FORMAT_INVALID');
mutate(x => { x.refSnapshot.object.sha = PARENT; }, 'REMOTE_HEAD_MISMATCH');
mutate(x => { x.refSnapshot.ref = 'refs/heads/main'; }, 'REMOTE_HEAD_MISMATCH');
mutate(x => { x.refSnapshot.object.type = 'tag'; }, 'REMOTE_HEAD_MISMATCH');
mutate(x => { x.reviewEvidence = { ...x.reviewEvidence, reviewHistoryBound: false }; }, 'GITHUB_REVIEW_NOT_BOUND');
mutate(x => { x.reviewEvidence = null; }, 'GITHUB_REVIEW_NOT_BOUND');
mutate(x => { x.reviewEvidence = { status: 'approved' }; }, 'GITHUB_REVIEW_NOT_BOUND');

assert.equal(paperCustodyAccountScopeFingerprint({ ...fixture().scope, unexpected: true }), null);
assert.equal(paperCustodyAccountScopeFingerprint(null), null);
checks += 2;

function client({ runMutate, reviewsMutate, headSha = COMMIT, runStatus = 200,
  approvalStatus = 200, refStatus = 200, throwAt = 0, oversize = false } = {}) {
  let calls = 0;
  const x = fixture();
  if (runMutate) runMutate(x.run);
  if (reviewsMutate) reviewsMutate(x.reviews);
  const fetchImpl = async (url, options) => {
    calls++; providerCalls++;
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer ' + TOKEN);
    if (throwAt === calls) throw Error('do not echo private token and account evidence');
    const prefix = 'https://api.github.com/repos/' + REPO + '/actions/runs/' + RUN;
    let status, payload;
    if (url === prefix) { status = runStatus; payload = x.run; }
    else if (url === prefix + '/approvals') { status = approvalStatus; payload = x.reviews; }
    else if (url === 'https://api.github.com/repos/' + REPO + '/git/ref/heads/paper-state') {
      status = refStatus; payload = {
        ref: 'refs/heads/paper-state', object: { type: 'commit', sha: headSha },
      };
    } else throw Error('unexpected path');
    return new Response(JSON.stringify(payload), { status, headers: oversize
      ? { 'content-length': String(128 * 1024 * 1024 + 1) } : {} });
  };
  return { fetchImpl, get calls() { return calls; } };
}
async function preflight(c, changes = {}) {
  const x = fixture();
  return inspectPaperCustodyReadOnlyPreflight({
    expected: x.expected, scope: x.scope, custodyConfig: x.custodyConfig,
    claim: x.claim, reviewedCodeSha256: x.reviewedCodeSha256,
    token: TOKEN, fetchImpl: c.fetchImpl, ...changes,
  });
}
const valid = client();
const ok = await preflight(valid);
assert.equal(valid.calls, 3);
verify({ ...fixture(), reviewEvidence: inspectGithubPaperReviewEvidence(fixture()) });
assert.equal(ok.status, 'HOLD_BOUNDARY_UNTRUSTED_NOT_AUTHORIZED');
assert.equal(ok.structuralBindingValid, true);
assert.equal(ok.operationalEligible, false);
assert.equal(ok.durableWriterVerified, false);
assert.equal(ok.stateMutationAuthorized, false);
checks += 7;
async function blocked(c, error, overrides = {}, expectedCalls) {
  const out = await preflight(c, overrides);
  assert.equal(out.status, 'DENY_RUNTIME_BOUNDARY_INVALID');
  assert.ok(out.findings.includes(error), JSON.stringify(out.findings));
  assert.equal(out.brokerSubmitAuthorized, false);
  assert.equal(out.stateMutationAuthorized, false);
  if (expectedCalls !== undefined) assert.equal(c.calls, expectedCalls);
  checks++;
}
const badRun = client({ runMutate: run => { run.head_sha = '8'.repeat(40); } });
await blocked(badRun, 'GITHUB_REVIEW_NOT_BOUND', {}, 1);
const missingReview = client({ reviewsMutate: r => r.splice(0) });
await blocked(missingReview, 'GITHUB_REVIEW_NOT_BOUND', {}, 2);
const deniedReview = client({ reviewsMutate: r => { r[0].state = 'rejected'; } });
await blocked(deniedReview, 'GITHUB_REVIEW_NOT_BOUND', {}, 2);
const duplicateReview = client({ reviewsMutate: r => r.push(structuredClone(r[0])) });
await blocked(duplicateReview, 'GITHUB_REVIEW_NOT_BOUND', {}, 2);
const staleHead = client({ headSha: PARENT });
await blocked(staleHead, 'REMOTE_HEAD_MISMATCH', {}, 3);
const absentHead = client({ refStatus: 404 });
await blocked(absentHead, 'REMOTE_REF_NOT_AVAILABLE', {}, 3);
const badRunStatus = client({ runStatus: 403 });
await blocked(badRunStatus, 'GITHUB_REVIEW_NOT_BOUND', {}, 1);
const badApprovalStatus = client({ approvalStatus: 403 });
await blocked(badApprovalStatus, 'GITHUB_REVIEW_NOT_BOUND', {}, 2);
const brokenNetwork = client({ throwAt: 3 });
await blocked(brokenNetwork, 'READ_ONLY_PREFLIGHT_FAILED', {}, 3);
const tooLargeRef = client({ oversize: true });
await blocked(tooLargeRef, 'GITHUB_REVIEW_NOT_BOUND', {}, 1);
const invalidToken = client();
await blocked(invalidToken, 'GITHUB_REVIEW_NOT_BOUND', { token: 'bad' }, 0);
const invalidScope = client();
await blocked(invalidScope, 'CROSS_SCOPE_RUN_BINDING_INVALID', { scope: { ...fixture().scope, attemptId: 'DIFFERENT' } }, 0);
const nullPreflight = await inspectPaperCustodyReadOnlyPreflight(null);
assert.equal(nullPreflight.status, 'DENY_RUNTIME_BOUNDARY_INVALID');
assert.equal(nullPreflight.brokerSubmitAuthorized, false);
checks += 2;
assert.ok(providerCalls > 0);
assert.ok(!JSON.stringify(ok).includes(TOKEN));
checks += 2;
console.log(JSON.stringify({
  status: 'OFFLINE_PAPER_CUSTODY_RUNTIME_BOUNDARY_PASS',
  checks, actualGithubRequests: 0, brokerRequests: 0,
  stateWrites: 0, executionAuthorityGranted: 0,
}));
