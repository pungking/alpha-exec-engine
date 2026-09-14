import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const sourceHashes = {};
const sourceGeneratedAt = {};
const read = (name) => {
  sourceHashes[name] = null;
  try {
    const raw = fs.readFileSync(path.join("state", name));
    sourceHashes[name] = createHash("sha256").update(raw).digest("hex");
    const parsed = JSON.parse(raw.toString("utf8"));
    const stamp = parsed?.generatedAt;
    sourceGeneratedAt[name] = typeof stamp === "string"
      && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(stamp)
      && Number.isFinite(Date.parse(stamp)) ? stamp : null;
    return parsed;
  } catch {
    sourceGeneratedAt[name] = null;
    return null;
  }
};
// Only fixed field names and typed aggregates cross the public boundary.
const counts = (source, names) => Object.fromEntries(names.map((key) => [key,
  Number.isSafeInteger(source?.[key]) && source[key] >= 0 ? source[key] : null,
]));
const bool = (value) => typeof value === "boolean" ? value : null;
const validated = (value, regex) => typeof value === "string" && regex.test(value) ? value : null;
const readiness = read("live-readiness-scorecard.json");
const preview = read("last-dry-exec-preview.json");
const protection = read("position-protection-root-cause-audit.json");
const performance = read("performance-dashboard-public.json");
const evidence = {
  schemaVersion: "sidecar-public-evidence-v1",
  runId: validated(process.env.GITHUB_RUN_ID, /^\d+$/),
  headSha: validated(process.env.GITHUB_SHA, /^[a-f0-9]{40}$/),
  status: readiness && preview && protection && performance ? "AGGREGATE_AVAILABLE" : "SOURCE_INCOMPLETE",
  sourceHashes,
  sourceGeneratedAt,
  paperExit: counts(readiness?.paperExitReadiness?.summary, [
    "filledPositionRows", "evaluatedPositionRows", "exitShadowNotDueRows", "exitShadowReadyReportOnlyRows",
    "exitShadowBlockedProtectionRows", "exitShadowBlockedOwnershipRows", "exitShadowBlockedLedgerOrIdempotencyRows",
    "exitShadowBlockedTerminalReconciliationRows", "exitShadowBlockedMarketSessionRows", "exitShadowEvidenceIncompleteRows",
    "unresolvedHeldIdentityRows", "activePositionLimitedControlRows", "unknownRows", "selectedCandidateCount",
  ]),
  lifecycle: counts(readiness?.entryOrderLifecycle?.summary, [
    "totalLifecycleRows", "entryEvidenceRows", "exitEvidenceRows", "filledCompleteRows", "closedLoopRows",
    "terminalLedgerMismatchRows", "realizedPnlVerifiedRows", "duplicateOpenRows", "idempotencyConflictRows", "unclassifiedRows",
  ]),
  protection: counts(protection?.summary, [
    "positions", "brokerStopMissing", "brokerTargetMissing", "guardMetadataMissing", "guardMetadataStale",
    "invalidGeometry", "fillStateReconciliationRequired", "positionOwnershipReviewRequired", "unclassifiedRows",
  ]),
  realizedPnl: counts(performance?.realizedPnl?.summary, [
    "totalRows", "verifiedRows", "exitFillEvidenceIncompleteRows", "terminalReconciliationRequiredRows",
    "costDoubleCountViolationRows", "unknownRows",
  ]),
  safety: {
    readOnly: bool(preview?.mode?.readOnly),
    execEnabled: bool(preview?.mode?.execEnabled),
    ...counts(preview?.brokerSubmission, ["attempted", "submitted"]),
    shadowWouldCreateBrokerPayload: bool(preview?.paperExitShadowIntent?.wouldCreateBrokerPayload),
    marketSessionOpen: bool(preview?.paperExitShadowIntent?.marketSessionEvidence?.marketOpen),
  },
  rawStatePublished: false,
  privateIdentifiersPublished: false,
};

try {
  if (!process.env.RUNNER_TEMP) throw new Error("runner_temp_required");
  const dir = path.join(process.env.RUNNER_TEMP, "sidecar-public-evidence");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "evidence.json");
  const text = JSON.stringify(evidence, null, 2) + "\n";
  fs.writeFileSync(file + ".tmp", text, { mode: 0o600 });
  fs.renameSync(file + ".tmp", file);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Sidecar aggregate evidence\n\n\`\`\`json\n${text}\`\`\`\n`);
  }
  console.log(`[SIDECAR_PUBLIC_EVIDENCE] status=${evidence.status} rawStatePublished=false`);
} catch {
  console.error("[SIDECAR_PUBLIC_EVIDENCE] publication_failed");
  process.exitCode = 1;
}
