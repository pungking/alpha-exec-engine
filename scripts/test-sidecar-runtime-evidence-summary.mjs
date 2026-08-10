import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildSidecarRuntimeEvidenceSummary } from "../dist/src/sidecar-runtime-evidence-core.js";

async function loadBaseline() {
  const raw = await readFile("testdata/replay/sidecar-runtime-evidence.fixture.json", "utf8");
  return JSON.parse(raw);
}

test("explains the zero-payload baseline as Stage6 no executable with reconciled blockers", async () => {
  const summary = buildSidecarRuntimeEvidenceSummary(await loadBaseline());

  assert.equal(summary.semanticIntegrityStatus, "PASS");
  assert.equal(summary.orderOutcome.primaryNoOrderCause, "STAGE6_NO_EXECUTABLE");
  assert.equal(summary.orderOutcome.payloadCount, 0);
  assert.equal(summary.decisionAudit.rows, 6);
  assert.equal(summary.decisionAudit.blockerSummaryRows, 6);
  assert.equal(summary.decisionAudit.rowStatusCountMatches, true);
  assert.equal(summary.decisionAudit.blockerSummaryCountMatches, true);
  assert.equal(summary.decisionAudit.decisionReasonCategoryParity, "EXACT");
  assert.equal(summary.decisionAudit.unknownOrUnclassifiedRows, 0);
  assert.deepEqual(summary.decisionAudit.reportedTopSkipReasonCategories, {
    quality_gate: 4,
    structure: 2
  });
  assert.equal(summary.sourceIntegrity.status, "DISPATCH_MATCHED");
  assert.equal(summary.marketSession.status, "NOT_EVALUATED_NO_PAYLOAD");
  assert.deepEqual(summary.safety, {
    readOnly: true,
    execEnabled: false,
    liveMode: false,
    brokerMutationAttempted: false,
    brokerMutationSubmitted: false,
    stateMutationAttempted: false,
    stateMutationSubmitted: false
  });
});

test("fails count reconciliation when the reported blocker summary omits a row", async () => {
  const input = await loadBaseline();
  input.reportedTopSkipReasonCategories = { quality_gate: 3, structure: 2 };

  const summary = buildSidecarRuntimeEvidenceSummary(input);

  assert.equal(summary.semanticIntegrityStatus, "FAIL_COUNT_RECONCILIATION");
  assert.equal(summary.decisionAudit.rows, 6);
  assert.equal(summary.decisionAudit.blockerSummaryRows, 5);
  assert.equal(summary.decisionAudit.blockerSummaryCountMatches, false);
});

test("separates stale or mismatched dispatch evidence from a normal no-order result", async () => {
  const input = await loadBaseline();
  input.source.previewStale = true;
  input.source.expectedStage6Hash = "f".repeat(64);

  const summary = buildSidecarRuntimeEvidenceSummary(input);

  assert.equal(summary.semanticIntegrityStatus, "FAIL_SOURCE_INTEGRITY");
  assert.equal(summary.sourceIntegrity.status, "PREVIEW_STALE_AND_DISPATCH_MISMATCH");
  assert.equal(summary.orderOutcome.primaryNoOrderCause, "STALE_OR_DISPATCH_MISMATCH");
});

test("classifies each supported downstream no-order lane without an unknown fallback", async () => {
  const cases = [
    ["portfolio_held", "PORTFOLIO_HELD"],
    ["portfolio_capacity", "PORTFOLIO_CAPACITY"],
    ["quality_gate", "QUALITY_GATE"],
    ["structure", "STRUCTURE_PROOF"],
    ["risk_geometry", "RISK_GEOMETRY"]
  ];

  for (const [category, expectedCause] of cases) {
    const input = await loadBaseline();
    input.stage6.executablePickRows = 1;
    input.decisionRows = [
      {
        symbol: "DYNAMIC_FIXTURE",
        status: "skipped",
        skipCategory: category,
        stage6DecisionCategory: category
      }
    ];
    input.reportedTopSkipReasonCategories = { [category]: 1 };

    const summary = buildSidecarRuntimeEvidenceSummary(input);
    assert.equal(summary.orderOutcome.primaryNoOrderCause, expectedCause);
    assert.equal(summary.decisionAudit.unknownOrUnclassifiedRows, 0);
  }
});

test("uses the market-session guard only when Stage6 had an executable candidate", async () => {
  const input = await loadBaseline();
  input.stage6.executablePickRows = 1;
  input.decisionRows = [
    {
      symbol: "DYNAMIC_FIXTURE",
      status: "skipped",
      skipCategory: "other",
      stage6DecisionCategory: "quality_gate"
    }
  ];
  input.reportedTopSkipReasonCategories = { other: 1 };
  input.preflight.status = "warn";
  input.preflight.code = "PREFLIGHT_MARKET_CLOSED";
  input.preflight.wouldBlockLive = true;
  input.preflight.marketOpen = false;

  const summary = buildSidecarRuntimeEvidenceSummary(input);

  assert.equal(summary.orderOutcome.primaryNoOrderCause, "MARKET_SESSION_GUARD");
  assert.equal(summary.marketSession.status, "CLOSED_BLOCKED");
});

test("is invariant to ticker renames and never emits row symbols", async () => {
  const input = await loadBaseline();
  const renamed = structuredClone(input);
  renamed.decisionRows = renamed.decisionRows.map((row, index) => ({
    ...row,
    symbol: `RENAMED_${index + 1}`
  }));

  const originalSummary = buildSidecarRuntimeEvidenceSummary(input);
  const renamedSummary = buildSidecarRuntimeEvidenceSummary(renamed);

  assert.deepEqual(renamedSummary, originalSummary);
  const serialized = JSON.stringify(originalSummary);
  for (const row of input.decisionRows) {
    assert.equal(serialized.includes(row.symbol), false);
  }
});

test("publishes the same runtime evidence contract through both canonical artifacts and CI summaries", async () => {
  const [source, workflow, ci] = await Promise.all([
    readFile("src/index.ts", "utf8"),
    readFile(".github/workflows/dry-run.yml", "utf8"),
    readFile(".github/workflows/ci.yml", "utf8")
  ]);

  assert.match(source, /buildSidecarRuntimeEvidenceSummary/);
  assert.match(source, /runtimeEvidence:\s*runtimeEvidence/);
  assert.match(workflow, /primaryNoOrderCause/);
  assert.match(workflow, /blockerSummaryCountMatches/);
  assert.match(workflow, /stateMutationAttempted/);
  assert.match(ci, /npm run ops:test:sidecar-runtime-evidence/);
});
