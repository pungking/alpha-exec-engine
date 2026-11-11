/**
 * STEP 5C-4D-3B: read-only GitHub-side workflow review evidence.
 *
 * This is deliberately NOT an authorization provider. A matching GitHub
 * review history cannot verify the active job environment, current account
 * scope, exclusive writer, source quality or broker permissions.
 *
 * No default fetch, token or runner context. No mutations or dispatch.
 */
const REPOSITORY = 'pungking/alpha-exec-engine';
const ENVIRONMENT = 'PAPER_CUSTODY_APPROVAL';
const ENVIRONMENT_ID = 26847620868;
const REVIEWER = 'pungking';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const RUN = /^[1-9][0-9]{0,15}$/;
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const WORKFLOWS = Object.freeze(new Set([
  '.github/workflows/paper-oco-submit-canary.yml',
  '.github/workflows/persistent-oco-repair-submit.yml',
  '.github/workflows/ledger-filled-migration.yml',
  '.github/workflows/paper-five-row-active-limited-state-recovery.yml',
]));
const fail = reason => { throw Error('GITHUB_PAPER_REVIEW_' + reason); };
const valid = (condition, reason) => { if (!condition) fail(reason); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const result = (findings, match = false) => Object.freeze({
  schemaVersion: 'github-paper-review-evidence-v1',
  status: findings.length ? 'DENY_REVIEW_EVIDENCE_INVALID' : 'HOLD_REVIEW_EVIDENCE_NOT_OPERATIONAL_AUTHORITY',
  findings: Object.freeze([...new Set(findings)].sort()),
  reviewHistoryBound: !findings.length && match,
  environmentConfigurationVerified: false,
  custodyScopeVerified: false,
  writerClaimVerified: false,
  brokerSubmitAuthorized: false,
  stateMutationAuthorized: false,
  operationalEligible: false,
});
function expectedValid(e) {
  return object(e) && Object.keys(e).sort().join(',') ===
    ['runId', 'codeSha', 'workflowPath', 'accountScopeSha256'].sort().join(',')
    && typeof e.runId === 'string' && RUN.test(e.runId) && Number.isSafeInteger(Number(e.runId))
    && typeof e.codeSha === 'string' && SHA40.test(e.codeSha)
    && typeof e.workflowPath === 'string' && WORKFLOWS.has(e.workflowPath)
    && typeof e.accountScopeSha256 === 'string' && SHA64.test(e.accountScopeSha256);
}

function runMatches(expected, run) {
  return object(run)
    && String(run.id) === expected.runId && run.run_attempt === 1
    && run.event === 'workflow_dispatch' && run.head_branch === 'main'
    && run.head_sha === expected.codeSha && run.path === expected.workflowPath
    && run.repository?.full_name === REPOSITORY
    && run.head_repository?.full_name === REPOSITORY
    && Array.isArray(run.pull_requests) && run.pull_requests.length === 0;
}
/**
 * Pure diagnostic for API-shaped evidence. Caller-supplied objects are NOT
 * authenticated, and every outcome remains HOLD or DENY.
 */
export function inspectGithubPaperReviewEvidence({ expected, run, reviews } = {}) {
  const findings = [];
  if (!expectedValid(expected)) return result(['EXPECTED_BOUNDARY_INVALID']);
  if (!runMatches(expected, run)) findings.push('RUN_BOUNDARY_INVALID');
  if (!Array.isArray(reviews) || reviews.length > 100) {
    findings.push('REVIEW_HISTORY_INVALID');
    return result(findings);
  }
  let approvals = 0, rejections = 0;
  for (const entry of reviews) {
    if (!object(entry) || !Array.isArray(entry.environments)) {
      findings.push('REVIEW_HISTORY_INVALID'); continue;
    }
    const matched = entry.environments.some(e =>
      object(e) && e.id === ENVIRONMENT_ID && e.name === ENVIRONMENT);
    if (!matched) continue;
    if (entry.state === 'rejected') { rejections++; continue; }
    if (entry.state === 'approved' && entry.user?.login === REVIEWER
      && Number.isSafeInteger(entry.user?.id) && entry.user.id > 0) {
      approvals++; continue;
    }
    findings.push('REVIEWER_OR_STATE_INVALID');
  }
  if (rejections) findings.push('REVIEW_REJECTED');
  if (approvals !== 1) findings.push('REVIEW_COUNT_INVALID');
  return result(findings, approvals === 1);
}

function safeBytes(value, reason) {
  valid(typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= MAX_RESPONSE_BYTES, reason);
}
/**
 * Read the exact run and its review history through explicitly injected HTTPS
 * transport. The authenticated REST result is evidence, not an execution token.
 * No automatic retries, no environment/secret edits and no POST/PATCH/DELETE.
 */
export async function readGithubPaperReviewEvidence({ expected, token, fetchImpl } = {}) {
  try {
    valid(expectedValid(expected) && typeof token === 'string'
      && token.length >= 8 && token.length <= 4096 && /^[\x21-\x7e]+$/.test(token)
      && typeof fetchImpl === 'function', 'CONFIG_INVALID');
    const prefix = 'https://api.github.com/repos/' + REPOSITORY
      + '/actions/runs/' + expected.runId;
    const headers = Object.freeze({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: 'Bearer ' + token,
    });
    async function get(suffix) {
      const uri = prefix + suffix;
      const response = await fetchImpl(uri, {
        method: 'GET', headers, redirect: 'error', cache: 'no-store',
      });
      valid(response?.status === 200 && typeof response.body?.getReader === 'function',
        'RESPONSE_INVALID');
      const length = response.headers?.get?.('content-length');
      valid(length == null || /^\d+$/.test(length) && Number(length) <= MAX_RESPONSE_BYTES,
        'RESPONSE_TOO_LARGE');
      let total = 0; const chunks = [], reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          valid(value instanceof Uint8Array, 'RESPONSE_INVALID');
          total += value.byteLength;
          valid(total <= MAX_RESPONSE_BYTES, 'RESPONSE_TOO_LARGE');
          chunks.push(Buffer.from(value));
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }
      const data = Buffer.concat(chunks, total).toString('utf8');
      safeBytes(data, 'RESPONSE_TOO_LARGE');
      let json;
      try { json = JSON.parse(data); } catch { fail('JSON_INVALID'); }
      return json;
    }
    const run = await get('');
    // Validate the exact workflow/run identity before reading review history.
    valid(runMatches(expected, run), 'RUN_BOUNDARY_INVALID');
    const reviews = await get('/approvals');
    return inspectGithubPaperReviewEvidence({ expected, run, reviews });
  } catch (error) {
    // Raw API bodies, tokens and provider error messages must never escape.
    const code = /^GITHUB_PAPER_REVIEW_[A-Z_]+$/.test(error?.message)
      ? error.message.slice('GITHUB_PAPER_REVIEW_'.length) : 'REQUEST_FAILED';
    return result([code]);
  }
}
