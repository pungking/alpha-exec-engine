#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  PROTECTION_LANES,
  classifyProtectionLane
} from "./lib/position-protection-classification.mjs";

const base = {
  qty: 1,
  brokerStopPresent: false,
  brokerTargetPresent: false,
  ownershipClassification: "SIDECAR_MANAGED_FILLED",
  fillStateRepairBlocked: false,
  guardMetadataMissing: false,
  guardMetadataStale: false,
  geometryValid: true,
  brokerChildMissing: true
};

const cases = [
  {
    expected: PROTECTION_LANES.BROKER_CHILDREN_PRESENT_OR_NOT_REQUIRED,
    input: { ...base, brokerStopPresent: true, brokerTargetPresent: true, brokerChildMissing: false },
    domain: "none"
  },
  {
    expected: PROTECTION_LANES.FRESH_GUARD_SOURCE_REQUIRED,
    input: { ...base, guardMetadataStale: true, geometryValid: false },
    domain: "protection"
  },
  {
    expected: PROTECTION_LANES.INVALID_GUARD_GEOMETRY_NO_REPAIR,
    input: { ...base, geometryValid: false },
    domain: "protection"
  },
  {
    expected: PROTECTION_LANES.OWNERSHIP_PROOF_REQUIRED,
    input: { ...base, ownershipClassification: "EXTERNAL_OR_MANUAL_POSITION", guardMetadataMissing: true },
    domain: "ownership"
  },
  {
    expected: PROTECTION_LANES.OWNERSHIP_PROOF_REQUIRED,
    input: {
      ...base,
      ownershipClassification: "SIDECAR_MANAGED_FILL_RECONCILIATION_REQUIRED",
      fillStateRepairBlocked: true
    },
    domain: "ledger_fill_state"
  },
  {
    expected: PROTECTION_LANES.MANUAL_APPROVAL_CANDIDATE,
    input: base,
    domain: "protection"
  }
];

for (const testCase of cases) {
  const actual = classifyProtectionLane(testCase.input);
  assert.equal(actual.protectionLane, testCase.expected);
  assert.equal(actual.blockerDomain, testCase.domain);
  assert.equal(
    actual.repairEligible,
    testCase.expected === PROTECTION_LANES.MANUAL_APPROVAL_CANDIDATE
  );
  assert.ok(actual.nextAction);
  if (testCase.expected === PROTECTION_LANES.BROKER_CHILDREN_PRESENT_OR_NOT_REQUIRED) {
    assert.equal(actual.blockedReason, null);
  } else {
    assert.ok(actual.blockedReason);
  }
}

console.log("[POSITION_PROTECTION_LANE_CLASSIFICATION_TEST] pass");
