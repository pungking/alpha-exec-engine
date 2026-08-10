export type SidecarNoOrderCause =
  | "PAYLOAD_READY"
  | "STALE_OR_DISPATCH_MISMATCH"
  | "STAGE6_NO_EXECUTABLE"
  | "PORTFOLIO_HELD"
  | "PORTFOLIO_CAPACITY"
  | "QUALITY_GATE"
  | "STRUCTURE_PROOF"
  | "RISK_GEOMETRY"
  | "ENTRY_PRICE_OR_DISTANCE"
  | "IDEMPOTENCY_DEDUPLICATED"
  | "STALE_CANDIDATE_SOURCE"
  | "STAGE6_CONTRACT_BLOCKED"
  | "SIZING_POLICY"
  | "MARKET_SESSION_GUARD"
  | "NO_ORDER_CONTRACT_INCONSISTENT";

export type SidecarRuntimeEvidenceInput = {
  stage6: {
    file: string;
    hash: string;
    modelTop6Rows: number;
    executablePickRows: number;
    watchlistRows: number;
  };
  decisionRows: Array<{
    symbol: string;
    status: "payload" | "skipped";
    skipCategory: string;
    stage6DecisionCategory: string;
  }>;
  reportedTopSkipReasonCategories: Record<string, number>;
  payload: {
    count: number;
    expectationStatus: string;
  };
  source: {
    eventName: string;
    expectedStage6Hash: string;
    expectedStage6File: string;
    previewStale: boolean;
  };
  preflight: {
    status: string;
    code: string;
    blocking: boolean;
    wouldBlockLive: boolean;
    marketOpen: boolean | null;
    allowEntryOutsideRth: boolean;
  };
  marketGuard: {
    blocked: boolean;
    wouldBlockLive: boolean;
    stale: boolean;
    reason: string;
  };
  mode: {
    readOnly: boolean;
    execEnabled: boolean;
    liveMode: boolean;
  };
  broker: {
    attempted: number;
    submitted: number;
  };
  stateLedger: {
    upserted: number;
    transitioned: number;
    reconciled: number;
    pruned: number;
  };
};

const UNCLASSIFIED_CATEGORIES = new Set(["", "unknown", "other", "unclassified"]);

function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

function normalizeCategory(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase() || "unknown";
}

function sortCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts)
      .map(([key, value]) => [normalizeCategory(key), nonNegativeInteger(value)] as const)
      .filter(([, value]) => value > 0)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function countRowsByCategory(
  rows: SidecarRuntimeEvidenceInput["decisionRows"],
  field: "skipCategory" | "stage6DecisionCategory"
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (row.status !== "skipped") continue;
    const category = normalizeCategory(row[field]);
    counts[category] = (counts[category] || 0) + 1;
  }
  return sortCounts(counts);
}

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, value) => sum + nonNegativeInteger(value), 0);
}

function countsEqual(left: Record<string, number>, right: Record<string, number>): boolean {
  return JSON.stringify(sortCounts(left)) === JSON.stringify(sortCounts(right));
}

function deriveSourceIntegrity(input: SidecarRuntimeEvidenceInput): {
  status:
    | "DISPATCH_MATCHED"
    | "SCHEDULE_NO_DISPATCH_EXPECTATION"
    | "NON_DISPATCH_EVENT"
    | "PREVIEW_STALE"
    | "DISPATCH_MISMATCH"
    | "PREVIEW_STALE_AND_DISPATCH_MISMATCH";
  previewStale: boolean;
  dispatchHashMatches: boolean | null;
  dispatchFileMatches: boolean | null;
  valid: boolean;
} {
  const eventName = String(input.source.eventName || "").trim().toLowerCase();
  const isDispatch = eventName === "repository_dispatch";
  const expectedHash = String(input.source.expectedStage6Hash || "").trim().toLowerCase();
  const expectedFile = String(input.source.expectedStage6File || "").trim();
  const actualHash = String(input.stage6.hash || "").trim().toLowerCase();
  const actualFile = String(input.stage6.file || "").trim();
  const dispatchHashMatches = isDispatch ? Boolean(expectedHash) && expectedHash === actualHash : null;
  const dispatchFileMatches = isDispatch ? !expectedFile || expectedFile === actualFile : null;
  const dispatchMismatch = isDispatch && (!dispatchHashMatches || !dispatchFileMatches);
  const previewStale = input.source.previewStale === true;

  if (previewStale && dispatchMismatch) {
    return {
      status: "PREVIEW_STALE_AND_DISPATCH_MISMATCH",
      previewStale,
      dispatchHashMatches,
      dispatchFileMatches,
      valid: false
    };
  }
  if (previewStale) {
    return {
      status: "PREVIEW_STALE",
      previewStale,
      dispatchHashMatches,
      dispatchFileMatches,
      valid: false
    };
  }
  if (dispatchMismatch) {
    return {
      status: "DISPATCH_MISMATCH",
      previewStale,
      dispatchHashMatches,
      dispatchFileMatches,
      valid: false
    };
  }
  if (isDispatch) {
    return {
      status: "DISPATCH_MATCHED",
      previewStale,
      dispatchHashMatches,
      dispatchFileMatches,
      valid: true
    };
  }
  return {
    status: eventName === "schedule" ? "SCHEDULE_NO_DISPATCH_EXPECTATION" : "NON_DISPATCH_EVENT",
    previewStale,
    dispatchHashMatches,
    dispatchFileMatches,
    valid: true
  };
}

function deriveMarketSessionStatus(
  input: SidecarRuntimeEvidenceInput
): "OPEN" | "CLOSED_BLOCKED" | "OUTSIDE_RTH_ALLOWED" | "NOT_EVALUATED_NO_PAYLOAD" | "NOT_EVALUATED" {
  if (input.preflight.marketOpen === false || input.preflight.code === "PREFLIGHT_MARKET_CLOSED") {
    return "CLOSED_BLOCKED";
  }
  if (input.preflight.marketOpen === true) return "OPEN";
  if (input.preflight.allowEntryOutsideRth) return "OUTSIDE_RTH_ALLOWED";
  if (input.payload.count === 0 && input.preflight.code === "PREFLIGHT_NO_PAYLOAD") {
    return "NOT_EVALUATED_NO_PAYLOAD";
  }
  return "NOT_EVALUATED";
}

function pickDominantCategory(counts: Record<string, number>): string {
  const priority = [
    "portfolio_held",
    "portfolio_capacity",
    "capacity",
    "quality_gate",
    "structure",
    "breakout",
    "risk_geometry",
    "entry_distance",
    "price_geometry",
    "dedupe",
    "stale_source",
    "contract_gate",
    "sizing",
    "high_price_size",
    "market_session"
  ];
  const priorityIndex = new Map(priority.map((category, index) => [category, index]));
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort(([leftCategory, leftCount], [rightCategory, rightCount]) => {
      if (rightCount !== leftCount) return rightCount - leftCount;
      return (
        (priorityIndex.get(leftCategory) ?? Number.MAX_SAFE_INTEGER) -
        (priorityIndex.get(rightCategory) ?? Number.MAX_SAFE_INTEGER)
      );
    })[0]?.[0] ?? "unknown";
}

function mapCategoryToNoOrderCause(category: string): SidecarNoOrderCause {
  if (category === "portfolio_held") return "PORTFOLIO_HELD";
  if (category === "portfolio_capacity" || category === "capacity") return "PORTFOLIO_CAPACITY";
  if (category === "quality_gate") return "QUALITY_GATE";
  if (category === "structure" || category === "breakout") return "STRUCTURE_PROOF";
  if (category === "risk_geometry") return "RISK_GEOMETRY";
  if (category === "entry_distance" || category === "price_geometry") return "ENTRY_PRICE_OR_DISTANCE";
  if (category === "dedupe") return "IDEMPOTENCY_DEDUPLICATED";
  if (category === "stale_source") return "STALE_CANDIDATE_SOURCE";
  if (category === "contract_gate") return "STAGE6_CONTRACT_BLOCKED";
  if (category === "sizing" || category === "high_price_size") return "SIZING_POLICY";
  if (category === "market_session") return "MARKET_SESSION_GUARD";
  return "NO_ORDER_CONTRACT_INCONSISTENT";
}

function deriveStage6DecisionCoverageStatus(input: SidecarRuntimeEvidenceInput):
  | "ZERO_EXECUTABLE_MODEL_TOP_EXACT"
  | "EXECUTABLE_ROWS_COVERED"
  | "EMPTY_STAGE6_AND_AUDIT"
  | "COUNT_MISMATCH" {
  const decisionRows = input.decisionRows.length;
  const modelTop6Rows = nonNegativeInteger(input.stage6.modelTop6Rows);
  const executablePickRows = nonNegativeInteger(input.stage6.executablePickRows);
  if (modelTop6Rows === 0 && executablePickRows === 0 && decisionRows === 0) {
    return "EMPTY_STAGE6_AND_AUDIT";
  }
  if (executablePickRows === 0) {
    return decisionRows === modelTop6Rows ? "ZERO_EXECUTABLE_MODEL_TOP_EXACT" : "COUNT_MISMATCH";
  }
  return decisionRows >= executablePickRows ? "EXECUTABLE_ROWS_COVERED" : "COUNT_MISMATCH";
}

export function buildSidecarRuntimeEvidenceSummary(input: SidecarRuntimeEvidenceInput) {
  const derivedSkipReasonCategories = countRowsByCategory(input.decisionRows, "skipCategory");
  const stage6DecisionReasonCategories = countRowsByCategory(input.decisionRows, "stage6DecisionCategory");
  const reportedTopSkipReasonCategories = sortCounts(input.reportedTopSkipReasonCategories);
  const payloadReadyRows = input.decisionRows.filter((row) => row.status === "payload").length;
  const skippedRows = input.decisionRows.filter((row) => row.status === "skipped").length;
  const blockerSummaryRows = sumCounts(reportedTopSkipReasonCategories);
  const rowStatusCountMatches = input.decisionRows.length === payloadReadyRows + skippedRows;
  const blockerSummaryCountMatches =
    blockerSummaryRows === skippedRows && countsEqual(reportedTopSkipReasonCategories, derivedSkipReasonCategories);
  const decisionReasonCategoryParity = countsEqual(
    stage6DecisionReasonCategories,
    derivedSkipReasonCategories
  )
    ? "EXACT"
    : "SIDECAR_GATE_OVERRIDE_OR_MISMATCH";
  const unknownOrUnclassifiedRows = input.decisionRows.filter((row) => {
    if (row.status !== "skipped") return false;
    return (
      UNCLASSIFIED_CATEGORIES.has(normalizeCategory(row.skipCategory)) ||
      UNCLASSIFIED_CATEGORIES.has(normalizeCategory(row.stage6DecisionCategory))
    );
  }).length;
  const stage6DecisionCoverageStatus = deriveStage6DecisionCoverageStatus(input);
  const sourceIntegrity = deriveSourceIntegrity(input);
  const marketSessionStatus = deriveMarketSessionStatus(input);
  const stateMutationRows =
    nonNegativeInteger(input.stateLedger.upserted) +
    nonNegativeInteger(input.stateLedger.transitioned) +
    nonNegativeInteger(input.stateLedger.reconciled) +
    nonNegativeInteger(input.stateLedger.pruned);
  const safety = {
    readOnly: input.mode.readOnly === true,
    execEnabled: input.mode.execEnabled === true,
    liveMode: input.mode.liveMode === true,
    brokerMutationAttempted: nonNegativeInteger(input.broker.attempted) > 0,
    brokerMutationSubmitted: nonNegativeInteger(input.broker.submitted) > 0,
    stateMutationAttempted: stateMutationRows > 0,
    stateMutationSubmitted: stateMutationRows > 0
  };
  const safetyViolation =
    !safety.readOnly ||
    safety.execEnabled ||
    safety.liveMode ||
    safety.brokerMutationAttempted ||
    safety.brokerMutationSubmitted ||
    safety.stateMutationAttempted ||
    safety.stateMutationSubmitted;

  let primaryNoOrderCause: SidecarNoOrderCause;
  if (!sourceIntegrity.valid) {
    primaryNoOrderCause = "STALE_OR_DISPATCH_MISMATCH";
  } else if (nonNegativeInteger(input.payload.count) > 0) {
    primaryNoOrderCause = "PAYLOAD_READY";
  } else if (nonNegativeInteger(input.stage6.executablePickRows) === 0) {
    primaryNoOrderCause = "STAGE6_NO_EXECUTABLE";
  } else if (
    marketSessionStatus === "CLOSED_BLOCKED" ||
    input.marketGuard.blocked === true ||
    input.marketGuard.wouldBlockLive === true
  ) {
    primaryNoOrderCause = "MARKET_SESSION_GUARD";
  } else {
    primaryNoOrderCause = mapCategoryToNoOrderCause(
      pickDominantCategory(reportedTopSkipReasonCategories)
    );
  }

  const countReconciliationFailed =
    !rowStatusCountMatches ||
    !blockerSummaryCountMatches ||
    stage6DecisionCoverageStatus === "COUNT_MISMATCH";
  const semanticIntegrityStatus = !sourceIntegrity.valid
    ? "FAIL_SOURCE_INTEGRITY"
    : countReconciliationFailed
      ? "FAIL_COUNT_RECONCILIATION"
      : unknownOrUnclassifiedRows > 0 || primaryNoOrderCause === "NO_ORDER_CONTRACT_INCONSISTENT"
        ? "FAIL_UNCLASSIFIED_NO_ORDER_CAUSE"
        : safetyViolation
          ? "FAIL_SAFETY_STATE"
          : "PASS";

  return {
    schemaVersion: "sidecar-runtime-evidence-v1",
    reportMode: "REPORT_ONLY",
    semanticIntegrityStatus,
    stage6: {
      file: input.stage6.file,
      hash: input.stage6.hash,
      modelTop6Rows: nonNegativeInteger(input.stage6.modelTop6Rows),
      executablePickRows: nonNegativeInteger(input.stage6.executablePickRows),
      watchlistRows: nonNegativeInteger(input.stage6.watchlistRows),
      decisionCoverageStatus: stage6DecisionCoverageStatus
    },
    decisionAudit: {
      rows: input.decisionRows.length,
      payloadReadyRows,
      skippedRows,
      blockerSummaryRows,
      rowStatusCountMatches,
      blockerSummaryCountMatches,
      decisionReasonCategoryParity,
      unknownOrUnclassifiedRows,
      reportedTopSkipReasonCategories,
      derivedSkipReasonCategories,
      stage6DecisionReasonCategories
    },
    orderOutcome: {
      status: nonNegativeInteger(input.payload.count) > 0 ? "PAYLOAD_READY" : "NO_ORDER_EXPLAINED",
      payloadCount: nonNegativeInteger(input.payload.count),
      payloadExpectationStatus: String(input.payload.expectationStatus || "unknown"),
      primaryNoOrderCause,
      contributingBlockerCategories: reportedTopSkipReasonCategories
    },
    sourceIntegrity,
    marketSession: {
      status: marketSessionStatus,
      preflightStatus: String(input.preflight.status || "unknown"),
      preflightCode: String(input.preflight.code || "unknown"),
      marketOpen: input.preflight.marketOpen,
      allowEntryOutsideRth: input.preflight.allowEntryOutsideRth === true,
      blocking: input.preflight.blocking === true,
      wouldBlockLive: input.preflight.wouldBlockLive === true
    },
    marketGuard: {
      blocked: input.marketGuard.blocked === true,
      wouldBlockLive: input.marketGuard.wouldBlockLive === true,
      stale: input.marketGuard.stale === true,
      reason: String(input.marketGuard.reason || "unknown")
    },
    safety
  };
}
