#!/usr/bin/env node
import fs from 'node:fs';

const checks = [];
const add = (id, status, detail) => checks.push({ id, status, detail });
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

const index = read('src/index.ts');
const guard = read('src/market-guard.ts');
const workflows = ['.github/workflows/dry-run.yml', '.github/workflows/market-guard.yml', '.github/workflows/payload-probe-isolated.yml']
  .map((file) => `${file}\n${read(file)}`)
  .join('\n---\n');
const docs = read('README.md');

add(
  'sidecar_no_telegram_chat_id_primary_route',
  !/TELEGRAM_CHAT_ID/.test(index + guard + workflows) ? 'PASS' : 'FAIL',
  'Sidecar must not use the web-app primary TELEGRAM_CHAT_ID for any dry-run, monitor, or error message.'
);
add(
  'sidecar_alert_no_primary_fallback',
  !/TELEGRAM_ALERT_CHAT_ID\s*\|\|[\s\S]{0,120}TELEGRAM_PRIMARY_CHAT_ID/.test(index + guard) ? 'PASS' : 'FAIL',
  'Sidecar alerts must route to alert then simulation only, never primary.'
);
add(
  'sidecar_workflows_no_primary_env',
  !/TELEGRAM_PRIMARY_CHAT_ID/.test(workflows) ? 'PASS' : 'FAIL',
  'Sidecar workflows must not inject primary chat env into execution-adjacent jobs.'
);
add(
  'sidecar_docs_no_primary_chat_config',
  !/TELEGRAM_PRIMARY_CHAT_ID/.test(docs) && !/TELEGRAM_CHAT_ID/.test(docs) ? 'PASS' : 'FAIL',
  'Sidecar docs must not instruct operators to configure a primary analysis chat route.'
);
add(
  'sidecar_simulation_route_present',
  /TELEGRAM_SIMULATION_CHAT_ID/.test(index + guard + workflows) ? 'PASS' : 'FAIL',
  'Dry-run, guard, and monitor notifications must retain simulation routing.'
);
add(
  'sidecar_alert_route_present',
  /TELEGRAM_ALERT_CHAT_ID/.test(index + guard + workflows) ? 'PASS' : 'FAIL',
  'Failure notifications must retain alert routing.'
);

const fail = checks.filter((check) => check.status === 'FAIL').length;
const warn = checks.filter((check) => check.status === 'WARN').length;
const report = {
  generatedAt: new Date().toISOString(),
  overall: fail ? 'fail' : warn ? 'warn' : 'pass',
  policy: 'primary_analysis_only_simulation_for_monitoring_alert_for_errors',
  brokerMutation: false,
  stateMutation: false,
  checks
};
fs.mkdirSync('state', { recursive: true });
fs.writeFileSync('state/telegram-routing-policy-audit.json', `${JSON.stringify(report, null, 2)}\n`);
const md = [
  '# Telegram Routing Policy Audit',
  '',
  `- overall: **${report.overall}**`,
  `- policy: ${report.policy}`,
  '- brokerMutation: false',
  '- stateMutation: false',
  '',
  '| Check | Status | Detail |',
  '| --- | --- | --- |',
  ...checks.map((check) => `| ${check.id} | ${check.status} | ${check.detail} |`)
];
fs.writeFileSync('state/telegram-routing-policy-audit.md', `${md.join('\n')}\n`);
console.log(`[TELEGRAM_ROUTING_AUDIT] overall=${report.overall} checks=${checks.length} json=state/telegram-routing-policy-audit.json`);
if (fail) process.exit(1);
