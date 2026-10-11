import { createHash } from 'node:crypto';
import { BUDGET } from './scoped-closeout-contract.mjs';
import { decimalRatio, compare } from './closeout-decimal.mjs';

const PAPER = 'https://paper-api.alpaca.markets', DATA = 'https://data.alpaca.markets';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) => object(v) && Object.keys(v).sort().join(' ') === keys.split(' ').filter(Boolean).sort().join(' ');
const check = (ok, code) => { if (!ok) throw Error(code); };
const id = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,96}$/.test(v);
const symbol = v => typeof v === 'string' && /^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(v);
const decimal = v => typeof v === 'string' && /^(0|[1-9]\d{0,15})(\.\d{1,9})?$/.test(v) && Number(v) > 0;
const receipts = new WeakSet();
const freeze = value => { if (object(value) || Array.isArray(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const isScopedPaperReceipt = value => receipts.has(value);
const seal = value => { freeze(value); receipts.add(value); return value; };
const phases = { account: ['account'], initial: ['positions', 'orders', 'clock', 'calendar', 'assets', 'quotes'],
  presubmit: ['account', 'positions', 'orders', 'clock', 'assets', 'quotes'], postcheck: ['lookup', 'positions', 'orders', 'clock'], submit: ['submit'] };

function route(request) {
  const { group, phase, routeInput: r, body } = request;
  check(exact(request, body === undefined ? 'group phase routeInput' : 'group phase routeInput body')
    && Object.hasOwn(phases, phase) && phases[phase].includes(group), 'ROUTE_INVALID');
  let endpoint;
  if (['account', 'positions', 'clock', 'orders', 'submit'].includes(group)) {
    check(exact(r, ''), 'ROUTE_INVALID');
    endpoint = group === 'orders' ? '/v2/orders?status=open&limit=500&nested=true' : `/v2/${group === 'submit' ? 'orders' : group}`;
  } else if (group === 'calendar') {
    check(exact(r, 'session') && /^\d{4}-\d\d-\d\d$/.test(r.session), 'ROUTE_INVALID');
    endpoint = `/v2/calendar?start=${r.session}&end=${r.session}`;
  } else if (group === 'assets' || group === 'lookup') {
    const key = group === 'assets' ? 'assetId' : 'clientOrderId';
    check(exact(r, key) && id(r[key]), 'ROUTE_INVALID');
    endpoint = group === 'assets' ? `/v2/assets/${encodeURIComponent(r.assetId)}`
      : `/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(r.clientOrderId)}`;
  } else {
    check(group === 'quotes' && exact(r, 'symbols') && Array.isArray(r.symbols) && r.symbols.length > 0
      && r.symbols.length <= 5 && r.symbols.every(symbol) && new Set(r.symbols).size === r.symbols.length, 'ROUTE_INVALID');
    endpoint = `/v2/stocks/quotes/latest?symbols=${encodeURIComponent(r.symbols.join(','))}&feed=sip&currency=USD`;
  }
  if (group === 'submit') check(exact(body, 'symbol qty side type time_in_force limit_price client_order_id extended_hours')
    && symbol(body.symbol) && decimal(body.qty) && decimal(body.limit_price) && id(body.client_order_id) && body.client_order_id.length <= 48
    && body.side === 'sell' && body.type === 'limit' && body.time_in_force === 'day' && body.extended_hours === false, 'ORDER_INVALID');
  else check(body === undefined, 'ROUTE_INVALID');
  return { url: (group === 'quotes' ? DATA : PAPER) + endpoint, method: group === 'submit' ? 'POST' : 'GET' };
}

export function createScopedPaperTransport({ credentials, fetchImpl, clock, deadlineMs, beforeSubmit }) {
  check(typeof fetchImpl === 'function' && typeof clock?.now === 'function' && typeof clock?.monotonicMs === 'function'
    && Number.isFinite(deadlineMs) && deadlineMs > 0 && deadlineMs <= 300000, 'TRANSPORT_CONFIG_INVALID');
  check(exact(credentials, 'key secret') && [credentials.key, credentials.secret].every(v => typeof v === 'string' && v.trim()), 'CREDENTIALS_MISSING');
  const headers = Object.freeze({ 'APCA-API-KEY-ID': credentials.key, 'APCA-API-SECRET-KEY': credentials.secret });
  const counts = Object.fromEntries(Object.keys(BUDGET).map(k => [k, 0]));
  const start = clock.monotonicMs(); let stopped = false, active = null;
  return Object.freeze({
    counts: () => Object.freeze({ ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0) }),
    async request(input) {
      let timer, reader, complete = false, responseSha256 = null, bytes = 0, status = null, requestedAt = null, retrievedAt = null, durationMs = 0;
      let group = null, phase = null, abort;
      try {
        check(!stopped, 'TRANSPORT_STOPPED');
        if (active) { active.abort(); check(false, 'CONCURRENT_REQUEST'); }
        const request = structuredClone(input), target = route(request);
        ({ group, phase } = request);
        check(counts[group] < BUDGET[group], 'REQUEST_BUDGET_EXCEEDED');
        const before = clock.monotonicMs(); requestedAt = clock.now();
        check(Number.isFinite(before) && Number.isFinite(start) && before >= start && before - start < deadlineMs
          && Number.isFinite(Date.parse(requestedAt)), 'CLOCK_INVALID');
        abort = new AbortController(); active = abort;
        if (group === 'submit') check(typeof beforeSubmit === 'function' && await beforeSubmit(Object.freeze(request.body)) === true, 'SUBMIT_GATE_REQUIRED');
        check(!stopped && !abort.signal.aborted, 'TRANSPORT_STOPPED');
        const dispatchAt = clock.monotonicMs();
        check(Number.isFinite(dispatchAt) && dispatchAt >= before, 'CLOCK_INVALID');
        check(dispatchAt - start < deadlineMs, 'ATTEMPT_EXPIRED');
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
          abort.abort(); reject(Error('REQUEST_TIMEOUT'));
        }, Math.min(3000, deadlineMs - (before - start))); });
        counts[group]++;
        const work = async () => {
          const response = await fetchImpl(target.url, { method: target.method, redirect: 'error', signal: abort.signal,
            headers: { ...headers, ...(group === 'submit' ? { 'Content-Type': 'application/json' } : {}) },
            ...(group === 'submit' ? { body: JSON.stringify(request.body) } : {}) });
          check(!abort.signal.aborted, 'REQUEST_TIMEOUT');
          status = response.status;
          check(!response.redirected && (!response.url || response.url === target.url) && status >= 200 && status < 300, 'HTTP_FAILURE');
          check(response.body && typeof response.body.getReader === 'function', 'BODY_INVALID');
          reader = response.body.getReader(); const chunks = [];
          while (true) {
            const chunk = await reader.read(); check(!abort.signal.aborted, 'REQUEST_TIMEOUT');
            if (chunk.done) break;
            bytes += chunk.value.byteLength; check(bytes <= 8388608, 'RESPONSE_TOO_LARGE'); chunks.push(Buffer.from(chunk.value));
          }
          check(bytes > 0, 'BODY_INVALID');
          const raw = Buffer.concat(chunks); complete = true;
          responseSha256 = createHash('sha256').update(raw).digest('hex');
          let data;
          try {
            const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
            data = JSON.parse(text);
            // Preserve money semantics: reject numbers JSON.parse would silently round.
            for (const token of text.matchAll(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)) {
              if (token[0][0] === '"') continue;
              check(Number.isFinite(Number(token[0])) && compare(decimalRatio(token[0].toLowerCase()), decimalRatio(String(Number(token[0])))) === 0, 'JSON_INVALID');
            }
          }
          catch { throw Error('JSON_INVALID'); }
          return data;
        };
        const data = await Promise.race([work(), timeout]);
        retrievedAt = clock.now(); durationMs = clock.monotonicMs() - before;
        check(!abort.signal.aborted && durationMs >= 0 && durationMs <= 3000
          && Date.parse(retrievedAt) >= Date.parse(requestedAt), 'CLOCK_INVALID');
        return seal({ group, phase, status, complete, bytes, responseSha256, requestedAt, retrievedAt, durationMs, data, error: null });
      } catch (error) {
        stopped = true; abort?.abort();
        const codes = ['ROUTE_INVALID', 'ORDER_INVALID', 'REQUEST_BUDGET_EXCEEDED', 'CLOCK_INVALID', 'ATTEMPT_EXPIRED',
          'REQUEST_TIMEOUT', 'HTTP_FAILURE', 'BODY_INVALID', 'RESPONSE_TOO_LARGE', 'JSON_INVALID', 'SUBMIT_GATE_REQUIRED', 'TRANSPORT_STOPPED', 'CONCURRENT_REQUEST'];
        return seal({ group, phase, status, complete, bytes, responseSha256, requestedAt, retrievedAt, durationMs, data: null,
          error: codes.includes(error?.message) ? error.message : 'TRANSPORT_FAILURE' });
      } finally {
        clearTimeout(timer);
        // Cancellation is best effort after the receipt is sealed; it cannot authorize another call.
        if (reader) { void reader.cancel().catch(() => {}); }
        if (active === abort) active = null;
      }
    },
  });
}
