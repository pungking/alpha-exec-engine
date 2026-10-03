import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { readBytes, sourceJson } from './paper-exact-cache-private-export.mjs';
import { deliverNotifications } from './paper-order-notifications.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const safe = status => ({ status, eventCount: 0, brokerRequests: 0, orderMutation: false });

function allowed(env) {
  return ['schedule', 'repository_dispatch'].includes(env.GITHUB_EVENT_NAME) && env.GITHUB_REF === 'refs/heads/main'
    && env.GITHUB_WORKFLOW === 'sidecar-dry-run' && env.GITHUB_RUN_ATTEMPT === '1'
    && /^\d+$/.test(env.GITHUB_RUN_ID || '') && /^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')
    && ['DRY_RUN', 'PAPER'].includes(env.ALPHA_ENV) && env.ALPACA_BASE_URL === 'https://paper-api.alpaca.markets'
    && env.READ_ONLY === 'true' && env.EXEC_ENABLED === 'false' && env.LIVE_ORDER_SUBMIT_ENABLED === 'false'
    && ['', 'true'].includes(env.POSITION_LIFECYCLE_PREVIEW_ONLY ?? '') && env.MARKET_GUARD_MODE === 'observe'
    && ['GUARD_EXECUTE_TIGHTEN_STOPS', 'GUARD_EXECUTE_REDUCE_POSITIONS', 'GUARD_EXECUTE_FLATTEN'].every(key => env[key] === 'false');
}

export async function runNotificationDelivery({ env, stateDirectory, bindingDirectory, fetchImpl = fetch, now = Date.now() }) {
  if (!allowed(env)) return safe('AUTOMATIC_PAPER_OBSERVATION_REQUIRED');
  if (env.TELEGRAM_SEND_ENABLED === 'false') return safe('NOTIFICATION_DISABLED');
  if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_SIMULATION_CHAT_ID) return safe('SIMULATION_ROUTE_NOT_CONFIGURED');
  try {
    if (fs.existsSync(`${bindingDirectory}.failed-attempt.json`) || fs.existsSync(path.join(bindingDirectory, 'duplicate-attempt.json'))) return safe('SOURCE_BINDING_INVALID');
    const receipt = sourceJson(readBytes(path.join(bindingDirectory, 'performance.end.json'), undefined, true));
    const bytes = readBytes(path.join(stateDirectory, 'performance-dashboard.json'));
    const report = sourceJson(bytes), snapshot = report.notificationSnapshot;
    if (receipt.status !== 'COMPLETE' || receipt.phase !== 'performance' || receipt.producerExitCode !== 0
        || receipt.run?.runId !== env.GITHUB_RUN_ID || receipt.run?.runAttempt !== 1 || receipt.run?.headSha !== env.GITHUB_SHA
        || receipt.run?.event !== env.GITHUB_EVENT_NAME || receipt.run?.brokerEnvironment !== 'PAPER'
        || receipt.run?.executionEnvironment !== env.ALPHA_ENV
        || receipt.outputs?.['performance-dashboard.json'] !== sha(bytes)
        || receipt.previousOutputs?.['performance-dashboard.json'] === sha(bytes)
        || snapshot?.sourceRunId !== env.GITHUB_RUN_ID || snapshot?.headSha !== env.GITHUB_SHA
        || snapshot?.observedAt !== report.generatedAt
        || !(Date.parse(receipt.startedAt) <= Date.parse(report.generatedAt) && Date.parse(report.generatedAt) <= Date.parse(receipt.finishedAt)
          && Date.parse(receipt.finishedAt) <= now)) return safe('SOURCE_BINDING_INVALID');
    for (const name of ['order-ledger.json', 'order-idempotency.json']) {
      const hash = sha(readBytes(path.join(stateDirectory, name)));
      if (receipt.inputs?.[name] !== hash || receipt.inputsAfter?.[name] !== hash) return safe('SOURCE_BINDING_INVALID');
    }
    return await deliverNotifications({ snapshot, receiptPath: path.join(stateDirectory, 'paper-order-notification-receipts.json'),
      send: async text => {
        // One attempt only. Never propagate Telegram response bodies or token-bearing URLs.
        const response = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ chat_id: env.TELEGRAM_SIMULATION_CHAT_ID, text, disable_web_page_preview: 'true' })
        });
        if (!response.ok) return { ok: false };
        const body = await response.json();
        return { ok: body?.ok === true && Number.isSafeInteger(body?.result?.message_id) && body.result.message_id > 0 };
      } });
  } catch { return safe('NOTIFICATION_EVIDENCE_REJECTED'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runNotificationDelivery({ env: process.env, stateDirectory: path.resolve('state'),
    bindingDirectory: path.join(process.env.RUNNER_TEMP || '', 'paper-runtime-binding') });
  // The enclosing private shell wrapper publishes only its exit code; this is aggregate-only too.
  console.log(JSON.stringify(result));
  if (!['DELIVERED', 'NO_CHANGE', 'BASELINE_RECORDED', 'NOTIFICATION_DISABLED', 'SIMULATION_ROUTE_NOT_CONFIGURED'].includes(result.status)) process.exitCode = 1;
}
