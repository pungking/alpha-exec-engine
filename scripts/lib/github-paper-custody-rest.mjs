/**
 * STEP 5C-4D-3A — opt-in GitHub Git REST boundary for existing encrypted
 * PAPER custody transport. NOT an admission gate and NOT an executable job.
 *
 * No default credentials, network client, env reads, dispatcher or state-branch
 * creation. The caller must inject both a token and a fetch implementation.
 * Deployment / writer exclusion / P0 qualification are separate obligations.
 */
const MAX_HTTP_BYTES = 128 * 1024 * 1024;
const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const safe = (ok, reason) => { if (!ok) throw Error('GITHUB_CUSTODY_REST_' + reason); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const shape = (value, keys) => object(value) && Object.keys(value).sort().join('|') === keys.slice().sort().join('|');

function validateRoute(prefix, method, path, body) {
  safe(typeof path === 'string' && path.startsWith(prefix), 'ROUTE_INVALID');
  const suffix = path.slice(prefix.length);
  if (method === 'GET') {
    safe(body === undefined
      && (suffix === 'ref/heads/paper-state'
        || /^(?:commits|trees|blobs)\/[0-9a-f]{40}$/.test(suffix)), 'ROUTE_INVALID');
  } else if (method === 'POST') {
    safe(suffix === 'blobs' || suffix === 'trees' || suffix === 'commits', 'ROUTE_INVALID');
    if (suffix === 'blobs') {
      safe(shape(body, ['content', 'encoding']) && body.encoding === 'base64'
        && typeof body.content === 'string' && body.content.length > 0
        && body.content.length <= MAX_HTTP_BYTES, 'PAYLOAD_INVALID');
    } else if (suffix === 'trees') {
      safe(shape(body, ['tree']) && Array.isArray(body.tree) && body.tree.length === 1
        && shape(body.tree[0], ['path', 'mode', 'type', 'sha'])
        && body.tree[0].path === 'checkpoint.enc.json' && body.tree[0].mode === '100644'
        && body.tree[0].type === 'blob' && SHA.test(body.tree[0].sha), 'PAYLOAD_INVALID');
    } else {
      safe(shape(body, ['message', 'tree', 'parents'])
        && body.message === 'PAPER encrypted checkpoint' && SHA.test(body.tree)
        && Array.isArray(body.parents) && body.parents.length === 1
        && SHA.test(body.parents[0]), 'PAYLOAD_INVALID');
    }
  } else if (method === 'PATCH') {
    safe(suffix === 'refs/heads/paper-state' && shape(body, ['sha', 'force'])
      && SHA.test(body.sha) && body.force === false, 'ROUTE_INVALID');
  } else safe(false, 'METHOD_INVALID');
}

/**
 * Returns the bounded request callback expected by openGithubCustody.
 *
 * The repository/token/client supplied here are not source attestation or
 * permission evidence; only an already approved, isolated workflow can ever
 * provide operational entitlements. Nothing automatically invokes this API.
 */
export function createGithubPaperCustodyRestRequest({ repository, token, fetchImpl } = {}) {
  safe(REPO.test(repository) && !repository.split('/').some(x => x === '.' || x === '..')
    && typeof token === 'string'
    && token.length >= 8 && token.length <= 4096 && /^[\x21-\x7e]+$/.test(token)
    && typeof fetchImpl === 'function', 'CONFIG_INVALID');
  const prefix = '/repos/' + repository + '/git/';
  const fixedHeaders = Object.freeze({
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json',
  });
  return async function request({ method, path, body, signal } = {}) {
    try {
      validateRoute(prefix, method, path, body);
      safe(signal && typeof signal.aborted === 'boolean'
        && typeof signal.addEventListener === 'function' && !signal.aborted, 'SIGNAL_INVALID');
      const content = body === undefined ? undefined : JSON.stringify(body);
      safe(content === undefined || Buffer.byteLength(content, 'utf8') <= MAX_HTTP_BYTES, 'PAYLOAD_TOO_LARGE');
      const res = await fetchImpl('https://api.github.com' + path, {
        method, headers: fixedHeaders, body: content, signal, redirect: 'error',
      });
      safe(Number.isInteger(res?.status) && res.status >= 100 && res.status <= 599
        && typeof res.text === 'function', 'RESPONSE_INVALID');
      const length = res.headers?.get?.('content-length');
      safe(length === null || length === undefined
        || /^\d+$/.test(length) && Number(length) <= MAX_HTTP_BYTES, 'RESPONSE_TOO_LARGE');
      const text = await res.text();
      safe(typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= MAX_HTTP_BYTES, 'RESPONSE_TOO_LARGE');
      let data;
      try { data = JSON.parse(text); } catch { throw Error('GITHUB_CUSTODY_REST_RESPONSE_INVALID'); }
      safe(object(data), 'RESPONSE_INVALID');
      return Object.freeze({ status: res.status, data });
    } catch (error) {
      // Never surface raw HTTP response, remote URL, token or caller payload.
      throw Error(/^GITHUB_CUSTODY_REST_[A-Z_]+$/.test(error?.message)
        ? error.message : 'GITHUB_CUSTODY_REST_REQUEST_FAILED');
    }
  };
}
