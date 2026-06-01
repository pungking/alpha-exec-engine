const toNum = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const asText = (value) => String(value ?? "").trim();
const asLower = (value) => asText(value).toLowerCase();
const isFilledStatus = (value) => ["filled", "partially_filled"].includes(asLower(value));
const isTerminalStatus = (value) =>
  ["filled", "canceled", "cancelled", "expired", "rejected", "failed"].includes(asLower(value));
const isWorkingStatus = (value) =>
  ["new", "accepted", "pending_new", "open", "submitted", "partially_filled", "held"].includes(asLower(value));

const firstPresent = (...values) => values.find((value) => value !== null && value !== undefined && String(value).trim() !== "");

export const classifyProtectionOwnership = ({
  position = {},
  reconciliationRow = {},
  ledgerRow = null,
  idempotencyRow = null,
  orderStateRow = null,
  fillabilityRow = null
}) => {
  const qty = toNum(position?.qty ?? reconciliationRow?.qty) ?? 0;
  const normalizedFillState = firstPresent(
    position?.normalizedFillState,
    reconciliationRow?.normalizedFillState,
    ledgerRow?.fillState,
    ledgerRow?.status
  );
  const ledgerStatus = firstPresent(ledgerRow?.status, position?.ledgerStatus, reconciliationRow?.ledgerStatus);
  const idempotencyBrokerStatus = firstPresent(
    idempotencyRow?.brokerStatus,
    idempotencyRow?.status,
    position?.idempotencyBrokerStatus,
    reconciliationRow?.idempotencyBrokerStatus
  );
  const orderStateStatus = firstPresent(orderStateRow?.status, orderStateRow?.state, orderStateRow?.classification);
  const fillabilityStatus = firstPresent(fillabilityRow?.status, position?.fillabilityStatus, reconciliationRow?.fillabilityStatus);
  const sidecarEvidence = Boolean(
    ledgerRow ||
      idempotencyRow ||
      position?.plannedLedgerKey ||
      reconciliationRow?.plannedLedgerKey ||
      position?.plannedStage6Hash ||
      reconciliationRow?.plannedStage6Hash ||
      position?.plannedStage6File ||
      reconciliationRow?.plannedStage6File
  );
  const filledEvidence = [normalizedFillState, ledgerStatus, idempotencyBrokerStatus, orderStateStatus].some(isFilledStatus);
  const workingEvidence = [normalizedFillState, ledgerStatus, idempotencyBrokerStatus, orderStateStatus, fillabilityStatus].some(
    isWorkingStatus
  );
  const terminalButNotFilled = [normalizedFillState, ledgerStatus, idempotencyBrokerStatus, orderStateStatus].some(
    (value) => isTerminalStatus(value) && !isFilledStatus(value)
  );

  let ownershipClass = "EXTERNAL_OR_MANUAL_POSITION";
  let fillStateStatus = "external_position_no_sidecar_fill";
  if (sidecarEvidence && filledEvidence) {
    ownershipClass = "SIDECAR_MANAGED_FILLED";
    fillStateStatus = "confirmed_filled";
  } else if (sidecarEvidence && qty > 0 && workingEvidence) {
    ownershipClass = "SIDECAR_MANAGED_FILL_RECONCILIATION_REQUIRED";
    fillStateStatus = "position_present_ledger_submitted";
  } else if (sidecarEvidence && terminalButNotFilled) {
    ownershipClass = "SIDECAR_MANAGED_TERMINAL_NOT_FILLED";
    fillStateStatus = "terminal_not_filled_position_present_review";
  } else if (sidecarEvidence) {
    ownershipClass = "SIDECAR_MANAGED_UNCONFIRMED";
    fillStateStatus = qty > 0 ? "sidecar_lineage_present_fill_unknown" : "no_open_position";
  }

  const repairBlocked =
    ownershipClass !== "SIDECAR_MANAGED_FILLED" ||
    fillStateStatus !== "confirmed_filled";
  const blockers = [];
  if (qty <= 0) blockers.push("no_open_position");
  if (!sidecarEvidence) blockers.push("position_not_sidecar_managed");
  if (ownershipClass === "SIDECAR_MANAGED_FILL_RECONCILIATION_REQUIRED") blockers.push("fill_state_reconciliation_required");
  if (ownershipClass === "SIDECAR_MANAGED_TERMINAL_NOT_FILLED") blockers.push("terminal_not_filled_position_present_review");
  if (ownershipClass === "SIDECAR_MANAGED_UNCONFIRMED") blockers.push("fill_state_unknown");

  return {
    ownershipClass,
    sidecarManaged: sidecarEvidence,
    repairAllowedByOwnership: !repairBlocked,
    qty,
    fillStateReconciliation: {
      status: fillStateStatus,
      repairBlocked,
      normalizedFillState: normalizedFillState || null,
      ledgerStatus: ledgerStatus || null,
      idempotencyBrokerStatus: idempotencyBrokerStatus || null,
      orderStateStatus: orderStateStatus || null,
      fillabilityStatus: fillabilityStatus || null,
      blockers: [...new Set(blockers)]
    }
  };
};

export const resolveEffectiveGuardMetadata = ({
  position = {},
  reconciliationRow = {},
  ledgerRow = null,
  performanceGeneratedAt = null
}) => {
  const brokerStopPresent = position?.brokerStopPresent === true || reconciliationRow?.brokerStopPresent === true;
  const brokerTargetPresent = position?.brokerTargetPresent === true || reconciliationRow?.brokerTargetPresent === true;
  const brokerStopPrice = toNum(position?.brokerStopPrice ?? reconciliationRow?.brokerStopPrice);
  const brokerTargetPrice = toNum(position?.brokerTargetPrice ?? reconciliationRow?.brokerTargetPrice);
  const brokerChildrenComplete =
    brokerStopPresent &&
    brokerTargetPresent &&
    brokerStopPrice != null &&
    brokerTargetPrice != null;

  if (brokerChildrenComplete) {
    return {
      stopPrice: brokerStopPrice,
      targetPrice: brokerTargetPrice,
      source: "broker_children",
      generatedAt: performanceGeneratedAt || null,
      sourcePrecedence: "broker_children_over_state_guard_metadata",
      brokerChildrenComplete: true,
      staleStateMetadataIgnored: true
    };
  }

  const plannedStopPrice = toNum(
    position?.plannedStopPrice ??
      position?.stopPrice ??
      reconciliationRow?.plannedStopPrice ??
      ledgerRow?.stopLossPrice
  );
  const plannedTargetPrice = toNum(
    position?.plannedTargetPrice ??
      position?.targetPrice ??
      reconciliationRow?.plannedTargetPrice ??
      ledgerRow?.takeProfitPrice
  );
  const plannedSource =
    firstPresent(
      position?.plannedStopSource,
      position?.plannedTargetSource,
      reconciliationRow?.plannedStopSource,
      reconciliationRow?.plannedTargetSource,
      "state_guard_metadata"
    ) || "state_guard_metadata";

  return {
    stopPrice: plannedStopPrice,
    targetPrice: plannedTargetPrice,
    source: plannedSource,
    generatedAt:
      firstPresent(position?.plannedLedgerUpdatedAt, reconciliationRow?.plannedLedgerUpdatedAt, ledgerRow?.updatedAt, ledgerRow?.createdAt) ||
      null,
    sourcePrecedence: "state_guard_metadata",
    brokerChildrenComplete: false,
    staleStateMetadataIgnored: false
  };
};
