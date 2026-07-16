#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const STATE_DIR = process.env.BLOCKER_REDUCTION_STATE_DIR || process.env.STATE_DIR || "state";
const OUTPUT_JSON = path.join(STATE_DIR, "protection-blocker-reduction-plan.json");
const OUTPUT_MD = path.join(STATE_DIR, "protection-blocker-reduction-plan.md");

const readJson = (name, fallback = {}) => {
  const filePath = path.join(STATE_DIR, name);
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return { __readError: String(error?.message || error), __fileName: name };
  }
};

const writeAtomic = (filePath, text) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, filePath);
};

const rows = (report) => Array.isArray(report?.rows) ? report.rows : Array.isArray(report?.records) ? report.records : [];
const bool = (value) => value === true || value === "true";
const sym = (value) => String(value || "").trim().toUpperCase();
const uniqueSymbols = (items) => [...new Set(items.map((item) => sym(item?.symbol || item)).filter(Boolean))].sort();
const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const optionalCount = (value) => value === null || value === undefined || value === ""
  ? null
  : Number.isFinite(Number(value)) ? Number(value) : null;
const short = (value, max = 240) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const RECOVERY_STATUSES = new Set([
  "CURRENT_SOURCE_FRESH",
  "RECOVERY_SOURCE_READY_REPORT_ONLY",
  "RECOVERY_SOURCE_MATERIALIZATION_REQUIRED",
  "NO_FRESH_SOURCE_AVAILABLE",
  "RECOVERY_SOURCE_INVALID_GEOMETRY",
]);

function makeItem({
  id,
  currentStatus,
  rows: itemRows = [],
  count = uniqueSymbols(itemRows).length,
  nextSafeAction,
  requiredApprovalPhrase = "N/A",
  evidence,
  priority,
}) {
  return {
    id,
    currentStatus,
    count,
    affectedSymbols: uniqueSymbols(itemRows).slice(0, 20),
    nextSafeAction,
    requiredApprovalPhrase,
    mutationAllowed: false,
    priority,
    evidence: short(evidence, 500),
  };
}

function buildReport() {
  const live = readJson("live-readiness-scorecard.json");
  const protection = readJson("position-protection-root-cause-audit.json");
  const child = readJson("broker-child-order-reconciliation.json");
  const guarded = readJson("guarded-child-order-repair-plan.json");
  const persistent = readJson("persistent-oco-repair-plan.json");
  const lineage = readJson("guard-metadata-lineage-audit.json");
  const recovery = readJson("guard-source-recovery-plan.json");
  const fill = readJson("fill-state-reconciliation-audit.json");
  const terminal = readJson("ledger-terminalization-proposal.json");
  const ownershipDecision = readJson("position-ownership-recovery-decision.json");
  const ownership = readJson("position-ownership-state-migration-review-plan.json");
  const opsHealth = readJson("ops-health-report.json");

  const brokerSignals = [
    live?.brokerMutationAttempted,
    live?.brokerMutationSubmitted,
    child?.summary?.brokerMutationAttempted,
    child?.summary?.brokerMutationSubmitted,
    guarded?.summary?.brokerMutationAttempted,
    guarded?.summary?.brokerMutationSubmitted,
    persistent?.summary?.brokerMutationAttempted,
    persistent?.summary?.brokerMutationSubmitted,
    lineage?.summary?.brokerMutationAttempted,
    lineage?.summary?.brokerMutationSubmitted,
    lineage?.summary?.stateMutationAttempted,
    recovery?.summary?.brokerMutationAttempted,
    recovery?.summary?.brokerMutationSubmitted,
    recovery?.summary?.stateMutationAttempted,
    fill?.summary?.brokerMutationAttempted,
    fill?.summary?.brokerMutationSubmitted,
    fill?.summary?.stateMutationAttempted,
    terminal?.summary?.brokerMutationAttempted,
    terminal?.summary?.brokerMutationSubmitted,
    ownership?.summary?.brokerMutationAttempted,
    ownership?.summary?.brokerMutationSubmitted,
  ];
  const stateSignals = [
    live?.stateMutationAttempted,
    live?.stateMutationSubmitted,
    lineage?.summary?.stateMutationAttempted,
    recovery?.summary?.stateMutationAttempted,
    fill?.summary?.stateMutationAttempted,
    terminal?.summary?.stateMutationAttempted,
    ownership?.summary?.stateMutationAttempted,
    ownership?.summary?.stateMutationApplied,
  ];

  const childRows = rows(child);
  const protectionRows = rows(protection);
  const recoveryRows = rows(recovery);
  const persistentRows = rows(persistent);
  const lineageRows = rows(lineage);
  const fillRows = rows(fill);
  const terminalRows = rows(terminal);
  const ownershipDecisionRows = rows(ownershipDecision);
  const ownershipRows = rows(ownership);

  const alreadyProtected = childRows.filter((row) => row.protectionStatus === "BROKER_CHILDREN_PRESENT_OR_NOT_REQUIRED");
  const guardedReportOnlyCandidates = rows(guarded).filter((row) => row.readiness === "CANDIDATE_BLOCKED_REPORT_ONLY");
  const childRepairCandidates = persistentRows.filter((row) =>
    row.protectionLane === "MANUAL_APPROVAL_CANDIDATE" && row.repairEligible === true
  );
  const childForbiddenFill = childRows.filter((row) => row.fillStateReconciliation?.repairBlocked === true);
  const childForbiddenOwnership = childRows.filter((row) => row.ownershipClassification === "EXTERNAL_OR_MANUAL_POSITION");
  const childFreshSourceWait = recoveryRows.filter((row) => String(row.recoveryDecision || "").startsWith("FRESH_SOURCE_REQUIRED"));
  const childInvalidOrStale = childRows.filter((row) =>
    row.protectionStatus !== "BROKER_CHILDREN_PRESENT_OR_NOT_REQUIRED" &&
    (row.guardGeometryInvalid || row.guardMetadataMissing || row.staleStateMetadataIgnored)
  );

  const missingSource = lineageRows.filter((row) => row.rootCause === "NO_SOURCE_WITH_STOP_TARGET");
  const staleSource = lineageRows.filter((row) => row.rootCause === "SOURCE_AGE_EXCEEDED");
  const freshReview = recoveryRows.filter((row) => row.repairEligibleNow || row.recoveryDecision === "STATE_ONLY_RECOVERY_REVIEW_READY");

  const recoveryBySymbol = new Map(recoveryRows.map((row) => [sym(row.symbol), row]));
  const lifecycleBlockedSymbols = new Set(
    rows(live?.entryOrderLifecycle).filter((row) => row.status === "block").map((row) => sym(row.symbol))
  );
  const ownershipBlockedSymbols = new Set(protectionRows.filter((row) => row.blockerDomain === "ownership").map((row) => sym(row.symbol)));
  const ledgerBlockedSymbols = new Set(protectionRows.filter((row) => row.blockerDomain === "ledger").map((row) => sym(row.symbol)));
  const canonicalProtectionRows = protectionRows
    .filter((row) => row.blockerDomain === "protection")
    .map((rootRow) => {
      const symbol = sym(rootRow.symbol);
      const recoveryRow = recoveryBySymbol.get(symbol);
      const recoveryStatus = String(recoveryRow?.recoveryStatus || "");
      const upstreamRepairEligibleNow = recoveryRow?.repairEligibleNow === true;
      const repairEligibilityContract = recoveryRow?.repairEligibilityContract || null;
      const repairEligibilityContractViolation = upstreamRepairEligibleNow && repairEligibilityContract?.pass !== true;
      return {
        symbol,
        classification: RECOVERY_STATUSES.has(recoveryStatus) ? recoveryStatus : "UNCLASSIFIED",
        recoveryRootCause: recoveryRow?.recoveryRootCause || null,
        recoveryDisposition: recoveryRow?.recoveryDisposition || null,
        protectionLane: rootRow.protectionLane || recoveryRow?.protectionLane || null,
        blockerDomain: rootRow.blockerDomain,
        brokerChildren: {
          stopPresent: rootRow.brokerStopPresent === true,
          targetPresent: rootRow.brokerTargetPresent === true,
        },
        ownershipClassification: rootRow.ownershipClassification || recoveryRow?.ownershipClassification || null,
        normalizedFillState: rootRow.normalizedFillState || null,
        selectedSource: recoveryRow?.selectedSource
          ? { type: recoveryRow.selectedSource.type || null, fresh: recoveryRow.selectedSource.fresh === true }
          : null,
        sourcePrecedence: recoveryRow?.sourcePrecedence || rootRow.sourcePrecedence || null,
        sourcePrecedenceClass: recoveryRow?.sourcePrecedenceClass || rootRow.sourcePrecedenceClass || null,
        sourcePrecedenceRank: recoveryRow?.sourcePrecedenceRank ?? rootRow.sourcePrecedenceRank ?? null,
        sourcePrecedenceEvidence: recoveryRow?.sourcePrecedenceEvidence || null,
        sourcePrecedenceViolation: recoveryRow?.sourcePrecedenceEvidence?.violation === true,
        sourceLineage: recoveryRow?.sourceLineage || null,
        sourcePreservation: recoveryRow?.sourcePreservation || null,
        currentSourceFresh: recoveryRow?.currentSourceFresh === true,
        recoverySourceFreshness: recoveryRow?.recoverySourceFreshness || null,
        stateMaterializationRequired: recoveryRow?.stateMaterializationRequired === true,
        geometry: recoveryRow?.geometry || rootRow.geometry || null,
        recoveryGeometry: recoveryRow?.recoveryGeometry || null,
        idempotencyStatus: recoveryRow?.idempotencyStatus || rootRow.idempotencyStatus || null,
        idempotencyPass: recoveryRow?.idempotencyPass === true,
        upstreamRepairEligibleNow,
        repairEligibleNow: upstreamRepairEligibleNow && repairEligibilityContract?.pass === true,
        repairEligibilityContract,
        repairEligibilityContractViolation,
        blockedReason: recoveryRow?.blockedReason || rootRow.blockedReason || null,
        nextAction: recoveryRow?.nextAction || rootRow.nextAction || null,
        domainOverlap: ownershipBlockedSymbols.has(symbol) || ledgerBlockedSymbols.has(symbol) || lifecycleBlockedSymbols.has(symbol),
      };
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  const statusCounts = Object.fromEntries(
    [...new Set(canonicalProtectionRows.map((row) => row.classification))]
      .sort()
      .map((status) => [status, canonicalProtectionRows.filter((row) => row.classification === status).length])
  );
  const canonicalCount = canonicalProtectionRows.length;
  const reportCounts = {
    rootCause: optionalCount(protection.summary?.protectionBlockerRows),
    guardSourceRecovery: optionalCount(recovery.summary?.protectionBlockerRows),
    persistentOcoRepair: optionalCount(persistent.summary?.protectionBlockerRows),
    liveReadiness: optionalCount(live.protectionClassification?.protectionBlockerRows),
    opsHealth: optionalCount(opsHealth.metrics?.positionProtectionBlockerRows),
  };
  const missingReportCounts = Object.entries(reportCounts)
    .filter(([, value]) => value === null)
    .map(([report]) => report);
  const canonicalProtectionClassification = {
    sourceReport: "position-protection-root-cause-audit.json",
    canonicalCount,
    classifiedRows: canonicalProtectionRows.filter((row) => row.classification !== "UNCLASSIFIED").length,
    unclassifiedRows: canonicalProtectionRows.filter((row) => row.classification === "UNCLASSIFIED").length,
    sourcePrecedenceViolations: canonicalProtectionRows.filter((row) => row.sourcePrecedenceViolation).length,
    domainOverlapRows: canonicalProtectionRows.filter((row) => row.domainOverlap).length,
    repairEligibleNow: canonicalProtectionRows.filter((row) => row.repairEligibleNow).length,
    repairEligibilityContractViolations: canonicalProtectionRows.filter((row) => row.repairEligibilityContractViolation).length,
    statusCounts,
    reportCounts,
    missingReportCounts,
    reportCountsMatch: missingReportCounts.length === 0 && Object.values(reportCounts).every((value) => value === canonicalCount),
    rows: canonicalProtectionRows,
  };

  const fillNeedsProposal = fillRows.filter((row) => row.requiresLedgerTerminalizationReview || row.reconciliationDecision !== "FILL_STATE_CONFIRMED");
  const proposalReady = terminalRows.filter((row) => row.proposalReady !== false);
  const proposalBlocked = terminalRows.filter((row) => row.proposalReady === false);
  const externalRows = ownershipDecisionRows.filter((row) =>
    row.manualExternalAdoptionReview === true || String(row.ownershipRecoveryDecision || "").startsWith("DO_NOT")
  );
  const ownershipReview = ownershipRows.filter((row) => row.migrationReviewReady === false || row.migrationApplyAllowed === false);

  const priority = [
    makeItem({
      id: "fill_state_ledger_terminalization",
      currentStatus: fillNeedsProposal.length || proposalReady.length ? "proposal_only_review_ready" : "clear",
      rows: [...fillNeedsProposal, ...proposalReady, ...proposalBlocked],
      nextSafeAction: "Review terminalization proposal first; require backup, diff, audit record, and post-verify before any state migration.",
      requiredApprovalPhrase: "CONFIRM STATE LEDGER MIGRATION",
      evidence: `fill=${fill.overall || "N/A"} review=${fill.summary?.ledgerTerminalizationReviewRequired ?? "N/A"} proposal=${terminal.overall || "N/A"} ready=${terminal.summary?.proposalReady ?? "N/A"} blocked=${terminal.summary?.blocked ?? "N/A"}`,
      priority: 1,
    }),
    makeItem({
      id: "guard_metadata_source_recovery",
      currentStatus: missingSource.length ? "missing_source_wait" : staleSource.length ? "stale_source_wait" : freshReview.length ? "state_only_review_candidate" : "clear",
      rows: [...missingSource, ...staleSource, ...freshReview],
      nextSafeAction: "Use only fresh Stage6, position lifecycle, order ledger, recommendation ledger, or broker children source with ownership proof.",
      requiredApprovalPhrase: "CONFIRM STATE OWNERSHIP RECOVERY",
      evidence: `lineage=${lineage.overall || "N/A"} missing=${lineage.summary?.missingNoSource ?? "N/A"} stale=${lineage.summary?.staleSourceOnly ?? "N/A"} recoveryReady=${recovery.summary?.recoveryReady ?? "N/A"}`,
      priority: 2,
    }),
    makeItem({
      id: "protective_child_missing",
      currentStatus: childRepairCandidates.length ? "manual_repair_approval_candidate" : childFreshSourceWait.length ? "fresh_source_wait" : childForbiddenFill.length || childForbiddenOwnership.length || childInvalidOrStale.length ? "repair_forbidden_until_prereq_clear" : "clear_or_already_protected",
      rows: [...guardedReportOnlyCandidates, ...childRepairCandidates, ...childFreshSourceWait, ...childForbiddenFill, ...childForbiddenOwnership, ...childInvalidOrStale],
      nextSafeAction: "Keep actual OCO repair blocked until fill-state, ownership, and fresh guard-source prerequisites are clear.",
      requiredApprovalPhrase: "CONFIRM LIVE EXECUTION",
      evidence: `child=${child.overall || "N/A"} missingStops=${child.summary?.missingStopChildren ?? "N/A"} alreadyProtected=${alreadyProtected.length} guarded=${guarded.overall || "N/A"} candidates=${guarded.summary?.candidates ?? "N/A"} persistent=${persistent.overall || "N/A"} eligible=${persistent.summary?.eligible ?? "N/A"}`,
      priority: 3,
    }),
    makeItem({
      id: "ownership_external_manual",
      currentStatus: n(ownership.summary?.externalAdoptionReview) > 0 || n(ownership.summary?.doNotAutoRecover) > 0 ? "external_adoption_blocked" : n(ownership.summary?.migrationReviewRows) > 0 ? "state_only_review_candidate" : "clear",
      rows: [...externalRows, ...ownershipReview],
      nextSafeAction: "Do not auto-adopt external/manual positions; require sidecar ownership proof and fresh guard source before state-only review.",
      requiredApprovalPhrase: "CONFIRM STATE OWNERSHIP RECOVERY",
      evidence: `ownership=${ownership.overall || "N/A"} reviewRows=${ownership.summary?.migrationReviewRows ?? "N/A"} external=${ownership.summary?.externalAdoptionReview ?? "N/A"} doNotAuto=${ownership.summary?.doNotAutoRecover ?? "N/A"}`,
      priority: 4,
    }),
  ];

  return {
    schemaVersion: "2.0.0",
    generatedAt: new Date().toISOString(),
    stateDir: STATE_DIR,
    reportOnly: true,
    finalVerdict: live.finalVerdict === "BLOCKED" ? "BLOCKED" : live.finalVerdict || "UNKNOWN",
    mutationAllowed: false,
    brokerMutationAttempted: brokerSignals.some(bool),
    brokerMutationSubmitted: [live?.brokerMutationSubmitted, child?.summary?.brokerMutationSubmitted, persistent?.summary?.brokerMutationSubmitted].some(bool),
    stateMutationAttempted: stateSignals.some(bool),
    stateMutationSubmitted: [live?.stateMutationSubmitted, ownership?.summary?.stateMutationApplied].some(bool),
    blockerGroupSeparation: live.blockerGroupSeparation || {},
    canonicalProtectionClassification,
    priority,
    childMissingClassification: {
      alreadyProtectedNoAction: uniqueSymbols(alreadyProtected),
      reportOnlyCandidate: uniqueSymbols(guardedReportOnlyCandidates),
      manualRepairCandidate: uniqueSymbols(childRepairCandidates),
      repairForbiddenFillState: uniqueSymbols(childForbiddenFill),
      repairForbiddenOwnership: uniqueSymbols(childForbiddenOwnership),
      freshSourceWait: uniqueSymbols(childFreshSourceWait),
      invalidOrStaleGuardSource: uniqueSymbols(childInvalidOrStale),
    },
    guardSourceClassification: {
      missingSource: uniqueSymbols(missingSource),
      staleSource: uniqueSymbols(staleSource),
      freshSourceReviewCandidate: uniqueSymbols(freshReview),
    },
    fillStateClassification: {
      proposalReady: uniqueSymbols(proposalReady),
      proposalBlocked: uniqueSymbols(proposalBlocked),
      requiresTerminalizationReview: uniqueSymbols(fillNeedsProposal),
      requiredBeforeApply: [
        "state backup",
        "machine-readable diff",
        "audit record with run id and reason",
        "post-verify ledger/idempotency/guard source",
        "no broker mutation",
      ],
    },
    ownershipClassification: {
      externalManualBlocked: uniqueSymbols(externalRows),
      stateOnlyReviewCandidates: uniqueSymbols(ownershipRows.filter((row) =>
        row.currentDecision === "STATE_ONLY_RECOVERY_REVIEW_READY" || row.sourceClassification === "manual_approval_candidate"
      )),
      requiredBeforeApply: ownership.requiredBeforeApply || [],
    },
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("## Protection Blocker Reduction Plan");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- finalVerdict: \`${report.finalVerdict}\``);
  lines.push(`- reportOnly: \`${report.reportOnly}\``);
  lines.push(`- mutationAllowed: \`${report.mutationAllowed}\``);
  lines.push(`- brokerMutation: \`attempted=${report.brokerMutationAttempted} submitted=${report.brokerMutationSubmitted}\``);
  lines.push(`- stateMutation: \`attempted=${report.stateMutationAttempted} submitted=${report.stateMutationSubmitted}\``);
  lines.push("");
  lines.push("### Reduction Priority");
  lines.push("| Priority | Lane | Status | Count | Symbols | Next Safe Action | Approval |");
  lines.push("|---:|---|---|---:|---|---|---|");
  for (const item of report.priority) {
    lines.push(`| ${item.priority} | ${item.id} | \`${item.currentStatus}\` | ${item.count} | ${item.affectedSymbols.join(",") || "none"} | ${item.nextSafeAction} | \`${item.requiredApprovalPhrase}\` |`);
  }
  lines.push("");
  lines.push("### Canonical Protection Classification");
  lines.push(`- canonicalCount: \`${report.canonicalProtectionClassification.canonicalCount}\``);
  lines.push(`- classified/unclassified: \`${report.canonicalProtectionClassification.classifiedRows}/${report.canonicalProtectionClassification.unclassifiedRows}\``);
  lines.push(`- precedence/domain overlap: \`${report.canonicalProtectionClassification.sourcePrecedenceViolations}/${report.canonicalProtectionClassification.domainOverlapRows}\``);
  lines.push(`- repairEligible/contract violations: \`${report.canonicalProtectionClassification.repairEligibleNow}/${report.canonicalProtectionClassification.repairEligibilityContractViolations}\``);
  lines.push(`- reportCountsMatch: \`${report.canonicalProtectionClassification.reportCountsMatch}\``);
  lines.push("| Symbol | Classification | Root Cause | Source | Fresh | Materialization | Geometry | Idempotency | Repair Eligible | Next Action |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const row of report.canonicalProtectionClassification.rows) {
    lines.push(`| ${row.symbol} | \`${row.classification}\` | \`${row.recoveryRootCause || "none"}\` | ${row.selectedSource?.type || "none"} | ${row.currentSourceFresh ? "yes" : "no"} | ${row.stateMaterializationRequired ? "required" : "no"} | ${row.geometry?.valid === true ? "valid" : "invalid"} | ${row.idempotencyStatus || "N/A"}/${row.idempotencyPass ? "pass" : "block"} | ${row.repairEligibleNow ? "yes" : "no"} | ${row.nextAction || "N/A"} |`);
  }
  lines.push("");
  lines.push("### Child Missing Classification");
  for (const [key, value] of Object.entries(report.childMissingClassification)) {
    lines.push(`- ${key}: \`${value.join(",") || "none"}\``);
  }
  lines.push("");
  lines.push("### Guard Source Classification");
  for (const [key, value] of Object.entries(report.guardSourceClassification)) {
    lines.push(`- ${key}: \`${value.join(",") || "none"}\``);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const report = buildReport();
writeAtomic(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
writeAtomic(OUTPUT_MD, renderMarkdown(report));
console.log(`[PROTECTION_BLOCKER_REDUCTION] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} verdict=${report.finalVerdict} priorities=${report.priority.length} brokerMutationAttempted=${report.brokerMutationAttempted} stateMutationAttempted=${report.stateMutationAttempted}`);
