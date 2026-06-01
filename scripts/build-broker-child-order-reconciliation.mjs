import fs from "node:fs";
import { classifyProtectionOwnership, resolveEffectiveGuardMetadata } from "./lib/position-protection-classification.mjs";

const STATE_DIR = String(process.env.BROKER_CHILD_RECONCILIATION_STATE_DIR || "state").trim() || "state";
const PERFORMANCE_PATH = `${STATE_DIR}/performance-dashboard.json`;
const OUTPUT_JSON = `${STATE_DIR}/broker-child-order-reconciliation.json`;
const OUTPUT_MD = `${STATE_DIR}/broker-child-order-reconciliation.md`;

const readJson = (path) => {
  if (!fs.existsSync(path)) return null;
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const toNum = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const fmt = (value, digits = 2) => {
  const n = toNum(value);
  if (n == null) return "N/A";
  return n.toFixed(digits);
};

const short = (value, max = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

const classifyPosition = ({ position, performanceGeneratedAt }) => {
  const symbol = String(position?.symbol || "").toUpperCase();
  const qty = toNum(position?.qty) ?? 0;
  const plannedStopPrice = toNum(position?.plannedStopPrice ?? position?.stopPrice);
  const plannedTargetPrice = toNum(position?.plannedTargetPrice ?? position?.targetPrice);
  const currentPrice = toNum(position?.currentPrice);
  const brokerStopPresent = position?.brokerStopPresent === true;
  const brokerTargetPresent = position?.brokerTargetPresent === true;
  const ownership = classifyProtectionOwnership({ position });
  const effectiveGuard = resolveEffectiveGuardMetadata({ position, performanceGeneratedAt });
  const hasOpenPosition = qty > 0;
  const guardMetadataMissing = hasOpenPosition && effectiveGuard.stopPrice == null && effectiveGuard.targetPrice == null;
  const stopGeometryInvalid = hasOpenPosition && currentPrice != null && effectiveGuard.stopPrice != null && effectiveGuard.stopPrice >= currentPrice;
  const targetGeometryInvalid = hasOpenPosition && currentPrice != null && effectiveGuard.targetPrice != null && effectiveGuard.targetPrice <= currentPrice;
  const targetStopGeometryInvalid = hasOpenPosition && effectiveGuard.stopPrice != null && effectiveGuard.targetPrice != null && effectiveGuard.targetPrice <= effectiveGuard.stopPrice;
  const guardGeometryInvalid = stopGeometryInvalid || targetGeometryInvalid || targetStopGeometryInvalid;
  const stopChildMissing = hasOpenPosition && effectiveGuard.stopPrice != null && !brokerStopPresent;
  const targetChildMissing = hasOpenPosition && effectiveGuard.targetPrice != null && !brokerTargetPresent;
  const fillStateRepairBlocked = ownership.fillStateReconciliation.repairBlocked;

  const proposedActions = [];
  if (guardMetadataMissing) proposedActions.push("REPORT_ONLY_REVIEW_GUARD_METADATA");
  if (guardGeometryInvalid) proposedActions.push("REPORT_ONLY_REVIEW_INVALID_GUARD_GEOMETRY");
  if (fillStateRepairBlocked && hasOpenPosition) proposedActions.push("REPORT_ONLY_RECONCILE_FILL_STATE");
  if (!fillStateRepairBlocked && !guardGeometryInvalid && stopChildMissing) proposedActions.push("REPORT_ONLY_CREATE_STOP_CHILD");
  if (!fillStateRepairBlocked && !guardGeometryInvalid && targetChildMissing) proposedActions.push("REPORT_ONLY_CREATE_TARGET_CHILD");
  if (proposedActions.length === 0) proposedActions.push("NO_ACTION");

  const severity = guardGeometryInvalid || stopChildMissing ? "critical" : targetChildMissing || guardMetadataMissing ? "warn" : "pass";
  const protectionStatus = !hasOpenPosition
    ? "NO_POSITION"
    : guardMetadataMissing
      ? "GUARD_METADATA_MISSING"
      : guardGeometryInvalid
        ? "INVALID_GUARD_GEOMETRY_REVIEW"
        : fillStateRepairBlocked && (stopChildMissing || targetChildMissing)
          ? "FILL_STATE_RECONCILIATION_REQUIRED_BEFORE_REPAIR"
          : stopChildMissing && targetChildMissing
          ? "STOP_AND_TARGET_CHILD_MISSING"
          : stopChildMissing
            ? "STOP_CHILD_MISSING"
            : targetChildMissing
              ? "TARGET_CHILD_MISSING"
              : "BROKER_CHILDREN_PRESENT_OR_NOT_REQUIRED";

  const reason = guardGeometryInvalid
    ? "planned stop/current/target geometry is invalid; block repair and route to root-cause review"
    : fillStateRepairBlocked && (stopChildMissing || targetChildMissing)
      ? "broker position exists but sidecar fill state is not confirmed filled; reconcile fill ownership before any child-order repair"
    : stopChildMissing
      ? "planned stop exists but no active Alpaca sell stop child was found in nested open orders"
      : targetChildMissing
        ? "planned target exists but no active Alpaca sell target child was found in nested open orders"
        : guardMetadataMissing
          ? "held position has no planned stop/target metadata in sidecar state"
          : "no report-only broker child reconciliation action required";

  return {
    symbol,
    qty,
    currentPrice,
    plannedStopPrice,
    plannedTargetPrice,
    effectiveStopPrice: effectiveGuard.stopPrice,
    effectiveTargetPrice: effectiveGuard.targetPrice,
    effectiveGuardSource: effectiveGuard.source,
    effectiveGuardGeneratedAt: effectiveGuard.generatedAt,
    sourcePrecedence: effectiveGuard.sourcePrecedence,
    staleStateMetadataIgnored: effectiveGuard.staleStateMetadataIgnored,
    brokerStopPresent,
    brokerTargetPresent,
    brokerStopPrice: toNum(position?.brokerStopPrice),
    brokerTargetPrice: toNum(position?.brokerTargetPrice),
    brokerSellOrderCount: toNum(position?.brokerSellOrderCount) ?? 0,
    brokerNestedSellOrderCount: toNum(position?.brokerNestedSellOrderCount) ?? 0,
    plannedStopSource: position?.plannedStopSource || null,
    plannedTargetSource: position?.plannedTargetSource || null,
    plannedStage6Hash: position?.plannedStage6Hash || null,
    plannedStage6File: position?.plannedStage6File || null,
    plannedLedgerKey: position?.plannedLedgerKey || null,
    plannedLedgerUpdatedAt: position?.plannedLedgerUpdatedAt || null,
    stopPriceSource: position?.stopPriceSource || null,
    targetPriceSource: position?.targetPriceSource || null,
    normalizedFillState: position?.normalizedFillState || null,
    ledgerStatus: position?.ledgerStatus || null,
    idempotencyBrokerStatus: position?.idempotencyBrokerStatus || null,
    positionStatus: position?.positionStatus || null,
    ownershipClassification: ownership.ownershipClass,
    sidecarManaged: ownership.sidecarManaged,
    repairAllowedByOwnership: ownership.repairAllowedByOwnership,
    fillStateReconciliation: ownership.fillStateReconciliation,
    guardMetadataMissing,
    guardGeometryInvalid,
    stopGeometryInvalid,
    targetGeometryInvalid,
    targetStopGeometryInvalid,
    stopChildMissing,
    targetChildMissing,
    protectionStatus,
    severity,
    proposedActions,
    executionAllowed: false,
    reason: short(reason, 240)
  };
};

const summarize = (rows) => {
  const actionableRows = rows.filter((row) => row.proposedActions.some((action) => action !== "NO_ACTION"));
  const criticalRows = rows.filter((row) => row.severity === "critical");
  const warnRows = rows.filter((row) => row.severity === "warn");
  return {
    positionsChecked: rows.length,
    protectedOrNoAction: rows.filter((row) => row.severity === "pass").length,
    criticalCount: criticalRows.length,
    warningCount: warnRows.length,
    proposedActionRows: actionableRows.length,
    missingStopChildren: rows.filter((row) => row.stopChildMissing).length,
    missingTargetChildren: rows.filter((row) => row.targetChildMissing).length,
    guardMetadataMissing: rows.filter((row) => row.guardMetadataMissing).length,
    guardGeometryInvalid: rows.filter((row) => row.guardGeometryInvalid).length,
    noActionRows: rows.filter((row) => row.proposedActions.length === 1 && row.proposedActions[0] === "NO_ACTION").length,
    sidecarManagedFilled: rows.filter((row) => row.ownershipClassification === "SIDECAR_MANAGED_FILLED").length,
    fillStateReconciliationRequired: rows.filter((row) => row.fillStateReconciliation?.status === "position_present_ledger_submitted").length,
    externalOrManualPositions: rows.filter((row) => row.ownershipClassification === "EXTERNAL_OR_MANUAL_POSITION").length,
    brokerChildrenSourceActive: rows.filter((row) => row.effectiveGuardSource === "broker_children").length
  };
};

const buildMarkdown = (report) => {
  const lines = [];
  lines.push("## Broker Child-Order Reconciliation");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- mode: \`${report.executionPolicy.mode}\``);
  lines.push(`- overall: \`${String(report.overall).toUpperCase()}\``);
  lines.push(
    `- source: \`performanceDashboard=${report.files.performanceDashboard ? "ok" : "missing"} nested=${report.source.openOrderNested ?? "N/A"} rawOpen=${report.source.openOrderRawCount ?? "N/A"} flattenedOpen=${report.source.openOrderFlattenedCount ?? "N/A"}\``
  );
  lines.push(
    `- summary: \`positions=${report.summary.positionsChecked} critical=${report.summary.criticalCount} warnings=${report.summary.warningCount} stopMissing=${report.summary.missingStopChildren} targetMissing=${report.summary.missingTargetChildren} guardMissing=${report.summary.guardMetadataMissing} invalidGeometry=${report.summary.guardGeometryInvalid} fillRecon=${report.summary.fillStateReconciliationRequired} external=${report.summary.externalOrManualPositions} brokerChildSource=${report.summary.brokerChildrenSourceActive} proposedRows=${report.summary.proposedActionRows}\``
  );
  lines.push("- safety: `report-only; no broker mutation; auto repair disabled` ");
  lines.push("| Symbol | Severity | Protection | Ownership | Fill State | Qty | Current | Effective Stop | Effective Target | Source | Broker Stop | Broker Target | Actions | Reason |");
  lines.push("| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- |");
  for (const row of report.rows.slice(0, 50)) {
    lines.push(
      `| ${row.symbol || "N/A"} | ${row.severity.toUpperCase()} | ${row.protectionStatus} | ${row.ownershipClassification || "N/A"} | ${row.fillStateReconciliation?.status || "N/A"} | ${fmt(row.qty, 3)} | ${fmt(row.currentPrice)} | ${fmt(row.effectiveStopPrice)} | ${fmt(row.effectiveTargetPrice)} | ${row.effectiveGuardSource || "N/A"} | ${row.brokerStopPresent ? "present" : "missing"} | ${row.brokerTargetPresent ? "present" : "missing"} | ${row.proposedActions.join(",")} | ${short(row.reason, 160)} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const dashboard = readJson(PERFORMANCE_PATH);
  const live = dashboard?.live || {};
  const positions = Array.isArray(live?.positions) ? live.positions : [];
  const rows = positions
    .filter((row) => (toNum(row?.qty) ?? 0) > 0)
    .map((position) => classifyPosition({ position, performanceGeneratedAt: dashboard?.generatedAt || null }));
  const summary = summarize(rows);
  const overall = !dashboard
    ? "warn"
    : summary.criticalCount > 0
      ? "critical"
      : summary.warningCount > 0
        ? "warn"
        : "pass";

  const report = {
    generatedAt: new Date().toISOString(),
    overall,
    files: {
      performanceDashboard: Boolean(dashboard)
    },
    source: {
      performanceDashboardGeneratedAt: dashboard?.generatedAt || null,
      openOrderNested: live?.totals?.openOrderNested ?? null,
      openOrderRawCount: toNum(live?.totals?.openOrderRawCount),
      openOrderFlattenedCount: toNum(live?.totals?.openOrderFlattenedCount)
    },
    executionPolicy: {
      mode: "report_only",
      brokerMutationAllowed: false,
      autoRepairEnabled: false,
      requiresApprovalForMutation: true
    },
    summary,
    rows
  };

  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(OUTPUT_MD, buildMarkdown(report), "utf8");
  console.log(
    `[BROKER_CHILD_RECON] saved json=${OUTPUT_JSON} md=${OUTPUT_MD} overall=${overall} positions=${summary.positionsChecked} critical=${summary.criticalCount} proposedRows=${summary.proposedActionRows}`
  );
};

main();
