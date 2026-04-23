import { loadRuntimeConfig } from "../config/policy.js";
import type { LifecycleActionType, PositionLifecycleConfig } from "../config/policy.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  describeHfLivePromotionRequiredMissingCore,
  deriveHfLivePromotionSummaryCore,
  deriveHfTuningAdviceCore,
  deriveHfTuningPhaseCore
} from "./hf-judgement-core.js";
import { parseJsonText } from "./json-utils.js";

function mask(value: string): string {
  if (!value) return "";
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

type EnvCheckResult = {
  missing: string[];
  warnings: string[];
};

type DriveListResponse = {
  files?: Array<{
    id: string;
    name: string;
    modifiedTime?: string;
    size?: string;
    md5Checksum?: string;
  }>;
};

type ApprovalQueueStatus = "pending" | "approved" | "rejected" | "expired";

type ApprovalQueueRecord = {
  id: string;
  type: "trade" | "param_change" | "live_switch";
  symbol?: string;
  side?: string;
  notional?: number;
  limitPrice?: number;
  takeProfit?: number;
  stopLoss?: number;
  detail?: string;
  status: ApprovalQueueStatus;
  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  stage6Hash?: string;
  ttlMinutes?: number;
};

type ApprovalQueueState = {
  queue: ApprovalQueueRecord[];
  updatedAt: string;
};

type ApprovalQueueLoadResult = {
  state: ApprovalQueueState;
  fileId: string | null;
};

type ApprovalQueueGateConfig = {
  required: boolean;
  enforceInPreview: boolean;
  queueFileName: string;
  requestTtlMinutes: number;
};

type ApprovalQueueGateSummary = {
  enabled: boolean;
  required: boolean;
  enforced: boolean;
  previewBypassed: boolean;
  queueFileName: string;
  queueLoaded: boolean;
  queueLoadError: string | null;
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  expired: number;
  matchedApproved: number;
  matchedPending: number;
  createdPending: number;
  blocked: number;
  reason: string;
  blockedSymbols: string[];
};

type Stage6LoadResult = {
  fileId: string;
  fileName: string;
  modifiedTime: string;
  md5Checksum: string;
  sha256: string;
  candidateSymbols: string[];
  candidates: Stage6CandidateSummary[];
  allCandidates: Stage6CandidateSummary[];
  modelTopCandidates: Stage6CandidateSummary[];
  contractContext: Stage6ContractContext | null;
};

type HeldPositionSnapshot = {
  symbol: string;
  qty: number;
  side: "long" | "short";
  marketValue: number | null;
  costBasis: number | null;
  avgEntryPrice: number | null;
  currentPrice: number | null;
  unrealizedPnlPct: number | null;
  intradayPnlPct: number | null;
  ageDays: number | null;
};

type Stage6ContractContext = {
  modelTop6: Stage6CandidateSummary[];
  executablePicks: Stage6CandidateSummary[];
  watchlistTop: Stage6CandidateSummary[];
  decisionCountsPrimary: Record<string, number>;
  decisionCountsTop6: Record<string, number>;
  decisionReasonCountsPrimary: Record<string, number>;
  decisionReasonCountsTop6: Record<string, number>;
};

type Stage6CandidateSummary = {
  symbol: string;
  instrumentType: "common" | "warrant" | "unit" | "right" | "hybrid" | "unknown";
  analysisEligible: boolean | null;
  historyTier: "FULL" | "PROVISIONAL" | "ONBOARDING" | "UNKNOWN";
  symbolLifecycleState:
    | "ACTIVE"
    | "PROVISIONAL"
    | "ONBOARDING"
    | "RECOVERED"
    | "STALE"
    | "RETIRED"
    | "EXCLUDED"
    | "UNKNOWN";
  verdict: string;
  expectedReturn: string;
  expectedReturnPct: number | null;
  entry: string;
  entryValue: number | null;
  target: string;
  targetValue: number | null;
  stop: string;
  stopValue: number | null;
  conviction: string;
  qualityScore: number | null;
  modelRank: number | null;
  executionRank: number | null;
  executionScore: number | null;
  executionBucket: "EXECUTABLE" | "WATCHLIST" | "N/A";
  executionReason:
    | "VALID_EXEC"
    | "WAIT_PULLBACK_TOO_DEEP"
    | "INVALID_GEOMETRY"
    | "INVALID_DATA"
    | "N/A";
  finalDecision:
    | "EXECUTABLE_NOW"
    | "WAIT_PRICE"
    | "BLOCKED_RISK"
    | "BLOCKED_EVENT"
    | "N/A";
  decisionReason: string;
  stage6Tier: "TIER1" | "TIER2" | "NONE" | "N/A";
  stage6TierReason: string;
  stage6TierMultiplier: number | null;
  displacement: number | null;
  ictPos: number | null;
  trendAlignment: string | null;
  entryDistancePct: number | null;
  entryFeasible: boolean | null;
  tradePlanStatus: string;
  hfSentimentLabel: "positive" | "neutral" | "negative" | null;
  hfSentimentScore: number | null;
  hfSentimentStatus: "OK" | "SKIPPED" | "FAILED" | "DISABLED" | "N/A";
  hfSentimentReason: string | null;
  hfSentimentArticleCount: number | null;
  hfSentimentNewestAgeHours: number | null;
  earningsDaysToEvent: number | null;
  shadowIntel: Stage6ShadowIntelSummary | null;
};

type Stage6ShadowIntelSummary = {
  alphaVantage: {
    source: string;
    marketCap: number | null;
    peRatio: number | null;
    beta: number | null;
    earningsDate: string | null;
  } | null;
  secEdgar: {
    source: string;
    cik: string | null;
    latestFormType: string | null;
    latestFiledAt: string | null;
    filingCount30d: number | null;
  } | null;
};

type ShadowFieldParsingSummary = {
  totalCandidates: number;
  alphaVantageParsed: number;
  secEdgarParsed: number;
  alphaVantageCoveragePct: number;
  secEdgarCoveragePct: number;
  alphaVantageSymbols: string[];
  secEdgarSymbols: string[];
};

type DryExecOrderPayload = {
  symbol: string;
  side: "buy";
  type: "limit";
  time_in_force: "day";
  order_class: "bracket";
  limit_price: number;
  notional: number;
  take_profit: { limit_price: number };
  stop_loss: { stop_price: number };
  client_order_id: string;
  idempotencyKey: string;
  conviction?: number;
  actionType?: LifecycleActionType;
  actionReason?: string;
};

type DryExecSkipReason = {
  symbol: string;
  reason: string;
  detail?: string;
  actionType?: LifecycleActionType;
  actionReason?: string;
};

type RegimeProfile = "default" | "risk_off";

type RegimeQualityStatus = "high" | "medium" | "low";

type RegimeQualityGuard = {
  enabled: boolean;
  score: number;
  minScore: number;
  status: RegimeQualityStatus;
  forceRiskOff: boolean;
  reasons: string[];
};

type RegimeHysteresisMeta = {
  enabled: boolean;
  minHoldMin: number;
  previousProfile: RegimeProfile | null;
  desiredProfile: RegimeProfile;
  appliedProfile: RegimeProfile;
  holdRemainingMin: number;
  reason: string;
};

type RegimeEntryGuard = {
  blocked: boolean;
  reason: string;
};

type GuardControlState = {
  haltNewEntries?: boolean;
  source?: string;
  level?: number;
  profile?: string;
  reason?: string;
  updatedAt?: string;
};

type GuardControlGate = {
  enforce: boolean;
  maxAgeMin: number;
  ageMin: number | null;
  blocked: boolean;
  wouldBlockLive: boolean;
  reason: string;
  updatedAt: string | null;
  level: number | null;
  stale: boolean;
};

type RegimeSelection = {
  profile: RegimeProfile;
  baseProfile: RegimeProfile;
  source: "forced" | "market_snapshot" | "finnhub" | "cnbc_direct" | "cnbc_rapidapi" | "env_fallback";
  vix: number | null;
  sourcePriority: "snapshot_first" | "realtime_first";
  snapshotVix: number | null;
  snapshotAgeMin: number | null;
  riskOnThreshold: number;
  riskOffThreshold: number;
  diagnostics: string[];
  quality: RegimeQualityGuard;
  hysteresis: RegimeHysteresisMeta;
  entryGuard: RegimeEntryGuard;
};

type VixLookupResult = {
  vix: number | null;
  reason: string;
  modifiedTime?: string;
  source?: "market_snapshot" | "finnhub" | "cnbc_direct" | "cnbc_rapidapi" | "env_fallback";
};

type ShadowDataBusSummary = {
  enabled: boolean;
  mode: "off" | "shadow_only";
  sources: {
    alpacaReadOnly: boolean;
    alphaVantage: boolean;
    secEdgar: boolean;
    perplexity: boolean;
    supabase: boolean;
  };
  enabledSourceCount: number;
  keyReadiness: {
    alphaVantage: boolean;
    perplexity: boolean;
    supabase: boolean;
    alpaca: boolean;
  };
};

type RegimeGuardState = {
  lastProfile: RegimeProfile;
  lastSwitchedAt: string;
  updatedAt: string;
};

type DryExecBuildResult = {
  payloads: DryExecOrderPayload[];
  skipped: DryExecSkipReason[];
  skipReasonCounts: Record<string, number>;
  actionIntent: {
    enabled: boolean;
    previewOnly: boolean;
    allowedActionTypes: LifecycleActionType[];
    counts: Record<LifecycleActionType, number>;
  };
  notionalPerOrder: number;
  maxOrders: number;
  maxTotalNotional: number;
  minConviction: number;
  minConvictionPolicy: {
    base: number;
    applied: number;
    floor: number;
    ceiling: number;
    marketTighten: number;
    qualityRelief: number;
    sampleCount: number;
    sampleQuantileQ: number;
    sampleQuantileValue: number | null;
    sampleCap: number | null;
  };
  hfSentimentGate: {
    enabled: boolean;
    scoreFloor: number;
    minArticleCount: number;
    maxNewsAgeHours: number;
    earningsWindowEnabled: boolean;
    earningsBlockDays: number;
    earningsReduceDays: number;
    earningsReduceFactor: number;
    positiveReliefMax: number;
    negativeTightenMax: number;
    applied: number;
    reliefCount: number;
    tightenCount: number;
    blockedNegative: number;
    earningsBlocked: number;
    earningsReduced: number;
    netMinConvictionDelta: number;
    sizeReductionEnabled: boolean;
    sizeReductionPct: number;
    sizeReducedCount: number;
    sizeReductionNotionalTotal: number;
    explainLine: string;
  };
  minStopDistancePct: number;
  maxStopDistancePct: number;
  stopDistancePolicy: {
    syncWithStage6: boolean;
    configuredMinPct: number;
    configuredMaxPct: number;
    stage6MinPct: number;
    stage6MaxPct: number;
    appliedMinPct: number;
    appliedMaxPct: number;
    strategy: "stage6_locked" | "stage6_fallback" | "configured";
  };
  entryFeasibility: {
    enforce: boolean;
    maxDistancePct: number;
    checked: number;
    blocked: number;
  };
  stage6Contract: {
    enforce: boolean;
    checked: number;
    executable: number;
    watchlist: number;
    blocked: number;
  };
  regime: RegimeSelection;
  idempotency: {
    enabled: boolean;
    enforced: boolean;
    ttlDays: number;
    newCount: number;
    duplicateCount: number;
  };
};

type PreflightStatus = "pass" | "warn" | "fail" | "skip";

type PreflightResult = {
  enabled: boolean;
  enforced: boolean;
  blocking: boolean;
  wouldBlockLive: boolean;
  simulatedLiveParity: boolean;
  status: PreflightStatus;
  code: string;
  message: string;
  requiredNotional: number;
  dailyMaxNotional: number;
  allowEntryOutsideRth: boolean;
  accountStatus: string | null;
  buyingPower: number | null;
  marketOpen: boolean | null;
  nextOpen: string | null;
};

type OrderLifecycleStatus =
  | "planned"
  | "submitted"
  | "accepted"
  | "partially_filled"
  | "filled"
  | "canceled"
  | "rejected"
  | "expired";

type OrderLifecycleHistoryEntry = {
  at: string;
  from: OrderLifecycleStatus | null;
  to: OrderLifecycleStatus;
  reason: string;
  source: string;
};

type OrderLedgerRecord = {
  idempotencyKey: string;
  symbol: string;
  side: "buy";
  stage6Hash: string;
  stage6File: string;
  mode: string;
  clientOrderId: string;
  status: OrderLifecycleStatus;
  statusReason: string;
  preflightCode: string;
  regimeProfile: RegimeProfile;
  notional: number;
  limitPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  brokerOrderId: string | null;
  createdAt: string;
  updatedAt: string;
  history: OrderLifecycleHistoryEntry[];
};

type OrderLedgerState = {
  orders: Record<string, OrderLedgerRecord>;
  updatedAt: string;
};

type OrderLedgerUpdateResult = {
  enabled: boolean;
  targetStatus: OrderLifecycleStatus | "none";
  upserted: number;
  transitioned: number;
  unchanged: number;
  pruned: number;
};

type BrokerSubmitOrderResult = {
  idempotencyKey: string;
  symbol: string;
  actionType: LifecycleActionType | "N/A";
  attempted: boolean;
  submitted: boolean;
  brokerOrderId: string | null;
  brokerStatus: OrderLifecycleStatus | null;
  reason: string;
};

type BrokerSubmitSummary = {
  enabled: boolean;
  active: boolean;
  reason: string;
  requirePerfGateGo: boolean;
  requireHfLivePromotionPass: boolean;
  perfGateStatus: PerformanceLoopGateStatus | "N/A";
  perfGateReason: string;
  hfLivePromotionStatus: HfLivePromotionStatus | "N/A";
  hfLivePromotionReason: string;
  attempted: number;
  submitted: number;
  failed: number;
  skipped: number;
  orders: Record<string, BrokerSubmitOrderResult>;
};

type OpenEntryOrderGuardConfig = {
  enabled: boolean;
  staleCancelEnabled: boolean;
  staleMinutes: number;
  replaceMinDeltaBps: number;
  replaceMaxChaseBps: number;
  replaceCooldownMinutes: number;
  replaceMaxPerSymbolPerDay: number;
};

type OpenEntryOrderSnapshot = {
  orderId: string;
  symbol: string;
  status: string;
  limitPrice: number | null;
  qty: number | null;
  clientOrderId: string | null;
  submittedAt: string | null;
  submittedAtMs: number;
  ageMinutes: number | null;
  symbolOpenCount: number;
};

type OpenEntryOrderIndex = {
  total: number;
  duplicateSymbols: number;
  bySymbol: Map<string, OpenEntryOrderSnapshot>;
};

type OpenEntryReplaceGuardSymbolState = {
  lastReplaceAt: string | null;
  replaceCountByDay: Record<string, number>;
};

type OpenEntryReplaceGuardState = {
  symbols: Record<string, OpenEntryReplaceGuardSymbolState>;
  updatedAt: string;
};

type OpenEntryReplaceThrottle = {
  lastReplaceAtMs: number | null;
  replaceCountToday: number;
};

type SidecarRunState = {
  lastStage6Sha256: string;
  lastStage6FileId: string;
  lastStage6FileName: string;
  lastMode: string;
  lastSentAt: string;
  lastForceSendKey?: string;
};

type PerformanceLoopRow = {
  rowId: string;
  runDate: string;
  stage6Hash: string;
  stage6File: string;
  symbol: string;
  modelRank: number | null;
  execRank: number | null;
  AQ: number | null;
  XS: number | null;
  decisionReason: string;
  entryPlanned: number | null;
  entryFilled: number | null;
  stopPlanned: number | null;
  targetPlanned: number | null;
  exitPrice: number | null;
  exitReason: string | null;
  holdDaysPlanned: number | null;
  holdDaysActual: number | null;
  RMultiple: number | null;
  slipPct: number | null;
  marketRegime: RegimeProfile;
  notes: string;
};

type PerformanceLoopSnapshot = {
  at: string;
  tradeCount: number;
  filledCount: number;
  closedCount: number;
  fillRatePct: number | null;
  avgR: number | null;
  medianHoldErrorDays: number | null;
  noReasonDrift: number;
  kpiSource: "realized" | "proxy_preflight" | "none";
};

type PerformanceLoopState = {
  batchId: string;
  createdAt: string;
  updatedAt: string;
  policyFingerprint: string;
  rows: Record<string, PerformanceLoopRow>;
  snapshots: PerformanceLoopSnapshot[];
  notifiedMilestones: number[];
};

type PerformanceLoopGateStatus = "PENDING_SAMPLE" | "GO" | "NO_GO" | "NO_DATA";

type PerformanceLoopGate = {
  status: PerformanceLoopGateStatus;
  reason: string;
  progress: string;
  observedTrades: number;
  requiredTrades: number;
  remainingTrades: number;
  progressPct: number;
};

type PerformanceLoopUpdateResult = {
  batchId: string;
  tradeCount: number;
  snapshotCount: number;
  gate: PerformanceLoopGate;
  latestSnapshot: PerformanceLoopSnapshot | null;
  alertMessage: string | null;
  updated: boolean;
};

type HfDriftSnapshot = {
  at: string;
  stage6Hash: string;
  stage6File: string;
  profile: RegimeProfile;
  hfSoftEnabled: boolean;
  payloadCount?: number;
  checkedCandidates: number;
  appliedCount: number;
  tightenCount: number;
  appliedRatio: number;
  negativeRatio: number;
};

type HfDriftState = {
  updatedAt: string;
  snapshots: HfDriftSnapshot[];
};

type HfDriftAlert = {
  enabled: boolean;
  triggered: boolean;
  reason: string;
  requirePayload: boolean;
  payloadCount: number;
  windowRuns: number;
  minHistory: number;
  minCandidates: number;
  checkedCandidates: number;
  baselineSamples: number;
  currentAppliedRatio: number;
  currentNegativeRatio: number;
  baselineAppliedRatio: number;
  baselineNegativeRatio: number;
  thresholds: {
    negativeRatioSpike: number;
    negativeRatioDelta: number;
    appliedRatioDrop: number;
    appliedRatioFloor: number;
  };
};

type HfShadowSummary = {
  enabled: boolean;
  compared: boolean;
  reason: string;
  onPayloadCount: number;
  offPayloadCount: number;
  payloadDelta: number;
  onSkippedCount: number;
  offSkippedCount: number;
  skippedDelta: number;
  onNotional: number;
  offNotional: number;
  notionalDelta: number;
  onOnlySymbols: string[];
  offOnlySymbols: string[];
  skipReasonDelta: string;
  generatedAt: string;
};

type HfShadowHistoryRecord = {
  at: string;
  stage6Hash: string;
  stage6File: string;
  profile: RegimeProfile;
  regimeSource: RegimeSelection["source"];
  vix: number | null;
  payloadCount: number;
  skippedCount: number;
  hfSoftEnabled: boolean;
  hfSoftApplied: number;
  hfSoftNetDelta: number;
  hfSoftExplain: string;
  hfShadowEnabled: boolean;
  hfShadowCompared: boolean;
  hfShadowPayloadDelta: number;
  hfShadowNotionalDelta: number;
  hfShadowSkippedDelta: number;
  hfAlertEnabled: boolean;
  hfAlertTriggered: boolean;
  hfAlertReason: string;
  perfGateStatus: PerformanceLoopGateStatus;
  perfGateProgress: string;
};

type HfShadowTrendSummary = {
  historySize: number;
  windowSize: number;
  comparedRuns: number;
  alertTriggeredRuns: number;
  alertTriggeredRate: number;
  avgAbsPayloadDelta: number;
  avgAbsNotionalDelta: number;
  avgAbsSkippedDelta: number;
  zeroPayloadRate: number;
  latestAt: string | null;
};

type HfEvidenceHistoryRecord = {
  at: string;
  stage6Hash: string;
  stage6File: string;
  profile: RegimeProfile;
  payloadCount: number;
  skippedCount: number;
  hfLivePromotionStatus: HfLivePromotionStatus;
  hfLivePromotionReason: string;
  hfLivePromotionRequiredMissing: string[];
  hfPayloadProbeStatus: HfPayloadProbeStatus;
  hfPayloadProbeReason: string;
  hfAlertTriggered: boolean;
  hfAlertReason: string;
  perfGateStatus: PerformanceLoopGateStatus;
  perfGateProgress: string;
  perfGateRemainingTrades: number;
};

type HfEvidenceHistorySummary = {
  historySize: number;
  latestAt: string | null;
  latestStage6Hash: string | null;
  latestLivePromotionStatus: HfLivePromotionStatus | "N/A";
  latestPayloadProbeStatus: HfPayloadProbeStatus | "N/A";
  latestAlertTriggered: boolean;
  latestGateProgress: string;
  recentWindowSize: number;
  recentPassCount: number;
  recentHoldCount: number;
  recentBlockCount: number;
  recentAlertCount: number;
};

type HfTuningPhase = "OBSERVE_ONLY" | "REVIEW_ONLY" | "FREEZE_READY";

type HfTuningPhaseSummary = {
  phase: HfTuningPhase;
  reason: string;
  recommendation: string;
  gateStatus: PerformanceLoopGateStatus;
  gateProgress: string;
  gateRemainingTrades: number;
  gateProgressPct: number;
  observedTrades: number;
  requiredTrades: number;
  alertTriggered: boolean;
  shadowAlertRate: number;
  generatedAt: string;
};

type HfTuningAdviceStatus = "HOLD" | "ADJUST" | "FREEZE";

type HfTuningAdvice = {
  status: HfTuningAdviceStatus;
  action: string;
  variable: string | null;
  currentValue: number | null;
  suggestedValue: number | null;
  reason: string;
  confidence: "low" | "medium" | "high";
  generatedAt: string;
};

type HfPayloadProbeMode = "off" | "tighten" | "relief";

type HfPayloadProbeSummary = {
  requestedMode: HfPayloadProbeMode;
  active: boolean;
  modified: boolean;
  reason: string;
  symbol: string | null;
  basePayloadCount: number;
  baseSkippedCount: number;
  baseApplied: number;
  baseTighten: number;
  baseRelief: number;
  baseSizeReduced: number;
  baseSizeReductionNotional: number;
  generatedAt: string;
};

type HfPayloadProbeStatus =
  | "PENDING_NO_PAYLOAD"
  | "PENDING_HF_DISABLED"
  | "PENDING_NO_HF_ADJUST"
  | "WARN_SIZE_REDUCE_EXPECTED"
  | "PASS_HF_APPLIED"
  | "PASS_SIZE_REDUCED"
  | "PASS_FORCED_PATH"
  | "PASS_FORCED_SIZE_REDUCED";

type HfPayloadProbeGateSummary = {
  status: HfPayloadProbeStatus;
  reason: string;
  payloadCount: number;
  hfApplied: number;
  tightenCount: number;
  sizeReduceEnabled: boolean;
  sizeReducedCount: number;
  savedNotional: number;
  forced: boolean;
};

type HfFreezeStatus = "DISABLED" | "OBSERVE" | "CANDIDATE" | "FROZEN" | "UNFREEZE_REVIEW";

type HfFreezeSummary = {
  enabled: boolean;
  status: HfFreezeStatus;
  reason: string;
  recommendation: string;
  observedTrades: number;
  requiredProgress: number;
  stableRunStreak: number;
  stableRunsTarget: number;
  alertStreak: number;
  alertStreakThreshold: number;
  shadowAlertRate: number;
  maxShadowAlertRate: number;
  hfAlertTriggered: boolean;
  frozenAt: string | null;
  updatedAt: string;
};

type HfFreezeState = {
  status: HfFreezeStatus;
  stableRunStreak: number;
  alertStreak: number;
  frozenAt: string | null;
  updatedAt: string;
};

type HfLivePromotionStatus = "BLOCK" | "HOLD" | "PASS";

type HfLivePromotionPolicy = {
  requirePerfGateGo: boolean;
  requireFreezeFrozen: boolean;
  requireShadowStable: boolean;
  requirePayloadPathVerified: boolean;
};

type HfLivePromotionSummary = {
  status: HfLivePromotionStatus;
  reason: string;
  recommendation: string;
  payloadPathSource: "none" | "current_live" | "current_probe" | "sticky";
  payloadPathVerifiedAt: string | null;
  policy: HfLivePromotionPolicy;
  checks: {
    perfGateGo: boolean;
    freezeFrozen: boolean;
    alertClear: boolean;
    shadowStable: boolean;
    payloadPathVerified: boolean;
    probeActive: boolean;
    probeMode: HfPayloadProbeMode;
  };
  requiredPass: number;
  requiredTotal: number;
  requiredMissing: string[];
  requiredHintToken: string;
  requiredHintText: string;
  checklistPass: number;
  checklistTotal: number;
  generatedAt: string;
};

type HfLivePromotionState = {
  stage6Hash: string;
  payloadPathVerified: boolean;
  payloadPathVerifiedAt: string | null;
  lastSource: "none" | "current_live" | "current_probe" | "sticky";
  updatedAt: string;
};

type HfPayloadPathStickyAudit = {
  priorStage6Hash: string | null;
  stage6HashChanged: boolean;
  stickyEligible: boolean;
  stickyCarried: boolean;
  stickyReset: boolean;
  stickyResetReason: string;
  currentVerified: boolean;
  currentSource: "none" | "current_live" | "current_probe";
  resolvedVerified: boolean;
  resolvedSource: "none" | "current_live" | "current_probe" | "sticky";
};

type HfPayloadPathVerificationStatus = {
  payloadPathVerified: boolean;
  payloadPathSource: "none" | "current_live" | "current_probe" | "sticky";
  payloadPathVerifiedAt: string | null;
  stickyAudit: HfPayloadPathStickyAudit;
};

type HfNextActionStatus =
  | "BLOCK_ALERT"
  | "BLOCK_PROMOTION"
  | "HOLD_OBSERVE"
  | "HOLD_CHECKLIST"
  | "REVIEW_TUNE"
  | "LIVE_READY"
  | "MONITOR";

type HfNextActionSummary = {
  status: HfNextActionStatus;
  action: string;
  reason: string;
  hint: string;
  requiredMissing: string[];
  livePromotionStatus: HfLivePromotionStatus;
  gateStatus: PerformanceLoopGateStatus;
  gateProgress: string;
  gateRemainingTrades: number;
  generatedAt: string;
};

type HfDailyVerdictStatus = "PASS" | "HOLD" | "BLOCK";

type HfDailyVerdictSummary = {
  status: HfDailyVerdictStatus;
  action: string;
  reason: string;
  requiredMissing: string[];
  livePromotionStatus: HfLivePromotionStatus;
  gateStatus: PerformanceLoopGateStatus;
  gateProgress: string;
  gateRemainingTrades: number;
  generatedAt: string;
};

type HfAnomalyAlert = {
  enabled: boolean;
  triggered: boolean;
  reason: string;
  shadowCompared: boolean;
  shadowPayloadDelta: number;
  shadowNotionalDelta: number;
  shadowSkippedDelta: number;
  driftTriggered: boolean;
  thresholds: {
    shadowPayloadDeltaAbs: number;
    shadowNotionalDeltaAbs: number;
    shadowSkippedDeltaAbs: number;
  };
};

type OrderIdempotencyState = {
  orders: Record<
    string,
    {
      symbol: string;
      side: "buy";
      stage6Hash: string;
      stage6File: string;
      firstSeenAt: string;
      lastSeenAt: string;
    }
  >;
  updatedAt: string;
};

const STATE_PATH = "state/last-run.json";
const DRY_EXEC_PREVIEW_PATH = "state/last-dry-exec-preview.json";
const ORDER_IDEMPOTENCY_PATH = "state/order-idempotency.json";
const ORDER_LEDGER_PATH = "state/order-ledger.json";
const OPEN_ENTRY_REPLACE_GUARD_PATH = "state/open-entry-replace-guard.json";
const REGIME_GUARD_STATE_PATH = "state/regime-guard-state.json";
const GUARD_CONTROL_STATE_PATH = "state/guard-control.json";
const PERFORMANCE_LOOP_JSON_PATH = "state/stage6-20trade-loop.json";
const PERFORMANCE_LOOP_CSV_PATH = "state/stage6-20trade-loop.csv";
const HF_DRIFT_STATE_PATH = "state/hf-drift-state.json";
const HF_SHADOW_STATE_PATH = "state/hf-shadow-last.json";
const HF_SHADOW_HISTORY_PATH = "state/hf-shadow-history.jsonl";
const HF_EVIDENCE_HISTORY_PATH = "state/hf-evidence-history.jsonl";
const HF_TUNING_FREEZE_STATE_PATH = "state/hf-tuning-freeze.json";
const HF_LIVE_PROMOTION_STATE_PATH = "state/hf-live-promotion-state.json";
const HF_SHADOW_HISTORY_WINDOW = 20;
const HF_SHADOW_HISTORY_MAX_ROWS = 200;
const HF_EVIDENCE_HISTORY_WINDOW = 20;
const HF_EVIDENCE_HISTORY_MAX_ROWS = 300;
const PERFORMANCE_LOOP_REQUIRED_TRADES = 20;
const BASE_ACTIONABLE_VERDICTS = new Set(["BUY", "STRONG_BUY"]);
const NON_EXECUTABLE_DECISIONS = new Set(["WAIT_PRICE", "BLOCKED_RISK", "BLOCKED_EVENT"]);
const LIFECYCLE_HARD_EXIT_DECISION_REASONS = new Set([
  "blocked_symbol_stale",
  "blocked_invalid_geometry",
  "blocked_missing_trade_box",
  "blocked_state_verdict_conflict",
  "blocked_verdict_risk_off",
  "blocked_rr_below_min",
  "blocked_ev_non_positive",
  "blocked_earnings_window",
  "blocked_earnings_data_missing"
]);

function resolveActionableVerdicts(): Set<string> {
  const includeSpeculative = readBoolEnv("ACTIONABLE_INCLUDE_SPECULATIVE_BUY", false);
  if (!includeSpeculative) return new Set(BASE_ACTIONABLE_VERDICTS);
  return new Set([...BASE_ACTIONABLE_VERDICTS, "SPECULATIVE_BUY"]);
}

function formatActionableVerdicts(verdicts: Set<string>): string {
  return Array.from(verdicts.values()).join("/");
}

const ORDER_TRANSITIONS: Record<OrderLifecycleStatus, Set<OrderLifecycleStatus>> = {
  planned: new Set(["submitted", "accepted", "canceled", "rejected", "expired"]),
  submitted: new Set(["accepted", "partially_filled", "filled", "canceled", "rejected", "expired"]),
  accepted: new Set(["partially_filled", "filled", "canceled", "rejected", "expired"]),
  partially_filled: new Set(["partially_filled", "filled", "canceled", "rejected", "expired"]),
  filled: new Set(),
  canceled: new Set(),
  rejected: new Set(),
  expired: new Set()
};

function hasValue(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

function buildOpenEntryOrderGuardConfig(): OpenEntryOrderGuardConfig {
  return {
    enabled: readBoolEnv("ENTRY_OPEN_ORDER_GUARD_ENABLED", true),
    staleCancelEnabled: readBoolEnv("ENTRY_OPEN_ORDER_STALE_CANCEL_ENABLED", false),
    staleMinutes: Math.max(5, Math.round(readNonNegativeNumberEnv("ENTRY_OPEN_ORDER_STALE_MINUTES", 180))),
    replaceMinDeltaBps: Math.max(0, Math.round(readNonNegativeNumberEnv("ENTRY_OPEN_ORDER_REPLACE_MIN_DELTA_BPS", 10))),
    replaceMaxChaseBps: Math.max(0, Math.round(readNonNegativeNumberEnv("ENTRY_OPEN_ORDER_REPLACE_MAX_CHASE_BPS", 120))),
    replaceCooldownMinutes: Math.max(
      0,
      Math.round(readNonNegativeNumberEnv("ENTRY_OPEN_ORDER_REPLACE_COOLDOWN_MINUTES", 10))
    ),
    replaceMaxPerSymbolPerDay: Math.max(
      1,
      Math.round(readNonNegativeNumberEnv("ENTRY_OPEN_ORDER_REPLACE_MAX_PER_SYMBOL_PER_DAY", 3))
    )
  };
}

function normalizeApprovalQueueStatus(raw: unknown): ApprovalQueueStatus {
  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "approved") return "approved";
  if (normalized === "rejected") return "rejected";
  if (normalized === "expired") return "expired";
  return "pending";
}

function buildApprovalQueueGateConfig(): ApprovalQueueGateConfig {
  return {
    required: readBoolEnv("APPROVAL_REQUIRED", false),
    enforceInPreview: readBoolEnv("APPROVAL_ENFORCE_IN_PREVIEW", false),
    queueFileName: String(process.env.APPROVAL_QUEUE_FILE_NAME || "APPROVAL_QUEUE.json").trim() || "APPROVAL_QUEUE.json",
    requestTtlMinutes: Math.max(5, Math.round(readNonNegativeNumberEnv("APPROVAL_REQUEST_TTL_MINUTES", 180)))
  };
}

function createApprovalQueueState(): ApprovalQueueState {
  return { queue: [], updatedAt: new Date().toISOString() };
}

function createApprovalQueueGateSummary(
  cfg: ApprovalQueueGateConfig,
  reason: string,
  overrides?: Partial<ApprovalQueueGateSummary>
): ApprovalQueueGateSummary {
  return {
    enabled: cfg.required,
    required: cfg.required,
    enforced: false,
    previewBypassed: false,
    queueFileName: cfg.queueFileName,
    queueLoaded: false,
    queueLoadError: null,
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    expired: 0,
    matchedApproved: 0,
    matchedPending: 0,
    createdPending: 0,
    blocked: 0,
    reason,
    blockedSymbols: [],
    ...(overrides || {})
  };
}

function formatApprovalQueueGateSummary(summary: ApprovalQueueGateSummary): string {
  return [
    `enabled:${summary.enabled}`,
    `required:${summary.required}`,
    `enforced:${summary.enforced}`,
    `previewBypassed:${summary.previewBypassed}`,
    `queueLoaded:${summary.queueLoaded}`,
    `queueFile:${summary.queueFileName}`,
    `total:${summary.total}`,
    `pending:${summary.pending}`,
    `approved:${summary.approved}`,
    `rejected:${summary.rejected}`,
    `expired:${summary.expired}`,
    `matchedApproved:${summary.matchedApproved}`,
    `matchedPending:${summary.matchedPending}`,
    `createdPending:${summary.createdPending}`,
    `blocked:${summary.blocked}`,
    `reason:${summary.reason}`,
    `blockedSample:${summarizeSymbols(summary.blockedSymbols)}`
  ].join("|");
}

function normalizeStage6Verdict(raw: unknown): string {
  const key = String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "_").replace(/-/g, "_");
  if (!key || key === "N/A" || key === "NA" || key === "NONE" || key === "NULL" || key === "UNDEFINED" || key === "TBD") {
    return "HOLD";
  }
  if (key === "STRONGBUY") return "STRONG_BUY";
  if (key === "SPECULATIVEBUY") return "SPECULATIVE_BUY";
  if (key === "WATCH" || key === "WAIT" || key === "OBSERVE" || key === "NEUTRAL") return "HOLD";
  if (key === "SELL" || key === "EXIT" || key === "REDUCE" || key === "TRIM") return "PARTIAL_EXIT";
  if (key === "ACCUMULATE" || key === "LONG") return "BUY";
  return key;
}

function isMissingContractToken(value: unknown): boolean {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  return (
    !normalized ||
    normalized === "N/A" ||
    normalized === "NA" ||
    normalized === "NONE" ||
    normalized === "NULL" ||
    normalized === "UNDEFINED" ||
    normalized === "TBD"
  );
}

function runEnvGuard(): EnvCheckResult {
  const cfg = loadRuntimeConfig();
  const missing: string[] = [];
  const warnings: string[] = [];
  const telegramSendEnabled = readBoolEnv("TELEGRAM_SEND_ENABLED", true);

  const requiredAlways = [
    "ALPACA_BASE_URL",
    "GDRIVE_CLIENT_ID",
    "GDRIVE_CLIENT_SECRET",
    "GDRIVE_REFRESH_TOKEN",
    "GDRIVE_ROOT_FOLDER_ID",
    "GDRIVE_STAGE6_FOLDER",
    "GDRIVE_REPORT_FOLDER"
  ];

  for (const key of requiredAlways) {
    if (!hasValue(process.env[key])) missing.push(key);
  }

  if (telegramSendEnabled) {
    for (const key of ["TELEGRAM_TOKEN", "TELEGRAM_PRIMARY_CHAT_ID", "TELEGRAM_SIMULATION_CHAT_ID"]) {
      if (!hasValue(process.env[key])) missing.push(key);
    }
  } else {
    if (!hasValue(process.env.TELEGRAM_TOKEN) || !hasValue(process.env.TELEGRAM_SIMULATION_CHAT_ID)) {
      warnings.push("TELEGRAM send disabled; TELEGRAM_TOKEN/TELEGRAM_SIMULATION_CHAT_ID missing is allowed");
    }
  }

  const needsAlpacaCreds = cfg.execEnabled || !cfg.readOnly || cfg.simulationLiveParity;
  if (needsAlpacaCreds) {
    for (const key of ["ALPACA_KEY_ID", "ALPACA_SECRET_KEY"]) {
      if (!hasValue(process.env[key])) missing.push(key);
    }
  } else {
    if (!hasValue(process.env.ALPACA_KEY_ID) || !hasValue(process.env.ALPACA_SECRET_KEY)) {
      warnings.push("ALPACA_KEY_ID/ALPACA_SECRET_KEY unset (allowed in READ_ONLY dry-run)");
    }
  }

  return { missing, warnings };
}

function printStartupSummary() {
  const cfg = loadRuntimeConfig();
  const now = new Date().toISOString();
  const check = runEnvGuard();
  const shadowDataBus = buildShadowDataBusSummary();
  const approvalCfg = buildApprovalQueueGateConfig();
  const openEntryGuardCfg = buildOpenEntryOrderGuardConfig();
  const lifecycleThresholds = resolveLifecycleHeldConvictionThresholds(cfg.positionLifecycle);
  const lifecycleExitFullMaxLossPct = clamp(
    readNonNegativeNumberEnv("POSITION_LIFECYCLE_EXIT_FULL_MAX_LOSS_PCT", 0.08),
    0.01,
    0.5
  );
  const lifecycleExitPartialMaxLossPct = clamp(
    readNonNegativeNumberEnv("POSITION_LIFECYCLE_EXIT_PARTIAL_MAX_LOSS_PCT", 0.05),
    0.01,
    0.5
  );
  const lifecycleScaleDownMaxLossPct = clamp(
    readNonNegativeNumberEnv("POSITION_LIFECYCLE_SCALE_DOWN_MAX_LOSS_PCT", 0.03),
    0.005,
    0.5
  );
  const lifecycleRiskOffIntradayShockPct = clamp(
    readNonNegativeNumberEnv("POSITION_LIFECYCLE_RISK_OFF_INTRADAY_SHOCK_PCT", 0.025),
    0.005,
    0.3
  );
  const lifecycleTakeProfitPartialPct = clamp(
    readNonNegativeNumberEnv("POSITION_LIFECYCLE_TAKE_PROFIT_PARTIAL_PCT", 0.18),
    0.02,
    2
  );
  const lifecycleScaleUpMaxChaseFromAvgEntryPct = clamp(
    readNonNegativeNumberEnv("POSITION_LIFECYCLE_SCALE_UP_MAX_CHASE_FROM_AVG_ENTRY_PCT", 0.03),
    0,
    0.5
  );
  const lifecycleScaleUpMaxIntradayGainPct = clamp(
    readNonNegativeNumberEnv("POSITION_LIFECYCLE_SCALE_UP_MAX_INTRADAY_GAIN_PCT", 0.02),
    0,
    0.5
  );
  const lifecycleStaleHoldDays = clamp(
    readNonNegativeNumberEnv("POSITION_LIFECYCLE_STALE_HOLD_DAYS", 15),
    1,
    365
  );

  console.log("=== alpha-exec-engine bootstrap ===");
  console.log(`timestamp        : ${now}`);
  console.log(`policyVersion    : ${cfg.policyVersion}`);
  console.log(`timezone         : ${cfg.timezone}`);
  console.log(`EXEC_ENABLED     : ${cfg.execEnabled}`);
  console.log(`READ_ONLY        : ${cfg.readOnly}`);
  console.log(`LIVE_PARITY_SIM  : ${cfg.simulationLiveParity}`);
  console.log(`LIFECYCLE_ENABLE : ${cfg.positionLifecycle.enabled}`);
  console.log(`LIFECYCLE_PREVIEW: ${cfg.positionLifecycle.previewOnly}`);
  console.log(`LIFECYCLE_ACTIONS: ${cfg.positionLifecycle.allowedActionTypes.join("/")}`);
  console.log(`LIFECYCLE_SCALEUP: ${cfg.positionLifecycle.scaleUpMinConviction}`);
  console.log(`LIFECYCLE_SCALEDN: ${cfg.positionLifecycle.scaleDownPct}`);
  console.log(`LIFECYCLE_EXPART : ${cfg.positionLifecycle.exitPartialPct}`);
  console.log(`LIFECYCLE_SDMAXC: ${lifecycleThresholds.scaleDownMax}`);
  console.log(`LIFECYCLE_EPMAXC: ${lifecycleThresholds.exitPartialMax}`);
  console.log(`LIFECYCLE_EFMAXC: ${lifecycleThresholds.exitFullMax}`);
  console.log(`LIFECYCLE_EXIT_WL: ${lifecycleThresholds.exitOnWatchlist}`);
  console.log(`LIFECYCLE_EXIT_BL: ${lifecycleThresholds.exitOnBlocked}`);
  console.log(`LIFECYCLE_EXFLOSS: ${lifecycleExitFullMaxLossPct}`);
  console.log(`LIFECYCLE_EXPLOSS: ${lifecycleExitPartialMaxLossPct}`);
  console.log(`LIFECYCLE_SDNLOSS: ${lifecycleScaleDownMaxLossPct}`);
  console.log(`LIFECYCLE_RISKSHK: ${lifecycleRiskOffIntradayShockPct}`);
  console.log(`LIFECYCLE_TPPRTL: ${lifecycleTakeProfitPartialPct}`);
  console.log(`LIFECYCLE_SUCHAS: ${lifecycleScaleUpMaxChaseFromAvgEntryPct}`);
  console.log(`LIFECYCLE_SUINTR: ${lifecycleScaleUpMaxIntradayGainPct}`);
  console.log(`LIFECYCLE_STALE_D: ${lifecycleStaleHoldDays}`);
  console.log(`LIFECYCLE_SELFTS: ${readBoolEnv("LIFECYCLE_SELFTEST", false)}`);
  console.log(`APPROVAL_REQ    : ${approvalCfg.required}`);
  console.log(`APPROVAL_PREVIEW: ${approvalCfg.enforceInPreview}`);
  console.log(`APPROVAL_TTL_MIN: ${approvalCfg.requestTtlMinutes}`);
  console.log(`HF_SOFT_GATE_EN : ${readBoolEnv("HF_SENTIMENT_SOFT_GATE_ENABLED", false)}`);
  console.log(`HF_SOFT_SCORE_FL: ${clamp(readNonNegativeNumberEnv("HF_SENTIMENT_SCORE_FLOOR", 0.55), 0.5, 0.95)}`);
  console.log(`HF_SOFT_MIN_ART : ${Math.max(0, Math.round(readNonNegativeNumberEnv("HF_SENTIMENT_MIN_ARTICLE_COUNT", 2)))}`);
  console.log(`HF_SOFT_MAX_AGEH: ${clamp(readNonNegativeNumberEnv("HF_SENTIMENT_MAX_NEWS_AGE_HOURS", 24), 1, 240)}`);
  console.log(`HF_EARN_WIN_EN  : ${readBoolEnv("HF_EARNINGS_WINDOW_ENABLED", true)}`);
  console.log(`HF_EARN_WIN_BLK : ${Math.max(0, Math.round(readNonNegativeNumberEnv("HF_EARNINGS_WINDOW_BLOCK_DAYS", 1)))}`);
  console.log(`HF_EARN_WIN_RED : ${Math.max(0, Math.round(readNonNegativeNumberEnv("HF_EARNINGS_WINDOW_REDUCE_DAYS", 3)))}`);
  console.log(`HF_EARN_WIN_FAC : ${clamp(readNonNegativeNumberEnv("HF_EARNINGS_WINDOW_REDUCE_FACTOR", 0.3), 0, 1)}`);
  console.log(`HF_SOFT_RELIEF  : ${clamp(readNonNegativeNumberEnv("HF_SENTIMENT_POSITIVE_RELIEF_MAX", 1.0), 0, 3)}`);
  console.log(`HF_SOFT_TIGHTEN : ${clamp(readNonNegativeNumberEnv("HF_SENTIMENT_NEGATIVE_TIGHTEN_MAX", 2.0), 0, 4)}`);
  console.log(`HF_PROBE_MODE   : ${parseHfPayloadProbeMode(process.env.HF_PAYLOAD_PROBE_MODE)}`);
  console.log(`HF_SIZE_NEG_EN  : ${readBoolEnv("HF_NEGATIVE_SIZE_REDUCTION_ENABLED", false)}`);
  console.log(`HF_SIZE_NEG_PCT : ${clamp(readNonNegativeNumberEnv("HF_NEGATIVE_SIZE_REDUCTION_PCT", 0.15), 0, 0.5)}`);
  console.log(`HF_SHADOW_EN    : ${readBoolEnv("HF_SHADOW_ENABLED", false)}`);
  console.log(`HF_ALERT_EN     : ${readBoolEnv("HF_ALERT_ENABLED", true)}`);
  console.log(`HF_ALERT_PAY_D  : ${Math.max(1, Math.round(readNonNegativeNumberEnv("HF_ALERT_SHADOW_PAYLOAD_DELTA_ABS", 2)))}`);
  console.log(`HF_ALERT_NOT_D  : ${clamp(readNonNegativeNumberEnv("HF_ALERT_SHADOW_NOTIONAL_DELTA_ABS", 1000), 0, 1000000)}`);
  console.log(`HF_ALERT_SKP_D  : ${Math.max(1, Math.round(readNonNegativeNumberEnv("HF_ALERT_SHADOW_SKIPPED_DELTA_ABS", 2)))}`);
  console.log(`HF_DRIFT_EN     : ${readBoolEnv("HF_DRIFT_ALERT_ENABLED", true)}`);
  console.log(`HF_DRIFT_WIN_N  : ${Math.max(3, Math.min(30, Math.round(readNonNegativeNumberEnv("HF_DRIFT_ALERT_WINDOW_RUNS", 8))))}`);
  console.log(`HF_DRIFT_MIN_H  : ${Math.max(2, Math.round(readNonNegativeNumberEnv("HF_DRIFT_ALERT_MIN_HISTORY", 4)))}`);
  console.log(`HF_DRIFT_MIN_C  : ${Math.max(1, Math.round(readNonNegativeNumberEnv("HF_DRIFT_ALERT_MIN_CANDIDATES", 3)))}`);
  console.log(`HF_DRIFT_NEG_ABS: ${clamp(readNonNegativeNumberEnv("HF_DRIFT_ALERT_NEGATIVE_RATIO_SPIKE", 0.75), 0, 1)}`);
  console.log(`HF_DRIFT_NEG_DEL: ${clamp(readNonNegativeNumberEnv("HF_DRIFT_ALERT_NEGATIVE_RATIO_DELTA", 0.35), 0, 1)}`);
  console.log(`HF_DRIFT_APP_DRP: ${clamp(readNonNegativeNumberEnv("HF_DRIFT_ALERT_APPLIED_RATIO_DROP", 0.25), 0, 1)}`);
  console.log(`HF_DRIFT_APP_FLR: ${clamp(readNonNegativeNumberEnv("HF_DRIFT_ALERT_APPLIED_RATIO_FLOOR", 0.15), 0, 1)}`);
  console.log(`HF_DRIFT_REQ_PAY: ${readBoolEnv("HF_DRIFT_ALERT_REQUIRE_PAYLOAD", true)}`);
  console.log(`HF_FREEZE_EN    : ${readBoolEnv("HF_TUNING_FREEZE_ENABLED", false)}`);
  console.log(`HF_FREEZE_STBL  : ${Math.max(1, Math.round(readNonNegativeNumberEnv("HF_TUNING_FREEZE_STABLE_RUNS", 3)))}`);
  console.log(`HF_FREEZE_UNFRZ : ${Math.max(1, Math.round(readNonNegativeNumberEnv("HF_TUNING_UNFREEZE_ALERT_STREAK", 2)))}`);
  console.log(`HF_FREEZE_REQP  : ${Math.max(1, Math.round(readNonNegativeNumberEnv("HF_TUNING_FREEZE_REQUIRE_PROGRESS", 20)))}`);
  console.log(`HF_FREEZE_SHDW  : ${clamp(readNonNegativeNumberEnv("HF_TUNING_FREEZE_MAX_SHADOW_ALERT_RATE", 0.1), 0, 1)}`);
  console.log(`HF_PROMO_REQ_G  : ${readBoolEnv("HF_LIVE_PROMOTION_REQUIRE_PERF_GATE_GO", true)}`);
  console.log(`HF_PROMO_REQ_F  : ${readBoolEnv("HF_LIVE_PROMOTION_REQUIRE_FREEZE_FROZEN", true)}`);
  console.log(`HF_PROMO_REQ_S  : ${readBoolEnv("HF_LIVE_PROMOTION_REQUIRE_SHADOW_STABLE", true)}`);
  console.log(`HF_PROMO_REQ_P  : ${readBoolEnv("HF_LIVE_PROMOTION_REQUIRE_PAYLOAD_PATH_VERIFIED", true)}`);
  console.log(
    `HF_PROMO_STICKYH: ${clamp(readNonNegativeNumberEnv("HF_LIVE_PROMOTION_PAYLOAD_PATH_STICKY_HOURS", 168), 0, 720)}`
  );
  console.log(`LIVE_SUBMIT_EN  : ${readBoolEnv("LIVE_ORDER_SUBMIT_ENABLED", false)}`);
  console.log(`LIVE_SUBMIT_REQG: ${readBoolEnv("LIVE_ORDER_SUBMIT_REQUIRE_PERF_GATE_GO", true)}`);
  console.log(
    `LIVE_SUBMIT_REQH: ${readBoolEnv("LIVE_ORDER_SUBMIT_REQUIRE_HF_LIVE_PROMOTION_PASS", true)}`
  );
  console.log(`OPEN_ENTRY_GUARD: ${openEntryGuardCfg.enabled}`);
  console.log(`OPEN_ENTRY_STALE: ${openEntryGuardCfg.staleCancelEnabled}`);
  console.log(`OPEN_ENTRY_STMIN: ${openEntryGuardCfg.staleMinutes}`);
  console.log(`OPEN_ENTRY_RDEL : ${openEntryGuardCfg.replaceMinDeltaBps}`);
  console.log(`OPEN_ENTRY_RMAX : ${openEntryGuardCfg.replaceMaxChaseBps}`);
  console.log(`OPEN_ENTRY_RCDN : ${openEntryGuardCfg.replaceCooldownMinutes}`);
  console.log(`OPEN_ENTRY_RDAY : ${openEntryGuardCfg.replaceMaxPerSymbolPerDay}`);
  console.log(`TELEGRAM_SEND   : ${readBoolEnv("TELEGRAM_SEND_ENABLED", true)}`);
  console.log(
    `SHADOW_DATA_BUS : enabled=${shadowDataBus.enabled} mode=${shadowDataBus.mode} sources=${formatShadowDataBusSources(shadowDataBus)} keys=${formatShadowDataBusKeyReadiness(shadowDataBus)}`
  );
  console.log(`ALPACA_BASE_URL  : ${process.env.ALPACA_BASE_URL || "(unset)"}`);
  console.log(`TELEGRAM_PRIMARY : ${mask(process.env.TELEGRAM_PRIMARY_CHAT_ID || "")}`);
  console.log(`TELEGRAM_SIM     : ${mask(process.env.TELEGRAM_SIMULATION_CHAT_ID || "")}`);
  console.log(`TELEGRAM_ALERT   : ${mask(process.env.TELEGRAM_ALERT_CHAT_ID || "")}`);
  console.log(`GDRIVE_ROOT      : ${mask(process.env.GDRIVE_ROOT_FOLDER_ID || "")}`);
  console.log(`GDRIVE_STAGE6    : ${mask(process.env.GDRIVE_STAGE6_FOLDER || "")}`);
  console.log(`GDRIVE_REPORT    : ${mask(process.env.GDRIVE_REPORT_FOLDER || "")}`);

  if (!cfg.readOnly && !cfg.execEnabled) {
    console.warn("[WARN] READ_ONLY is false but EXEC_ENABLED is false. No orders will run.");
  }

  if (!cfg.readOnly && cfg.execEnabled) {
    console.warn("[WARN] Execution mode enabled. Ensure this is intended.");
  }

  if (check.warnings.length > 0) {
    for (const warning of check.warnings) {
      console.warn(`[WARN] ${warning}`);
    }
  }

  if (check.missing.length > 0) {
    console.error(`[ENV_GUARD] FAIL missing=${check.missing.join(", ")}`);
    process.exit(1);
  }

  console.log("[ENV_GUARD] OK");
  console.log("bootstrap status : OK");
}

async function getGoogleAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: process.env.GDRIVE_CLIENT_ID || "",
    client_secret: process.env.GDRIVE_CLIENT_SECRET || "",
    refresh_token: process.env.GDRIVE_REFRESH_TOKEN || "",
    grant_type: "refresh_token"
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google token refresh failed (${response.status}): ${text.slice(0, 240)}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Google token refresh response missing access_token");
  }
  return data.access_token;
}

async function fetchLatestStage6Metadata(accessToken: string) {
  const folderId = process.env.GDRIVE_STAGE6_FOLDER || "";
  const query = [
    `'${folderId}' in parents`,
    "trashed=false",
    "mimeType='application/json'",
    "name contains 'STAGE6_ALPHA_FINAL_'"
  ].join(" and ");

  const params = new URLSearchParams({
    q: query,
    orderBy: "modifiedTime desc",
    pageSize: "1",
    fields: "files(id,name,modifiedTime,size,md5Checksum)"
  });

  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Drive list failed (${response.status}): ${text.slice(0, 240)}`);
  }

  const data = (await response.json()) as DriveListResponse;
  const file = data.files?.[0];
  if (!file?.id || !file.name) {
    throw new Error("No STAGE6_ALPHA_FINAL_* file found in GDRIVE_STAGE6_FOLDER");
  }
  return {
    id: file.id,
    name: file.name,
    modifiedTime: file.modifiedTime || "unknown",
    md5Checksum: file.md5Checksum || "n/a"
  };
}

async function downloadStage6Json(accessToken: string, fileId: string): Promise<string> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Drive download failed (${response.status}): ${text.slice(0, 240)}`);
  }
  return response.text();
}

function normalizeApprovalQueueState(raw: unknown): ApprovalQueueState {
  if (!raw || typeof raw !== "object") return createApprovalQueueState();
  const node = raw as Record<string, unknown>;
  const queueRaw = Array.isArray(node.queue) ? node.queue : [];
  const queue: ApprovalQueueRecord[] = [];
  for (const item of queueRaw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? "").trim();
    if (!id) continue;
    const symbol = String(row.symbol ?? "")
      .trim()
      .toUpperCase();
    const stage6Hash = String(row.stage6Hash ?? "").trim().toLowerCase();
    queue.push({
      id,
      type: row.type === "param_change" || row.type === "live_switch" ? (row.type as ApprovalQueueRecord["type"]) : "trade",
      symbol: symbol || undefined,
      side: typeof row.side === "string" ? row.side : undefined,
      notional: parseFiniteNumber(row.notional) ?? undefined,
      limitPrice: parseFiniteNumber(row.limitPrice) ?? undefined,
      takeProfit: parseFiniteNumber(row.takeProfit) ?? undefined,
      stopLoss: parseFiniteNumber(row.stopLoss) ?? undefined,
      detail: typeof row.detail === "string" ? row.detail : undefined,
      status: normalizeApprovalQueueStatus(row.status),
      requestedAt:
        typeof row.requestedAt === "string" && row.requestedAt.trim().length > 0
          ? row.requestedAt
          : new Date().toISOString(),
      resolvedAt: typeof row.resolvedAt === "string" ? row.resolvedAt : undefined,
      resolvedBy: typeof row.resolvedBy === "string" ? row.resolvedBy : undefined,
      stage6Hash: stage6Hash || undefined,
      ttlMinutes:
        typeof row.ttlMinutes === "number" && Number.isFinite(row.ttlMinutes) ? Math.max(5, Math.round(row.ttlMinutes)) : undefined
    });
  }
  return {
    queue,
    updatedAt:
      typeof node.updatedAt === "string" && node.updatedAt.trim().length > 0
        ? node.updatedAt
        : new Date().toISOString()
  };
}

async function loadApprovalQueueFromDrive(
  accessToken: string,
  cfg: ApprovalQueueGateConfig
): Promise<ApprovalQueueLoadResult> {
  const folderId = (process.env.GDRIVE_ROOT_FOLDER_ID || "").trim();
  if (!folderId) {
    throw new Error("GDRIVE_ROOT_FOLDER_ID missing");
  }
  const escapedName = cfg.queueFileName.replace(/'/g, "\\'");
  const query = [`'${folderId}' in parents`, "trashed=false", `name = '${escapedName}'`].join(" and ");
  const params = new URLSearchParams({
    q: query,
    pageSize: "1",
    fields: "files(id,name,modifiedTime)"
  });
  const listResponse = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!listResponse.ok) {
    const text = await listResponse.text();
    throw new Error(`approval queue list failed (${listResponse.status}): ${text.slice(0, 180)}`);
  }
  const listData = (await listResponse.json()) as DriveListResponse;
  const file = listData.files?.[0];
  if (!file?.id) {
    return { state: createApprovalQueueState(), fileId: null };
  }
  const download = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!download.ok) {
    const text = await download.text();
    throw new Error(`approval queue download failed (${download.status}): ${text.slice(0, 180)}`);
  }
  const text = await download.text();
  const parsed = parseJsonText<ApprovalQueueState>(text, "approval_queue_state");
  return { state: normalizeApprovalQueueState(parsed), fileId: file.id };
}

async function saveApprovalQueueToDrive(
  accessToken: string,
  cfg: ApprovalQueueGateConfig,
  state: ApprovalQueueState,
  existingFileId: string | null
): Promise<string | null> {
  const folderId = (process.env.GDRIVE_ROOT_FOLDER_ID || "").trim();
  if (!folderId) return existingFileId;
  const normalizedState = normalizeApprovalQueueState({
    queue: state.queue,
    updatedAt: state.updatedAt
  });
  const metadata = existingFileId
    ? { name: cfg.queueFileName, mimeType: "application/json" }
    : { name: cfg.queueFileName, mimeType: "application/json", parents: [folderId] };
  const boundary = `----ApprovalQueueBoundary${Date.now()}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json",
    "",
    JSON.stringify(normalizedState, null, 2),
    `--${boundary}--`
  ].join("\r\n");
  const url = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingFileId)}?uploadType=multipart`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
  const method = existingFileId ? "PATCH" : "POST";
  const upload = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body
  });
  if (!upload.ok) {
    const text = await upload.text();
    throw new Error(`approval queue upload failed (${upload.status}): ${text.slice(0, 180)}`);
  }
  const json = (await upload.json()) as { id?: string };
  return json.id || existingFileId;
}

function isApprovalRecordForCurrentStage(record: ApprovalQueueRecord, stage6Hash: string): boolean {
  const rowHash = String(record.stage6Hash ?? "")
    .trim()
    .toLowerCase();
  return rowHash.length > 0 && rowHash === stage6Hash.toLowerCase();
}

function sortApprovalRecordsLatestFirst(records: ApprovalQueueRecord[]): ApprovalQueueRecord[] {
  const next = [...records];
  next.sort((a, b) => {
    const aTs = Date.parse(a.resolvedAt || a.requestedAt || "");
    const bTs = Date.parse(b.resolvedAt || b.requestedAt || "");
    const aScore = Number.isFinite(aTs) ? aTs : 0;
    const bScore = Number.isFinite(bTs) ? bTs : 0;
    return bScore - aScore;
  });
  return next;
}

function computeApprovalQueueStatusCounts(state: ApprovalQueueState): Pick<
  ApprovalQueueGateSummary,
  "total" | "pending" | "approved" | "rejected" | "expired"
> {
  let pending = 0;
  let approved = 0;
  let rejected = 0;
  let expired = 0;
  for (const row of state.queue) {
    if (row.status === "approved") approved += 1;
    else if (row.status === "rejected") rejected += 1;
    else if (row.status === "expired") expired += 1;
    else pending += 1;
  }
  return { total: state.queue.length, pending, approved, rejected, expired };
}

async function applyApprovalQueueGate(
  accessToken: string,
  stage6: Stage6LoadResult,
  dryExec: DryExecBuildResult,
  preflight: PreflightResult,
  cfg: ReturnType<typeof loadRuntimeConfig>
): Promise<{ dryExec: DryExecBuildResult; summary: ApprovalQueueGateSummary }> {
  const gateCfg = buildApprovalQueueGateConfig();
  const blockAllPayloads = (
    reason: string,
    detail: string,
    summaryOverrides?: Partial<ApprovalQueueGateSummary>
  ): { dryExec: DryExecBuildResult; summary: ApprovalQueueGateSummary } => {
    const actionIntentCounts = { ...dryExec.actionIntent.counts };
    const blockedSkips: DryExecSkipReason[] = [];
    const passthroughPayloads: DryExecOrderPayload[] = [];
    for (const payload of dryExec.payloads) {
      if (!isApprovalRequiredForPayloadAction(payload.actionType)) {
        passthroughPayloads.push(payload);
        continue;
      }
      if (dryExec.actionIntent.enabled && payload.actionType && actionIntentCounts[payload.actionType] > 0) {
        actionIntentCounts[payload.actionType] -= 1;
      }
      if (dryExec.actionIntent.enabled && dryExec.actionIntent.allowedActionTypes.includes("HOLD_WAIT")) {
        actionIntentCounts.HOLD_WAIT += 1;
      }
      blockedSkips.push({
        symbol: payload.symbol,
        reason,
        detail,
        actionType: "HOLD_WAIT",
        actionReason: reason
      });
    }
    const nextDryExec: DryExecBuildResult = {
      ...dryExec,
      payloads: passthroughPayloads,
      skipped: [...dryExec.skipped, ...blockedSkips],
      skipReasonCounts: buildSkipReasonCounts([...dryExec.skipped, ...blockedSkips]),
      actionIntent: {
        ...dryExec.actionIntent,
        counts: actionIntentCounts
      }
    };
    const summary = createApprovalQueueGateSummary(gateCfg, reason, {
      enabled: true,
      required: true,
      enforced: true,
      blocked: blockedSkips.length,
      blockedSymbols: blockedSkips.map((row) => row.symbol),
      ...(summaryOverrides || {})
    });
    return { dryExec: nextDryExec, summary };
  };

  if (!gateCfg.required) {
    return { dryExec, summary: createApprovalQueueGateSummary(gateCfg, "disabled") };
  }
  if (dryExec.payloads.length === 0) {
    return { dryExec, summary: createApprovalQueueGateSummary(gateCfg, "no_payload") };
  }
  const approvalTargetCount = dryExec.payloads.filter((row) =>
    isApprovalRequiredForPayloadAction(row.actionType)
  ).length;
  if (approvalTargetCount === 0) {
    return { dryExec, summary: createApprovalQueueGateSummary(gateCfg, "no_approval_target_payload") };
  }
  if (preflight.blocking) {
    return { dryExec, summary: createApprovalQueueGateSummary(gateCfg, "preflight_blocking") };
  }
  const enforceNow = cfg.execEnabled && (!cfg.positionLifecycle.previewOnly || gateCfg.enforceInPreview);
  if (!enforceNow) {
    return {
      dryExec,
      summary: createApprovalQueueGateSummary(gateCfg, "preview_bypass", {
        previewBypassed: cfg.positionLifecycle.previewOnly
      })
    };
  }

  let queueResult: ApprovalQueueLoadResult;
  let queueLoadError: string | null = null;
  try {
    queueResult = await loadApprovalQueueFromDrive(accessToken, gateCfg);
  } catch (error) {
    queueLoadError = error instanceof Error ? error.message : String(error);
    return blockAllPayloads("approval_queue_error", `queue_load_error:${queueLoadError}`, {
      queueLoaded: false,
      queueLoadError
    });
  }

  const state = queueResult.state;
  let queueChanged = false;
  const nowIso = new Date().toISOString();

  for (const row of state.queue) {
    if (row.status !== "pending") continue;
    const ttlMinutes = row.ttlMinutes ?? gateCfg.requestTtlMinutes;
    const requestedAtTs = Date.parse(row.requestedAt);
    if (!Number.isFinite(requestedAtTs)) continue;
    if (Date.now() - requestedAtTs > ttlMinutes * 60 * 1000) {
      row.status = "expired";
      row.resolvedAt = nowIso;
      row.resolvedBy = "system_ttl";
      queueChanged = true;
    }
  }

  const recordsBySymbol = new Map<string, ApprovalQueueRecord[]>();
  for (const row of state.queue) {
    if (!row.symbol) continue;
    if (!isApprovalRecordForCurrentStage(row, stage6.sha256)) continue;
    const symbol = row.symbol.trim().toUpperCase();
    if (!symbol) continue;
    const rows = recordsBySymbol.get(symbol) || [];
    rows.push(row);
    recordsBySymbol.set(symbol, rows);
  }
  for (const [symbol, rows] of recordsBySymbol.entries()) {
    recordsBySymbol.set(symbol, sortApprovalRecordsLatestFirst(rows));
  }

  const allowedPayloads: DryExecOrderPayload[] = [];
  const blockedPayloads: DryExecOrderPayload[] = [];
  const blockedSkips: DryExecSkipReason[] = [];
  const blockedSymbols: string[] = [];
  let matchedApproved = 0;
  let matchedPending = 0;
  let createdPending = 0;

  for (const payload of dryExec.payloads) {
    if (!isApprovalRequiredForPayloadAction(payload.actionType)) {
      allowedPayloads.push(payload);
      continue;
    }
    const symbol = payload.symbol.trim().toUpperCase();
    const rows = recordsBySymbol.get(symbol) || [];
    const latest = rows[0];
    if (latest?.status === "approved") {
      matchedApproved += 1;
      allowedPayloads.push(payload);
      continue;
    }
    if (latest?.status === "pending") {
      matchedPending += 1;
      blockedSymbols.push(symbol);
      blockedSkips.push({
        symbol,
        reason: "approval_pending",
        detail: `request_id=${latest.id}`,
        actionType: "HOLD_WAIT",
        actionReason: "approval_pending"
      });
      blockedPayloads.push(payload);
      continue;
    }
    if (latest?.status === "rejected") {
      blockedSymbols.push(symbol);
      blockedSkips.push({
        symbol,
        reason: "approval_rejected",
        detail: `request_id=${latest.id}`,
        actionType: "HOLD_WAIT",
        actionReason: "approval_rejected"
      });
      blockedPayloads.push(payload);
      continue;
    }
    if (latest?.status === "expired") {
      blockedSymbols.push(symbol);
      blockedSkips.push({
        symbol,
        reason: "approval_expired",
        detail: `request_id=${latest.id}`,
        actionType: "HOLD_WAIT",
        actionReason: "approval_expired"
      });
      blockedPayloads.push(payload);
      continue;
    }

    const requestId = `APR_${stage6.sha256.slice(0, 10)}_${symbol}`;
    const pendingRecord: ApprovalQueueRecord = {
      id: requestId,
      type: "trade",
      symbol,
      side: payload.side,
      notional: roundToCent(payload.notional),
      limitPrice: roundToCent(payload.limit_price),
      takeProfit: roundToCent(payload.take_profit.limit_price),
      stopLoss: roundToCent(payload.stop_loss.stop_price),
      detail: `awaiting_approval ${symbol} entry=${payload.limit_price.toFixed(2)} tp=${payload.take_profit.limit_price.toFixed(2)} sl=${payload.stop_loss.stop_price.toFixed(2)} notional=${payload.notional.toFixed(2)}`,
      status: "pending",
      requestedAt: nowIso,
      stage6Hash: stage6.sha256.toLowerCase(),
      ttlMinutes: gateCfg.requestTtlMinutes
    };
    state.queue.push(pendingRecord);
    const nextRows = recordsBySymbol.get(symbol) || [];
    nextRows.unshift(pendingRecord);
    recordsBySymbol.set(symbol, nextRows);
    queueChanged = true;
    createdPending += 1;
    blockedSymbols.push(symbol);
    blockedSkips.push({
      symbol,
      reason: "approval_pending",
      detail: `request_id=${requestId}`,
      actionType: "HOLD_WAIT",
      actionReason: "approval_pending"
    });
    blockedPayloads.push(payload);
  }

  if (queueChanged) {
    state.updatedAt = nowIso;
    try {
      await saveApprovalQueueToDrive(accessToken, gateCfg, state, queueResult.fileId);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      return blockAllPayloads("approval_queue_error", `queue_save_error:${errorText}`, {
        queueLoaded: true,
        queueLoadError: errorText
      });
    }
  }

  const actionIntentCounts = { ...dryExec.actionIntent.counts };
  if (dryExec.actionIntent.enabled && dryExec.actionIntent.allowedActionTypes.includes("HOLD_WAIT")) {
    for (const blockedPayload of blockedPayloads) {
      if (blockedPayload.actionType && actionIntentCounts[blockedPayload.actionType] > 0) {
        actionIntentCounts[blockedPayload.actionType] -= 1;
      }
      actionIntentCounts.HOLD_WAIT += 1;
    }
  }

  const nextDryExec: DryExecBuildResult = {
    ...dryExec,
    payloads: allowedPayloads,
    skipped: [...dryExec.skipped, ...blockedSkips],
    skipReasonCounts: buildSkipReasonCounts([...dryExec.skipped, ...blockedSkips]),
    actionIntent: {
      ...dryExec.actionIntent,
      counts: actionIntentCounts
    }
  };

  const counts = computeApprovalQueueStatusCounts(state);
  const summary = createApprovalQueueGateSummary(gateCfg, blockedSkips.length > 0 ? "approval_gate_blocked" : "pass", {
    enforced: true,
    queueLoaded: true,
    queueLoadError,
    ...counts,
    matchedApproved,
    matchedPending,
    createdPending,
    blocked: blockedSkips.length,
    blockedSymbols
  });
  return { dryExec: nextDryExec, summary };
}

function extractCandidateSymbols(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const raw = root.alpha_candidates;
  if (!Array.isArray(raw)) return [];

  const symbols = raw
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const node = item as Record<string, unknown>;
      const symbol = node.symbol ?? node.ticker;
      return typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
    })
    .filter((s) => s.length > 0);

  return Array.from(new Set(symbols));
}

function parsePrice(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return `$${value.toFixed(2)}`;
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return "N/A";
}

function parseNumericPrice(label: string): number | null {
  if (!label || label === "N/A") return null;
  const normalized = label.replace(/[^0-9.-]/g, "");
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parsePriceValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    return parseNumericPrice(value.trim());
  }
  return null;
}

function normalizePercentValue(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.abs(value) <= 1 ? value * 100 : value;
}

function formatExpectedReturnLabel(raw: unknown, fallbackPct: number | null): string {
  if (typeof raw === "string" && raw.trim()) return raw.trim();

  const rawNumeric = parseFiniteNumber(raw);
  if (rawNumeric != null) {
    const pct = normalizePercentValue(rawNumeric);
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
  }

  if (fallbackPct != null) {
    const pct = normalizePercentValue(fallbackPct);
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
  }
  return "N/A";
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseBooleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  }
  return null;
}

function readPositiveNumberEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function readPositiveIntEnv(key: string, fallback: number): number {
  const n = Math.floor(readPositiveNumberEnv(key, fallback));
  if (n <= 0) return fallback;
  return n;
}

function readBoolEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function readNumberEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function readNonNegativeNumberEnv(key: string, fallback: number): number {
  const n = readNumberEnv(key, fallback);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function computeAgeMinutes(isoTs: string | null | undefined): number | null {
  if (!isoTs) return null;
  const ts = Date.parse(isoTs);
  if (!Number.isFinite(ts)) return null;
  return (Date.now() - ts) / 60000;
}

function parseConviction(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q = clamp(quantile, 0, 1);
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const weight = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * weight;
}

function mapStage6ExecutionReasonToSkip(
  reason: Stage6CandidateSummary["executionReason"]
): DryExecSkipReason["reason"] {
  if (reason === "WAIT_PULLBACK_TOO_DEEP") return "stage6_wait_pullback_too_deep";
  if (reason === "INVALID_GEOMETRY") return "stage6_invalid_geometry";
  if (reason === "INVALID_DATA") return "stage6_invalid_data";
  if (reason === "VALID_EXEC") return "stage6_valid_exec_but_blocked";
  return "stage6_watchlist";
}

function mapStage6DecisionReasonToSkip(
  reason: string
): DryExecSkipReason["reason"] {
  const key = String(reason || "").trim().toLowerCase();
  if (!key || key === "n/a") return "stage6_watchlist";
  if (key === "wait_pullback_not_reached") return "stage6_wait_pullback_too_deep";
  if (key === "wait_earnings_data_missing") return "stage6_wait_earnings_data_missing";
  if (key === "wait_insufficient_history") return "stage6_wait_insufficient_history";
  if (key === "wait_state_verdict_conflict") return "stage6_wait_state_verdict_conflict";
  if (key === "blocked_symbol_stale") return "stage6_symbol_stale";
  if (key === "blocked_invalid_geometry") return "stage6_invalid_geometry";
  if (key === "blocked_missing_trade_box") return "stage6_invalid_data";
  if (key === "blocked_quality_missing_expected_return") return "stage6_quality_missing_expected_return";
  if (key === "blocked_quality_conviction_floor") return "stage6_quality_conviction_floor";
  if (key === "blocked_quality_verdict_unusable") return "stage6_quality_verdict_unusable";
  if (key === "blocked_stop_too_tight") return "stage6_stop_too_tight";
  if (key === "blocked_stop_too_wide") return "stage6_stop_too_wide";
  if (key === "blocked_target_too_close") return "stage6_target_too_close";
  if (key === "blocked_anchor_exec_gap") return "stage6_anchor_exec_gap";
  if (key === "blocked_rr_below_min") return "stage6_rr_below_min";
  if (key === "blocked_ev_non_positive") return "stage6_ev_non_positive";
  if (key === "blocked_earnings_data_missing") return "stage6_earnings_missing";
  if (key === "blocked_earnings_window") return "stage6_earnings_blackout";
  if (key === "blocked_state_verdict_conflict") return "stage6_state_verdict_conflict";
  if (key === "blocked_verdict_risk_off") return "stage6_risk_off_verdict";
  return `stage6_${key}`;
}

function mapStage6DecisionReasonCountsToSkipCounts(
  counts: Record<string, number>
): Record<string, number> {
  return Object.entries(counts).reduce<Record<string, number>>((acc, [reason, countRaw]) => {
    const count = Number(countRaw);
    if (!Number.isFinite(count) || count <= 0) return acc;
    const key = mapStage6DecisionReasonToSkip(reason);
    acc[key] = Number((acc[key] || 0) + count);
    return acc;
  }, {});
}

function buildSkipReasonCounts(skipped: DryExecSkipReason[]): Record<string, number> {
  return skipped.reduce<Record<string, number>>((acc, row) => {
    const key = String(row?.reason || "unknown");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function formatSkipReasonCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "none";
  return entries.map(([reason, count]) => `${reason}:${count}`).join(",");
}

function formatSkipDetails(skipped: DryExecSkipReason[], maxItems = 8): string {
  const detailRows = skipped.filter((row) => typeof row.detail === "string" && row.detail.trim().length > 0);
  if (detailRows.length === 0) return "none";
  const visible = detailRows
    .slice(0, maxItems)
    .map((row) => `${row.symbol}:${row.reason}[${row.detail}]`);
  const suffix = detailRows.length > maxItems ? ` (+${detailRows.length - maxItems} more)` : "";
  return `${visible.join(" || ")}${suffix}`;
}

function createEmptyActionIntentCounts(): Record<LifecycleActionType, number> {
  return {
    ENTRY_NEW: 0,
    HOLD_WAIT: 0,
    SCALE_UP: 0,
    SCALE_DOWN: 0,
    EXIT_PARTIAL: 0,
    EXIT_FULL: 0
  };
}

function isActionTypeAllowed(
  actionType: LifecycleActionType,
  lifecycleConfig: PositionLifecycleConfig
): boolean {
  return lifecycleConfig.allowedActionTypes.includes(actionType);
}

function isLifecycleExitActionType(
  actionType: LifecycleActionType | undefined
): actionType is "SCALE_DOWN" | "EXIT_PARTIAL" | "EXIT_FULL" {
  return actionType === "SCALE_DOWN" || actionType === "EXIT_PARTIAL" || actionType === "EXIT_FULL";
}

function isApprovalRequiredForPayloadAction(actionType: LifecycleActionType | undefined): boolean {
  if (!actionType) return true;
  return actionType === "ENTRY_NEW" || actionType === "SCALE_UP";
}

function rebuildActionIntentSummary(dryExec: DryExecBuildResult): DryExecBuildResult["actionIntent"] {
  if (!dryExec.actionIntent.enabled) {
    return {
      ...dryExec.actionIntent,
      counts: createEmptyActionIntentCounts()
    };
  }
  const counts = createEmptyActionIntentCounts();
  dryExec.payloads.forEach((row) => {
    if (row.actionType) counts[row.actionType] += 1;
  });
  dryExec.skipped.forEach((row) => {
    if (row.actionType) counts[row.actionType] += 1;
  });
  return {
    ...dryExec.actionIntent,
    counts
  };
}

function sumNotional(
  payloads: DryExecOrderPayload[],
  options?: { includeExitActions?: boolean }
): number {
  const includeExitActions = options?.includeExitActions ?? false;
  return payloads.reduce((acc, row) => {
    if (!includeExitActions && isLifecycleExitActionType(row.actionType)) return acc;
    return acc + row.notional;
  }, 0);
}

function isTransitionAllowed(from: OrderLifecycleStatus, to: OrderLifecycleStatus): boolean {
  if (from === to) return true;
  return ORDER_TRANSITIONS[from].has(to);
}

function buildOrderIdempotencyKey(
  stage6Hash: string,
  symbol: string,
  side: "buy",
  actionType?: LifecycleActionType
): string {
  const base = `${stage6Hash}:${symbol}:${side}`;
  if (isLifecycleExitActionType(actionType)) {
    return `${base}:${actionType.toLowerCase()}`;
  }
  return base;
}

function roundToCent(value: number): number {
  return Number(value.toFixed(2));
}

function validateAndNormalizePayload(payload: DryExecOrderPayload): { ok: true; payload: DryExecOrderPayload } | { ok: false; reason: string } {
  const limit = roundToCent(payload.limit_price);
  const takeProfit = roundToCent(payload.take_profit.limit_price);
  const stopLoss = roundToCent(payload.stop_loss.stop_price);
  const notional = roundToCent(payload.notional);
  const conviction =
    payload.conviction == null || !Number.isFinite(payload.conviction)
      ? undefined
      : Number(clamp(payload.conviction, 0, 100).toFixed(1));

  if (![limit, takeProfit, stopLoss, notional].every((n) => Number.isFinite(n))) {
    return { ok: false, reason: "payload_invalid_non_finite_number" };
  }
  if (limit <= 0 || takeProfit <= 0 || stopLoss <= 0) {
    return { ok: false, reason: "payload_invalid_non_positive_price" };
  }
  if (notional < 1) {
    return { ok: false, reason: "payload_invalid_notional_too_small" };
  }
  if (!(takeProfit > limit && stopLoss < limit)) {
    return { ok: false, reason: "payload_invalid_price_geometry" };
  }
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(payload.client_order_id)) {
    return { ok: false, reason: "payload_invalid_client_order_id" };
  }

  return {
    ok: true,
    payload: {
      ...payload,
      limit_price: limit,
      notional,
      conviction,
      take_profit: { limit_price: takeProfit },
      stop_loss: { stop_price: stopLoss }
    }
  };
}

function readProfilePositiveNumber(
  profile: RegimeProfile,
  defaultKey: string,
  riskOffKey: string,
  legacyKey: string,
  fallback: number
): number {
  const legacy = readPositiveNumberEnv(legacyKey, fallback);
  const scopedKey = profile === "risk_off" ? riskOffKey : defaultKey;
  return readPositiveNumberEnv(scopedKey, legacy);
}

function readProfilePositiveInt(
  profile: RegimeProfile,
  defaultKey: string,
  riskOffKey: string,
  legacyKey: string,
  fallback: number
): number {
  const legacy = readPositiveIntEnv(legacyKey, fallback);
  const scopedKey = profile === "risk_off" ? riskOffKey : defaultKey;
  return readPositiveIntEnv(scopedKey, legacy);
}

function toFinitePositiveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function getNestedValue(obj: unknown, path: string[]): unknown {
  return path.reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function extractVixFromMarketSnapshot(payload: unknown): number | null {
  const paths = [
    ["benchmarks", "vix", "close"],
    ["data", "benchmarks", "vix", "close"],
    ["snapshot", "benchmarks", "vix", "close"],
    ["marketPulse", "vix", "price"],
    ["marketPulse", "vix"],
    ["vix"]
  ];

  for (const path of paths) {
    const candidate = getNestedValue(payload, path);
    const parsed = toFinitePositiveNumber(candidate);
    if (parsed != null) return parsed;
  }
  return null;
}

function parseCandidateSummaries(payload: unknown): Stage6CandidateSummary[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  return parseCandidateSummariesFromRaw(root.alpha_candidates, 6);
}

function parseAllCandidateSummaries(payload: unknown): Stage6CandidateSummary[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  return parseCandidateSummariesFromRaw(root.alpha_candidates, null);
}

function normalizeStage6InstrumentType(value: unknown): Stage6CandidateSummary["instrumentType"] {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "common") return "common";
  if (normalized === "warrant") return "warrant";
  if (normalized === "unit") return "unit";
  if (normalized === "right") return "right";
  if (normalized === "hybrid") return "hybrid";
  return "unknown";
}

function normalizeStage6HistoryTier(value: unknown): Stage6CandidateSummary["historyTier"] {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (normalized === "FULL") return "FULL";
  if (normalized === "PROVISIONAL") return "PROVISIONAL";
  if (normalized === "ONBOARDING") return "ONBOARDING";
  return "UNKNOWN";
}

function normalizeStage6LifecycleState(value: unknown): Stage6CandidateSummary["symbolLifecycleState"] {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (normalized === "ACTIVE") return "ACTIVE";
  if (normalized === "PROVISIONAL") return "PROVISIONAL";
  if (normalized === "ONBOARDING") return "ONBOARDING";
  if (normalized === "RECOVERED") return "RECOVERED";
  if (normalized === "STALE") return "STALE";
  if (normalized === "RETIRED") return "RETIRED";
  if (normalized === "EXCLUDED") return "EXCLUDED";
  return "UNKNOWN";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeShadowDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.includes("T") ? trimmed : `${trimmed}T00:00:00Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeShadowString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseStage6ShadowAlphaVantage(node: Record<string, unknown>): Stage6ShadowIntelSummary["alphaVantage"] {
  const payload =
    asRecord(node.alphaVantage) ??
    asRecord(node.alpha_vantage) ??
    asRecord(node.shadowAlphaVantage) ??
    asRecord(node.fundamentalsAlphaVantage) ??
    asRecord(getNestedValue(node, ["shadow", "alphaVantage"])) ??
    asRecord(getNestedValue(node, ["shadow", "alpha_vantage"]));
  if (!payload) return null;

  const marketCap = parseFiniteNumber(payload.marketCap ?? payload.market_cap ?? payload.mktCap);
  const peRatio = parseFiniteNumber(payload.peRatio ?? payload.pe ?? payload.priceEarningsRatio ?? payload.ttmPE);
  const beta = parseFiniteNumber(payload.beta);
  const earningsDate = normalizeShadowDate(
    payload.earningsDate ??
      payload.nextEarningsDate ??
      payload.next_earnings_date ??
      payload.reportDate
  );
  const source =
    normalizeShadowString(payload.source ?? payload.provider ?? payload.vendor) ?? "alpha_vantage";

  if (marketCap == null && peRatio == null && beta == null && earningsDate == null) return null;
  return {
    source,
    marketCap: marketCap != null ? Number(marketCap.toFixed(2)) : null,
    peRatio: peRatio != null ? Number(peRatio.toFixed(3)) : null,
    beta: beta != null ? Number(beta.toFixed(4)) : null,
    earningsDate
  };
}

function parseStage6ShadowSecEdgar(node: Record<string, unknown>): Stage6ShadowIntelSummary["secEdgar"] {
  const payload =
    asRecord(node.secEdgar) ??
    asRecord(node.sec_edgar) ??
    asRecord(node.shadowSecEdgar) ??
    asRecord(getNestedValue(node, ["shadow", "secEdgar"])) ??
    asRecord(getNestedValue(node, ["shadow", "sec_edgar"]));
  if (!payload) return null;

  const cik = normalizeShadowString(payload.cik ?? payload.CIK);
  const latestFormType = normalizeShadowString(
    payload.latestFormType ?? payload.latest_form_type ?? payload.lastForm ?? payload.formType
  );
  const latestFiledAt = normalizeShadowDate(
    payload.latestFiledAt ?? payload.latest_filed_at ?? payload.lastFiledAt ?? payload.last_filed_at ?? payload.filedAt
  );
  const filingCount30d = parseFiniteNumber(
    payload.filingCount30d ?? payload.filing_count_30d ?? payload.recentFilingCount ?? payload.filingCount
  );
  const source = normalizeShadowString(payload.source ?? payload.provider ?? payload.vendor) ?? "sec_edgar";

  if (cik == null && latestFormType == null && latestFiledAt == null && filingCount30d == null) return null;
  return {
    source,
    cik,
    latestFormType,
    latestFiledAt,
    filingCount30d: filingCount30d != null ? Math.max(0, Math.round(filingCount30d)) : null
  };
}

function parseStage6ShadowIntel(node: Record<string, unknown>): Stage6ShadowIntelSummary | null {
  const alphaVantage = parseStage6ShadowAlphaVantage(node);
  const secEdgar = parseStage6ShadowSecEdgar(node);
  if (!alphaVantage && !secEdgar) return null;
  return {
    alphaVantage,
    secEdgar
  };
}

function parseCandidateSummariesFromRaw(raw: unknown, maxItems: number | null = 6): Stage6CandidateSummary[] {
  if (!Array.isArray(raw)) return [];
  const actionableVerdicts = resolveActionableVerdicts();

  const summaries = raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const node = item as Record<string, unknown>;
      const symbol = typeof node.symbol === "string" ? node.symbol.trim().toUpperCase() : "";
      if (!symbol) return null;
      const verdictRaw = node.verdictFinal ?? node.finalVerdict ?? node.aiVerdict ?? node.verdict;
      const convictionRaw =
        node.convictionScore ??
        node.gatedConvictionScore ??
        node.rawConvictionScore ??
        node.convictionAiRaw ??
        node.conviction;
      const expectedReturnRaw = node.expectedReturn ?? node.gatedExpectedReturn ?? node.rawExpectedReturn;
      const expectedReturnPctRaw = parseFiniteNumber(
        node.expectedReturnPct ?? node.gatedExpectedReturnPct ?? node.rawExpectedReturnPct
      );
      const entryRaw = node.entryExecPrice ?? node.entryExecPriceShadow ?? node.entryPrice ?? node.otePrice ?? node.supportLevel;
      const targetRaw = node.targetPrice ?? node.targetMeanPrice ?? node.resistanceLevel;
      const stopRaw = node.stopPrice ?? node.stopLoss ?? node.ictStopLoss;
      const entryValueRaw = parsePriceValue(entryRaw);
      const targetValueRaw = parsePriceValue(targetRaw);
      const stopValueRaw = parsePriceValue(stopRaw);
      const entryDistanceRaw = node.entryDistancePct ?? node.entryDistancePctShadow;
      const entryFeasibleRaw = node.entryFeasible ?? node.entryFeasibleShadow;
      const tradePlanStatusRaw = node.tradePlanStatus ?? node.tradePlanStatusShadow;
      const qualityScoreRaw = parseFiniteNumber(node.qualityScore ?? node.convictionScore);
      const modelRankRaw = parseFiniteNumber(node.modelRank);
      const executionRankRaw = parseFiniteNumber(node.executionRank);
      const executionScoreRaw = parseFiniteNumber(node.executionScore);
      const executionBucketRaw = typeof node.executionBucket === "string" ? node.executionBucket.trim().toUpperCase() : "";
      const executionReasonRaw = typeof node.executionReason === "string" ? node.executionReason.trim().toUpperCase() : "";
      const finalDecisionRaw = typeof node.finalDecision === "string" ? node.finalDecision.trim().toUpperCase() : "";
      const decisionReasonRaw = typeof node.decisionReason === "string" ? node.decisionReason.trim().toLowerCase() : "";
      const stage6TierRaw = typeof node.stage6Tier === "string" ? node.stage6Tier.trim().toUpperCase() : "";
      const stage6TierReasonRaw = typeof node.stage6TierReason === "string" ? node.stage6TierReason.trim().toLowerCase() : "";
      const stage6TierMultiplierRaw = parseFiniteNumber(node.stage6TierMultiplier);
      const displacementRaw = parseFiniteNumber(node.displacement ?? getNestedValue(node, ["ictMetrics", "displacement"]));
      const ictPosRaw = parseFiniteNumber(node.ictPos ?? node.stage6IctPos);
      const trendAlignmentRaw =
        typeof node.trendAlignment === "string"
          ? node.trendAlignment.trim().toUpperCase()
          : typeof getNestedValue(node, ["techMetrics", "trendAlignment"]) === "string"
            ? String(getNestedValue(node, ["techMetrics", "trendAlignment"])).trim().toUpperCase()
            : null;
      const hfSentimentLabelRaw = typeof node.hfSentimentLabel === "string" ? node.hfSentimentLabel.trim().toLowerCase() : "";
      const hfSentimentStatusRaw =
        typeof node.hfSentimentStatus === "string" ? node.hfSentimentStatus.trim().toUpperCase() : "";
      const hfSentimentReasonRaw =
        typeof node.hfSentimentReason === "string" ? node.hfSentimentReason.trim().toLowerCase() : "";
      const hfSentimentScoreRaw = parseFiniteNumber(node.hfSentimentScore);
      const hfSentimentArticleCountRaw = parseFiniteNumber(node.hfSentimentArticleCount);
      const hfSentimentNewestAgeHoursRaw = parseFiniteNumber(node.hfSentimentNewestAgeHours);
      const earningsDaysToEventRaw = parseFiniteNumber(node.earningsDaysToEvent);
      const shadowIntel = parseStage6ShadowIntel(node);
      const instrumentType = normalizeStage6InstrumentType(node.instrumentType);
      const historyTier = normalizeStage6HistoryTier(node.historyTier);
      const symbolLifecycleState = normalizeStage6LifecycleState(node.symbolLifecycleState);
      const analysisEligibleRaw = parseBooleanValue(node.analysisEligible);
      const analysisEligible =
        analysisEligibleRaw != null ? analysisEligibleRaw : instrumentType === "common" ? true : null;
      let executionBucket: Stage6CandidateSummary["executionBucket"] =
        executionBucketRaw === "EXECUTABLE" ? "EXECUTABLE" : executionBucketRaw === "WATCHLIST" ? "WATCHLIST" : "N/A";
      const executionReason: Stage6CandidateSummary["executionReason"] =
        executionReasonRaw === "VALID_EXEC"
          ? "VALID_EXEC"
          : executionReasonRaw === "WAIT_PULLBACK_TOO_DEEP"
            ? "WAIT_PULLBACK_TOO_DEEP"
            : executionReasonRaw === "INVALID_GEOMETRY"
              ? "INVALID_GEOMETRY"
            : executionReasonRaw === "INVALID_DATA"
                ? "INVALID_DATA"
                : "N/A";
      let finalDecision: Stage6CandidateSummary["finalDecision"] =
        finalDecisionRaw === "EXECUTABLE_NOW"
          ? "EXECUTABLE_NOW"
          : finalDecisionRaw === "WAIT_PRICE"
            ? "WAIT_PRICE"
            : finalDecisionRaw === "BLOCKED_RISK"
              ? "BLOCKED_RISK"
              : finalDecisionRaw === "BLOCKED_EVENT"
                ? "BLOCKED_EVENT"
                : executionBucket === "EXECUTABLE"
                  ? "EXECUTABLE_NOW"
                  : executionBucket === "WATCHLIST"
                    ? "WAIT_PRICE"
                    : "N/A";
      let decisionReason =
        decisionReasonRaw ||
        (executionReason === "WAIT_PULLBACK_TOO_DEEP"
          ? "wait_pullback_not_reached"
          : executionReason === "INVALID_GEOMETRY"
            ? "blocked_invalid_geometry"
            : executionReason === "INVALID_DATA"
              ? "blocked_missing_trade_box"
              : executionReason === "VALID_EXEC"
                ? "executable_pullback"
                : "n/a");
      const stage6Tier: Stage6CandidateSummary["stage6Tier"] =
        stage6TierRaw === "TIER1"
          ? "TIER1"
          : stage6TierRaw === "TIER2"
            ? "TIER2"
            : stage6TierRaw === "NONE"
              ? "NONE"
              : "N/A";
      const verdict = normalizeStage6Verdict(verdictRaw);

      // Stage6 execution contract invariant:
      // - EXECUTABLE_NOW must be paired with configured actionable verdicts
      // - non-executable decisions are always treated as watchlist on sidecar
      if (finalDecision === "EXECUTABLE_NOW" && !actionableVerdicts.has(verdict)) {
        finalDecision = "WAIT_PRICE";
        executionBucket = "WATCHLIST";
        if (!decisionReason || decisionReason === "n/a" || decisionReason === "executable_pullback") {
          decisionReason = "blocked_quality_verdict_unusable";
        }
      } else if (NON_EXECUTABLE_DECISIONS.has(finalDecision)) {
        executionBucket = "WATCHLIST";
      } else if (finalDecision === "EXECUTABLE_NOW") {
        executionBucket = "EXECUTABLE";
      }

      return {
        symbol,
        instrumentType,
        analysisEligible,
        historyTier,
        symbolLifecycleState,
        verdict,
        expectedReturn: formatExpectedReturnLabel(expectedReturnRaw, expectedReturnPctRaw),
        expectedReturnPct:
          expectedReturnPctRaw != null ? Number(normalizePercentValue(expectedReturnPctRaw).toFixed(2)) : null,
        entry: parsePrice(entryRaw),
        entryValue: entryValueRaw != null ? Number(entryValueRaw.toFixed(6)) : null,
        target: parsePrice(targetRaw),
        targetValue: targetValueRaw != null ? Number(targetValueRaw.toFixed(6)) : null,
        stop: parsePrice(stopRaw),
        stopValue: stopValueRaw != null ? Number(stopValueRaw.toFixed(6)) : null,
        conviction:
          typeof convictionRaw === "number" && Number.isFinite(convictionRaw)
            ? convictionRaw.toFixed(0)
            : typeof convictionRaw === "string" && convictionRaw.trim()
              ? convictionRaw.trim()
              : "N/A",
        qualityScore: qualityScoreRaw != null ? Number(qualityScoreRaw.toFixed(1)) : null,
        modelRank: modelRankRaw != null ? Math.round(modelRankRaw) : null,
        executionRank: executionRankRaw != null ? Math.round(executionRankRaw) : null,
        executionScore: executionScoreRaw != null ? Number(executionScoreRaw.toFixed(1)) : null,
        executionBucket,
        executionReason,
        finalDecision,
        decisionReason,
        stage6Tier,
        stage6TierReason: stage6TierReasonRaw || "tier_none",
        stage6TierMultiplier: stage6TierMultiplierRaw != null ? Number(stage6TierMultiplierRaw.toFixed(3)) : null,
        displacement: displacementRaw != null ? Number(displacementRaw.toFixed(2)) : null,
        ictPos: ictPosRaw != null ? Number(ictPosRaw.toFixed(4)) : null,
        trendAlignment: trendAlignmentRaw,
        entryDistancePct: parseFiniteNumber(entryDistanceRaw),
        entryFeasible: parseBooleanValue(entryFeasibleRaw),
        tradePlanStatus:
          typeof tradePlanStatusRaw === "string" && tradePlanStatusRaw.trim()
            ? tradePlanStatusRaw.trim().toUpperCase()
            : "N/A",
        hfSentimentLabel:
          hfSentimentLabelRaw === "positive"
            ? "positive"
            : hfSentimentLabelRaw === "negative"
              ? "negative"
              : hfSentimentLabelRaw === "neutral"
                ? "neutral"
                : null,
        hfSentimentScore:
          hfSentimentScoreRaw != null ? Number(clamp(hfSentimentScoreRaw, 0, 1).toFixed(4)) : null,
        hfSentimentStatus:
          hfSentimentStatusRaw === "OK"
            ? "OK"
            : hfSentimentStatusRaw === "SKIPPED"
              ? "SKIPPED"
              : hfSentimentStatusRaw === "FAILED"
                ? "FAILED"
                : hfSentimentStatusRaw === "DISABLED"
                  ? "DISABLED"
                : "N/A",
        hfSentimentReason: hfSentimentReasonRaw || null,
        hfSentimentArticleCount:
          hfSentimentArticleCountRaw != null ? Math.max(0, Math.round(hfSentimentArticleCountRaw)) : null,
        hfSentimentNewestAgeHours:
          hfSentimentNewestAgeHoursRaw != null ? Number(Math.max(0, hfSentimentNewestAgeHoursRaw).toFixed(2)) : null,
        earningsDaysToEvent:
          earningsDaysToEventRaw != null ? Number(earningsDaysToEventRaw.toFixed(0)) : null,
        shadowIntel
      };
    })
    .filter((row): row is Stage6CandidateSummary => row !== null);
  if (maxItems == null) return summaries;
  const limit = Math.max(0, Math.floor(maxItems));
  if (!Number.isFinite(limit) || limit <= 0) return [];
  return summaries.slice(0, limit);
}

function parseStage6DecisionCounts(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  return Object.entries(raw as Record<string, unknown>).reduce<Record<string, number>>((acc, [key, value]) => {
    const parsed = parseFiniteNumber(value);
    if (!Number.isFinite(parsed)) return acc;
    const safeKey = String(key || "").trim();
    if (!safeKey) return acc;
    acc[safeKey] = Number(parsed);
    return acc;
  }, {});
}

function parseStage6ContractContext(payload: unknown): Stage6ContractContext | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const raw = root.execution_contract;
  if (!raw || typeof raw !== "object") return null;
  const node = raw as Record<string, unknown>;

  const modelTop6 = parseCandidateSummariesFromRaw(node.modelTop6);
  const executablePicks = parseCandidateSummariesFromRaw(node.executablePicks);
  const watchlistTop = parseCandidateSummariesFromRaw(node.watchlistTop);
  const decisionCountsPrimary = parseStage6DecisionCounts(node.decisionCountsPrimary);
  const decisionCountsTop6 = parseStage6DecisionCounts(node.decisionCountsTop6);
  const decisionReasonCountsPrimary = parseStage6DecisionCounts(node.decisionReasonCountsPrimary);
  const decisionReasonCountsTop6 = parseStage6DecisionCounts(node.decisionReasonCountsTop6);

  if (modelTop6.length === 0 && executablePicks.length === 0 && watchlistTop.length === 0) return null;

  return {
    modelTop6,
    executablePicks,
    watchlistTop,
    decisionCountsPrimary,
    decisionCountsTop6,
    decisionReasonCountsPrimary,
    decisionReasonCountsTop6
  };
}

async function fetchLatestMarketSnapshotVix(accessToken: string): Promise<VixLookupResult> {
  const explicitFolderId = process.env.GDRIVE_MARKET_SNAPSHOT_FOLDER_ID?.trim() || "";
  const fallbackFolderId = process.env.GDRIVE_ROOT_FOLDER_ID || "";
  const folderId = explicitFolderId || fallbackFolderId;
  if (!folderId) {
    return { vix: null, reason: "snapshot folder not configured (set GDRIVE_MARKET_SNAPSHOT_FOLDER_ID)" };
  }

  const query = [
    `'${folderId}' in parents`,
    "trashed=false",
    "name contains 'MARKET_REGIME_SNAPSHOT'"
  ].join(" and ");

  const params = new URLSearchParams({
    q: query,
    orderBy: "modifiedTime desc",
    pageSize: "1",
    fields: "files(id,name,modifiedTime)"
  });

  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    const text = await response.text();
    return {
      vix: null,
      reason: `snapshot list failed (${response.status}) in folder ${folderId}: ${text.slice(0, 120)}`,
      source: "market_snapshot"
    };
  }

  const data = (await response.json()) as DriveListResponse;
  const file = data.files?.[0];
  if (!file?.id) {
    return { vix: null, reason: `snapshot not found in folder ${folderId}`, source: "market_snapshot" };
  }

  try {
    const raw = await downloadStage6Json(accessToken, file.id);
    const parsed = parseJsonText<unknown>(raw, `market_snapshot(${file.name || file.id})`);
    const vix = extractVixFromMarketSnapshot(parsed);
    if (vix == null) {
      return {
        vix: null,
        reason: `snapshot parse miss: VIX field not found in ${file.name}`,
        modifiedTime: file.modifiedTime,
        source: "market_snapshot"
      };
    }
    return {
      vix,
      reason: `snapshot ok: ${file.name}`,
      modifiedTime: file.modifiedTime,
      source: "market_snapshot"
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      vix: null,
      reason: `snapshot parse/download failed for ${file.name}: ${message.slice(0, 120)}`,
      modifiedTime: file.modifiedTime,
      source: "market_snapshot"
    };
  }
}

async function fetchFinnhubVix(): Promise<VixLookupResult> {
  const token = process.env.FINNHUB_API_KEY?.trim();
  if (!token) return { vix: null, reason: "FINNHUB_API_KEY missing", source: "finnhub" };

  const candidates = ["VIX", "^VIX", "CBOE:VIX"];
  const attempts: string[] = [];
  let sawAuthFailure = false;
  let sawCoverageOnly = false;
  for (const symbol of candidates) {
    try {
      const params = new URLSearchParams({ symbol, token });
      const response = await fetch(`https://finnhub.io/api/v1/quote?${params.toString()}`);
      if (!response.ok) {
        if (response.status === 401) sawAuthFailure = true;
        attempts.push(`${symbol}:http_${response.status}`);
        continue;
      }
      const data = (await response.json()) as { c?: unknown; error?: unknown };
      const errorText = typeof data.error === "string" ? data.error.toLowerCase() : "";
      if (errorText.includes("subscription required")) {
        sawCoverageOnly = true;
        attempts.push(`${symbol}:subscription_required`);
        continue;
      }
      const parsed = toFinitePositiveNumber(data.c);
      if (parsed != null) return { vix: parsed, reason: `finnhub ok: ${symbol}`, source: "finnhub" };
      sawCoverageOnly = true;
      attempts.push(`${symbol}:no_price`);
    } catch {
      attempts.push(`${symbol}:network_error`);
    }
  }
  const attemptSummary = attempts.join(", ") || "no candidates";
  if (sawAuthFailure) {
    return { vix: null, reason: `finnhub auth_failed (${attemptSummary})`, source: "finnhub" };
  }
  if (sawCoverageOnly) {
    return { vix: null, reason: `finnhub no_vix_coverage (${attemptSummary})`, source: "finnhub" };
  }
  return { vix: null, reason: `finnhub failed (${attemptSummary})`, source: "finnhub" };
}

async function fetchCnbcDirectVix(): Promise<VixLookupResult> {
  const symbols = ".VIX";
  const url =
    `https://quote.cnbc.com/quote-html-webservice/quote.htm?partnerId=2&requestMethod=quick&` +
    `exthrs=1&noform=1&fund=1&output=json&players=null&symbols=${encodeURIComponent(symbols)}`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    if (!response.ok) {
      const text = await response.text();
      return {
        vix: null,
        reason: `cnbc direct failed (${response.status}): ${text.slice(0, 120)}`,
        source: "cnbc_direct"
      };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const quickQuoteResult = data.QuickQuoteResult as Record<string, unknown> | undefined;
    const rawQuotes = quickQuoteResult?.QuickQuote;
    const quotes = Array.isArray(rawQuotes) ? rawQuotes : [];
    const vixRow = quotes.find((row) => {
      if (!row || typeof row !== "object") return false;
      const symbol = String((row as Record<string, unknown>).symbol || "").toUpperCase();
      return symbol === ".VIX" || symbol === "VIX";
    }) as Record<string, unknown> | undefined;
    if (!vixRow) {
      return { vix: null, reason: "cnbc direct parse miss: .VIX not found", source: "cnbc_direct" };
    }

    const vix = toFinitePositiveNumber(vixRow.last ?? vixRow.last_trade ?? vixRow.price);
    if (vix == null) {
      return { vix: null, reason: "cnbc direct parse miss: invalid VIX value", source: "cnbc_direct" };
    }
    return { vix, reason: "cnbc direct ok: .VIX", source: "cnbc_direct" };
  } catch {
    return { vix: null, reason: "cnbc direct network error", source: "cnbc_direct" };
  }
}

async function fetchCnbcRapidApiVix(): Promise<VixLookupResult> {
  const rapidEnabled = readBoolEnv("CNBC_RAPIDAPI_ENABLED", false);
  if (!rapidEnabled) {
    return { vix: null, reason: "cnbc rapidapi disabled", source: "cnbc_rapidapi" };
  }

  const key = process.env.CNBC_RAPIDAPI_KEY?.trim() || process.env.RAPID_API_KEY?.trim() || "";
  if (!key) {
    return { vix: null, reason: "CNBC_RAPIDAPI_KEY/RAPID_API_KEY missing", source: "cnbc_rapidapi" };
  }

  const host = process.env.CNBC_RAPIDAPI_HOST?.trim() || "cnbc.p.rapidapi.com";
  const endpoint = process.env.CNBC_RAPIDAPI_ENDPOINT?.trim() || "/market/get-quote";
  const symbols = ".VIX";
  const symbolParam = process.env.CNBC_RAPIDAPI_SYMBOL_PARAM?.trim() || "symbol";
  const params = new URLSearchParams();
  params.set(symbolParam, symbols);
  params.set("requestMethod", "quick");
  params.set("exthrs", "1");
  params.set("noform", "1");
  params.set("fund", "1");
  params.set("output", "json");

  try {
    const response = await fetch(`https://${host}${endpoint}?${params.toString()}`, {
      method: "GET",
      headers: {
        "X-RapidAPI-Key": key,
        "X-RapidAPI-Host": host
      }
    });
    if (!response.ok) {
      const text = await response.text();
      return {
        vix: null,
        reason: `cnbc rapidapi failed (${response.status}) host=${host} endpoint=${endpoint}: ${text.slice(0, 120)}`,
        source: "cnbc_rapidapi"
      };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const quickQuoteResult = data.QuickQuoteResult as Record<string, unknown> | undefined;
    const rawQuotes = quickQuoteResult?.QuickQuote;
    const quotes = Array.isArray(rawQuotes) ? rawQuotes : [];
    const vixRow = quotes.find((row) => {
      if (!row || typeof row !== "object") return false;
      const symbol = String((row as Record<string, unknown>).symbol || "").toUpperCase();
      return symbol === ".VIX" || symbol === "VIX";
    }) as Record<string, unknown> | undefined;
    if (!vixRow) {
      return { vix: null, reason: "cnbc rapidapi parse miss: .VIX not found", source: "cnbc_rapidapi" };
    }

    const vix = toFinitePositiveNumber(vixRow.last ?? vixRow.last_trade ?? vixRow.price);
    if (vix == null) {
      return { vix: null, reason: "cnbc rapidapi parse miss: invalid VIX value", source: "cnbc_rapidapi" };
    }
    return { vix, reason: "cnbc rapidapi ok: .VIX", source: "cnbc_rapidapi" };
  } catch {
    return { vix: null, reason: "cnbc rapidapi network error", source: "cnbc_rapidapi" };
  }
}

function evaluateSnapshotFreshness(
  snapshot: VixLookupResult,
  maxAgeMin: number
): { usableVix: number | null; diag?: string } {
  if (snapshot.vix == null) return { usableVix: null };
  if (maxAgeMin <= 0) return { usableVix: snapshot.vix };
  if (!snapshot.modifiedTime) {
    return { usableVix: null, diag: `snapshot stale guard: modifiedTime missing (maxAge=${maxAgeMin}m)` };
  }

  const modifiedTs = Date.parse(snapshot.modifiedTime);
  if (!Number.isFinite(modifiedTs)) {
    return { usableVix: null, diag: `snapshot stale guard: invalid modifiedTime (${snapshot.modifiedTime})` };
  }

  const ageMin = (Date.now() - modifiedTs) / 60000;
  if (ageMin <= maxAgeMin) {
    return { usableVix: snapshot.vix };
  }
  return {
    usableVix: null,
    diag: `snapshot stale guard: age=${ageMin.toFixed(1)}m > max=${maxAgeMin}m`
  };
}

async function loadRegimeGuardState(): Promise<RegimeGuardState | null> {
  try {
    const raw = await readFile(REGIME_GUARD_STATE_PATH, "utf8");
    const parsed = parseJsonText<Partial<RegimeGuardState>>(raw, "regime_guard_state");
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.lastProfile !== "default" && parsed.lastProfile !== "risk_off") return null;
    if (typeof parsed.lastSwitchedAt !== "string" || typeof parsed.updatedAt !== "string") return null;
    return {
      lastProfile: parsed.lastProfile,
      lastSwitchedAt: parsed.lastSwitchedAt,
      updatedAt: parsed.updatedAt
    };
  } catch {
    return null;
  }
}

async function saveRegimeGuardState(state: RegimeGuardState): Promise<void> {
  await mkdir("state", { recursive: true });
  await writeFile(REGIME_GUARD_STATE_PATH, JSON.stringify(state, null, 2), "utf8");
  console.log(`[STATE] saved ${REGIME_GUARD_STATE_PATH}`);
}

function evaluateRegimeQuality(selection: RegimeSelection): RegimeQualityGuard {
  const enabled = readBoolEnv("REGIME_QUALITY_GUARD_ENABLED", true);
  const minScore = readPositiveNumberEnv("REGIME_QUALITY_MIN_SCORE", 60);
  const vixMismatchPct = readPositiveNumberEnv("REGIME_VIX_MISMATCH_PCT", 8);
  const reasons: string[] = [];
  let score = 100;

  if (selection.vix == null) {
    score -= 65;
    reasons.push("vix_missing");
  }

  if (selection.source === "market_snapshot") {
    score -= 20;
    reasons.push("realtime_source_unavailable");
  } else if (selection.source === "env_fallback") {
    score -= 35;
    reasons.push("all_vix_sources_unavailable");
  }

  if (selection.snapshotAgeMin != null && selection.snapshotAgeMin > 30) {
    score -= 10;
    reasons.push(`snapshot_age_high:${selection.snapshotAgeMin.toFixed(1)}m`);
  }

  if (selection.snapshotVix != null && selection.vix != null && selection.snapshotAgeMin != null && selection.snapshotAgeMin <= 30) {
    const mismatchPct = (Math.abs(selection.vix - selection.snapshotVix) / Math.max(selection.snapshotVix, 0.01)) * 100;
    if (mismatchPct >= vixMismatchPct) {
      score -= 15;
      reasons.push(`vix_source_mismatch:${mismatchPct.toFixed(1)}%`);
    }
  }

  if (selection.diagnostics.some((line) => line.includes("snapshot stale guard"))) {
    score -= 10;
    reasons.push("snapshot_stale");
  }
  if (selection.diagnostics.some((line) => line.includes("finnhub auth_failed"))) {
    score -= 8;
    reasons.push("finnhub_auth_failed");
  } else if (selection.diagnostics.some((line) => line.includes("finnhub failed"))) {
    score -= 5;
    reasons.push("finnhub_unavailable");
  } else if (selection.diagnostics.some((line) => line.includes("finnhub no_vix_coverage"))) {
    reasons.push("finnhub_vix_uncovered");
  }
  if (selection.diagnostics.some((line) => line.includes("cnbc-direct") && line.includes("failed"))) {
    score -= 10;
    reasons.push("cnbc_direct_unavailable");
  }
  if (selection.diagnostics.some((line) => line.includes("cnbc rapidapi failed"))) {
    score -= 5;
    reasons.push("cnbc_rapidapi_unavailable");
  }

  score = clamp(Math.round(score), 0, 100);
  const status: RegimeQualityStatus = score >= 80 ? "high" : score >= minScore ? "medium" : "low";
  const forceRiskOff = enabled && score < minScore;

  return {
    enabled,
    score,
    minScore,
    status,
    forceRiskOff,
    reasons
  };
}

async function applyRegimeGuards(base: RegimeSelection): Promise<RegimeSelection> {
  const quality = evaluateRegimeQuality(base);
  const hysteresisEnabled = readBoolEnv("REGIME_HYSTERESIS_ENABLED", true);
  const minHoldMin = Math.max(0, readNonNegativeNumberEnv("REGIME_MIN_HOLD_MIN", 30));
  const nowIso = new Date().toISOString();
  const state = await loadRegimeGuardState();
  const previousProfile = state?.lastProfile ?? null;

  let desiredProfile = base.profile;
  let entryGuard: RegimeEntryGuard = { blocked: false, reason: "none" };

  if (quality.forceRiskOff) {
    desiredProfile = "risk_off";
    entryGuard = {
      blocked: true,
      reason: `data_quality_low(score=${quality.score}<${quality.minScore})`
    };
  }

  // Hysteresis band: while in risk_off, recover only below riskOn threshold.
  if (base.vix != null && previousProfile === "risk_off" && desiredProfile === "default" && base.vix > base.riskOnThreshold) {
    desiredProfile = "risk_off";
  }

  let appliedProfile = desiredProfile;
  let holdRemainingMin = 0;
  let hysteresisReason = "none";

  const shouldBypassHold = quality.forceRiskOff && desiredProfile === "risk_off";
  if (hysteresisEnabled && previousProfile && previousProfile !== desiredProfile && !shouldBypassHold) {
    const switchedAt = Date.parse(state?.lastSwitchedAt || "");
    if (Number.isFinite(switchedAt)) {
      const elapsedMin = (Date.now() - switchedAt) / 60000;
      if (elapsedMin < minHoldMin) {
        appliedProfile = previousProfile;
        holdRemainingMin = Math.max(0, minHoldMin - elapsedMin);
        hysteresisReason = "min_hold";
      } else {
        hysteresisReason = "min_hold_satisfied";
      }
    }
  }

  if (hysteresisEnabled && previousProfile === "risk_off" && desiredProfile === "default" && appliedProfile === "risk_off") {
    if (hysteresisReason === "none") hysteresisReason = "hysteresis_band";
  }

  const shouldSave =
    !state ||
    state.lastProfile !== appliedProfile ||
    !state.lastSwitchedAt ||
    !state.updatedAt ||
    (computeAgeMinutes(state.updatedAt) ?? 9999) > 60;

  if (shouldSave) {
    await saveRegimeGuardState({
      lastProfile: appliedProfile,
      lastSwitchedAt: !state || state.lastProfile !== appliedProfile ? nowIso : state.lastSwitchedAt,
      updatedAt: nowIso
    });
  }

  return {
    ...base,
    baseProfile: base.profile,
    profile: appliedProfile,
    quality,
    hysteresis: {
      enabled: hysteresisEnabled,
      minHoldMin,
      previousProfile,
      desiredProfile,
      appliedProfile,
      holdRemainingMin: Number(holdRemainingMin.toFixed(1)),
      reason: hysteresisReason
    },
    entryGuard
  };
}

async function loadGuardControlState(): Promise<GuardControlState | null> {
  try {
    const raw = await readFile(GUARD_CONTROL_STATE_PATH, "utf8");
    const parsed = parseJsonText<GuardControlState>(raw, "guard_control_state");
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function resolveGuardControlGate(): Promise<GuardControlGate> {
  const enforce = readBoolEnv("GUARD_CONTROL_ENFORCE", false);
  const maxAgeMin = Math.max(0, readNonNegativeNumberEnv("GUARD_CONTROL_MAX_AGE_MIN", 180));

  if (!enforce) {
    return {
      enforce: false,
      maxAgeMin,
      ageMin: null,
      blocked: false,
      wouldBlockLive: false,
      reason: "disabled",
      updatedAt: null,
      level: null,
      stale: false
    };
  }

  const state = await loadGuardControlState();
  if (!state) {
    return {
      enforce: true,
      maxAgeMin,
      ageMin: null,
      blocked: false,
      wouldBlockLive: false,
      reason: "state_missing",
      updatedAt: null,
      level: null,
      stale: false
    };
  }

  const cfg = loadRuntimeConfig();
  const updatedAt = typeof state.updatedAt === "string" && state.updatedAt ? state.updatedAt : null;
  const levelRaw = typeof state.level === "number" && Number.isFinite(state.level) ? state.level : null;
  const level = levelRaw != null ? Math.max(0, Math.floor(levelRaw)) : null;
  const ageMin = computeAgeMinutes(updatedAt);
  const stale = maxAgeMin > 0 && ageMin != null && ageMin > maxAgeMin;
  const liveMode = !cfg.readOnly && cfg.execEnabled;
  const simulationLiveParity = cfg.simulationLiveParity;
  const liveParityGuard = liveMode || simulationLiveParity;
  const lastLevelDangerous = level != null ? level >= 2 : Boolean(state.haltNewEntries);

  if (stale) {
    const keepHaltConservative = liveParityGuard && lastLevelDangerous;
    let reason = `stale(age=${ageMin.toFixed(1)}m>${maxAgeMin}m)`;
    if (lastLevelDangerous) reason += ",halt_level_dangerous";
    if (keepHaltConservative && !liveMode) reason += ",simulated_live_parity";
    return {
      enforce: true,
      maxAgeMin,
      ageMin,
      blocked: keepHaltConservative,
      wouldBlockLive: lastLevelDangerous,
      reason,
      updatedAt,
      level,
      stale: true
    };
  }

  if (!state.haltNewEntries) {
    return {
      enforce: true,
      maxAgeMin,
      ageMin,
      blocked: false,
      wouldBlockLive: false,
      reason: "halt_new_entries_false",
      updatedAt,
      level,
      stale: false
    };
  }

  if (!liveParityGuard) {
    return {
      enforce: true,
      maxAgeMin,
      ageMin,
      blocked: false,
      wouldBlockLive: true,
      reason: `non_live_mode(readOnly=${cfg.readOnly},execEnabled=${cfg.execEnabled})`,
      updatedAt,
      level,
      stale: false
    };
  }

  const levelLabel = level != null ? `L${level}` : "unknown";
  return {
    enforce: true,
    maxAgeMin,
    ageMin,
    blocked: true,
    wouldBlockLive: true,
    reason: `guard_control_halt_new_entries(level=${levelLabel})${!liveMode ? ",simulated_live_parity" : ""}`,
    updatedAt,
    level,
    stale: false
  };
}

function applyEntryGuardToDryExec(dryExec: DryExecBuildResult, regime: RegimeSelection): DryExecBuildResult {
  if (!regime.entryGuard.blocked || dryExec.payloads.length === 0) return dryExec;
  const capacityReasons = new Set(["max_orders_reached", "max_total_notional_reached"]);
  const remappedSkips = dryExec.skipped.map((row) =>
    capacityReasons.has(row.reason)
      ? { ...row, reason: `entry_blocked:${regime.entryGuard.reason}` }
      : row
  );
  const blockedSkips: DryExecSkipReason[] = dryExec.payloads.map((row) => ({
    symbol: row.symbol,
    reason: `entry_blocked:${regime.entryGuard.reason}`,
    ...(dryExec.actionIntent.enabled && dryExec.actionIntent.allowedActionTypes.includes("HOLD_WAIT")
      ? { actionType: "HOLD_WAIT" as const, actionReason: "entry_guard_blocked" }
      : {})
  }));
  const skipped = [...remappedSkips, ...blockedSkips];
  const nextDryExec: DryExecBuildResult = {
    ...dryExec,
    payloads: [],
    skipped,
    skipReasonCounts: buildSkipReasonCounts(skipped)
  };

  return {
    ...nextDryExec,
    actionIntent: rebuildActionIntentSummary(nextDryExec)
  };
}

function applyGuardControlGateToDryExec(dryExec: DryExecBuildResult, gate: GuardControlGate): DryExecBuildResult {
  if (!gate.blocked || dryExec.payloads.length === 0) return dryExec;
  const capacityReasons = new Set(["max_orders_reached", "max_total_notional_reached"]);
  const remappedSkips = dryExec.skipped.map((row) =>
    capacityReasons.has(row.reason)
      ? { ...row, reason: `entry_blocked:${gate.reason}` }
      : row
  );
  const blockedSkips: DryExecSkipReason[] = dryExec.payloads.map((row) => ({
    symbol: row.symbol,
    reason: `entry_blocked:${gate.reason}`,
    ...(dryExec.actionIntent.enabled && dryExec.actionIntent.allowedActionTypes.includes("HOLD_WAIT")
      ? { actionType: "HOLD_WAIT" as const, actionReason: "guard_control_blocked" }
      : {})
  }));
  const skipped = [...remappedSkips, ...blockedSkips];
  const nextDryExec: DryExecBuildResult = {
    ...dryExec,
    payloads: [],
    skipped,
    skipReasonCounts: buildSkipReasonCounts(skipped)
  };

  return {
    ...nextDryExec,
    actionIntent: rebuildActionIntentSummary(nextDryExec)
  };
}

function applyPreflightGateToDryExec(
  dryExec: DryExecBuildResult,
  preflight: PreflightResult
): DryExecBuildResult {
  if (!preflight.blocking || dryExec.payloads.length === 0) return dryExec;
  const blockedSkips: DryExecSkipReason[] = dryExec.payloads.map((row) => ({
    symbol: row.symbol,
    reason: `preflight_blocked:${preflight.code}`,
    ...(dryExec.actionIntent.enabled && dryExec.actionIntent.allowedActionTypes.includes("HOLD_WAIT")
      ? { actionType: "HOLD_WAIT" as const, actionReason: "preflight_blocked" }
      : {})
  }));
  const skipped = [...dryExec.skipped, ...blockedSkips];
  const nextDryExec: DryExecBuildResult = {
    ...dryExec,
    payloads: [],
    skipped,
    skipReasonCounts: buildSkipReasonCounts(skipped)
  };

  return {
    ...nextDryExec,
    actionIntent: rebuildActionIntentSummary(nextDryExec)
  };
}

async function resolveRegimeSelection(accessToken: string): Promise<RegimeSelection> {
  const forced = (process.env.REGIME_FORCE_PROFILE || "auto").trim().toLowerCase();
  const sourcePriorityRaw = (process.env.REGIME_VIX_SOURCE_PRIORITY || "realtime_first").trim().toLowerCase();
  const sourcePriority = sourcePriorityRaw === "snapshot_first" ? "snapshot_first" : "realtime_first";
  const riskOffThreshold = readPositiveNumberEnv("VIX_RISK_OFF_THRESHOLD", 25);
  const riskOnThresholdRaw = readPositiveNumberEnv("VIX_RISK_ON_THRESHOLD", 22);
  const riskOnThreshold = Math.min(riskOnThresholdRaw, riskOffThreshold);
  const snapshotMaxAgeMin = Math.max(0, readNumberEnv("REGIME_SNAPSHOT_MAX_AGE_MIN", 10));
  const diagnostics: string[] = [];

  const buildSelection = (
    profile: RegimeProfile,
    source: RegimeSelection["source"],
    vix: number | null,
    snapshotVix: number | null,
    snapshotAgeMin: number | null,
    diag: string[]
  ): RegimeSelection => ({
    profile,
    baseProfile: profile,
    source,
    vix,
    sourcePriority,
    snapshotVix,
    snapshotAgeMin,
    riskOnThreshold,
    riskOffThreshold,
    diagnostics: diag,
    quality: {
      enabled: readBoolEnv("REGIME_QUALITY_GUARD_ENABLED", true),
      score: 100,
      minScore: readPositiveNumberEnv("REGIME_QUALITY_MIN_SCORE", 60),
      status: "high",
      forceRiskOff: false,
      reasons: []
    },
    hysteresis: {
      enabled: readBoolEnv("REGIME_HYSTERESIS_ENABLED", true),
      minHoldMin: Math.max(0, readNonNegativeNumberEnv("REGIME_MIN_HOLD_MIN", 30)),
      previousProfile: null,
      desiredProfile: profile,
      appliedProfile: profile,
      holdRemainingMin: 0,
      reason: "none"
    },
    entryGuard: {
      blocked: false,
      reason: "none"
    }
  });

  if (forced === "default" || forced === "risk_off") {
    return buildSelection(forced, "forced", null, null, null, [`forced profile=${forced}`]);
  }

  if (!readBoolEnv("REGIME_AUTO_ENABLED", false)) {
    return buildSelection("default", "env_fallback", null, null, null, [
      "regime auto disabled (REGIME_AUTO_ENABLED=false)"
    ]);
  }

  diagnostics.push(`auto source priority=${sourcePriority} snapshotMaxAge=${snapshotMaxAgeMin}m`);

  const snapshot = await fetchLatestMarketSnapshotVix(accessToken);
  if (snapshot.reason) diagnostics.push(`snapshot: ${snapshot.reason}`);
  const snapshotFresh = evaluateSnapshotFreshness(snapshot, snapshotMaxAgeMin);
  if (snapshotFresh.diag) diagnostics.push(snapshotFresh.diag);
  const snapshotAgeMin = computeAgeMinutes(snapshot.modifiedTime);

  const resolveRealtimeVix = async (): Promise<VixLookupResult> => {
    const finnhub = await fetchFinnhubVix();
    diagnostics.push(`finnhub: ${finnhub.reason}`);
    if (finnhub.vix != null) return finnhub;

    const cnbcDirect = await fetchCnbcDirectVix();
    diagnostics.push(`cnbc-direct: ${cnbcDirect.reason}`);
    if (cnbcDirect.vix != null) return cnbcDirect;

    const cnbc = await fetchCnbcRapidApiVix();
    diagnostics.push(`cnbc: ${cnbc.reason}`);
    if (cnbc.vix != null) return cnbc;
    return { vix: null, reason: "realtime providers exhausted", source: "env_fallback" };
  };

  let vix: number | null = null;
  let source: RegimeSelection["source"] = "env_fallback";

  if (sourcePriority === "snapshot_first") {
    if (snapshotFresh.usableVix != null) {
      vix = snapshotFresh.usableVix;
      source = "market_snapshot";
    } else {
      const realtime = await resolveRealtimeVix();
      vix = realtime.vix;
      if (
        realtime.source === "finnhub" ||
        realtime.source === "cnbc_direct" ||
        realtime.source === "cnbc_rapidapi"
      ) {
        source = realtime.source;
      }
    }
  } else {
    const realtime = await resolveRealtimeVix();
    if (
      realtime.vix != null &&
      (realtime.source === "finnhub" || realtime.source === "cnbc_direct" || realtime.source === "cnbc_rapidapi")
    ) {
      vix = realtime.vix;
      source = realtime.source;
    } else if (snapshotFresh.usableVix != null) {
      vix = snapshotFresh.usableVix;
      source = "market_snapshot";
    }
  }

  if (vix == null) {
    return buildSelection("default", source, null, snapshot.vix ?? null, snapshotAgeMin, diagnostics);
  }

  const profile: RegimeProfile = vix >= riskOffThreshold ? "risk_off" : "default";
  return buildSelection(profile, source, vix, snapshot.vix ?? null, snapshotAgeMin, diagnostics);
}

async function loadLatestStage6FromDrive(accessToken: string): Promise<Stage6LoadResult> {
  const meta = await fetchLatestStage6Metadata(accessToken);
  const jsonText = await downloadStage6Json(accessToken, meta.id);
  const parsed = parseJsonText<unknown>(jsonText, `stage6(${meta.name})`);
  const contractContext = parseStage6ContractContext(parsed);
  const allCandidates = parseAllCandidateSummaries(parsed);
  const fallbackCandidates = parseCandidateSummaries(parsed);
  const candidates =
    contractContext && contractContext.executablePicks.length > 0
      ? contractContext.executablePicks
      : fallbackCandidates;
  const modelTopCandidates =
    contractContext && contractContext.modelTop6.length > 0
      ? contractContext.modelTop6
      : fallbackCandidates;
  const symbols = Array.from(new Set(candidates.map((row) => row.symbol).filter(Boolean)));
  const sha256 = createHash("sha256").update(jsonText).digest("hex");

  return {
    fileId: meta.id,
    fileName: meta.name,
    modifiedTime: meta.modifiedTime,
    md5Checksum: meta.md5Checksum,
    sha256,
    candidateSymbols: symbols,
    candidates,
    allCandidates,
    modelTopCandidates,
    contractContext
  };
}

function printStage6Lock(result: Stage6LoadResult) {
  const symbolLog = result.candidateSymbols.length > 0 ? result.candidateSymbols.join(",") : "(none)";
  console.log(
    `[STAGE6_LOCK] ${result.fileName} | fileId=${result.fileId} | modified=${result.modifiedTime} | md5=${result.md5Checksum} | sha256=${result.sha256.slice(0, 12)}`
  );
  console.log(`[STAGE6_CANDIDATES] count=${result.candidateSymbols.length} | symbols=${symbolLog}`);
  console.log(`[STAGE6_ALL_CANDIDATES] count=${result.allCandidates.length}`);
}

function isSha256Hex(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function validateTriggerContext(stage6: Stage6LoadResult): void {
  const eventName = (process.env.WORKFLOW_EVENT_NAME || process.env.GITHUB_EVENT_NAME || "")
    .trim()
    .toLowerCase();
  if (eventName !== "repository_dispatch") return;

  const triggerHashRaw = (process.env.TRIGGER_STAGE6_HASH || "").trim();
  const triggerFile = (process.env.TRIGGER_STAGE6_FILE || "").trim();
  const triggerSourceRun = (process.env.TRIGGER_STAGE6_SOURCE_RUN || "").trim();

  const fail = (reason: string): never => {
    console.error(`[TRIGGER_VALIDATE] fail ${reason}`);
    throw new Error(`[TRIGGER_VALIDATE] ${reason}`);
  };

  if (!triggerHashRaw) {
    fail("missing TRIGGER_STAGE6_HASH for repository_dispatch event");
  }
  if (!isSha256Hex(triggerHashRaw)) {
    fail(`invalid TRIGGER_STAGE6_HASH format (expected=64-hex gotLength=${triggerHashRaw.length})`);
  }

  const expectedHash = triggerHashRaw.toLowerCase();
  const actualHash = stage6.sha256.toLowerCase();
  if (expectedHash !== actualHash) {
    fail(
      `stage6 hash mismatch expected=${expectedHash.slice(0, 12)}(len=${expectedHash.length}) actual=${actualHash.slice(0, 12)}(len=${actualHash.length})`
    );
  }

  if (triggerFile && triggerFile !== stage6.fileName) {
    fail(`stage6 file mismatch expected=${triggerFile} actual=${stage6.fileName}`);
  }

  console.log(
    `[TRIGGER_VALIDATE] ok hash=${actualHash.slice(0, 12)} file=${stage6.fileName} sourceRun=${triggerSourceRun || "N/A"}`
  );
}

function getActionableCandidates(
  candidates: Stage6CandidateSummary[],
  actionableVerdicts: Set<string>
): Stage6CandidateSummary[] {
  return candidates.filter(
    (row) =>
      actionableVerdicts.has(row.verdict) &&
      (row.finalDecision === "EXECUTABLE_NOW" || row.executionBucket === "EXECUTABLE")
  );
}

function mergeLifecycleHeldCandidates(
  baseCandidates: Stage6CandidateSummary[],
  stage6: Stage6LoadResult,
  heldSymbols: Set<string> | undefined
): Stage6CandidateSummary[] {
  if (!heldSymbols || heldSymbols.size === 0) return baseCandidates;
  const merged = new Map<string, Stage6CandidateSummary>();
  baseCandidates.forEach((row) => {
    if (row?.symbol) merged.set(row.symbol, row);
  });
  stage6.allCandidates.forEach((row) => {
    if (!row?.symbol) return;
    if (!heldSymbols.has(row.symbol)) return;
    if (merged.has(row.symbol)) return;
    merged.set(row.symbol, row);
  });
  return Array.from(merged.values());
}

function parseHfPayloadProbeMode(raw: unknown): HfPayloadProbeMode {
  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "tighten") return "tighten";
  if (normalized === "relief") return "relief";
  return "off";
}

function isWorkflowDispatchEvent(): boolean {
  const eventName = (process.env.WORKFLOW_EVENT_NAME || process.env.GITHUB_EVENT_NAME || "")
    .trim()
    .toLowerCase();
  return eventName === "workflow_dispatch";
}

function selectProbeCandidateIndex(actionable: Stage6CandidateSummary[]): number {
  for (let i = 0; i < actionable.length; i += 1) {
    const row = actionable[i];
    const entry = row.entryValue ?? parseNumericPrice(row.entry);
    const target = row.targetValue ?? parseNumericPrice(row.target);
    const stop = row.stopValue ?? parseNumericPrice(row.stop);
    if (entry && target && stop && target > entry && stop < entry) {
      return i;
    }
  }
  return actionable.length > 0 ? 0 : -1;
}

function applyHfPayloadProbe(
  actionable: Stage6CandidateSummary[],
  cfg: ReturnType<typeof loadRuntimeConfig>
): { actionable: Stage6CandidateSummary[]; summary: HfPayloadProbeSummary } {
  const requestedMode = parseHfPayloadProbeMode(process.env.HF_PAYLOAD_PROBE_MODE);
  const baseSummary: HfPayloadProbeSummary = {
    requestedMode,
    active: false,
    modified: false,
    reason: "not_requested",
    symbol: null,
    basePayloadCount: 0,
    baseSkippedCount: 0,
    baseApplied: 0,
    baseTighten: 0,
    baseRelief: 0,
    baseSizeReduced: 0,
    baseSizeReductionNotional: 0,
    generatedAt: new Date().toISOString()
  };

  if (requestedMode === "off") {
    return { actionable, summary: baseSummary };
  }
  if (!isWorkflowDispatchEvent()) {
    return { actionable, summary: { ...baseSummary, reason: "event_not_workflow_dispatch" } };
  }
  if (!cfg.readOnly || cfg.execEnabled) {
    return { actionable, summary: { ...baseSummary, reason: "blocked_non_dry_mode" } };
  }
  if (actionable.length === 0) {
    return { actionable, summary: { ...baseSummary, reason: "no_actionable_candidates" } };
  }
  const probeIndex = selectProbeCandidateIndex(actionable);
  if (probeIndex < 0) {
    return { actionable, summary: { ...baseSummary, reason: "no_probe_candidate" } };
  }

  const target = actionable[probeIndex];
  const scoreFloor = clamp(readNonNegativeNumberEnv("HF_SENTIMENT_SCORE_FLOOR", 0.55), 0.5, 0.95);
  const minArticleCount = Math.max(0, Math.round(readNonNegativeNumberEnv("HF_SENTIMENT_MIN_ARTICLE_COUNT", 2)));
  const maxNewsAgeHours = clamp(readNonNegativeNumberEnv("HF_SENTIMENT_MAX_NEWS_AGE_HOURS", 24), 1, 240);
  const earningsBlockDays = Math.max(0, Math.round(readNonNegativeNumberEnv("HF_EARNINGS_WINDOW_BLOCK_DAYS", 1)));
  const earningsReduceDays = Math.max(0, Math.round(readNonNegativeNumberEnv("HF_EARNINGS_WINDOW_REDUCE_DAYS", 3)));
  const normalizedEarningsReduceDays = Math.max(earningsReduceDays, earningsBlockDays);
  const probeScore = Number(clamp(Math.max(scoreFloor + 0.25, 0.9), 0.5, 0.99).toFixed(4));
  const probeAgeHours = Number(clamp(Math.min(maxNewsAgeHours - 0.1, 6), 0, maxNewsAgeHours).toFixed(2));
  const probeRow: Stage6CandidateSummary = {
    ...target,
    hfSentimentStatus: "OK",
    hfSentimentLabel: requestedMode === "tighten" ? "negative" : "positive",
    hfSentimentScore: probeScore,
    hfSentimentArticleCount: Math.max(1, minArticleCount),
    hfSentimentNewestAgeHours: probeAgeHours,
    hfSentimentReason: `probe_${requestedMode}`,
    earningsDaysToEvent: normalizedEarningsReduceDays + 5
  };
  const nextActionable = [...actionable];
  nextActionable[probeIndex] = probeRow;
  return {
    actionable: nextActionable,
    summary: {
      ...baseSummary,
      active: true,
      modified: true,
      reason: `forced_${requestedMode}`,
      symbol: target.symbol
    }
  };
}

function finalizeHfPayloadProbeSummary(
  probe: HfPayloadProbeSummary,
  dryExecBase: DryExecBuildResult
): HfPayloadProbeSummary {
  return {
    ...probe,
    basePayloadCount: dryExecBase.payloads.length,
    baseSkippedCount: dryExecBase.skipped.length,
    baseApplied: dryExecBase.hfSentimentGate.applied,
    baseTighten: dryExecBase.hfSentimentGate.tightenCount,
    baseRelief: dryExecBase.hfSentimentGate.reliefCount,
    baseSizeReduced: dryExecBase.hfSentimentGate.sizeReducedCount,
    baseSizeReductionNotional: roundToCent(dryExecBase.hfSentimentGate.sizeReductionNotionalTotal)
  };
}

type HfSoftGatePolicy = {
  enabled: boolean;
  scoreFloor: number;
  minArticleCount: number;
  maxNewsAgeHours: number;
  earningsWindowEnabled: boolean;
  earningsBlockDays: number;
  earningsReduceDays: number;
  earningsReduceFactor: number;
  positiveReliefMax: number;
  negativeTightenMax: number;
};

type HfNegativeSizeReductionPolicy = {
  enabled: boolean;
  reductionPct: number;
};

type HfSoftGateAdjustment = {
  applied: boolean;
  delta: number;
  mode: "none" | "relief" | "tighten";
  earningsWindow: "none" | "blocked" | "reduced";
};

function computeHfSoftGateAdjustment(
  row: Stage6CandidateSummary,
  policy: HfSoftGatePolicy
): HfSoftGateAdjustment {
  if (!policy.enabled) return { applied: false, delta: 0, mode: "none", earningsWindow: "none" };
  if (row.hfSentimentStatus !== "OK") return { applied: false, delta: 0, mode: "none", earningsWindow: "none" };
  const label = row.hfSentimentLabel;
  if (label !== "positive" && label !== "negative") return { applied: false, delta: 0, mode: "none", earningsWindow: "none" };
  const score = row.hfSentimentScore;
  if (score == null || !Number.isFinite(score) || score < policy.scoreFloor) {
    return { applied: false, delta: 0, mode: "none", earningsWindow: "none" };
  }
  const articleCount = row.hfSentimentArticleCount;
  if (articleCount == null || articleCount < policy.minArticleCount) {
    return { applied: false, delta: 0, mode: "none", earningsWindow: "none" };
  }
  const newestAgeHours = row.hfSentimentNewestAgeHours;
  if (newestAgeHours == null || newestAgeHours > policy.maxNewsAgeHours) {
    return { applied: false, delta: 0, mode: "none", earningsWindow: "none" };
  }
  const earningsAbsDays =
    row.earningsDaysToEvent != null && Number.isFinite(Number(row.earningsDaysToEvent))
      ? Math.abs(Number(row.earningsDaysToEvent))
      : null;
  if (policy.earningsWindowEnabled && earningsAbsDays != null && earningsAbsDays <= policy.earningsBlockDays) {
    return { applied: false, delta: 0, mode: "none", earningsWindow: "blocked" };
  }
  const confidenceScale = Math.max(1 - policy.scoreFloor, 0.0001);
  const confidence = clamp((score - policy.scoreFloor) / confidenceScale, 0, 1);
  const earningsReduce =
    policy.earningsWindowEnabled &&
    earningsAbsDays != null &&
    earningsAbsDays > policy.earningsBlockDays &&
    earningsAbsDays <= policy.earningsReduceDays;
  const earningsMultiplier = earningsReduce ? policy.earningsReduceFactor : 1;
  if (label === "positive") {
    const rawRelief = policy.positiveReliefMax * confidence * earningsMultiplier;
    const delta = Number((-rawRelief).toFixed(2));
    return Math.abs(delta) > 0
      ? { applied: true, delta, mode: "relief", earningsWindow: earningsReduce ? "reduced" : "none" }
      : { applied: false, delta: 0, mode: "none", earningsWindow: earningsReduce ? "reduced" : "none" };
  }
  const rawTighten = policy.negativeTightenMax * confidence * earningsMultiplier;
  const delta = Number(rawTighten.toFixed(2));
  return delta > 0
    ? { applied: true, delta, mode: "tighten", earningsWindow: earningsReduce ? "reduced" : "none" }
    : { applied: false, delta: 0, mode: "none", earningsWindow: earningsReduce ? "reduced" : "none" };
}

type LifecycleHeldConvictionThresholds = {
  scaleDownMax: number;
  exitPartialMax: number;
  exitFullMax: number;
  exitOnWatchlist: boolean;
  exitOnBlocked: boolean;
};

type LifecycleHeldActionDecision = {
  actionType: LifecycleActionType | null;
  actionReason: string;
  skipReason: string | null;
  detail: string;
};

function resolveLifecycleHeldConvictionThresholds(
  lifecycle: PositionLifecycleConfig
): LifecycleHeldConvictionThresholds {
  const rawScaleDown = clamp(
    readNonNegativeNumberEnv(
      "POSITION_LIFECYCLE_SCALE_DOWN_MAX_CONVICTION",
      Math.max(0, lifecycle.scaleUpMinConviction - 8)
    ),
    0,
    100
  );
  const rawExitPartial = clamp(
    readNonNegativeNumberEnv(
      "POSITION_LIFECYCLE_EXIT_PARTIAL_MAX_CONVICTION",
      Math.max(0, rawScaleDown - 12)
    ),
    0,
    100
  );
  const rawExitFull = clamp(
    readNonNegativeNumberEnv(
      "POSITION_LIFECYCLE_EXIT_FULL_MAX_CONVICTION",
      Math.max(0, rawExitPartial - 12)
    ),
    0,
    100
  );

  const scaleDownMax = Number(rawScaleDown.toFixed(1));
  const exitPartialMax = Number(Math.min(rawExitPartial, scaleDownMax).toFixed(1));
  const exitFullMax = Number(Math.min(rawExitFull, exitPartialMax).toFixed(1));

  return {
    scaleDownMax,
    exitPartialMax,
    exitFullMax,
    exitOnWatchlist: readBoolEnv("POSITION_LIFECYCLE_EXIT_ON_WATCHLIST", true),
    exitOnBlocked: readBoolEnv("POSITION_LIFECYCLE_EXIT_ON_BLOCKED", true)
  };
}

function resolveHeldPreferredAction(
  preferred: "SCALE_UP" | "SCALE_DOWN" | "EXIT_PARTIAL" | "EXIT_FULL",
  lifecycle: PositionLifecycleConfig
): LifecycleActionType | null {
  const chain: LifecycleActionType[] =
    preferred === "SCALE_UP"
      ? ["SCALE_UP"]
      : preferred === "SCALE_DOWN"
        ? ["SCALE_DOWN"]
        : preferred === "EXIT_PARTIAL"
          ? ["EXIT_PARTIAL", "SCALE_DOWN"]
          : ["EXIT_FULL", "EXIT_PARTIAL", "SCALE_DOWN"];
  for (const candidate of chain) {
    if (isActionTypeAllowed(candidate, lifecycle)) return candidate;
  }
  return null;
}

function resolveHeldLifecycleAction(
  row: Stage6CandidateSummary,
  conviction: number | null,
  effectiveExecutable: boolean,
  effectiveWatchlist: boolean,
  lifecycle: PositionLifecycleConfig,
  thresholds: LifecycleHeldConvictionThresholds,
  heldPosition: HeldPositionSnapshot | null,
  regime: RegimeSelection
): LifecycleHeldActionDecision {
  const convictionToken = conviction == null ? "n/a" : conviction.toFixed(1);
  const decisionReasonKey = String(row.decisionReason || "")
    .trim()
    .toLowerCase();
  const finalDecision = row.finalDecision;
  const blockedDecision = finalDecision === "BLOCKED_RISK" || finalDecision === "BLOCKED_EVENT";
  const symbolStateHardExit =
    row.symbolLifecycleState === "STALE" ||
    row.symbolLifecycleState === "RETIRED" ||
    row.symbolLifecycleState === "EXCLUDED";
  const unrealizedPnlPct = heldPosition?.unrealizedPnlPct ?? null;
  const intradayPnlPct = heldPosition?.intradayPnlPct ?? null;
  const holdAgeDays = heldPosition?.ageDays ?? null;
  const unrealizedToken = unrealizedPnlPct == null ? "n/a" : unrealizedPnlPct.toFixed(4);
  const intradayToken = intradayPnlPct == null ? "n/a" : intradayPnlPct.toFixed(4);
  const holdAgeToken = holdAgeDays == null ? "n/a" : holdAgeDays.toFixed(2);

  const regimeRiskOff = regime.profile === "risk_off";
  const exitFullLossPct = -clamp(
    readNonNegativeNumberEnv(
      "POSITION_LIFECYCLE_EXIT_FULL_MAX_LOSS_PCT",
      regimeRiskOff ? 0.06 : 0.08
    ),
    0.01,
    0.5
  );
  const exitPartialLossPct = -clamp(
    readNonNegativeNumberEnv(
      "POSITION_LIFECYCLE_EXIT_PARTIAL_MAX_LOSS_PCT",
      regimeRiskOff ? 0.04 : 0.05
    ),
    0.01,
    0.5
  );
  const scaleDownLossPct = -clamp(
    readNonNegativeNumberEnv(
      "POSITION_LIFECYCLE_SCALE_DOWN_MAX_LOSS_PCT",
      regimeRiskOff ? 0.02 : 0.03
    ),
    0.005,
    0.5
  );
  const intradayShockPct = -clamp(
    readNonNegativeNumberEnv("POSITION_LIFECYCLE_RISK_OFF_INTRADAY_SHOCK_PCT", 0.025),
    0.005,
    0.3
  );
  const takeProfitPartialPct = clamp(
    readNonNegativeNumberEnv("POSITION_LIFECYCLE_TAKE_PROFIT_PARTIAL_PCT", 0.18),
    0.02,
    2
  );
  const scaleUpMaxChaseFromAvgEntryPct = clamp(
    readNonNegativeNumberEnv("POSITION_LIFECYCLE_SCALE_UP_MAX_CHASE_FROM_AVG_ENTRY_PCT", 0.03),
    0,
    0.5
  );
  const scaleUpMaxIntradayGainPct = clamp(
    readNonNegativeNumberEnv("POSITION_LIFECYCLE_SCALE_UP_MAX_INTRADAY_GAIN_PCT", 0.02),
    0,
    0.5
  );
  const staleHoldDays = clamp(
    readNonNegativeNumberEnv("POSITION_LIFECYCLE_STALE_HOLD_DAYS", 15),
    1,
    365
  );
  const scaleUpChasePct =
    heldPosition &&
    heldPosition.avgEntryPrice != null &&
    heldPosition.currentPrice != null &&
    heldPosition.avgEntryPrice > 0 &&
    heldPosition.currentPrice > 0
      ? Number(
          (
            heldPosition.side === "short"
              ? (heldPosition.avgEntryPrice - heldPosition.currentPrice) / heldPosition.avgEntryPrice
              : (heldPosition.currentPrice - heldPosition.avgEntryPrice) / heldPosition.avgEntryPrice
          ).toFixed(4)
        )
      : null;
  const scaleUpChaseToken = scaleUpChasePct == null ? "n/a" : scaleUpChasePct.toFixed(4);

  if (effectiveExecutable && conviction != null && conviction >= lifecycle.scaleUpMinConviction) {
    if (scaleUpChasePct != null && scaleUpChasePct > scaleUpMaxChaseFromAvgEntryPct) {
      return {
        actionType: null,
        actionReason: "scale_up_chase_guard",
        skipReason: "scale_up_chase_guard",
        detail: `chasePct=${scaleUpChaseToken}|max=${scaleUpMaxChaseFromAvgEntryPct.toFixed(4)}|entry=${heldPosition?.avgEntryPrice?.toFixed(2) ?? "n/a"}|last=${heldPosition?.currentPrice?.toFixed(2) ?? "n/a"}`
      };
    }
    if (intradayPnlPct != null && intradayPnlPct > scaleUpMaxIntradayGainPct) {
      return {
        actionType: null,
        actionReason: "scale_up_intraday_chase_guard",
        skipReason: "scale_up_intraday_chase_guard",
        detail: `intraday=${intradayToken}|max=${scaleUpMaxIntradayGainPct.toFixed(4)}|chasePct=${scaleUpChaseToken}`
      };
    }
    const actionType = resolveHeldPreferredAction("SCALE_UP", lifecycle);
    if (actionType) {
      return {
        actionType,
        actionReason: "existing_position_scale_up",
        skipReason: null,
        detail: `conv=${convictionToken}|scaleUpMin=${lifecycle.scaleUpMinConviction.toFixed(1)}|chasePct=${scaleUpChaseToken}|intraday=${intradayToken}`
      };
    }
    return {
      actionType: null,
      actionReason: "scale_up_not_allowed",
      skipReason: "scale_up_not_allowed",
      detail: `conv=${convictionToken}|scaleUpMin=${lifecycle.scaleUpMinConviction.toFixed(1)}|chasePct=${scaleUpChaseToken}|intraday=${intradayToken}`
    };
  }

  if (
    thresholds.exitOnBlocked &&
    (symbolStateHardExit ||
      blockedDecision ||
      LIFECYCLE_HARD_EXIT_DECISION_REASONS.has(decisionReasonKey))
  ) {
    const actionType = resolveHeldPreferredAction("EXIT_FULL", lifecycle);
    if (actionType) {
      return {
        actionType,
        actionReason: symbolStateHardExit ? "held_state_hard_exit" : "held_blocked_hard_exit",
        skipReason: null,
        detail: `decision=${finalDecision}|reason=${decisionReasonKey || "n/a"}|conv=${convictionToken}`
      };
    }
  }

  if (unrealizedPnlPct != null && unrealizedPnlPct <= exitFullLossPct) {
    const actionType = resolveHeldPreferredAction("EXIT_FULL", lifecycle);
    if (actionType) {
      return {
        actionType,
        actionReason: "loss_exit_full",
        skipReason: null,
        detail: `upl=${unrealizedToken}|threshold=${exitFullLossPct.toFixed(4)}|profile=${regime.profile}`
      };
    }
  }

  if (row.verdict === "PARTIAL_EXIT") {
    const actionType = resolveHeldPreferredAction("EXIT_PARTIAL", lifecycle);
    if (actionType) {
      return {
        actionType,
        actionReason: "stage6_partial_exit_verdict",
        skipReason: null,
        detail: `verdict=${row.verdict}|decision=${finalDecision}|conv=${convictionToken}`
      };
    }
  }

  const riskOffDeRiskSignal =
    regimeRiskOff &&
    ((unrealizedPnlPct != null && unrealizedPnlPct <= exitPartialLossPct) ||
      (unrealizedPnlPct != null && unrealizedPnlPct <= scaleDownLossPct && effectiveWatchlist) ||
      (intradayPnlPct != null && intradayPnlPct <= intradayShockPct) ||
      regime.quality.forceRiskOff);
  if (riskOffDeRiskSignal) {
    const actionType = resolveHeldPreferredAction("EXIT_PARTIAL", lifecycle);
    if (actionType) {
      return {
        actionType,
        actionReason: "risk_off_de_risk",
        skipReason: null,
        detail: `profile=${regime.profile}|upl=${unrealizedToken}|intraday=${intradayToken}|qualityForce=${regime.quality.forceRiskOff}`
      };
    }
  }

  if (conviction != null && conviction <= thresholds.exitFullMax) {
    const actionType = resolveHeldPreferredAction("EXIT_FULL", lifecycle);
    if (actionType) {
      return {
        actionType,
        actionReason: "conviction_exit_full_threshold",
        skipReason: null,
        detail: `conv=${convictionToken}|threshold=${thresholds.exitFullMax.toFixed(1)}`
      };
    }
  }

  if (conviction != null && conviction <= thresholds.exitPartialMax) {
    const actionType = resolveHeldPreferredAction("EXIT_PARTIAL", lifecycle);
    if (actionType) {
      return {
        actionType,
        actionReason: "conviction_exit_partial_threshold",
        skipReason: null,
        detail: `conv=${convictionToken}|threshold=${thresholds.exitPartialMax.toFixed(1)}`
      };
    }
  }

  if (
    holdAgeDays != null &&
    holdAgeDays >= staleHoldDays &&
    (effectiveWatchlist || (conviction != null && conviction <= thresholds.scaleDownMax))
  ) {
    const actionType = resolveHeldPreferredAction("SCALE_DOWN", lifecycle);
    if (actionType) {
      return {
        actionType,
        actionReason: "stale_hold_scale_down",
        skipReason: null,
        detail: `holdAgeDays=${holdAgeToken}|staleDays=${staleHoldDays.toFixed(1)}|decision=${finalDecision}`
      };
    }
  }

  if (
    unrealizedPnlPct != null &&
    unrealizedPnlPct >= takeProfitPartialPct &&
    (effectiveWatchlist || conviction == null || conviction <= thresholds.scaleDownMax)
  ) {
    const actionType = resolveHeldPreferredAction("EXIT_PARTIAL", lifecycle);
    if (actionType) {
      return {
        actionType,
        actionReason: "take_profit_partial",
        skipReason: null,
        detail: `upl=${unrealizedToken}|threshold=${takeProfitPartialPct.toFixed(4)}|decision=${finalDecision}`
      };
    }
  }

  if (
    conviction != null &&
    conviction <= thresholds.scaleDownMax &&
    (thresholds.exitOnWatchlist ? effectiveWatchlist || finalDecision === "WAIT_PRICE" : true)
  ) {
    const actionType = resolveHeldPreferredAction("SCALE_DOWN", lifecycle);
    if (actionType) {
      return {
        actionType,
        actionReason:
          effectiveWatchlist || finalDecision === "WAIT_PRICE"
            ? "watchlist_scale_down"
            : "conviction_scale_down_threshold",
        skipReason: null,
        detail: `conv=${convictionToken}|threshold=${thresholds.scaleDownMax.toFixed(1)}|decision=${finalDecision}`
      };
    }
  }

  return {
    actionType: null,
    actionReason: "held_position_hold_wait",
    skipReason: "held_position_hold_wait",
    detail: `conv=${convictionToken}|decision=${finalDecision}|reason=${decisionReasonKey || "n/a"}|upl=${unrealizedToken}|intraday=${intradayToken}|holdAge=${holdAgeToken}|scaleDownMax=${thresholds.scaleDownMax.toFixed(1)}`
  };
}

function buildLifecycleExitPriceScaffold(
  entry: number | null,
  target: number | null,
  stop: number | null
): { entry: number; target: number; stop: number } {
  const basisRaw = entry ?? target ?? stop ?? 1;
  const basis = Number.isFinite(basisRaw) && basisRaw > 0 ? basisRaw : 1;
  const safeEntry = roundToCent(Math.max(basis, 0.01));
  const safeTarget = roundToCent(Math.max(target ?? safeEntry * 1.01, safeEntry + 0.01));
  let safeStop = roundToCent(Math.max(0.01, Math.min(stop ?? safeEntry * 0.99, safeEntry - 0.01)));
  if (safeStop >= safeEntry) safeStop = roundToCent(Math.max(0.01, safeEntry - 0.01));
  return {
    entry: safeEntry,
    target: safeTarget,
    stop: safeStop
  };
}

function buildDryExecPayloads(
  actionable: Stage6CandidateSummary[],
  stage6Hash: string,
  regime: RegimeSelection,
  overrides?: {
    hfSoftGateEnabled?: boolean;
    hfNegativeSizeReductionEnabled?: boolean;
    lifecycleHeldSymbols?: Set<string>;
    lifecycleHeldContext?: Map<string, HeldPositionSnapshot>;
  }
): DryExecBuildResult {
  const runtimeCfg = loadRuntimeConfig();
  const lifecycle = runtimeCfg.positionLifecycle;
  const actionIntentCounts = createEmptyActionIntentCounts();
  const notionalPerOrder = readProfilePositiveNumber(
    regime.profile,
    "DRY_DEFAULT_NOTIONAL_PER_TRADE",
    "DRY_RISK_OFF_NOTIONAL_PER_TRADE",
    "DRY_NOTIONAL_PER_TRADE",
    1000
  );
  const maxOrders = readProfilePositiveInt(
    regime.profile,
    "DRY_DEFAULT_MAX_ORDERS",
    "DRY_RISK_OFF_MAX_ORDERS",
    "DRY_MAX_ORDERS",
    3
  );
  const maxTotalNotional = readProfilePositiveNumber(
    regime.profile,
    "DRY_DEFAULT_MAX_TOTAL_NOTIONAL",
    "DRY_RISK_OFF_MAX_TOTAL_NOTIONAL",
    "DRY_MAX_TOTAL_NOTIONAL",
    notionalPerOrder * maxOrders
  );
  const baseMinConviction = readProfilePositiveNumber(
    regime.profile,
    "DRY_DEFAULT_MIN_CONVICTION",
    "DRY_RISK_OFF_MIN_CONVICTION",
    "DRY_MIN_CONVICTION",
    70
  );
  const minConvictionFloorRaw = readProfilePositiveNumber(
    regime.profile,
    "DRY_DEFAULT_MIN_CONVICTION_FLOOR",
    "DRY_RISK_OFF_MIN_CONVICTION_FLOOR",
    "DRY_MIN_CONVICTION_FLOOR",
    regime.profile === "risk_off" ? 58 : 55
  );
  const minConvictionCeilingRaw = readProfilePositiveNumber(
    regime.profile,
    "DRY_DEFAULT_MIN_CONVICTION_CEILING",
    "DRY_RISK_OFF_MIN_CONVICTION_CEILING",
    "DRY_MIN_CONVICTION_CEILING",
    90
  );
  const minConvictionFloor = Math.min(minConvictionFloorRaw, minConvictionCeilingRaw - 0.1);
  const minConvictionCeiling =
    minConvictionCeilingRaw > minConvictionFloor
      ? minConvictionCeilingRaw
      : minConvictionFloor + 0.1;
  const convictionSamples = actionable
    .map((row) => parseConviction(row.conviction))
    .filter((value): value is number => value != null);
  const sampleQuantileQ = regime.profile === "risk_off" ? 0.35 : 0.25;
  const sampleQuantileValue = percentile(convictionSamples, sampleQuantileQ);
  const sampleCap = sampleQuantileValue == null ? null : sampleQuantileValue + (regime.profile === "risk_off" ? 6 : 8);
  const vixRef = regime.vix ?? regime.snapshotVix;
  const marketTighten =
    vixRef == null
      ? 0
      : regime.profile === "risk_off"
        ? clamp((vixRef - 24) / 2, 0, 3)
        : clamp((vixRef - 20) / 4, 0, 2);
  const qualityRelief = clamp((regime.quality.score - 70) / 5, 0, 3);
  let adaptiveMinConviction = baseMinConviction + marketTighten - qualityRelief;
  if (sampleCap != null) adaptiveMinConviction = Math.min(adaptiveMinConviction, sampleCap);
  const minConviction = Number(clamp(adaptiveMinConviction, minConvictionFloor, minConvictionCeiling).toFixed(1));
  const minConvictionPolicy = {
    base: Number(baseMinConviction.toFixed(1)),
    applied: minConviction,
    floor: Number(minConvictionFloor.toFixed(1)),
    ceiling: Number(minConvictionCeiling.toFixed(1)),
    marketTighten: Number(marketTighten.toFixed(2)),
    qualityRelief: Number(qualityRelief.toFixed(2)),
    sampleCount: convictionSamples.length,
    sampleQuantileQ,
    sampleQuantileValue: sampleQuantileValue != null ? Number(sampleQuantileValue.toFixed(2)) : null,
    sampleCap: sampleCap != null ? Number(sampleCap.toFixed(2)) : null
  };
  const hfSoftGatePolicy: HfSoftGatePolicy = {
    enabled: overrides?.hfSoftGateEnabled ?? readBoolEnv("HF_SENTIMENT_SOFT_GATE_ENABLED", false),
    scoreFloor: clamp(readNonNegativeNumberEnv("HF_SENTIMENT_SCORE_FLOOR", 0.55), 0.5, 0.95),
    minArticleCount: Math.max(0, Math.round(readNonNegativeNumberEnv("HF_SENTIMENT_MIN_ARTICLE_COUNT", 2))),
    maxNewsAgeHours: clamp(readNonNegativeNumberEnv("HF_SENTIMENT_MAX_NEWS_AGE_HOURS", 24), 1, 240),
    earningsWindowEnabled: readBoolEnv("HF_EARNINGS_WINDOW_ENABLED", true),
    earningsBlockDays: Math.max(0, Math.round(readNonNegativeNumberEnv("HF_EARNINGS_WINDOW_BLOCK_DAYS", 1))),
    earningsReduceDays: Math.max(0, Math.round(readNonNegativeNumberEnv("HF_EARNINGS_WINDOW_REDUCE_DAYS", 3))),
    earningsReduceFactor: clamp(readNonNegativeNumberEnv("HF_EARNINGS_WINDOW_REDUCE_FACTOR", 0.3), 0, 1),
    positiveReliefMax: clamp(readNonNegativeNumberEnv("HF_SENTIMENT_POSITIVE_RELIEF_MAX", 1.0), 0, 3),
    negativeTightenMax: clamp(readNonNegativeNumberEnv("HF_SENTIMENT_NEGATIVE_TIGHTEN_MAX", 2.0), 0, 4)
  };
  const hfNegativeSizeReductionPolicy: HfNegativeSizeReductionPolicy = {
    enabled:
      overrides?.hfNegativeSizeReductionEnabled ?? readBoolEnv("HF_NEGATIVE_SIZE_REDUCTION_ENABLED", false),
    reductionPct: clamp(readNonNegativeNumberEnv("HF_NEGATIVE_SIZE_REDUCTION_PCT", 0.15), 0, 0.5)
  };
  if (hfSoftGatePolicy.earningsReduceDays < hfSoftGatePolicy.earningsBlockDays) {
    hfSoftGatePolicy.earningsReduceDays = hfSoftGatePolicy.earningsBlockDays;
  }
  let hfSoftApplied = 0;
  let hfSoftReliefCount = 0;
  let hfSoftTightenCount = 0;
  let hfSoftBlockedNegative = 0;
  let hfSoftEarningsBlocked = 0;
  let hfSoftEarningsReduced = 0;
  let hfSoftNetConvictionDelta = 0;
  let hfSoftSizeReducedCount = 0;
  let hfSoftSizeReductionNotionalTotal = 0;
  let hfExplainCheckedCandidates = 0;
  let hfExplainStatusNotOk = 0;
  let hfExplainUnsupportedLabel = 0;
  let hfExplainLowScore = 0;
  let hfExplainLowArticleCount = 0;
  let hfExplainStaleNews = 0;
  let hfExplainEarningsWindowBlocked = 0;
  const configuredMinStopDistancePct = readProfilePositiveNumber(
    regime.profile,
    "DRY_DEFAULT_MIN_STOP_DISTANCE_PCT",
    "DRY_RISK_OFF_MIN_STOP_DISTANCE_PCT",
    "DRY_MIN_STOP_DISTANCE_PCT",
    2
  );
  const configuredMaxStopDistancePctRaw = readProfilePositiveNumber(
    regime.profile,
    "DRY_DEFAULT_MAX_STOP_DISTANCE_PCT",
    "DRY_RISK_OFF_MAX_STOP_DISTANCE_PCT",
    "DRY_MAX_STOP_DISTANCE_PCT",
    25
  );
  const configuredMaxStopDistancePct =
    configuredMaxStopDistancePctRaw > configuredMinStopDistancePct
      ? configuredMaxStopDistancePctRaw
      : configuredMinStopDistancePct + 0.1;
  const stage6MinStopDistancePct = readPositiveNumberEnv("VITE_STAGE6_MIN_STOP_DISTANCE_PCT", 1.5);
  const stage6MaxStopDistancePctRaw = readPositiveNumberEnv("VITE_STAGE6_MAX_STOP_DISTANCE_PCT", 22);
  const stage6MaxStopDistancePct =
    stage6MaxStopDistancePctRaw > stage6MinStopDistancePct
      ? stage6MaxStopDistancePctRaw
      : stage6MinStopDistancePct + 0.1;
  const syncStopDistanceWithStage6 = readBoolEnv("DRY_STOP_DISTANCE_STAGE6_SYNC", true);
  let minStopDistancePct = configuredMinStopDistancePct;
  let maxStopDistancePct = configuredMaxStopDistancePct;
  let stopDistancePolicyStrategy: "stage6_locked" | "stage6_fallback" | "configured" = "configured";
  if (syncStopDistanceWithStage6) {
    minStopDistancePct = stage6MinStopDistancePct;
    maxStopDistancePct = stage6MaxStopDistancePct;
    stopDistancePolicyStrategy = "stage6_locked";
  }
  const entryFeasibilityEnforce = readBoolEnv("ENTRY_FEASIBILITY_ENFORCE", false);
  const entryMaxDistancePct = Math.max(0, readNonNegativeNumberEnv("ENTRY_MAX_DISTANCE_PCT", 15));
  const stage6ExecutionBucketEnforce = readBoolEnv("STAGE6_EXECUTION_BUCKET_ENFORCE", true);
  const lifecycleHeldSymbols = overrides?.lifecycleHeldSymbols;
  const lifecycleHeldContext = overrides?.lifecycleHeldContext;
  const lifecycleHeldThresholds = resolveLifecycleHeldConvictionThresholds(lifecycle);
  const payloads: DryExecOrderPayload[] = [];
  const skipped: DryExecSkipReason[] = [];
  let allocatedNotional = 0;
  let entryFeasibilityChecked = 0;
  let entryFeasibilityBlocked = 0;
  let stage6ContractChecked = 0;
  let stage6ContractExecutable = 0;
  let stage6ContractWatchlist = 0;
  let stage6ContractBlocked = 0;

  const pushSkip = (
    symbol: string,
    reason: string,
    actionType?: LifecycleActionType,
    actionReason?: string,
    detail?: string
  ) => {
    const row: DryExecSkipReason = { symbol, reason };
    if (detail && detail.trim().length > 0) row.detail = detail;
    if (lifecycle.enabled && actionType && isActionTypeAllowed(actionType, lifecycle)) {
      actionIntentCounts[actionType] += 1;
      row.actionType = actionType;
      row.actionReason = actionReason || reason;
    }
    skipped.push(row);
  };

  actionable.forEach((row) => {
    hfExplainCheckedCandidates += 1;
    const hasBucketSignal =
      !isMissingContractToken(row.executionBucket) || !isMissingContractToken(row.executionReason);
    const hasDecisionSignal =
      !isMissingContractToken(row.finalDecision) || !isMissingContractToken(row.decisionReason);
    const effectiveExecutable =
      row.executionBucket === "EXECUTABLE" || row.finalDecision === "EXECUTABLE_NOW";
    const effectiveWatchlist =
      row.executionBucket === "WATCHLIST" ||
      row.finalDecision === "WAIT_PRICE" ||
      row.finalDecision === "BLOCKED_RISK" ||
      row.finalDecision === "BLOCKED_EVENT";
    const hasHeldPosition =
      lifecycle.enabled &&
      !lifecycle.previewOnly &&
      lifecycleHeldSymbols != null &&
      lifecycleHeldSymbols.has(row.symbol);

    if (hasBucketSignal || hasDecisionSignal) {
      stage6ContractChecked += 1;
      if (effectiveExecutable) stage6ContractExecutable += 1;
      if (effectiveWatchlist) stage6ContractWatchlist += 1;
    }

    const isExplicitlyNonCommon = row.instrumentType !== "unknown" && row.instrumentType !== "common";
    const isInstrumentIneligible = row.analysisEligible === false || isExplicitlyNonCommon;
    if (isInstrumentIneligible) {
      pushSkip(row.symbol, "instrument_type_ineligible");
      stage6ContractBlocked += 1;
      return;
    }
    const isLifecycleIneligible =
      row.symbolLifecycleState === "STALE" ||
      row.symbolLifecycleState === "RETIRED" ||
      row.symbolLifecycleState === "EXCLUDED";
    if (isLifecycleIneligible) {
      pushSkip(row.symbol, "symbol_state_ineligible");
      stage6ContractBlocked += 1;
      return;
    }

    if (stage6ExecutionBucketEnforce && effectiveWatchlist && !hasHeldPosition) {
      pushSkip(
        row.symbol,
        row.decisionReason && !isMissingContractToken(row.decisionReason)
          ? mapStage6DecisionReasonToSkip(row.decisionReason)
          : mapStage6ExecutionReasonToSkip(row.executionReason),
        "HOLD_WAIT",
        "watchlist_or_blocked"
      );
      stage6ContractBlocked += 1;
      return;
    }

    if (
      stage6ExecutionBucketEnforce &&
      effectiveExecutable &&
      !isMissingContractToken(row.executionReason) &&
      row.executionReason !== "VALID_EXEC" &&
      !hasHeldPosition
    ) {
      pushSkip(
        row.symbol,
        mapStage6ExecutionReasonToSkip(row.executionReason),
        "HOLD_WAIT",
        "stage6_execution_reason_blocked"
      );
      stage6ContractBlocked += 1;
      return;
    }

    // Quality gate first: keep skip reasons deterministic and diagnosis-friendly.
    const conviction = parseConviction(row.conviction);
    if (hfSoftGatePolicy.enabled) {
      if (row.hfSentimentStatus !== "OK") {
        hfExplainStatusNotOk += 1;
      } else if (row.hfSentimentLabel !== "positive" && row.hfSentimentLabel !== "negative") {
        hfExplainUnsupportedLabel += 1;
      } else if (
        row.hfSentimentScore == null ||
        !Number.isFinite(row.hfSentimentScore) ||
        row.hfSentimentScore < hfSoftGatePolicy.scoreFloor
      ) {
        hfExplainLowScore += 1;
      } else if (
        row.hfSentimentArticleCount == null ||
        row.hfSentimentArticleCount < hfSoftGatePolicy.minArticleCount
      ) {
        hfExplainLowArticleCount += 1;
      } else if (
        row.hfSentimentNewestAgeHours == null ||
        row.hfSentimentNewestAgeHours > hfSoftGatePolicy.maxNewsAgeHours
      ) {
        hfExplainStaleNews += 1;
      } else {
        const earningsAbsDays =
          row.earningsDaysToEvent != null && Number.isFinite(Number(row.earningsDaysToEvent))
            ? Math.abs(Number(row.earningsDaysToEvent))
            : null;
        if (
          hfSoftGatePolicy.earningsWindowEnabled &&
          earningsAbsDays != null &&
          earningsAbsDays <= hfSoftGatePolicy.earningsBlockDays
        ) {
          hfExplainEarningsWindowBlocked += 1;
        }
      }
    }
    const hfAdjustment = computeHfSoftGateAdjustment(row, hfSoftGatePolicy);
    if (hfAdjustment.earningsWindow === "blocked") hfSoftEarningsBlocked += 1;
    if (hfAdjustment.earningsWindow === "reduced") hfSoftEarningsReduced += 1;
    const convictionFloorWithHf = Number(
      clamp(minConviction + hfAdjustment.delta, minConvictionFloor, minConvictionCeiling).toFixed(1)
    );
    if (hfAdjustment.applied) {
      hfSoftApplied += 1;
      hfSoftNetConvictionDelta = Number((hfSoftNetConvictionDelta + hfAdjustment.delta).toFixed(2));
      if (hfAdjustment.mode === "relief") hfSoftReliefCount += 1;
      if (hfAdjustment.mode === "tighten") hfSoftTightenCount += 1;
    }
    const convictionBelowEntryFloor = conviction == null || conviction < convictionFloorWithHf;
    if (convictionBelowEntryFloor && !hasHeldPosition) {
      const skipReason =
        hfAdjustment.mode === "tighten" ? "conviction_below_floor_hf_negative" : "conviction_below_floor";
      if (hfAdjustment.mode === "tighten") hfSoftBlockedNegative += 1;
      const convictionToken = conviction == null ? "n/a" : conviction.toFixed(1);
      const decisionToken = isMissingContractToken(row.finalDecision) ? "n/a" : row.finalDecision;
      const decisionReasonToken = isMissingContractToken(row.decisionReason) ? "n/a" : row.decisionReason;
      const executionReasonToken = isMissingContractToken(row.executionReason) ? "n/a" : row.executionReason;
      const detail = `conv=${convictionToken}|floor=${convictionFloorWithHf.toFixed(1)}|hfMode=${hfAdjustment.mode}|decision=${decisionToken}|decisionReason=${decisionReasonToken}|executionReason=${executionReasonToken}`;
      pushSkip(row.symbol, skipReason, "HOLD_WAIT", "conviction_gate_not_passed", detail);
      return;
    }

    const entryRaw = row.entryValue ?? parseNumericPrice(row.entry);
    const targetRaw = row.targetValue ?? parseNumericPrice(row.target);
    const stopRaw = row.stopValue ?? parseNumericPrice(row.stop);

    let actionType: LifecycleActionType | undefined;
    let actionReason: string | undefined;
    if (lifecycle.enabled) {
      if (hasHeldPosition) {
        const heldDecision = resolveHeldLifecycleAction(
          row,
          conviction,
          effectiveExecutable,
          effectiveWatchlist,
          lifecycle,
          lifecycleHeldThresholds,
          lifecycleHeldContext?.get(row.symbol) || null,
          regime
        );
        if (!heldDecision.actionType) {
          pushSkip(
            row.symbol,
            heldDecision.skipReason || "held_position_hold_wait",
            "HOLD_WAIT",
            heldDecision.actionReason,
            heldDecision.detail
          );
          return;
        }
        actionType = heldDecision.actionType;
        actionReason = heldDecision.actionReason;
      } else if (isActionTypeAllowed("ENTRY_NEW", lifecycle)) {
        actionType = "ENTRY_NEW";
        actionReason = "stage6_executable_now";
      }
    }

    const isExitAction = isLifecycleExitActionType(actionType);
    let entry = entryRaw;
    let target = targetRaw;
    let stop = stopRaw;

    if (!isExitAction) {
      if (!entry || !target || !stop) {
        pushSkip(row.symbol, "missing_or_invalid_price");
        return;
      }
      if (!(target > entry && stop < entry)) {
        pushSkip(row.symbol, "invalid_price_geometry");
        return;
      }
      const stopDistancePct = ((entry - stop) / entry) * 100;
      if (stopDistancePct < minStopDistancePct || stopDistancePct > maxStopDistancePct) {
        pushSkip(row.symbol, "stop_distance_out_of_range");
        return;
      }
      if (entryFeasibilityEnforce) {
        entryFeasibilityChecked += 1;
        if (row.tradePlanStatus === "INVALID_DATA") {
          pushSkip(row.symbol, "entry_data_missing", "HOLD_WAIT", "entry_data_not_ready");
          entryFeasibilityBlocked += 1;
          return;
        }
        if (row.tradePlanStatus === "INVALID_GEOMETRY") {
          pushSkip(row.symbol, "entry_invalid_geometry", "HOLD_WAIT", "entry_geometry_not_ready");
          entryFeasibilityBlocked += 1;
          return;
        }
        if (row.entryFeasible === false) {
          const reason =
            row.tradePlanStatus === "WAIT_PULLBACK_TOO_DEEP"
              ? "entry_too_far_from_market"
              : "entry_feasibility_false";
          pushSkip(row.symbol, reason, "HOLD_WAIT", "entry_feasibility_not_ready");
          entryFeasibilityBlocked += 1;
          return;
        }
        if (row.entryDistancePct != null && row.entryDistancePct > entryMaxDistancePct) {
          pushSkip(row.symbol, "entry_too_far_from_market", "HOLD_WAIT", "entry_distance_over_limit");
          entryFeasibilityBlocked += 1;
          return;
        }
      }
    } else {
      const scaffold = buildLifecycleExitPriceScaffold(entryRaw, targetRaw, stopRaw);
      entry = scaffold.entry;
      target = scaffold.target;
      stop = scaffold.stop;
    }

    // Capacity / exposure gate only applies to entry/scale-up paths.
    if (!isExitAction && payloads.length >= maxOrders) {
      pushSkip(row.symbol, "max_orders_reached");
      return;
    }
    if (!isExitAction && allocatedNotional + notionalPerOrder > maxTotalNotional) {
      pushSkip(row.symbol, "max_total_notional_reached");
      return;
    }

    let effectiveNotional = notionalPerOrder;
    if (
      !isExitAction &&
      hfNegativeSizeReductionPolicy.enabled &&
      hfAdjustment.applied &&
      hfAdjustment.mode === "tighten"
    ) {
      const reducedNotional = Math.max(
        1,
        roundToCent(notionalPerOrder * (1 - hfNegativeSizeReductionPolicy.reductionPct))
      );
      if (reducedNotional < notionalPerOrder) {
        hfSoftSizeReducedCount += 1;
        hfSoftSizeReductionNotionalTotal = roundToCent(
          hfSoftSizeReductionNotionalTotal + (notionalPerOrder - reducedNotional)
        );
      }
      effectiveNotional = reducedNotional;
    }

    const candidatePayload: DryExecOrderPayload = {
      symbol: row.symbol,
      side: "buy",
      type: "limit",
      time_in_force: "day",
      order_class: "bracket",
      limit_price: Number(entry),
      notional: effectiveNotional,
      conviction: conviction ?? undefined,
      take_profit: { limit_price: Number(target) },
      stop_loss: { stop_price: Number(stop) },
      client_order_id: `dry_${stage6Hash.slice(0, 8)}_${row.symbol.toLowerCase()}`,
      idempotencyKey: buildOrderIdempotencyKey(stage6Hash, row.symbol, "buy", actionType),
      actionType,
      actionReason
    };
    const normalized = validateAndNormalizePayload(candidatePayload);
    if (!normalized.ok) {
      pushSkip(row.symbol, normalized.reason);
      return;
    }
    payloads.push(normalized.payload);
    if (actionType) {
      actionIntentCounts[actionType] += 1;
    }
    if (!isExitAction) {
      allocatedNotional += notionalPerOrder;
    }
  });

  return {
    payloads,
    skipped,
    skipReasonCounts: buildSkipReasonCounts(skipped),
    actionIntent: {
      enabled: lifecycle.enabled,
      previewOnly: lifecycle.previewOnly,
      allowedActionTypes: [...lifecycle.allowedActionTypes],
      counts: actionIntentCounts
    },
    notionalPerOrder,
    maxOrders,
    maxTotalNotional,
    minConviction,
    minConvictionPolicy,
    hfSentimentGate: {
      enabled: hfSoftGatePolicy.enabled,
      scoreFloor: Number(hfSoftGatePolicy.scoreFloor.toFixed(2)),
      minArticleCount: hfSoftGatePolicy.minArticleCount,
      maxNewsAgeHours: Number(hfSoftGatePolicy.maxNewsAgeHours.toFixed(1)),
      earningsWindowEnabled: hfSoftGatePolicy.earningsWindowEnabled,
      earningsBlockDays: hfSoftGatePolicy.earningsBlockDays,
      earningsReduceDays: hfSoftGatePolicy.earningsReduceDays,
      earningsReduceFactor: Number(hfSoftGatePolicy.earningsReduceFactor.toFixed(2)),
      positiveReliefMax: Number(hfSoftGatePolicy.positiveReliefMax.toFixed(2)),
      negativeTightenMax: Number(hfSoftGatePolicy.negativeTightenMax.toFixed(2)),
      applied: hfSoftApplied,
      reliefCount: hfSoftReliefCount,
      tightenCount: hfSoftTightenCount,
      blockedNegative: hfSoftBlockedNegative,
      earningsBlocked: hfSoftEarningsBlocked,
      earningsReduced: hfSoftEarningsReduced,
      netMinConvictionDelta: Number(hfSoftNetConvictionDelta.toFixed(2)),
      sizeReductionEnabled: hfNegativeSizeReductionPolicy.enabled,
      sizeReductionPct: Number(hfNegativeSizeReductionPolicy.reductionPct.toFixed(2)),
      sizeReducedCount: hfSoftSizeReducedCount,
      sizeReductionNotionalTotal: roundToCent(hfSoftSizeReductionNotionalTotal),
      explainLine: buildHfSoftGateExplainLine(
        hfSoftGatePolicy,
        hfExplainCheckedCandidates,
        {
          statusNotOk: hfExplainStatusNotOk,
          unsupportedLabel: hfExplainUnsupportedLabel,
          lowScore: hfExplainLowScore,
          lowArticleCount: hfExplainLowArticleCount,
          staleNews: hfExplainStaleNews,
          earningsWindowBlocked: hfExplainEarningsWindowBlocked
        },
        {
          applied: hfSoftApplied,
          reliefCount: hfSoftReliefCount,
          tightenCount: hfSoftTightenCount,
          netMinConvictionDelta: Number(hfSoftNetConvictionDelta.toFixed(2)),
          blockedNegative: hfSoftBlockedNegative
        }
      )
    },
    minStopDistancePct,
    maxStopDistancePct,
    stopDistancePolicy: {
      syncWithStage6: syncStopDistanceWithStage6,
      configuredMinPct: configuredMinStopDistancePct,
      configuredMaxPct: configuredMaxStopDistancePct,
      stage6MinPct: stage6MinStopDistancePct,
      stage6MaxPct: stage6MaxStopDistancePct,
      appliedMinPct: minStopDistancePct,
      appliedMaxPct: maxStopDistancePct,
      strategy: stopDistancePolicyStrategy
    },
    entryFeasibility: {
      enforce: entryFeasibilityEnforce,
      maxDistancePct: entryMaxDistancePct,
      checked: entryFeasibilityChecked,
      blocked: entryFeasibilityBlocked
    },
    stage6Contract: {
      enforce: stage6ExecutionBucketEnforce,
      checked: stage6ContractChecked,
      executable: stage6ContractExecutable,
      watchlist: stage6ContractWatchlist,
      blocked: stage6ContractBlocked
    },
    regime,
    idempotency: {
      enabled: false,
      enforced: false,
      ttlDays: 0,
      newCount: 0,
      duplicateCount: 0
    }
  };
}

async function fetchAlpacaJson(
  path: string,
  init: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: Record<string, unknown>;
    expectedStatuses?: number[];
  } = {}
): Promise<unknown> {
  const baseUrl = (process.env.ALPACA_BASE_URL || "").trim().replace(/\/+$/, "");
  const keyId = (process.env.ALPACA_KEY_ID || "").trim();
  const secret = (process.env.ALPACA_SECRET_KEY || "").trim();

  if (!baseUrl) throw new Error("ALPACA_BASE_URL missing");
  if (!keyId || !secret) throw new Error("ALPACA_KEY_ID/ALPACA_SECRET_KEY missing");

  const headers: Record<string, string> = {
    "APCA-API-KEY-ID": keyId,
    "APCA-API-SECRET-KEY": secret
  };
  if (init.body) headers["Content-Type"] = "application/json";

  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method || "GET",
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined
  });
  const text = await response.text();
  const expectedStatuses = init.expectedStatuses || [200];
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(`alpaca ${path} failed (${response.status}): ${text.slice(0, 160)}`);
  }
  if (!text) return null;
  try {
    return parseJsonText<unknown>(text, `alpaca_response(${path})`);
  } catch {
    return text;
  }
}

function parseOpenEntryOrderSnapshot(raw: unknown, nowMs: number): OpenEntryOrderSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const node = raw as Record<string, unknown>;
  const orderId = String(node.id ?? "").trim();
  const symbol = String(node.symbol ?? "")
    .trim()
    .toUpperCase();
  const side = String(node.side ?? "")
    .trim()
    .toLowerCase();
  if (!orderId || !symbol || side !== "buy") return null;
  const status = String(node.status ?? "")
    .trim()
    .toLowerCase();
  const submittedAtRaw =
    typeof node.submitted_at === "string"
      ? node.submitted_at
      : typeof node.created_at === "string"
        ? node.created_at
        : null;
  const submittedAtMs =
    submittedAtRaw && Number.isFinite(Date.parse(submittedAtRaw)) ? Date.parse(submittedAtRaw) : 0;
  const ageMinutes =
    submittedAtMs > 0 ? Number(Math.max(0, (nowMs - submittedAtMs) / 60000).toFixed(2)) : null;
  return {
    orderId,
    symbol,
    status,
    limitPrice: parseFiniteNumber(node.limit_price ?? node.limitPrice),
    qty: parseFiniteNumber(node.qty),
    clientOrderId: typeof node.client_order_id === "string" ? node.client_order_id : null,
    submittedAt: submittedAtRaw,
    submittedAtMs,
    ageMinutes,
    symbolOpenCount: 1
  };
}

async function loadOpenEntryOrderIndex(): Promise<OpenEntryOrderIndex> {
  const raw = await fetchAlpacaJson("/v2/orders?status=open&nested=true&direction=desc&limit=500");
  if (!Array.isArray(raw)) {
    return {
      total: 0,
      duplicateSymbols: 0,
      bySymbol: new Map<string, OpenEntryOrderSnapshot>()
    };
  }
  const nowMs = Date.now();
  const bySymbol = new Map<string, OpenEntryOrderSnapshot>();
  const countBySymbol = new Map<string, number>();

  raw.forEach((row) => {
    const snapshot = parseOpenEntryOrderSnapshot(row, nowMs);
    if (!snapshot) return;
    countBySymbol.set(snapshot.symbol, (countBySymbol.get(snapshot.symbol) ?? 0) + 1);
    const existing = bySymbol.get(snapshot.symbol);
    if (!existing || snapshot.submittedAtMs > existing.submittedAtMs) {
      bySymbol.set(snapshot.symbol, snapshot);
    }
  });

  let total = 0;
  let duplicateSymbols = 0;
  countBySymbol.forEach((count, symbol) => {
    total += count;
    if (count > 1) duplicateSymbols += 1;
    const latest = bySymbol.get(symbol);
    if (!latest) return;
    bySymbol.set(symbol, {
      ...latest,
      symbolOpenCount: count
    });
  });

  return {
    total,
    duplicateSymbols,
    bySymbol
  };
}

function createOpenEntryReplaceGuardState(): OpenEntryReplaceGuardState {
  return {
    symbols: {},
    updatedAt: ""
  };
}

function toUtcDayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function normalizeOpenEntryReplaceGuardState(raw: unknown): OpenEntryReplaceGuardState {
  if (!raw || typeof raw !== "object") return createOpenEntryReplaceGuardState();
  const node = raw as Record<string, unknown>;
  const symbolsRaw = node.symbols && typeof node.symbols === "object" ? (node.symbols as Record<string, unknown>) : {};
  const symbols: Record<string, OpenEntryReplaceGuardSymbolState> = {};
  for (const [rawSymbol, value] of Object.entries(symbolsRaw)) {
    if (!value || typeof value !== "object") continue;
    const symbol = String(rawSymbol || "")
      .trim()
      .toUpperCase();
    if (!symbol) continue;
    const row = value as Record<string, unknown>;
    const replaceCountByDayRaw =
      row.replaceCountByDay && typeof row.replaceCountByDay === "object"
        ? (row.replaceCountByDay as Record<string, unknown>)
        : {};
    const replaceCountByDay: Record<string, number> = {};
    for (const [day, countRaw] of Object.entries(replaceCountByDayRaw)) {
      const count = Math.max(0, Math.round(Number(countRaw)));
      if (!Number.isFinite(count) || count <= 0) continue;
      replaceCountByDay[day] = count;
    }
    const lastReplaceAt =
      typeof row.lastReplaceAt === "string" && row.lastReplaceAt.trim().length > 0 ? row.lastReplaceAt : null;
    symbols[symbol] = {
      lastReplaceAt,
      replaceCountByDay
    };
  }
  return {
    symbols,
    updatedAt: typeof node.updatedAt === "string" ? node.updatedAt : ""
  };
}

async function loadOpenEntryReplaceGuardState(): Promise<OpenEntryReplaceGuardState> {
  try {
    const raw = await readFile(OPEN_ENTRY_REPLACE_GUARD_PATH, "utf8");
    const parsed = parseJsonText<unknown>(raw, "open_entry_replace_guard_state");
    return normalizeOpenEntryReplaceGuardState(parsed);
  } catch {
    return createOpenEntryReplaceGuardState();
  }
}

async function saveOpenEntryReplaceGuardState(state: OpenEntryReplaceGuardState): Promise<void> {
  await mkdir("state", { recursive: true });
  await writeFile(OPEN_ENTRY_REPLACE_GUARD_PATH, JSON.stringify(state, null, 2), "utf8");
  console.log(`[STATE] saved ${OPEN_ENTRY_REPLACE_GUARD_PATH}`);
}

function pruneOpenEntryReplaceGuardState(state: OpenEntryReplaceGuardState, keepDays: number): number {
  const ttlDays = Math.max(1, Math.round(keepDays));
  const cutoffMs = Date.now() - ttlDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const [symbol, row] of Object.entries(state.symbols)) {
    for (const dayKey of Object.keys(row.replaceCountByDay)) {
      const dayMs = Date.parse(`${dayKey}T00:00:00.000Z`);
      if (!Number.isFinite(dayMs) || dayMs < cutoffMs) {
        delete row.replaceCountByDay[dayKey];
        removed += 1;
      }
    }
    if (!row.lastReplaceAt && Object.keys(row.replaceCountByDay).length === 0) {
      delete state.symbols[symbol];
    }
  }
  if (removed > 0) {
    state.updatedAt = new Date().toISOString();
  }
  return removed;
}

function resolveOpenEntryReplaceThrottle(
  state: OpenEntryReplaceGuardState,
  symbol: string,
  nowMs: number
): OpenEntryReplaceThrottle {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const row = state.symbols[normalizedSymbol];
  const todayKey = toUtcDayKey(nowMs);
  const lastReplaceAtMs =
    row?.lastReplaceAt && Number.isFinite(Date.parse(row.lastReplaceAt)) ? Date.parse(row.lastReplaceAt) : null;
  const replaceCountToday = Math.max(0, Math.round(Number(row?.replaceCountByDay?.[todayKey] ?? 0)));
  return {
    lastReplaceAtMs,
    replaceCountToday
  };
}

function recordOpenEntryReplace(
  state: OpenEntryReplaceGuardState,
  symbol: string,
  replacedAtIso: string
): number {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const replacedTs = Date.parse(replacedAtIso);
  const safeIso =
    Number.isFinite(replacedTs) && replacedTs > 0 ? new Date(replacedTs).toISOString() : new Date().toISOString();
  const dayKey = safeIso.slice(0, 10);
  const existing = state.symbols[normalizedSymbol] || {
    lastReplaceAt: null,
    replaceCountByDay: {}
  };
  existing.lastReplaceAt = safeIso;
  existing.replaceCountByDay[dayKey] = Math.max(0, Math.round(Number(existing.replaceCountByDay[dayKey] ?? 0))) + 1;
  state.symbols[normalizedSymbol] = existing;
  state.updatedAt = safeIso;
  return existing.replaceCountByDay[dayKey];
}

async function cancelOpenEntryOrder(orderId: string): Promise<void> {
  const normalized = orderId.trim();
  if (!normalized) throw new Error("open_entry_cancel_order_id_missing");
  await fetchAlpacaJson(`/v2/orders/${encodeURIComponent(normalized)}`, {
    method: "DELETE",
    expectedStatuses: [200, 204]
  });
}

function evaluateOpenEntryReplacePolicy(
  openEntry: OpenEntryOrderSnapshot,
  refreshedLimitPrice: number,
  cfg: OpenEntryOrderGuardConfig,
  throttle: OpenEntryReplaceThrottle
): {
  allowed: boolean;
  deltaBps: number | null;
  reason: string;
} {
  const liveLimit = openEntry.limitPrice;
  if (!Number.isFinite(liveLimit) || liveLimit == null || liveLimit <= 0) {
    return {
      allowed: false,
      deltaBps: null,
      reason: "open_entry_replace_missing_limit_price"
    };
  }
  if (!Number.isFinite(refreshedLimitPrice) || refreshedLimitPrice <= 0) {
    return {
      allowed: false,
      deltaBps: null,
      reason: "open_entry_replace_invalid_refreshed_limit"
    };
  }
  if (cfg.replaceCooldownMinutes > 0 && throttle.lastReplaceAtMs != null) {
    const elapsedMin = Math.max(0, (Date.now() - throttle.lastReplaceAtMs) / 60000);
    if (elapsedMin < cfg.replaceCooldownMinutes) {
      return {
        allowed: false,
        deltaBps: null,
        reason: `open_entry_replace_cooldown_active(elapsedMin=${elapsedMin.toFixed(1)}<cooldownMin=${cfg.replaceCooldownMinutes})`
      };
    }
  }
  if (throttle.replaceCountToday >= cfg.replaceMaxPerSymbolPerDay) {
    return {
      allowed: false,
      deltaBps: null,
      reason: `open_entry_replace_daily_cap(count=${throttle.replaceCountToday}>=max=${cfg.replaceMaxPerSymbolPerDay})`
    };
  }
  const deltaBps = ((refreshedLimitPrice - liveLimit) / liveLimit) * 10000;
  const absDeltaBps = Math.abs(deltaBps);
  if (absDeltaBps < cfg.replaceMinDeltaBps) {
    return {
      allowed: false,
      deltaBps,
      reason: `open_entry_replace_delta_too_small(deltaBps=${deltaBps.toFixed(1)}<min=${cfg.replaceMinDeltaBps})`
    };
  }
  if (deltaBps > cfg.replaceMaxChaseBps) {
    return {
      allowed: false,
      deltaBps,
      reason: `open_entry_replace_chase_exceeds(deltaBps=${deltaBps.toFixed(1)}>max=${cfg.replaceMaxChaseBps})`
    };
  }
  return {
    allowed: true,
    deltaBps,
    reason: "replace_allowed"
  };
}

async function runPreflightGate(dryExec: DryExecBuildResult): Promise<PreflightResult> {
  const cfg = loadRuntimeConfig();
  const enabled = readBoolEnv("PREFLIGHT_ENABLED", true);
  const simulatedLiveParity = cfg.simulationLiveParity && !cfg.execEnabled;
  const enforced = enabled && (cfg.execEnabled || simulatedLiveParity);
  const allowEntryOutsideRth = readBoolEnv("ALLOW_ENTRY_OUTSIDE_RTH", false);
  const dailyMaxNotional = readNonNegativeNumberEnv("DAILY_MAX_NOTIONAL", 5000);
  const requiredNotional = roundToCent(sumNotional(dryExec.payloads));

  const makeResult = (
    status: PreflightStatus,
    code: string,
    message: string,
    patch?: Partial<PreflightResult>
  ): PreflightResult => ({
    enabled,
    enforced,
    blocking: status === "fail" && enforced,
    wouldBlockLive: status === "fail",
    simulatedLiveParity,
    status,
    code,
    message,
    requiredNotional,
    dailyMaxNotional,
    allowEntryOutsideRth,
    accountStatus: null,
    buyingPower: null,
    marketOpen: null,
    nextOpen: null,
    ...(patch || {})
  });

  const failOrWarn = (
    code: string,
    message: string,
    patch?: Partial<PreflightResult>
  ): PreflightResult => makeResult(enforced ? "fail" : "warn", code, message, {
    ...patch,
    wouldBlockLive: true
  });

  if (!enabled) {
    return makeResult("skip", "PREFLIGHT_DISABLED", "preflight disabled by env");
  }

  if (requiredNotional <= 0) {
    return makeResult("skip", "PREFLIGHT_NO_PAYLOAD", "no payload to preflight");
  }

  if (dailyMaxNotional > 0 && requiredNotional > dailyMaxNotional) {
    return failOrWarn(
      "PREFLIGHT_DAILY_NOTIONAL_LIMIT",
      `required notional ${requiredNotional.toFixed(2)} exceeds daily max ${dailyMaxNotional.toFixed(2)}`
    );
  }

  let account: Record<string, unknown>;
  try {
    account = (await fetchAlpacaJson("/v2/account")) as Record<string, unknown>;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return failOrWarn("PREFLIGHT_ACCOUNT_FETCH_FAILED", msg);
  }

  const accountStatusRaw = String(account.status ?? "").trim();
  const accountStatus = accountStatusRaw ? accountStatusRaw.toUpperCase() : "UNKNOWN";
  const isTradingBlocked = account.trading_blocked === true || account.account_blocked === true;
  const isSuspended = account.trade_suspended_by_user === true || account.trading_suspended_by_user === true;
  const isStatusBlocked = accountStatus !== "ACTIVE";

  if (isTradingBlocked || isSuspended || isStatusBlocked) {
    return failOrWarn("PREFLIGHT_ACCOUNT_BLOCKED", `account not tradable (status=${accountStatus})`, {
      accountStatus
    });
  }

  const buyingPower = toFinitePositiveNumber(account.buying_power);
  if (buyingPower == null) {
    return failOrWarn("PREFLIGHT_BUYING_POWER_MISSING", "buying_power unavailable", {
      accountStatus
    });
  }
  if (requiredNotional > buyingPower) {
    return failOrWarn(
      "PREFLIGHT_BUYING_POWER_SHORT",
      `required ${requiredNotional.toFixed(2)} exceeds buying power ${buyingPower.toFixed(2)}`,
      { accountStatus, buyingPower }
    );
  }

  if (!allowEntryOutsideRth) {
    let clock: Record<string, unknown>;
    try {
      clock = (await fetchAlpacaJson("/v2/clock")) as Record<string, unknown>;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return failOrWarn("PREFLIGHT_CLOCK_FETCH_FAILED", msg, { accountStatus, buyingPower });
    }

    const marketOpen = clock.is_open === true;
    const nextOpen = typeof clock.next_open === "string" ? clock.next_open : null;

    if (!marketOpen) {
      return failOrWarn("PREFLIGHT_MARKET_CLOSED", "market is closed for new entry", {
        accountStatus,
        buyingPower,
        marketOpen,
        nextOpen
      });
    }

    return makeResult("pass", "PREFLIGHT_PASS", "preflight passed", {
      accountStatus,
      buyingPower,
      marketOpen,
      nextOpen
    });
  }

  return makeResult("pass", "PREFLIGHT_PASS", "preflight passed (RTH guard disabled)", {
    accountStatus,
    buyingPower,
    marketOpen: null,
    nextOpen: null
  });
}

function mapAlpacaOrderStatusToLifecycleStatus(rawStatus: unknown): OrderLifecycleStatus {
  const normalized = String(rawStatus ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "accepted") return "accepted";
  if (normalized === "partially_filled") return "partially_filled";
  if (normalized === "filled") return "filled";
  if (normalized === "canceled" || normalized === "cancelled") return "canceled";
  if (normalized === "rejected") return "rejected";
  if (normalized === "expired") return "expired";
  return "submitted";
}

async function resolveCurrentPerfGateStatus(dryExec: DryExecBuildResult): Promise<PerformanceLoopGate> {
  const policyFingerprint = buildPerformancePolicyFingerprint(dryExec);
  const loopState = await loadPerformanceLoopState(policyFingerprint);
  const latestSnapshot =
    loopState.snapshots.length > 0 ? loopState.snapshots[loopState.snapshots.length - 1] : null;
  return evaluatePerformanceLoopGate(latestSnapshot, Object.keys(loopState.rows).length);
}

async function loadHeldPositionMap(): Promise<Map<string, number>> {
  const snapshots = await loadHeldPositionSnapshots();
  const out = new Map<string, number>();
  snapshots.forEach((snapshot) => out.set(snapshot.symbol, snapshot.qty));
  return out;
}

function deriveHeldAgeDaysFromLedger(
  symbol: string,
  ledgerState: OrderLedgerState
): number | null {
  let oldestTs = Number.POSITIVE_INFINITY;
  Object.values(ledgerState.orders).forEach((row) => {
    if (!row || row.symbol !== symbol) return;
    const createdTs = Date.parse(row.createdAt);
    if (!Number.isFinite(createdTs)) return;
    if (createdTs < oldestTs) oldestTs = createdTs;
  });
  if (!Number.isFinite(oldestTs)) return null;
  return Number((((Date.now() - oldestTs) / (1000 * 60 * 60 * 24))).toFixed(2));
}

async function loadHeldPositionSnapshots(): Promise<Map<string, HeldPositionSnapshot>> {
  const raw = await fetchAlpacaJson("/v2/positions");
  if (!Array.isArray(raw)) return new Map();
  const out = new Map<string, HeldPositionSnapshot>();
  raw.forEach((row) => {
    if (!row || typeof row !== "object") return;
    const node = row as Record<string, unknown>;
    const symbolRaw = node.symbol;
    const symbol = typeof symbolRaw === "string" ? symbolRaw.trim().toUpperCase() : "";
    if (!symbol) return;
    const qtyRaw = node.qty;
    const qty =
      typeof qtyRaw === "number"
        ? qtyRaw
        : typeof qtyRaw === "string"
          ? Number(qtyRaw)
          : NaN;
    if (!Number.isFinite(qty) || qty === 0) return;
    const side: "long" | "short" = qty > 0 ? "long" : "short";
    const unrealizedPnlPct = parseFiniteNumber(
      node.unrealized_plpc ?? node.unrealizedPlpc ?? node.unrealizedPnlPct
    );
    const intradayPnlPct = parseFiniteNumber(
      node.unrealized_intraday_plpc ?? node.unrealizedIntradayPlpc ?? node.intradayPnlPct
    );
    out.set(symbol, {
      symbol,
      qty,
      side,
      marketValue: parseFiniteNumber(node.market_value ?? node.marketValue),
      costBasis: parseFiniteNumber(node.cost_basis ?? node.costBasis),
      avgEntryPrice: parseFiniteNumber(node.avg_entry_price ?? node.avgEntryPrice),
      currentPrice: parseFiniteNumber(node.current_price ?? node.currentPrice),
      unrealizedPnlPct:
        unrealizedPnlPct != null ? Number(clamp(unrealizedPnlPct, -10, 10).toFixed(4)) : null,
      intradayPnlPct:
        intradayPnlPct != null ? Number(clamp(intradayPnlPct, -10, 10).toFixed(4)) : null,
      ageDays: null
    });
  });
  const ledgerState = await loadOrderLedgerState();
  out.forEach((snapshot, symbol) => {
    out.set(symbol, {
      ...snapshot,
      ageDays: deriveHeldAgeDaysFromLedger(symbol, ledgerState)
    });
  });
  return out;
}

function toBrokerQtyString(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const normalized = Number(value.toFixed(6));
  if (!Number.isFinite(normalized) || normalized <= 0) return null;
  const trimmed = normalized.toFixed(6).replace(/\.?0+$/, "");
  return trimmed || null;
}

function toWholeShareQtyFromNotional(notional: number, limitPrice: number): string | null {
  if (!Number.isFinite(notional) || !Number.isFinite(limitPrice)) return null;
  if (notional <= 0 || limitPrice <= 0) return null;
  const wholeQty = Math.floor(notional / limitPrice);
  if (!Number.isFinite(wholeQty) || wholeQty < 1) return null;
  return String(wholeQty);
}

function makeActionClientOrderId(baseClientOrderId: string, actionType: LifecycleActionType): string {
  const normalizedBase = baseClientOrderId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 36);
  const actionSuffix = actionType.toLowerCase().replace(/[^A-Za-z0-9_-]/g, "");
  const out = `${normalizedBase}_${actionSuffix}`.slice(0, 48);
  return out || `act_${Date.now().toString(36).slice(-8)}`;
}

function isClientOrderIdDuplicateError(error: unknown): boolean {
  const text = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return text.includes("client_order_id") && text.includes("unique");
}

function makeRetryClientOrderId(baseClientOrderId: string): string {
  const normalizedBase = baseClientOrderId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  const nonce = Date.now().toString(36).slice(-6);
  return `${normalizedBase}_${nonce}`.slice(0, 48);
}

function resolveLifecycleExitRatio(
  actionType: LifecycleActionType,
  lifecycleCfg: PositionLifecycleConfig
): number {
  if (actionType === "EXIT_FULL") return 1;
  if (actionType === "EXIT_PARTIAL") return clamp(lifecycleCfg.exitPartialPct, 0.01, 1);
  if (actionType === "SCALE_DOWN") return clamp(lifecycleCfg.scaleDownPct, 0.01, 1);
  return 1;
}

function isLifecycleExitAction(
  actionType: LifecycleActionType | undefined
): actionType is "SCALE_DOWN" | "EXIT_PARTIAL" | "EXIT_FULL" {
  return isLifecycleExitActionType(actionType);
}

async function submitLifecycleExitOrder(
  payload: DryExecOrderPayload,
  actionType: "SCALE_DOWN" | "EXIT_PARTIAL" | "EXIT_FULL",
  positionQty: number,
  lifecycleCfg: PositionLifecycleConfig
): Promise<{
  brokerOrderId: string | null;
  brokerStatus: OrderLifecycleStatus;
  submittedQty: number;
}> {
  const absQty = Math.abs(positionQty);
  const ratio = resolveLifecycleExitRatio(actionType, lifecycleCfg);
  const rawQty = actionType === "EXIT_FULL" ? absQty : absQty * ratio;
  const qty = toBrokerQtyString(rawQty);
  if (!qty) throw new Error(`invalid_exit_qty:${rawQty}`);
  const side: "buy" | "sell" = positionQty > 0 ? "sell" : "buy";
  const rawResponse = await fetchAlpacaJson("/v2/orders", {
    method: "POST",
    body: {
      symbol: payload.symbol,
      side,
      type: "market",
      qty,
      time_in_force: "day",
      client_order_id: makeActionClientOrderId(payload.client_order_id, actionType)
    },
    expectedStatuses: [200, 201]
  });
  const responseRecord =
    rawResponse && typeof rawResponse === "object" ? (rawResponse as Record<string, unknown>) : {};
  const brokerOrderIdRaw = responseRecord.id;
  const brokerOrderId =
    typeof brokerOrderIdRaw === "string" && brokerOrderIdRaw.trim() ? brokerOrderIdRaw : null;
  const brokerStatus = mapAlpacaOrderStatusToLifecycleStatus(responseRecord.status);
  const submittedQty = clamp(Number(qty), 0, absQty);
  return { brokerOrderId, brokerStatus, submittedQty };
}

function updateHeldPositionAfterExitSubmit(
  heldQtyBySymbol: Map<string, number>,
  heldSymbols: Set<string>,
  symbol: string,
  submittedQty: number
) {
  const currentQty = heldQtyBySymbol.get(symbol) ?? 0;
  if (!Number.isFinite(currentQty) || currentQty === 0) return;
  const nextAbs = Math.max(0, Math.abs(currentQty) - Math.max(0, submittedQty));
  if (nextAbs <= 0) {
    heldQtyBySymbol.delete(symbol);
    heldSymbols.delete(symbol);
    return;
  }
  const nextSigned = currentQty > 0 ? nextAbs : -nextAbs;
  heldQtyBySymbol.set(symbol, nextSigned);
  heldSymbols.add(symbol);
}

function runLifecycleSelfTestIfEnabled(cfg: ReturnType<typeof loadRuntimeConfig>) {
  if (!readBoolEnv("LIFECYCLE_SELFTEST", false)) return;
  const symbol = "SELFTEST";
  const scaleUpWithoutPositionBlocked =
    cfg.positionLifecycle.enabled && !cfg.positionLifecycle.previewOnly;
  console.log(
    `[LIFECYCLE_SELFTEST] scale_up_no_position_expected=true observed=${scaleUpWithoutPositionBlocked}`
  );

  const heldQtyBySymbol = new Map<string, number>([[symbol, 10]]);
  const heldSymbols = new Set<string>([symbol]);
  const partialRatio = resolveLifecycleExitRatio("EXIT_PARTIAL", cfg.positionLifecycle);
  const qtyBefore = Math.abs(heldQtyBySymbol.get(symbol) ?? 0);
  const qtyPartial1 = qtyBefore * partialRatio;
  updateHeldPositionAfterExitSubmit(heldQtyBySymbol, heldSymbols, symbol, qtyPartial1);
  const qtyAfterPartial1 = Math.abs(heldQtyBySymbol.get(symbol) ?? 0);

  const qtyPartial2 = qtyAfterPartial1 * partialRatio;
  updateHeldPositionAfterExitSubmit(heldQtyBySymbol, heldSymbols, symbol, qtyPartial2);
  const qtyAfterPartial2 = Math.abs(heldQtyBySymbol.get(symbol) ?? 0);

  const qtyFull = qtyAfterPartial2;
  updateHeldPositionAfterExitSubmit(heldQtyBySymbol, heldSymbols, symbol, qtyFull);
  const qtyAfterFull = Math.abs(heldQtyBySymbol.get(symbol) ?? 0);
  const overExitBlocked = !heldSymbols.has(symbol) && qtyAfterFull === 0;

  console.log(
    `[LIFECYCLE_SELFTEST] over_exit_guard=${overExitBlocked} partialPct=${partialRatio.toFixed(2)} qtyBefore=${qtyBefore.toFixed(4)} qtyAfterP1=${qtyAfterPartial1.toFixed(4)} qtyAfterP2=${qtyAfterPartial2.toFixed(4)} qtyAfterFull=${qtyAfterFull.toFixed(4)}`
  );

  const thresholds = resolveLifecycleHeldConvictionThresholds(cfg.positionLifecycle);
  const baseRow: Stage6CandidateSummary = {
    symbol,
    instrumentType: "common",
    analysisEligible: true,
    historyTier: "FULL",
    symbolLifecycleState: "ACTIVE",
    verdict: "BUY",
    expectedReturn: "N/A",
    expectedReturnPct: null,
    entry: "100",
    entryValue: 100,
    target: "112",
    targetValue: 112,
    stop: "95",
    stopValue: 95,
    conviction: "70",
    qualityScore: 70,
    modelRank: 1,
    executionRank: 1,
    executionScore: 80,
    executionBucket: "EXECUTABLE",
    executionReason: "VALID_EXEC",
    finalDecision: "EXECUTABLE_NOW",
    decisionReason: "executable_pullback",
    stage6Tier: "TIER1",
    stage6TierReason: "selftest",
    stage6TierMultiplier: 1,
    displacement: 0,
    ictPos: 0,
    trendAlignment: "UP",
    entryDistancePct: 0,
    entryFeasible: true,
    tradePlanStatus: "VALID_EXEC",
    hfSentimentLabel: null,
    hfSentimentScore: null,
    hfSentimentStatus: "N/A",
    hfSentimentReason: null,
    hfSentimentArticleCount: null,
    hfSentimentNewestAgeHours: null,
    earningsDaysToEvent: null,
    shadowIntel: null
  };
  const regimeDefault: RegimeSelection = {
    profile: "default",
    baseProfile: "default",
    source: "env_fallback",
    vix: null,
    sourcePriority: "realtime_first",
    snapshotVix: null,
    snapshotAgeMin: null,
    riskOnThreshold: 22,
    riskOffThreshold: 25,
    diagnostics: [],
    quality: {
      enabled: true,
      score: 100,
      minScore: 60,
      status: "high",
      forceRiskOff: false,
      reasons: []
    },
    hysteresis: {
      enabled: true,
      minHoldMin: 30,
      previousProfile: null,
      desiredProfile: "default",
      appliedProfile: "default",
      holdRemainingMin: 0,
      reason: "selftest"
    },
    entryGuard: {
      blocked: false,
      reason: "none"
    }
  };
  const regimeRiskOff: RegimeSelection = {
    ...regimeDefault,
    profile: "risk_off",
    baseProfile: "risk_off",
    quality: {
      ...regimeDefault.quality,
      forceRiskOff: true
    },
    hysteresis: {
      ...regimeDefault.hysteresis,
      desiredProfile: "risk_off",
      appliedProfile: "risk_off"
    }
  };
  const heldForScaleDown: HeldPositionSnapshot = {
    symbol,
    qty: 10,
    side: "long",
    marketValue: 1000,
    costBasis: 1000,
    avgEntryPrice: 100,
    currentPrice: 100,
    unrealizedPnlPct: -0.01,
    intradayPnlPct: -0.005,
    ageDays: 20
  };
  const heldForExitPartial: HeldPositionSnapshot = {
    symbol,
    qty: 10,
    side: "long",
    marketValue: 920,
    costBasis: 1000,
    avgEntryPrice: 100,
    currentPrice: 92,
    unrealizedPnlPct: -0.08,
    intradayPnlPct: -0.03,
    ageDays: 5
  };
  const heldForExitFull: HeldPositionSnapshot = {
    symbol,
    qty: 10,
    side: "long",
    marketValue: 900,
    costBasis: 1000,
    avgEntryPrice: 100,
    currentPrice: 90,
    unrealizedPnlPct: -0.12,
    intradayPnlPct: -0.04,
    ageDays: 10
  };
  const actionScaleDown = resolveHeldLifecycleAction(
    { ...baseRow, executionBucket: "WATCHLIST", finalDecision: "WAIT_PRICE", decisionReason: "wait_pullback_not_reached" },
    thresholds.scaleDownMax - 1,
    false,
    true,
    cfg.positionLifecycle,
    thresholds,
    heldForScaleDown,
    regimeDefault
  );
  const actionExitPartial = resolveHeldLifecycleAction(
    { ...baseRow, executionBucket: "WATCHLIST", finalDecision: "WAIT_PRICE", decisionReason: "wait_pullback_not_reached" },
    thresholds.exitPartialMax - 1,
    false,
    true,
    cfg.positionLifecycle,
    thresholds,
    heldForExitPartial,
    regimeRiskOff
  );
  const actionExitFull = resolveHeldLifecycleAction(
    {
      ...baseRow,
      executionBucket: "WATCHLIST",
      finalDecision: "BLOCKED_RISK",
      decisionReason: "blocked_rr_below_min"
    },
    thresholds.exitFullMax - 1,
    false,
    true,
    cfg.positionLifecycle,
    thresholds,
    heldForExitFull,
    regimeRiskOff
  );
  console.log(
    `[LIFECYCLE_SELFTEST] held_rules scaleDown=${actionScaleDown.actionType ?? "HOLD_WAIT"} partial=${actionExitPartial.actionType ?? "HOLD_WAIT"} full=${actionExitFull.actionType ?? "HOLD_WAIT"}`
  );
}

async function submitOrdersToBroker(
  dryExec: DryExecBuildResult,
  preflight: PreflightResult,
  hfLivePromotion?: HfLivePromotionSummary | null
): Promise<BrokerSubmitSummary> {
  const cfg = loadRuntimeConfig();
  const enabled = readBoolEnv("LIVE_ORDER_SUBMIT_ENABLED", false);
  const requirePerfGateGo = readBoolEnv("LIVE_ORDER_SUBMIT_REQUIRE_PERF_GATE_GO", true);
  const requireHfLivePromotionPass = readBoolEnv(
    "LIVE_ORDER_SUBMIT_REQUIRE_HF_LIVE_PROMOTION_PASS",
    true
  );
  const summary: BrokerSubmitSummary = {
    enabled,
    active: false,
    reason: "disabled",
    requirePerfGateGo,
    requireHfLivePromotionPass,
    perfGateStatus: "N/A",
    perfGateReason: "not_checked",
    hfLivePromotionStatus: "N/A",
    hfLivePromotionReason: "not_checked",
    attempted: 0,
    submitted: 0,
    failed: 0,
    skipped: dryExec.payloads.length,
    orders: {}
  };

  for (const payload of dryExec.payloads) {
    summary.orders[payload.idempotencyKey] = {
      idempotencyKey: payload.idempotencyKey,
      symbol: payload.symbol,
      actionType: payload.actionType ?? "N/A",
      attempted: false,
      submitted: false,
      brokerOrderId: null,
      brokerStatus: null,
      reason: "submit_not_attempted"
    };
  }

  if (!enabled) {
    summary.reason = "submit_disabled";
    return summary;
  }
  if (!cfg.execEnabled) {
    summary.reason = "exec_disabled";
    return summary;
  }
  if (cfg.readOnly) {
    summary.reason = "read_only";
    return summary;
  }
  if (preflight.blocking) {
    summary.reason = `preflight_blocked:${preflight.code}`;
    return summary;
  }
  if (dryExec.payloads.length === 0) {
    summary.reason = "no_payload";
    summary.skipped = 0;
    return summary;
  }

  if (requirePerfGateGo) {
    const perfGate = await resolveCurrentPerfGateStatus(dryExec);
    summary.perfGateStatus = perfGate.status;
    summary.perfGateReason = perfGate.reason;
    if (perfGate.status !== "GO") {
      summary.reason = `perf_gate_blocked:${perfGate.status.toLowerCase()}`;
      return summary;
    }
  }
  if (requireHfLivePromotionPass) {
    if (!hfLivePromotion) {
      summary.hfLivePromotionStatus = "N/A";
      summary.hfLivePromotionReason = "missing";
      summary.reason = "hf_live_promotion_missing";
      return summary;
    }
    summary.hfLivePromotionStatus = hfLivePromotion.status;
    summary.hfLivePromotionReason = hfLivePromotion.reason;
    if (hfLivePromotion.status !== "PASS") {
      summary.reason = `hf_live_promotion_blocked:${hfLivePromotion.status.toLowerCase()}`;
      return summary;
    }
  }

  summary.active = true;
  summary.reason = "submit_attempted";
  summary.skipped = 0;
  const openEntryGuardCfg = buildOpenEntryOrderGuardConfig();
  let openEntryOrders: OpenEntryOrderIndex = {
    total: 0,
    duplicateSymbols: 0,
    bySymbol: new Map<string, OpenEntryOrderSnapshot>()
  };
  let openEntryReplaceState = createOpenEntryReplaceGuardState();
  let openEntryReplaceStateTouched = false;
  if (openEntryGuardCfg.enabled) {
    try {
      openEntryOrders = await loadOpenEntryOrderIndex();
      openEntryReplaceState = await loadOpenEntryReplaceGuardState();
      const prunedEntries = pruneOpenEntryReplaceGuardState(openEntryReplaceState, 14);
      openEntryReplaceStateTouched = prunedEntries > 0;
      console.log(
        `[OPEN_ENTRY_GUARD] enabled=true staleCancel=${openEntryGuardCfg.staleCancelEnabled} staleMin=${openEntryGuardCfg.staleMinutes} replaceMinDeltaBps=${openEntryGuardCfg.replaceMinDeltaBps} replaceMaxChaseBps=${openEntryGuardCfg.replaceMaxChaseBps} replaceCooldownMin=${openEntryGuardCfg.replaceCooldownMinutes} replaceMaxPerDay=${openEntryGuardCfg.replaceMaxPerSymbolPerDay} openEntries=${openEntryOrders.total} duplicateSymbols=${openEntryOrders.duplicateSymbols} replaceLedgerPruned=${prunedEntries}`
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      summary.reason = "open_entry_order_fetch_failed";
      summary.perfGateReason = `open_entry_order_fetch_failed:${msg.slice(0, 120)}`;
      return summary;
    }
  } else {
    console.log("[OPEN_ENTRY_GUARD] enabled=false");
  }

  let heldSymbols = new Set<string>();
  let heldQtyBySymbol = new Map<string, number>();
  if (cfg.positionLifecycle.enabled && !cfg.positionLifecycle.previewOnly) {
    try {
      heldQtyBySymbol = await loadHeldPositionMap();
      heldSymbols = new Set([...heldQtyBySymbol.keys()]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      summary.reason = "position_fetch_failed";
      summary.perfGateReason = `position_fetch_failed:${msg.slice(0, 120)}`;
      return summary;
    }
  }

  for (const payload of dryExec.payloads) {
    const row = summary.orders[payload.idempotencyKey];
    let effectiveActionType = payload.actionType;
    if (
      cfg.positionLifecycle.enabled &&
      !cfg.positionLifecycle.previewOnly &&
      payload.actionType === "ENTRY_NEW" &&
      heldSymbols.has(payload.symbol)
    ) {
      if (!isActionTypeAllowed("SCALE_UP", cfg.positionLifecycle)) {
        row.actionType = "HOLD_WAIT";
        row.reason = "scale_up_not_allowed";
        summary.skipped += 1;
        continue;
      }
      const conviction = payload.conviction ?? 0;
      if (conviction < cfg.positionLifecycle.scaleUpMinConviction) {
        row.actionType = "HOLD_WAIT";
        row.reason = `scale_up_conviction_below_min(${conviction.toFixed(1)}<${cfg.positionLifecycle.scaleUpMinConviction.toFixed(1)})`;
        summary.skipped += 1;
        continue;
      }
      effectiveActionType = "SCALE_UP";
    }
    if (
      cfg.positionLifecycle.enabled &&
      !cfg.positionLifecycle.previewOnly &&
      effectiveActionType === "SCALE_UP" &&
      !heldSymbols.has(payload.symbol)
    ) {
      row.actionType = "HOLD_WAIT";
      row.reason = "scale_up_no_position";
      summary.skipped += 1;
      continue;
    }
    if (
      effectiveActionType &&
      !isActionTypeAllowed(effectiveActionType, cfg.positionLifecycle) &&
      effectiveActionType !== "HOLD_WAIT"
    ) {
      row.actionType = effectiveActionType;
      row.reason = `action_not_allowed:${effectiveActionType}`;
      summary.skipped += 1;
      continue;
    }
    if (isLifecycleExitAction(effectiveActionType)) {
      const heldQty = heldQtyBySymbol.get(payload.symbol) ?? 0;
      if (!Number.isFinite(heldQty) || heldQty === 0) {
        row.actionType = effectiveActionType;
        row.reason = `exit_no_position:${effectiveActionType}`;
        summary.skipped += 1;
        continue;
      }
    }
    const isEntryStyleAction = !isLifecycleExitAction(effectiveActionType);
    let entryQtyForSubmit: string | null = null;
    if (isEntryStyleAction) {
      entryQtyForSubmit = toWholeShareQtyFromNotional(payload.notional, payload.limit_price);
      if (!entryQtyForSubmit) {
        row.actionType = effectiveActionType ?? row.actionType;
        row.reason = `entry_notional_below_limit_price(notional=${payload.notional.toFixed(2)},limit=${payload.limit_price.toFixed(2)})`;
        summary.skipped += 1;
        continue;
      }
      if (openEntryGuardCfg.enabled) {
        const openEntry = openEntryOrders.bySymbol.get(payload.symbol);
        if (openEntry) {
          if (openEntry.symbolOpenCount > 1) {
            row.actionType = "HOLD_WAIT";
            row.reason = `open_entry_duplicate_exists(count=${openEntry.symbolOpenCount})`;
            summary.skipped += 1;
            continue;
          }
          const staleEligible =
            openEntryGuardCfg.staleCancelEnabled &&
            openEntry.ageMinutes != null &&
            openEntry.ageMinutes >= openEntryGuardCfg.staleMinutes;
          if (staleEligible) {
            const replaceThrottle = resolveOpenEntryReplaceThrottle(
              openEntryReplaceState,
              payload.symbol,
              Date.now()
            );
            const replacePolicy = evaluateOpenEntryReplacePolicy(
              openEntry,
              payload.limit_price,
              openEntryGuardCfg,
              replaceThrottle
            );
            if (!replacePolicy.allowed) {
              row.actionType = "HOLD_WAIT";
              row.reason = replacePolicy.reason;
              summary.skipped += 1;
              continue;
            }
            try {
              await cancelOpenEntryOrder(openEntry.orderId);
              openEntryOrders.bySymbol.delete(payload.symbol);
              const replaceCountToday = recordOpenEntryReplace(
                openEntryReplaceState,
                payload.symbol,
                new Date().toISOString()
              );
              openEntryReplaceStateTouched = true;
              console.warn(
                `[OPEN_ENTRY_GUARD] symbol=${payload.symbol} stale_open_entry_cancelled orderId=${openEntry.orderId} ageMin=${openEntry.ageMinutes?.toFixed(1) ?? "n/a"} deltaBps=${replacePolicy.deltaBps?.toFixed(1) ?? "n/a"} replaceCountToday=${replaceCountToday} cooldownMin=${openEntryGuardCfg.replaceCooldownMinutes}`
              );
            } catch (error) {
              const msg = error instanceof Error ? error.message : String(error);
              row.actionType = "HOLD_WAIT";
              row.reason = `open_entry_cancel_failed:${msg.slice(0, 96)}`;
              summary.skipped += 1;
              continue;
            }
          } else {
            row.actionType = "HOLD_WAIT";
            row.reason = `open_entry_order_exists(id=${openEntry.orderId.slice(0, 10)} age=${openEntry.ageMinutes != null ? `${openEntry.ageMinutes.toFixed(1)}m` : "n/a"})`;
            summary.skipped += 1;
            continue;
          }
        }
      }
    }
    row.actionType = effectiveActionType ?? row.actionType;
    row.attempted = true;
    summary.attempted += 1;
    try {
      let brokerOrderId: string | null = null;
      let brokerStatus: OrderLifecycleStatus = "submitted";
      if (isLifecycleExitAction(effectiveActionType)) {
        const heldQty = heldQtyBySymbol.get(payload.symbol) ?? 0;
        const exitSubmit = await submitLifecycleExitOrder(
          payload,
          effectiveActionType,
          heldQty,
          cfg.positionLifecycle
        );
        brokerOrderId = exitSubmit.brokerOrderId;
        brokerStatus = exitSubmit.brokerStatus;
        updateHeldPositionAfterExitSubmit(
          heldQtyBySymbol,
          heldSymbols,
          payload.symbol,
          exitSubmit.submittedQty
        );
      } else {
        const submitQty = entryQtyForSubmit;
        if (!submitQty) {
          throw new Error("entry_qty_missing");
        }
        let submitClientOrderId = payload.client_order_id;
        let rawResponse: unknown = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          const orderBody = {
            symbol: payload.symbol,
            side: payload.side,
            type: payload.type,
            time_in_force: payload.time_in_force,
            order_class: payload.order_class,
            limit_price: payload.limit_price,
            qty: submitQty,
            take_profit: payload.take_profit,
            stop_loss: payload.stop_loss,
            client_order_id: submitClientOrderId
          };
          try {
            rawResponse = await fetchAlpacaJson("/v2/orders", {
              method: "POST",
              body: orderBody,
              expectedStatuses: [200, 201]
            });
            break;
          } catch (error) {
            if (attempt === 0 && isClientOrderIdDuplicateError(error)) {
              const retryClientOrderId = makeRetryClientOrderId(payload.client_order_id);
              console.warn(
                `[BROKER_SUBMIT] symbol=${payload.symbol} duplicate client_order_id=${submitClientOrderId} retry_with=${retryClientOrderId}`
              );
              submitClientOrderId = retryClientOrderId;
              continue;
            }
            throw error;
          }
        }
        const responseRecord =
          rawResponse && typeof rawResponse === "object" ? (rawResponse as Record<string, unknown>) : {};
        const brokerOrderIdRaw = responseRecord.id;
        brokerOrderId =
          typeof brokerOrderIdRaw === "string" && brokerOrderIdRaw.trim() ? brokerOrderIdRaw : null;
        brokerStatus = mapAlpacaOrderStatusToLifecycleStatus(responseRecord.status);
      }
      row.submitted = true;
      row.brokerOrderId = brokerOrderId;
      row.brokerStatus = brokerStatus;
      row.reason = `submitted:${row.actionType}`;
      summary.submitted += 1;
      if (isEntryStyleAction && brokerOrderId) {
        openEntryOrders.bySymbol.set(payload.symbol, {
          orderId: brokerOrderId,
          symbol: payload.symbol,
          status: String(brokerStatus || "submitted"),
          limitPrice: payload.limit_price,
          qty: parseFiniteNumber(entryQtyForSubmit),
          clientOrderId: payload.client_order_id,
          submittedAt: new Date().toISOString(),
          submittedAtMs: Date.now(),
          ageMinutes: 0,
          symbolOpenCount: 1
        });
      }
      console.log(
        `[BROKER_SUBMIT] symbol=${payload.symbol} action=${row.actionType} status=${brokerStatus} orderId=${brokerOrderId ?? "N/A"}`
      );
    } catch (error) {
      row.submitted = false;
      row.brokerOrderId = null;
      row.brokerStatus = null;
      row.reason = error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160);
      summary.failed += 1;
      console.warn(`[BROKER_SUBMIT] symbol=${payload.symbol} failed reason=${row.reason}`);
    }
  }

  if (openEntryGuardCfg.enabled && openEntryReplaceStateTouched) {
    try {
      await saveOpenEntryReplaceGuardState(openEntryReplaceState);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[OPEN_ENTRY_GUARD] replace_guard_state_save_failed=${msg.slice(0, 160)}`);
    }
  }

  if (summary.attempted === 0 && summary.skipped > 0) {
    summary.reason = "submit_skipped_all";
  } else if (summary.failed > 0 && summary.submitted === 0) {
    summary.reason = "submit_failed_all";
  } else if (summary.failed > 0) {
    summary.reason = "submit_partial";
  } else {
    summary.reason = "submit_ok";
  }
  return summary;
}

function buildSimulationMessage(
  result: Stage6LoadResult,
  actionable: Stage6CandidateSummary[],
  actionableVerdicts: Set<string>,
  dryExec: DryExecBuildResult,
  preflight: PreflightResult,
  ledger: OrderLedgerUpdateResult,
  brokerSubmit: BrokerSubmitSummary,
  guardControl: GuardControlGate,
  hfLivePromotion?: HfLivePromotionSummary | null,
  hfPayloadProbe?: HfPayloadProbeSummary,
  hfNextAction?: HfNextActionSummary | null
): string {
  const cfg = loadRuntimeConfig();
  const formatTierMeta = (row: Stage6CandidateSummary) => {
    const tier = row.stage6Tier && row.stage6Tier !== "N/A" ? row.stage6Tier : "NONE";
    const disp = row.displacement != null ? row.displacement.toFixed(1) : "-";
    const pos = row.ictPos != null ? row.ictPos.toFixed(3) : "-";
    return `Tier ${tier} | Disp ${disp} | ictPos ${pos}`;
  };
  const lines: string[] = [];
  lines.push("🧪 Sidecar Dry-Run Report");
  lines.push(`Stage6: ${result.fileName}`);
  lines.push(`Hash: ${result.sha256.slice(0, 12)} | MD5: ${result.md5Checksum}`);
  lines.push(`Candidates: ${result.candidateSymbols.length}`);
  lines.push(
    `Policy Gate: raw ${result.candidates.length} -> actionable ${actionable.length} (${formatActionableVerdicts(actionableVerdicts)} only)`
  );
  if (result.contractContext) {
    lines.push(
      `Contract Source: modelTop6=${result.contractContext.modelTop6.length} executablePicks=${result.contractContext.executablePicks.length} watchlistTop=${result.contractContext.watchlistTop.length}`
    );
  }
  lines.push("");

  if (result.modelTopCandidates.length === 0) {
    lines.push("Top6 summary: N/A");
  } else {
    lines.push("Top6 Summary");
    result.modelTopCandidates.forEach((row, index) => {
      lines.push(
        `${index + 1}) ${row.symbol} | ${row.verdict} | ER ${row.expectedReturn} | Conv ${row.conviction} | M#${row.modelRank ?? "-"} E#${row.executionRank ?? "-"} XS#${row.executionScore ?? "-"} | ${formatTierMeta(row)} | ${row.executionBucket}/${row.executionReason} | D=${row.finalDecision}/${row.decisionReason} | ${row.entry}→${row.target} / ${row.stop}`
      );
    });
  }

  lines.push("");
  lines.push("Actionable Candidates");
  if (actionable.length === 0) {
    lines.push("N/A (all filtered by policy gate)");
  } else {
    actionable.forEach((row, index) => {
      lines.push(
        `${index + 1}) ${row.symbol} | ${row.verdict} | XS#${row.executionScore ?? "-"} | ${formatTierMeta(row)} | ${row.executionBucket}/${row.executionReason} | D=${row.finalDecision}/${row.decisionReason} | ${row.entry}→${row.target} / ${row.stop}`
      );
    });
  }

  lines.push("");
  lines.push("Dry-Exec Payload Preview");
  lines.push(
    `Regime: ${dryExec.regime.profile.toUpperCase()} (base=${dryExec.regime.baseProfile.toUpperCase()}) | source=${dryExec.regime.source} | vix=${dryExec.regime.vix?.toFixed(2) ?? "N/A"} | on<=${dryExec.regime.riskOnThreshold} off>=${dryExec.regime.riskOffThreshold}`
  );
  lines.push(
    `Regime Guard: quality=${dryExec.regime.quality.status.toUpperCase()}(${dryExec.regime.quality.score}/${dryExec.regime.quality.minScore}) forceRiskOff=${dryExec.regime.quality.forceRiskOff} | hysteresis=${dryExec.regime.hysteresis.reason} holdRemain=${dryExec.regime.hysteresis.holdRemainingMin}m | entryBlocked=${dryExec.regime.entryGuard.blocked}`
  );
  if (dryExec.regime.entryGuard.blocked) {
    lines.push(`Entry Guard Reason: ${dryExec.regime.entryGuard.reason}`);
  }
  lines.push(
    `Guard Control: enforce=${guardControl.enforce} blocked=${guardControl.blocked} wouldBlockLive=${guardControl.wouldBlockLive} level=${guardControl.level != null ? `L${guardControl.level}` : "N/A"} stale=${guardControl.stale} age=${guardControl.ageMin != null ? `${guardControl.ageMin.toFixed(1)}m` : "N/A"} maxAge=${guardControl.maxAgeMin}m reason=${guardControl.reason} updatedAt=${guardControl.updatedAt ?? "N/A"}`
  );
  lines.push(
    `Gate: Conv>=${dryExec.minConviction} (base=${dryExec.minConvictionPolicy.base}, vix+${dryExec.minConvictionPolicy.marketTighten}, quality-${dryExec.minConvictionPolicy.qualityRelief}, sampleCap=${dryExec.minConvictionPolicy.sampleCap ?? "N/A"}) | StopDist ${dryExec.minStopDistancePct}%~${dryExec.maxStopDistancePct}%`
  );
  lines.push(
    `HF Soft Gate: enabled=${dryExec.hfSentimentGate.enabled} scoreFloor=${dryExec.hfSentimentGate.scoreFloor} minArticles=${dryExec.hfSentimentGate.minArticleCount} maxNewsAgeH=${dryExec.hfSentimentGate.maxNewsAgeHours} earningsWindow=${dryExec.hfSentimentGate.earningsWindowEnabled} blockD=${dryExec.hfSentimentGate.earningsBlockDays} reduceD=${dryExec.hfSentimentGate.earningsReduceDays} reduceFactor=${dryExec.hfSentimentGate.earningsReduceFactor} reliefMax=${dryExec.hfSentimentGate.positiveReliefMax} tightenMax=${dryExec.hfSentimentGate.negativeTightenMax} applied=${dryExec.hfSentimentGate.applied} relief=${dryExec.hfSentimentGate.reliefCount} tighten=${dryExec.hfSentimentGate.tightenCount} blockedNegative=${dryExec.hfSentimentGate.blockedNegative} earningsBlocked=${dryExec.hfSentimentGate.earningsBlocked} earningsReduced=${dryExec.hfSentimentGate.earningsReduced} netConvDelta=${dryExec.hfSentimentGate.netMinConvictionDelta} sizeReduceEnabled=${dryExec.hfSentimentGate.sizeReductionEnabled} sizeReducePct=${dryExec.hfSentimentGate.sizeReductionPct} sizeReduced=${dryExec.hfSentimentGate.sizeReducedCount} sizeReductionNotional=${dryExec.hfSentimentGate.sizeReductionNotionalTotal.toFixed(2)}`
  );
  lines.push(`HF Explain: ${dryExec.hfSentimentGate.explainLine}`);
  const probeForSummary: HfPayloadProbeSummary =
    hfPayloadProbe ??
    ({
      requestedMode: "off",
      active: false,
      modified: false,
      reason: "not_available",
      symbol: null,
      basePayloadCount: 0,
      baseSkippedCount: 0,
      baseApplied: 0,
      baseTighten: 0,
      baseRelief: 0,
      baseSizeReduced: 0,
      baseSizeReductionNotional: 0,
      generatedAt: new Date().toISOString()
    } as HfPayloadProbeSummary);
  const probeStatus = deriveHfPayloadProbeGateSummary(dryExec, probeForSummary);
  lines.push(
    `HF Payload Probe: status=${probeStatus.status} reason=${probeStatus.reason} payloads=${probeStatus.payloadCount} hfApplied=${probeStatus.hfApplied} tighten=${probeStatus.tightenCount} sizeReduceEnabled=${probeStatus.sizeReduceEnabled} sizeReduced=${probeStatus.sizeReducedCount} savedNotional=${probeStatus.savedNotional.toFixed(2)} forced=${probeStatus.forced}`
  );
  lines.push(
    `StopDist Policy: syncStage6=${dryExec.stopDistancePolicy.syncWithStage6} strategy=${dryExec.stopDistancePolicy.strategy} configured=${dryExec.stopDistancePolicy.configuredMinPct}%~${dryExec.stopDistancePolicy.configuredMaxPct}% stage6=${dryExec.stopDistancePolicy.stage6MinPct}%~${dryExec.stopDistancePolicy.stage6MaxPct}% applied=${dryExec.stopDistancePolicy.appliedMinPct}%~${dryExec.stopDistancePolicy.appliedMaxPct}%`
  );
  lines.push(
    `Entry Feasibility Gate: enforce=${dryExec.entryFeasibility.enforce} maxDistancePct=${dryExec.entryFeasibility.maxDistancePct} checked=${dryExec.entryFeasibility.checked} blocked=${dryExec.entryFeasibility.blocked}`
  );
  lines.push(
    `Stage6 Contract Gate: enforce=${dryExec.stage6Contract.enforce} checked=${dryExec.stage6Contract.checked} executable=${dryExec.stage6Contract.executable} watchlist=${dryExec.stage6Contract.watchlist} blocked=${dryExec.stage6Contract.blocked}`
  );
  if (hfLivePromotion) {
    lines.push(
      `HF Live Promotion: status=${hfLivePromotion.status} reason=${hfLivePromotion.reason} required=${hfLivePromotion.requiredPass}/${hfLivePromotion.requiredTotal} missing=${hfLivePromotion.requiredMissing.length ? hfLivePromotion.requiredMissing.join(",") : "none"} hint=${hfLivePromotion.requiredHintText} payloadPath=${hfLivePromotion.payloadPathSource}/${hfLivePromotion.payloadPathVerifiedAt ?? "n/a"}`
    );
  } else {
    lines.push("HF Live Promotion: N/A (summary not generated yet)");
  }
  if (hfNextAction) {
    lines.push(
      `HF Next Action: status=${hfNextAction.status} action=${hfNextAction.action} reason=${hfNextAction.reason} hint=${hfNextAction.hint} requiredMissing=${hfNextAction.requiredMissing.length ? hfNextAction.requiredMissing.join(",") : "none"} gate=${hfNextAction.gateStatus} progress=${hfNextAction.gateProgress} remainingTrades=${hfNextAction.gateRemainingTrades}`
    );
  } else {
    lines.push("HF Next Action: N/A");
  }
  lines.push(
    `Action Intent: enabled=${dryExec.actionIntent.enabled} previewOnly=${dryExec.actionIntent.previewOnly} allowed=${dryExec.actionIntent.allowedActionTypes.join("/")} counts=ENTRY_NEW:${dryExec.actionIntent.counts.ENTRY_NEW},HOLD_WAIT:${dryExec.actionIntent.counts.HOLD_WAIT},SCALE_UP:${dryExec.actionIntent.counts.SCALE_UP},SCALE_DOWN:${dryExec.actionIntent.counts.SCALE_DOWN},EXIT_PARTIAL:${dryExec.actionIntent.counts.EXIT_PARTIAL},EXIT_FULL:${dryExec.actionIntent.counts.EXIT_FULL}`
  );
  lines.push("Payload Validation: price/notional finite check + geometry + client_order_id format");
  lines.push(
    `Orders: ${dryExec.payloads.length} | Notional/Order: $${dryExec.notionalPerOrder.toFixed(2)} | MaxOrders: ${dryExec.maxOrders} | MaxTotalNotional: $${dryExec.maxTotalNotional.toFixed(2)}`
  );
  if (dryExec.payloads.length === 0) {
    lines.push("N/A (no payload generated)");
  } else {
    dryExec.payloads.forEach((order, index) => {
      lines.push(
        `${index + 1}) ${order.symbol} | A=${order.actionType ?? "N/A"} | LIMIT ${order.limit_price} | TP ${order.take_profit.limit_price} | SL ${order.stop_loss.stop_price} | Notional $${order.notional.toFixed(2)}`
      );
    });
  }
  if (dryExec.skipped.length > 0) {
    const skippedLog = dryExec.skipped
      .map((s) => `${s.symbol}:${s.reason}${s.detail ? `[${s.detail}]` : ""}${s.actionType ? `(${s.actionType})` : ""}`)
      .join(", ");
    lines.push(`Skipped: ${skippedLog}`);
  }
  lines.push(
    `Order Idempotency: enabled=${dryExec.idempotency.enabled} enforce=${dryExec.idempotency.enforced} ttlDays=${dryExec.idempotency.ttlDays} new=${dryExec.idempotency.newCount} duplicate=${dryExec.idempotency.duplicateCount}`
  );
  lines.push(
    `Order Lifecycle: enabled=${ledger.enabled} target=${ledger.targetStatus} upserted=${ledger.upserted} transitioned=${ledger.transitioned} unchanged=${ledger.unchanged} pruned=${ledger.pruned}`
  );
  lines.push(
    `Broker Submit: enabled=${brokerSubmit.enabled} active=${brokerSubmit.active} reason=${brokerSubmit.reason} requirePerfGateGo=${brokerSubmit.requirePerfGateGo} requireHfPass=${brokerSubmit.requireHfLivePromotionPass} perfGate=${brokerSubmit.perfGateStatus} perfReason=${brokerSubmit.perfGateReason} hfLive=${brokerSubmit.hfLivePromotionStatus} hfReason=${brokerSubmit.hfLivePromotionReason} attempted=${brokerSubmit.attempted} submitted=${brokerSubmit.submitted} failed=${brokerSubmit.failed} skipped=${brokerSubmit.skipped}`
  );
  lines.push("");
  lines.push("Preflight Gate");
  lines.push(
    `Status: ${preflight.status.toUpperCase()} | code=${preflight.code} | enforced=${preflight.enforced} | blocking=${preflight.blocking} | wouldBlockLive=${preflight.wouldBlockLive} | liveParity=${preflight.simulatedLiveParity}`
  );
  lines.push(`Message: ${preflight.message}`);
  lines.push(
    `Required: $${preflight.requiredNotional.toFixed(2)} | DailyMax: $${preflight.dailyMaxNotional.toFixed(2)} | BuyingPower: ${preflight.buyingPower != null ? `$${preflight.buyingPower.toFixed(2)}` : "N/A"}`
  );
  lines.push(
    `RTH Guard: ${!preflight.allowEntryOutsideRth} | MarketOpen: ${preflight.marketOpen == null ? "N/A" : preflight.marketOpen} | NextOpen: ${preflight.nextOpen ?? "N/A"}`
  );
  lines.push(`Account: ${preflight.accountStatus ?? "N/A"}`);

  lines.push("");
  lines.push(
    `Mode: READ_ONLY=${cfg.readOnly}, EXEC_ENABLED=${cfg.execEnabled}, SIMULATION_LIVE_PARITY=${cfg.simulationLiveParity}`
  );
  return lines.join("\n");
}

async function sendSimulationTelegram(
  result: Stage6LoadResult,
  actionable: Stage6CandidateSummary[],
  actionableVerdicts: Set<string>,
  dryExec: DryExecBuildResult,
  preflight: PreflightResult,
  ledger: OrderLedgerUpdateResult,
  brokerSubmit: BrokerSubmitSummary,
  guardControl: GuardControlGate,
  hfLivePromotion?: HfLivePromotionSummary | null,
  hfPayloadProbe?: HfPayloadProbeSummary,
  hfNextAction?: HfNextActionSummary | null
): Promise<void> {
  const token = process.env.TELEGRAM_TOKEN || "";
  const chatId = process.env.TELEGRAM_SIMULATION_CHAT_ID || "";
  const text = buildSimulationMessage(
    result,
    actionable,
    actionableVerdicts,
    dryExec,
    preflight,
    ledger,
    brokerSubmit,
    guardControl,
    hfLivePromotion,
    hfPayloadProbe,
    hfNextAction
  );

  await sendTelegramMessage(token, chatId, text, "TELEGRAM_SIM");
}

async function sendPerformanceLoopMilestoneAlert(
  perfLoop: PerformanceLoopUpdateResult
): Promise<void> {
  if (!perfLoop.alertMessage) return;
  const token = process.env.TELEGRAM_TOKEN || "";
  const chatId = process.env.TELEGRAM_SIMULATION_CHAT_ID || "";
  await sendTelegramMessage(token, chatId, perfLoop.alertMessage, "TELEGRAM_PERF_LOOP");
}

async function sendHeartbeatOnDedupe(stage6: Stage6LoadResult, mode: string): Promise<void> {
  const enabled = readBoolEnv("TELEGRAM_HEARTBEAT_ON_DEDUPE", false);
  if (!enabled) return;
  const token = process.env.TELEGRAM_TOKEN || "";
  const chatId = process.env.TELEGRAM_SIMULATION_CHAT_ID || "";
  const text = [
    "💓 Sidecar Heartbeat",
    `Dedupe skip: same hash/mode`,
    `Stage6: ${stage6.fileName}`,
    `Hash: ${stage6.sha256.slice(0, 12)}`,
    `Mode: ${mode}`
  ].join("\n");

  await sendTelegramMessage(token, chatId, text, "TELEGRAM_HEARTBEAT");
}

function resolveAlertChatId(): string {
  return (
    process.env.TELEGRAM_ALERT_CHAT_ID ||
    process.env.TELEGRAM_SIMULATION_CHAT_ID ||
    process.env.TELEGRAM_PRIMARY_CHAT_ID ||
    ""
  );
}

async function sendFailureAlert(message: string): Promise<void> {
  if (!readBoolEnv("TELEGRAM_SEND_ENABLED", true)) return;

  const token = process.env.TELEGRAM_TOKEN || "";
  const chatId = resolveAlertChatId();
  if (!token || !chatId) return;

  const text = [
    "🚨 Sidecar Dry-Run Failed",
    `time=${new Date().toISOString()}`,
    `message=${message.slice(0, 1000)}`
  ].join("\n");
  await sendTelegramMessage(token, chatId, text, "TELEGRAM_ALERT");
}

function splitTelegramText(text: string, maxLen: number): string[] {
  if (!text) return [""];
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";

  const flushCurrent = () => {
    if (!current) return;
    chunks.push(current);
    current = "";
  };

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= maxLen) {
      current = candidate;
      continue;
    }

    flushCurrent();

    if (line.length <= maxLen) {
      current = line;
      continue;
    }

    for (let idx = 0; idx < line.length; idx += maxLen) {
      chunks.push(line.slice(idx, idx + maxLen));
    }
  }

  flushCurrent();
  return chunks.length > 0 ? chunks : [text.slice(0, maxLen)];
}

async function sendTelegramMessage(token: string, chatId: string, text: string, tag: string): Promise<void> {
  if (!readBoolEnv("TELEGRAM_SEND_ENABLED", true)) {
    console.log(`[${tag}] skipped (TELEGRAM_SEND_ENABLED=false)`);
    return;
  }

  const maxLen = Math.max(500, Math.floor(readPositiveNumberEnv("TELEGRAM_MAX_MESSAGE_LENGTH", 3900)));
  const chunks = splitTelegramText(text, maxLen);

  for (let idx = 0; idx < chunks.length; idx++) {
    const body = new URLSearchParams({
      chat_id: chatId,
      text: chunks[idx],
      disable_web_page_preview: "true"
    });

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    if (!response.ok) {
      const raw = await response.text();
      throw new Error(
        `Telegram send failed (${response.status}) chunk=${idx + 1}/${chunks.length}: ${raw.slice(0, 240)}`
      );
    }
  }
  console.log(`[${tag}] sent to ${mask(chatId)} chunks=${chunks.length}`);
}

async function loadHfDriftState(): Promise<HfDriftState> {
  try {
    const raw = await readFile(HF_DRIFT_STATE_PATH, "utf8");
    const parsed = parseJsonText<Partial<HfDriftState>>(raw, "hf_drift_state");
    const snapshots = Array.isArray(parsed?.snapshots)
      ? (parsed.snapshots as HfDriftSnapshot[])
      : [];
    return {
      updatedAt: typeof parsed?.updatedAt === "string" ? parsed.updatedAt : "",
      snapshots
    };
  } catch {
    return {
      updatedAt: "",
      snapshots: []
    };
  }
}

async function saveHfDriftState(state: HfDriftState): Promise<void> {
  await mkdir("state", { recursive: true });
  await writeFile(HF_DRIFT_STATE_PATH, JSON.stringify(state, null, 2), "utf8");
  console.log(`[STATE] saved ${HF_DRIFT_STATE_PATH}`);
}

async function updateHfDriftAlert(
  stage6: Stage6LoadResult,
  dryExec: DryExecBuildResult,
  actionableCount: number
): Promise<HfDriftAlert> {
  const enabled = readBoolEnv("HF_DRIFT_ALERT_ENABLED", true);
  const windowRuns = Math.max(3, Math.min(30, Math.round(readNonNegativeNumberEnv("HF_DRIFT_ALERT_WINDOW_RUNS", 8))));
  const minHistory = Math.max(2, Math.min(windowRuns - 1, Math.round(readNonNegativeNumberEnv("HF_DRIFT_ALERT_MIN_HISTORY", 4))));
  const minCandidates = Math.max(1, Math.min(20, Math.round(readNonNegativeNumberEnv("HF_DRIFT_ALERT_MIN_CANDIDATES", 3))));
  const negativeRatioSpike = clamp(readNonNegativeNumberEnv("HF_DRIFT_ALERT_NEGATIVE_RATIO_SPIKE", 0.75), 0, 1);
  const negativeRatioDelta = clamp(readNonNegativeNumberEnv("HF_DRIFT_ALERT_NEGATIVE_RATIO_DELTA", 0.35), 0, 1);
  const appliedRatioDrop = clamp(readNonNegativeNumberEnv("HF_DRIFT_ALERT_APPLIED_RATIO_DROP", 0.25), 0, 1);
  const appliedRatioFloor = clamp(readNonNegativeNumberEnv("HF_DRIFT_ALERT_APPLIED_RATIO_FLOOR", 0.15), 0, 1);
  const requirePayload = readBoolEnv("HF_DRIFT_ALERT_REQUIRE_PAYLOAD", true);
  const payloadCount = Math.max(0, dryExec.payloads.length);
  const checkedCandidatesRaw =
    dryExec.stage6Contract.checked > 0 ? dryExec.stage6Contract.checked : actionableCount;
  const checkedCandidates = Math.max(0, checkedCandidatesRaw);
  const appliedCount = Math.max(0, dryExec.hfSentimentGate.applied);
  const tightenCount = Math.max(0, dryExec.hfSentimentGate.tightenCount);
  const appliedRatio =
    checkedCandidates > 0 ? Number((appliedCount / checkedCandidates).toFixed(4)) : 0;
  const negativeRatio =
    appliedCount > 0 ? Number((tightenCount / appliedCount).toFixed(4)) : 0;

  const snapshot: HfDriftSnapshot = {
    at: new Date().toISOString(),
    stage6Hash: stage6.sha256,
    stage6File: stage6.fileName,
    profile: dryExec.regime.profile,
    hfSoftEnabled: dryExec.hfSentimentGate.enabled,
    payloadCount,
    checkedCandidates,
    appliedCount,
    tightenCount,
    appliedRatio,
    negativeRatio
  };

  const state = await loadHfDriftState();
  const deduped = state.snapshots.filter((row) => row.stage6Hash !== snapshot.stage6Hash);
  deduped.push(snapshot);
  const maxKeep = Math.max(windowRuns * 6, 60);
  const snapshots = deduped.slice(-maxKeep);
  const recent = snapshots.slice(-windowRuns);
  const baselinePool = recent
    .slice(0, -1)
    .filter((row) => {
      const rowPayloadCount = typeof row.payloadCount === "number" ? Math.max(0, row.payloadCount) : 1;
      return (
        row.hfSoftEnabled &&
        row.checkedCandidates >= minCandidates &&
        (!requirePayload || rowPayloadCount > 0)
      );
    });
  const baselineAppliedRatio = average(baselinePool.map((row) => row.appliedRatio)) ?? 0;
  const baselineNegativeRatio = average(baselinePool.map((row) => row.negativeRatio)) ?? 0;
  const baselineSamples = baselinePool.length;
  const hasPayloadSample = !requirePayload || (snapshot.payloadCount ?? 0) > 0;
  const hasSample =
    baselineSamples >= minHistory &&
    snapshot.checkedCandidates >= minCandidates &&
    hasPayloadSample;
  const negativeSpikeTriggered =
    hasSample &&
    snapshot.negativeRatio >= Math.max(negativeRatioSpike, baselineNegativeRatio + negativeRatioDelta);
  const appliedDropTriggered =
    hasSample &&
    snapshot.appliedRatio <= appliedRatioFloor &&
    snapshot.appliedRatio <= Math.max(0, baselineAppliedRatio - appliedRatioDrop);
  const triggered =
    enabled &&
    snapshot.hfSoftEnabled &&
    (negativeSpikeTriggered || appliedDropTriggered);

  const reason = !enabled
    ? "disabled"
    : !snapshot.hfSoftEnabled
      ? "hf_soft_disabled"
      : !hasPayloadSample
        ? `insufficient_payload(${snapshot.payloadCount ?? 0}/1)`
      : !hasSample
        ? baselineSamples < minHistory
          ? `insufficient_history(${baselineSamples}/${minHistory})`
          : `insufficient_candidates(${snapshot.checkedCandidates}/${minCandidates})`
        : [negativeSpikeTriggered ? "negative_ratio_spike" : null, appliedDropTriggered ? "applied_ratio_drop" : null]
            .filter((row): row is string => Boolean(row))
            .join("|") || "stable";

  state.updatedAt = snapshot.at;
  state.snapshots = snapshots;
  await saveHfDriftState(state);

  const alert: HfDriftAlert = {
    enabled,
    triggered,
    reason,
    requirePayload,
    payloadCount: snapshot.payloadCount ?? 0,
    windowRuns,
    minHistory,
    minCandidates,
    checkedCandidates: snapshot.checkedCandidates,
    baselineSamples,
    currentAppliedRatio: snapshot.appliedRatio,
    currentNegativeRatio: snapshot.negativeRatio,
    baselineAppliedRatio,
    baselineNegativeRatio,
    thresholds: {
      negativeRatioSpike,
      negativeRatioDelta,
      appliedRatioDrop,
      appliedRatioFloor
    }
  };

  const driftLine =
    `[HF_DRIFT] enabled=${alert.enabled} triggered=${alert.triggered} reason=${alert.reason} ` +
    `requirePayload=${alert.requirePayload} payloads=${alert.payloadCount} ` +
    `window=${alert.windowRuns} baseline=${alert.baselineSamples} minHistory=${alert.minHistory} ` +
    `checked=${alert.checkedCandidates} minCandidates=${alert.minCandidates} ` +
    `currentApplied=${alert.currentAppliedRatio.toFixed(4)} baselineApplied=${alert.baselineAppliedRatio.toFixed(4)} ` +
    `currentNegative=${alert.currentNegativeRatio.toFixed(4)} baselineNegative=${alert.baselineNegativeRatio.toFixed(4)} ` +
    `negSpike=${alert.thresholds.negativeRatioSpike.toFixed(2)} negDelta=${alert.thresholds.negativeRatioDelta.toFixed(2)} ` +
    `drop=${alert.thresholds.appliedRatioDrop.toFixed(2)} floor=${alert.thresholds.appliedRatioFloor.toFixed(2)}`;
  if (alert.triggered) {
    console.warn(driftLine);
  } else {
    console.log(driftLine);
  }

  return alert;
}

async function loadHfFreezeState(): Promise<HfFreezeState> {
  try {
    const raw = await readFile(HF_TUNING_FREEZE_STATE_PATH, "utf8");
    const parsed = parseJsonText<Partial<HfFreezeState>>(raw, "hf_freeze_state");
    const statusRaw = String(parsed?.status ?? "").trim().toUpperCase();
    const status: HfFreezeStatus =
      statusRaw === "OBSERVE" ||
      statusRaw === "CANDIDATE" ||
      statusRaw === "FROZEN" ||
      statusRaw === "UNFREEZE_REVIEW"
        ? (statusRaw as HfFreezeStatus)
        : "OBSERVE";
    return {
      status,
      stableRunStreak: Math.max(0, Math.round(Number(parsed?.stableRunStreak ?? 0))),
      alertStreak: Math.max(0, Math.round(Number(parsed?.alertStreak ?? 0))),
      frozenAt: typeof parsed?.frozenAt === "string" && parsed.frozenAt.trim() ? parsed.frozenAt : null,
      updatedAt: typeof parsed?.updatedAt === "string" ? parsed.updatedAt : ""
    };
  } catch {
    return {
      status: "OBSERVE",
      stableRunStreak: 0,
      alertStreak: 0,
      frozenAt: null,
      updatedAt: ""
    };
  }
}

async function saveHfFreezeState(state: HfFreezeState): Promise<void> {
  await mkdir("state", { recursive: true });
  await writeFile(HF_TUNING_FREEZE_STATE_PATH, JSON.stringify(state, null, 2), "utf8");
  console.log(`[STATE] saved ${HF_TUNING_FREEZE_STATE_PATH}`);
}

async function loadHfLivePromotionState(): Promise<HfLivePromotionState | null> {
  try {
    const raw = await readFile(HF_LIVE_PROMOTION_STATE_PATH, "utf8");
    const parsed = parseJsonText<Partial<HfLivePromotionState>>(raw, "hf_live_promotion_state");
    const stage6Hash = String(parsed?.stage6Hash ?? "").trim();
    if (!stage6Hash) return null;
    const sourceRaw = String(parsed?.lastSource ?? "").trim().toLowerCase();
    const lastSource: HfLivePromotionState["lastSource"] =
      sourceRaw === "current_live" || sourceRaw === "current_probe" || sourceRaw === "sticky"
        ? (sourceRaw as HfLivePromotionState["lastSource"])
        : "none";
    return {
      stage6Hash,
      payloadPathVerified: Boolean(parsed?.payloadPathVerified),
      payloadPathVerifiedAt:
        typeof parsed?.payloadPathVerifiedAt === "string" && parsed.payloadPathVerifiedAt.trim()
          ? parsed.payloadPathVerifiedAt
          : null,
      lastSource,
      updatedAt: typeof parsed?.updatedAt === "string" ? parsed.updatedAt : ""
    };
  } catch {
    return null;
  }
}

async function saveHfLivePromotionState(state: HfLivePromotionState): Promise<void> {
  await mkdir("state", { recursive: true });
  await writeFile(HF_LIVE_PROMOTION_STATE_PATH, JSON.stringify(state, null, 2), "utf8");
  console.log(`[STATE] saved ${HF_LIVE_PROMOTION_STATE_PATH}`);
}

function evaluateCurrentPayloadPathVerification(
  dryExec: DryExecBuildResult,
  hfPayloadProbe: HfPayloadProbeSummary
): {
  verified: boolean;
  source: "none" | "current_live" | "current_probe";
} {
  const sizeReduceTightenSatisfied =
    !dryExec.hfSentimentGate.sizeReductionEnabled ||
    dryExec.hfSentimentGate.tightenCount <= 0 ||
    dryExec.hfSentimentGate.sizeReducedCount > 0;
  // Payload-path verification confirms payload creation path viability.
  // Do not require HF adjustment application count for path verification.
  const livePayloadPathVerified =
    dryExec.payloads.length > 0 &&
    sizeReduceTightenSatisfied;
  const probeSizeReduceTightenSatisfied =
    !dryExec.hfSentimentGate.sizeReductionEnabled ||
    hfPayloadProbe.baseTighten <= 0 ||
    hfPayloadProbe.baseSizeReduced > 0;
  const probePayloadPathVerified =
    hfPayloadProbe.active &&
    hfPayloadProbe.basePayloadCount > 0 &&
    probeSizeReduceTightenSatisfied;
  if (livePayloadPathVerified) return { verified: true, source: "current_live" };
  if (probePayloadPathVerified) return { verified: true, source: "current_probe" };
  return { verified: false, source: "none" };
}

async function resolvePayloadPathVerificationStatus(
  stage6Hash: string,
  current: {
    verified: boolean;
    source: "none" | "current_live" | "current_probe";
  }
): Promise<HfPayloadPathVerificationStatus> {
  const now = new Date().toISOString();
  const stickyHours = clamp(
    readNonNegativeNumberEnv("HF_LIVE_PROMOTION_PAYLOAD_PATH_STICKY_HOURS", 168),
    0,
    720
  );
  const prior = await loadHfLivePromotionState();
  const priorStage6Hash = prior?.stage6Hash ?? null;
  const priorReferenceAt = prior?.payloadPathVerifiedAt || prior?.updatedAt || "";
  const priorReferenceMs = Date.parse(priorReferenceAt);
  const priorAgeHours =
    Number.isFinite(priorReferenceMs) && priorReferenceMs > 0
      ? (Date.now() - priorReferenceMs) / (1000 * 60 * 60)
      : null;
  const stickyWithinWindow =
    stickyHours > 0 && priorAgeHours != null && priorAgeHours >= 0 && priorAgeHours <= stickyHours;
  // Keep payload-path verification sticky across stage hash changes within TTL
  // so daily stage refresh does not reset promotion progress.
  const stickyEligible = Boolean(prior?.payloadPathVerified && stickyWithinWindow);
  const stickyReset = Boolean(prior?.payloadPathVerified && !stickyEligible);
  const stickyResetReason =
    stickyReset && priorAgeHours != null && priorAgeHours > stickyHours
      ? "sticky_expired"
      : stickyReset && priorAgeHours == null
        ? "sticky_age_unknown"
        : "none";
  const stickyAuditBase = {
    priorStage6Hash,
    stage6HashChanged: Boolean(priorStage6Hash && priorStage6Hash !== stage6Hash),
    stickyEligible,
    stickyReset,
    stickyResetReason,
    currentVerified: current.verified,
    currentSource: current.source
  };

  if (current.verified) {
    await saveHfLivePromotionState({
      stage6Hash,
      payloadPathVerified: true,
      payloadPathVerifiedAt: now,
      lastSource: current.source,
      updatedAt: now
    });
    return {
      payloadPathVerified: true,
      payloadPathSource: current.source,
      payloadPathVerifiedAt: now,
      stickyAudit: {
        ...stickyAuditBase,
        stickyCarried: false,
        resolvedVerified: true,
        resolvedSource: current.source
      }
    };
  }

  if (stickyEligible) {
    await saveHfLivePromotionState({
      stage6Hash,
      payloadPathVerified: true,
      payloadPathVerifiedAt: prior?.payloadPathVerifiedAt ?? null,
      lastSource: "sticky",
      updatedAt: now
    });
    return {
      payloadPathVerified: true,
      payloadPathSource: "sticky",
      payloadPathVerifiedAt: prior?.payloadPathVerifiedAt ?? null,
      stickyAudit: {
        ...stickyAuditBase,
        stickyCarried: true,
        resolvedVerified: true,
        resolvedSource: "sticky"
      }
    };
  }

  await saveHfLivePromotionState({
    stage6Hash,
    payloadPathVerified: false,
    payloadPathVerifiedAt: null,
    lastSource: "none",
    updatedAt: now
  });
  return {
    payloadPathVerified: false,
    payloadPathSource: "none",
    payloadPathVerifiedAt: null,
    stickyAudit: {
      ...stickyAuditBase,
      stickyCarried: false,
      resolvedVerified: false,
      resolvedSource: "none"
    }
  };
}

async function updateHfFreezeSummary(
  tuningPhase: HfTuningPhaseSummary,
  hfShadowTrend: HfShadowTrendSummary | null,
  hfAlert: HfAnomalyAlert | null
): Promise<HfFreezeSummary> {
  const enabled = readBoolEnv("HF_TUNING_FREEZE_ENABLED", false);
  const stableRunsTarget = Math.max(1, Math.round(readNonNegativeNumberEnv("HF_TUNING_FREEZE_STABLE_RUNS", 3)));
  const alertStreakThreshold = Math.max(
    1,
    Math.round(readNonNegativeNumberEnv("HF_TUNING_UNFREEZE_ALERT_STREAK", 2))
  );
  const requiredProgress = Math.max(
    1,
    Math.round(readNonNegativeNumberEnv("HF_TUNING_FREEZE_REQUIRE_PROGRESS", PERFORMANCE_LOOP_REQUIRED_TRADES))
  );
  const maxShadowAlertRate = clamp(readNonNegativeNumberEnv("HF_TUNING_FREEZE_MAX_SHADOW_ALERT_RATE", 0.1), 0, 1);
  const observedTrades = Math.max(0, Math.round(Number(tuningPhase.observedTrades || 0)));
  const shadowAlertRate = hfShadowTrend?.alertTriggeredRate ?? 0;
  const hfAlertTriggered = Boolean(hfAlert?.triggered);
  const hasProgress = observedTrades >= requiredProgress;
  const stableSignal = hasProgress && !hfAlertTriggered && shadowAlertRate <= maxShadowAlertRate;
  const now = new Date().toISOString();

  if (!enabled) {
    const disabled: HfFreezeSummary = {
      enabled: false,
      status: "DISABLED",
      reason: "disabled",
      recommendation: "enable_freeze_when_ready",
      observedTrades,
      requiredProgress,
      stableRunStreak: 0,
      stableRunsTarget,
      alertStreak: 0,
      alertStreakThreshold,
      shadowAlertRate,
      maxShadowAlertRate,
      hfAlertTriggered,
      frozenAt: null,
      updatedAt: now
    };
    console.log(
      `[HF_FREEZE] enabled=false status=DISABLED reason=disabled recommendation=enable_freeze_when_ready progress=${disabled.observedTrades}/${disabled.requiredProgress} stable=0/${stableRunsTarget} alert=0/${alertStreakThreshold} shadowRate=${shadowAlertRate.toFixed(4)} shadowMax=${maxShadowAlertRate.toFixed(4)} hfAlert=${hfAlertTriggered} frozenAt=n/a`
    );
    return disabled;
  }

  const state = await loadHfFreezeState();
  let status = state.status;
  let stableRunStreak = state.stableRunStreak;
  let alertStreak = state.alertStreak;
  let frozenAt = state.frozenAt;
  let reason = "observe_collect_more";
  let recommendation = "collect_more_runs";

  if (!hasProgress) {
    status = "OBSERVE";
    stableRunStreak = 0;
    alertStreak = 0;
    reason = `progress_insufficient(${observedTrades}/${requiredProgress})`;
    recommendation = "collect_more_runs";
  } else if (status === "FROZEN") {
    if (hfAlertTriggered || shadowAlertRate > maxShadowAlertRate) {
      alertStreak += 1;
      if (alertStreak >= alertStreakThreshold) {
        status = "UNFREEZE_REVIEW";
        reason = hfAlertTriggered ? "unfreeze_hf_alert_streak" : "unfreeze_shadow_alert_rate_streak";
        recommendation = "review_thresholds_before_unfreeze";
      } else {
        reason = hfAlertTriggered ? "frozen_alert_detected" : "frozen_shadow_rate_high";
        recommendation = "monitor_alert_streak";
      }
    } else {
      alertStreak = 0;
      reason = "frozen_stable";
      recommendation = "keep_thresholds_frozen";
    }
  } else {
    alertStreak = 0;
    if (stableSignal) {
      stableRunStreak += 1;
      if (stableRunStreak >= stableRunsTarget) {
        status = "FROZEN";
        frozenAt = frozenAt || now;
        reason = "stable_runs_threshold_reached";
        recommendation = "freeze_baseline";
      } else {
        status = "CANDIDATE";
        reason = "stable_signal_accumulating";
        recommendation = "continue_stable_monitoring";
      }
    } else {
      status = "OBSERVE";
      stableRunStreak = 0;
      reason = hfAlertTriggered ? "hf_alert_triggered" : "shadow_alert_rate_high";
      recommendation = "stabilize_before_freeze";
    }
  }

  const nextState: HfFreezeState = {
    status,
    stableRunStreak,
    alertStreak,
    frozenAt,
    updatedAt: now
  };
  await saveHfFreezeState(nextState);

  const summary: HfFreezeSummary = {
    enabled: true,
    status,
    reason,
    recommendation,
    observedTrades,
    requiredProgress,
    stableRunStreak,
    stableRunsTarget,
    alertStreak,
    alertStreakThreshold,
    shadowAlertRate: Number(shadowAlertRate.toFixed(4)),
    maxShadowAlertRate: Number(maxShadowAlertRate.toFixed(4)),
    hfAlertTriggered,
    frozenAt,
    updatedAt: now
  };
  console.log(
    `[HF_FREEZE] enabled=true status=${summary.status} reason=${summary.reason} recommendation=${summary.recommendation} progress=${summary.observedTrades}/${summary.requiredProgress} stable=${summary.stableRunStreak}/${summary.stableRunsTarget} alert=${summary.alertStreak}/${summary.alertStreakThreshold} shadowRate=${summary.shadowAlertRate.toFixed(4)} shadowMax=${summary.maxShadowAlertRate.toFixed(4)} hfAlert=${summary.hfAlertTriggered} frozenAt=${summary.frozenAt ?? "n/a"}`
  );
  return summary;
}

function buildSkipReasonDelta(
  onCounts: Record<string, number>,
  offCounts: Record<string, number>
): string {
  const keys = new Set([...Object.keys(onCounts), ...Object.keys(offCounts)]);
  const deltas: string[] = [];
  Array.from(keys)
    .sort((a, b) => a.localeCompare(b))
    .forEach((key) => {
      const delta = (onCounts[key] || 0) - (offCounts[key] || 0);
      if (delta !== 0) {
        deltas.push(`${key}:${delta > 0 ? "+" : ""}${delta}`);
      }
    });
  return deltas.length > 0 ? deltas.join(",") : "none";
}

function summarizeSymbols(symbols: string[], maxItems = 3): string {
  if (symbols.length === 0) return "none";
  const preview = symbols.slice(0, maxItems);
  const suffix = symbols.length > maxItems ? `+${symbols.length - maxItems}` : "";
  return `${preview.join("/")}${suffix ? `(${suffix})` : ""}`;
}

function buildHfShadowSummaryForRun(shadow: HfShadowSummary | null): string {
  if (!shadow) return "n/a";
  return [
    `enabled:${shadow.enabled}`,
    `compared:${shadow.compared}`,
    `reason:${shadow.reason}`,
    `payloadDelta:${shadow.payloadDelta}`,
    `notionalDelta:${shadow.notionalDelta.toFixed(2)}`,
    `onOnly:${shadow.onOnlySymbols.length}`,
    `offOnly:${shadow.offOnlySymbols.length}`
  ].join("|");
}

function buildHfShadowTrendSummaryForRun(trend: HfShadowTrendSummary | null): string {
  if (!trend) return "n/a";
  return [
    `history:${trend.historySize}`,
    `window:${trend.windowSize}`,
    `compared:${trend.comparedRuns}`,
    `alertRate:${trend.alertTriggeredRate.toFixed(4)}`,
    `avgPayloadDelta:${trend.avgAbsPayloadDelta.toFixed(2)}`,
    `avgNotionalDelta:${trend.avgAbsNotionalDelta.toFixed(2)}`,
    `avgSkippedDelta:${trend.avgAbsSkippedDelta.toFixed(2)}`,
    `zeroPayloadRate:${trend.zeroPayloadRate.toFixed(4)}`
  ].join("|");
}

function buildHfTuningPhaseSummaryForRun(tuning: HfTuningPhaseSummary | null): string {
  if (!tuning) return "n/a";
  return [
    `phase:${tuning.phase}`,
    `reason:${tuning.reason}`,
    `rec:${tuning.recommendation}`,
    `gate:${tuning.gateStatus}`,
    `progress:${tuning.gateProgress}`,
    `remaining:${tuning.gateRemainingTrades}`,
    `progressPct:${tuning.gateProgressPct.toFixed(1)}`,
    `trades:${tuning.observedTrades}/${tuning.requiredTrades}`,
    `alertTriggered:${tuning.alertTriggered}`,
    `shadowAlertRate:${tuning.shadowAlertRate.toFixed(4)}`
  ].join("|");
}

function buildHfTuningAdviceSummaryForRun(advice: HfTuningAdvice | null): string {
  if (!advice) return "n/a";
  return [
    `status:${advice.status}`,
    `action:${advice.action}`,
    `variable:${advice.variable ?? "none"}`,
    `current:${advice.currentValue != null ? advice.currentValue.toFixed(4) : "n/a"}`,
    `suggested:${advice.suggestedValue != null ? advice.suggestedValue.toFixed(4) : "n/a"}`,
    `reason:${advice.reason}`,
    `confidence:${advice.confidence}`
  ].join("|");
}

function buildHfPayloadProbeSummaryForRun(probe: HfPayloadProbeSummary | null): string {
  if (!probe) return "n/a";
  return [
    `mode:${probe.requestedMode}`,
    `active:${probe.active}`,
    `modified:${probe.modified}`,
    `reason:${probe.reason}`,
    `symbol:${probe.symbol ?? "none"}`,
    `basePayloads:${probe.basePayloadCount}`,
    `baseApplied:${probe.baseApplied}`,
    `baseTighten:${probe.baseTighten}`,
    `baseRelief:${probe.baseRelief}`,
    `baseSizeReduced:${probe.baseSizeReduced}`,
    `baseSizeSaved:${probe.baseSizeReductionNotional.toFixed(2)}`
  ].join("|");
}

function deriveHfPayloadProbeGateSummary(
  dryExec: DryExecBuildResult,
  hfPayloadProbe: HfPayloadProbeSummary
): HfPayloadProbeGateSummary {
  const payloadCount = dryExec.payloads.length;
  const hfApplied = dryExec.hfSentimentGate.applied;
  const tightenCount = dryExec.hfSentimentGate.tightenCount;
  const sizeReduceEnabled = dryExec.hfSentimentGate.sizeReductionEnabled;
  const sizeReducedCount = dryExec.hfSentimentGate.sizeReducedCount;
  const savedNotional = dryExec.hfSentimentGate.sizeReductionNotionalTotal;
  const forced = hfPayloadProbe.active && hfPayloadProbe.modified;

  if (payloadCount > 0) {
    if (!dryExec.hfSentimentGate.enabled) {
      return {
        status: "PENDING_HF_DISABLED",
        reason: "hf_disabled",
        payloadCount,
        hfApplied,
        tightenCount,
        sizeReduceEnabled,
        sizeReducedCount,
        savedNotional,
        forced
      };
    }
    if (hfApplied <= 0) {
      return {
        status: "PENDING_NO_HF_ADJUST",
        reason: `explain:${dryExec.hfSentimentGate.explainLine || "no_adjust"}`,
        payloadCount,
        hfApplied,
        tightenCount,
        sizeReduceEnabled,
        sizeReducedCount,
        savedNotional,
        forced
      };
    }
    if (tightenCount > 0 && sizeReduceEnabled && sizeReducedCount <= 0) {
      return {
        status: "WARN_SIZE_REDUCE_EXPECTED",
        reason: "tighten_without_size_reduce",
        payloadCount,
        hfApplied,
        tightenCount,
        sizeReduceEnabled,
        sizeReducedCount,
        savedNotional,
        forced
      };
    }
    if (sizeReduceEnabled && sizeReducedCount > 0) {
      return {
        status: "PASS_SIZE_REDUCED",
        reason: "tighten_and_size_reduce_observed",
        payloadCount,
        hfApplied,
        tightenCount,
        sizeReduceEnabled,
        sizeReducedCount,
        savedNotional,
        forced
      };
    }
    return {
      status: "PASS_HF_APPLIED",
      reason: sizeReduceEnabled ? "applied_without_tighten" : "size_reduce_disabled",
      payloadCount,
      hfApplied,
      tightenCount,
      sizeReduceEnabled,
      sizeReducedCount,
      savedNotional,
      forced
    };
  }

  if (forced && hfPayloadProbe.baseApplied > 0) {
    if (sizeReduceEnabled && hfPayloadProbe.baseSizeReduced > 0) {
      return {
        status: "PASS_FORCED_SIZE_REDUCED",
        reason: "forced_tighten_and_size_reduce_observed",
        payloadCount,
        hfApplied,
        tightenCount,
        sizeReduceEnabled,
        sizeReducedCount,
        savedNotional,
        forced
      };
    }
    return {
      status: "PASS_FORCED_PATH",
      reason: "forced_hf_path_observed",
      payloadCount,
      hfApplied,
      tightenCount,
      sizeReduceEnabled,
      sizeReducedCount,
      savedNotional,
      forced
    };
  }

  return {
    status: "PENDING_NO_PAYLOAD",
    reason: "no_payload",
    payloadCount,
    hfApplied,
    tightenCount,
    sizeReduceEnabled,
    sizeReducedCount,
    savedNotional,
    forced
  };
}

function buildHfPayloadProbeGateSummaryForRun(summary: HfPayloadProbeGateSummary | null): string {
  if (!summary) return "n/a";
  return [
    `status:${summary.status}`,
    `reason:${summary.reason}`,
    `payloads:${summary.payloadCount}`,
    `hfApplied:${summary.hfApplied}`,
    `tighten:${summary.tightenCount}`,
    `sizeReduceEnabled:${summary.sizeReduceEnabled}`,
    `sizeReduced:${summary.sizeReducedCount}`,
    `savedNotional:${summary.savedNotional.toFixed(2)}`,
    `forced:${summary.forced}`
  ].join("|");
}

function buildHfFreezeSummaryForRun(freeze: HfFreezeSummary | null): string {
  if (!freeze) return "n/a";
  return [
    `enabled:${freeze.enabled}`,
    `status:${freeze.status}`,
    `reason:${freeze.reason}`,
    `rec:${freeze.recommendation}`,
    `progress:${freeze.observedTrades}/${freeze.requiredProgress}`,
    `stable:${freeze.stableRunStreak}/${freeze.stableRunsTarget}`,
    `alert:${freeze.alertStreak}/${freeze.alertStreakThreshold}`,
    `shadowRate:${freeze.shadowAlertRate.toFixed(4)}`,
    `shadowMax:${freeze.maxShadowAlertRate.toFixed(4)}`,
    `hfAlert:${freeze.hfAlertTriggered}`,
    `frozenAt:${freeze.frozenAt ?? "n/a"}`
  ].join("|");
}

function buildHfLivePromotionSummaryForRun(promotion: HfLivePromotionSummary | null): string {
  if (!promotion) return "n/a";
  return [
    `status:${promotion.status}`,
    `reason:${promotion.reason}`,
    `rec:${promotion.recommendation}`,
    `payloadPathSource:${promotion.payloadPathSource}`,
    `payloadPathVerifiedAt:${promotion.payloadPathVerifiedAt ?? "n/a"}`,
    `required:${promotion.requiredPass}/${promotion.requiredTotal}`,
    `requiredMissing:${promotion.requiredMissing.length ? promotion.requiredMissing.join(",") : "none"}`,
    `requiredHint:${promotion.requiredHintToken}`,
    `pass:${promotion.checklistPass}/${promotion.checklistTotal}`,
    `reqPerfGateGo:${promotion.policy.requirePerfGateGo}`,
    `reqFreezeFrozen:${promotion.policy.requireFreezeFrozen}`,
    `reqShadowStable:${promotion.policy.requireShadowStable}`,
    `reqPayloadPathVerified:${promotion.policy.requirePayloadPathVerified}`,
    `perfGateGo:${promotion.checks.perfGateGo}`,
    `freezeFrozen:${promotion.checks.freezeFrozen}`,
    `alertClear:${promotion.checks.alertClear}`,
    `shadowStable:${promotion.checks.shadowStable}`,
    `payloadPathVerified:${promotion.checks.payloadPathVerified}`,
    `probeActive:${promotion.checks.probeActive}`,
    `probeMode:${promotion.checks.probeMode}`
  ].join("|");
}

function buildHfNextActionSummaryForRun(nextAction: HfNextActionSummary | null): string {
  if (!nextAction) return "n/a";
  return [
    `status:${nextAction.status}`,
    `action:${nextAction.action}`,
    `reason:${nextAction.reason}`,
    `hint:${nextAction.hint || "none"}`,
    `requiredMissing:${nextAction.requiredMissing.length ? nextAction.requiredMissing.join(",") : "none"}`,
    `livePromotion:${nextAction.livePromotionStatus}`,
    `gate:${nextAction.gateStatus}`,
    `progress:${nextAction.gateProgress}`,
    `remaining:${nextAction.gateRemainingTrades}`
  ].join("|");
}

function buildHfDailyVerdictSummaryForRun(verdict: HfDailyVerdictSummary | null): string {
  if (!verdict) return "n/a";
  return [
    `status:${verdict.status}`,
    `action:${verdict.action}`,
    `reason:${verdict.reason}`,
    `requiredMissing:${verdict.requiredMissing.length ? verdict.requiredMissing.join(",") : "none"}`,
    `livePromotion:${verdict.livePromotionStatus}`,
    `gate:${verdict.gateStatus}`,
    `progress:${verdict.gateProgress}`,
    `remaining:${verdict.gateRemainingTrades}`
  ].join("|");
}

function buildHfPayloadPathStickySummaryForRun(audit: HfPayloadPathStickyAudit | null): string {
  if (!audit) return "n/a";
  return [
    `priorStage6Hash:${audit.priorStage6Hash ? audit.priorStage6Hash.slice(0, 12) : "none"}`,
    `stage6HashChanged:${audit.stage6HashChanged}`,
    `stickyEligible:${audit.stickyEligible}`,
    `stickyCarried:${audit.stickyCarried}`,
    `stickyReset:${audit.stickyReset}`,
    `stickyResetReason:${audit.stickyResetReason}`,
    `currentVerified:${audit.currentVerified}`,
    `currentSource:${audit.currentSource}`,
    `resolvedVerified:${audit.resolvedVerified}`,
    `resolvedSource:${audit.resolvedSource}`
  ].join("|");
}

function buildHfEvidenceSummaryForRun(summary: HfEvidenceHistorySummary | null): string {
  if (!summary) return "n/a";
  return [
    `history:${summary.historySize}`,
    `latestAt:${summary.latestAt ?? "n/a"}`,
    `latestStage6Hash:${summary.latestStage6Hash ? summary.latestStage6Hash.slice(0, 12) : "none"}`,
    `latestLive:${summary.latestLivePromotionStatus}`,
    `latestProbe:${summary.latestPayloadProbeStatus}`,
    `latestAlert:${summary.latestAlertTriggered}`,
    `latestGate:${summary.latestGateProgress}`,
    `window:${summary.recentWindowSize}`,
    `pass:${summary.recentPassCount}`,
    `hold:${summary.recentHoldCount}`,
    `block:${summary.recentBlockCount}`,
    `alerts:${summary.recentAlertCount}`
  ].join("|");
}

function buildHfAlertSummaryForRun(alert: HfAnomalyAlert | null): string {
  if (!alert) return "n/a";
  return [
    `enabled:${alert.enabled}`,
    `triggered:${alert.triggered}`,
    `reason:${alert.reason}`,
    `shadowCompared:${alert.shadowCompared}`,
    `shadowPayloadDelta:${alert.shadowPayloadDelta}`,
    `shadowNotionalDelta:${alert.shadowNotionalDelta.toFixed(2)}`,
    `shadowSkippedDelta:${alert.shadowSkippedDelta}`,
    `driftTriggered:${alert.driftTriggered}`
  ].join("|");
}

function loadHfLivePromotionPolicy(): HfLivePromotionPolicy {
  return {
    requirePerfGateGo: readBoolEnv("HF_LIVE_PROMOTION_REQUIRE_PERF_GATE_GO", true),
    requireFreezeFrozen: readBoolEnv("HF_LIVE_PROMOTION_REQUIRE_FREEZE_FROZEN", true),
    requireShadowStable: readBoolEnv("HF_LIVE_PROMOTION_REQUIRE_SHADOW_STABLE", true),
    requirePayloadPathVerified: readBoolEnv("HF_LIVE_PROMOTION_REQUIRE_PAYLOAD_PATH_VERIFIED", true)
  };
}

function describeHfLivePromotionRequiredMissing(requiredMissing: string[]): {
  token: string;
  text: string;
} {
  return describeHfLivePromotionRequiredMissingCore(requiredMissing);
}

function deriveHfLivePromotionSummary(
  perfLoop: PerformanceLoopUpdateResult,
  hfFreeze: HfFreezeSummary,
  hfAlert: HfAnomalyAlert | null,
  hfShadowTrend: HfShadowTrendSummary | null,
  hfPayloadProbe: HfPayloadProbeSummary,
  payloadPath: {
    payloadPathVerified: boolean;
    payloadPathSource: "none" | "current_live" | "current_probe" | "sticky";
    payloadPathVerifiedAt: string | null;
  }
): HfLivePromotionSummary {
  const policy = loadHfLivePromotionPolicy();
  return deriveHfLivePromotionSummaryCore({
    perfGate: {
      status: perfLoop.gate.status,
      reason: perfLoop.gate.reason
    },
    freeze: {
      enabled: hfFreeze.enabled,
      status: hfFreeze.status,
      reason: hfFreeze.reason,
      maxShadowAlertRate: hfFreeze.maxShadowAlertRate
    },
    alert: hfAlert
      ? {
          triggered: hfAlert.triggered,
          reason: hfAlert.reason
        }
      : null,
    shadowTrend: hfShadowTrend
      ? {
          comparedRuns: hfShadowTrend.comparedRuns,
          alertTriggeredRate: hfShadowTrend.alertTriggeredRate
        }
      : null,
    payloadProbe: {
      active: hfPayloadProbe.active,
      requestedMode: hfPayloadProbe.requestedMode
    },
    payloadPath: {
      payloadPathVerified: payloadPath.payloadPathVerified,
      payloadPathSource: payloadPath.payloadPathSource,
      payloadPathVerifiedAt: payloadPath.payloadPathVerifiedAt
    },
    policy
  });
}

function deriveHfNextActionSummary(
  hfLivePromotion: HfLivePromotionSummary,
  hfTuningPhase: HfTuningPhaseSummary,
  hfTuningAdvice: HfTuningAdvice,
  hfFreeze: HfFreezeSummary,
  hfAlert: HfAnomalyAlert
): HfNextActionSummary {
  const requiredMissing = hfLivePromotion.requiredMissing;
  let status: HfNextActionStatus = "MONITOR";
  let action = "monitor";
  let reason = "stable";
  let hint = "none";

  if (hfAlert.triggered) {
    status = "BLOCK_ALERT";
    action = "resolve_hf_alert_first";
    reason = hfAlert.reason || "hf_alert_triggered";
    hint = "clear alert and re-check shadow/drift deltas";
  } else if (hfLivePromotion.status === "BLOCK") {
    status = "BLOCK_PROMOTION";
    action = "resolve_live_promotion_blocker";
    reason = hfLivePromotion.reason;
    hint = hfLivePromotion.requiredHintText || hfLivePromotion.recommendation;
  } else if (hfTuningPhase.phase === "OBSERVE_ONLY") {
    status = "HOLD_OBSERVE";
    action = "accumulate_more_runs";
    reason = hfTuningPhase.reason;
    hint = hfTuningPhase.recommendation;
  } else if (requiredMissing.length > 0) {
    status = "HOLD_CHECKLIST";
    action = "complete_required_live_checks";
    reason = `required_missing(${requiredMissing.join(",")})`;
    hint = hfLivePromotion.requiredHintText || "complete remaining required checks";
  } else if (hfFreeze.status === "UNFREEZE_REVIEW") {
    status = "REVIEW_TUNE";
    action = "review_unfreeze_thresholds";
    reason = hfFreeze.reason;
    hint = hfFreeze.recommendation;
  } else if (hfTuningAdvice.status === "ADJUST") {
    status = "REVIEW_TUNE";
    action = hfTuningAdvice.action;
    reason = hfTuningAdvice.reason;
    hint =
      hfTuningAdvice.variable && hfTuningAdvice.suggestedValue != null
        ? `${hfTuningAdvice.variable} -> ${hfTuningAdvice.suggestedValue.toFixed(4)}`
        : "apply one small threshold adjustment";
  } else if (hfLivePromotion.status === "PASS") {
    status = "LIVE_READY";
    action = "review_and_promote_live";
    reason = hfLivePromotion.reason;
    hint = hfLivePromotion.recommendation;
  }

  return {
    status,
    action,
    reason,
    hint,
    requiredMissing,
    livePromotionStatus: hfLivePromotion.status,
    gateStatus: hfTuningPhase.gateStatus,
    gateProgress: hfTuningPhase.gateProgress,
    gateRemainingTrades: hfTuningPhase.gateRemainingTrades,
    generatedAt: new Date().toISOString()
  };
}

function deriveHfDailyVerdictSummary(
  hfLivePromotion: HfLivePromotionSummary,
  hfNextAction: HfNextActionSummary,
  hfAlert: HfAnomalyAlert,
  hfTuningPhase: HfTuningPhaseSummary
): HfDailyVerdictSummary {
  const requiredMissing = hfLivePromotion.requiredMissing;
  if (hfAlert.triggered || hfLivePromotion.status === "BLOCK" || hfNextAction.status.startsWith("BLOCK_")) {
    return {
      status: "BLOCK",
      action: "resolve_blocker",
      reason: hfAlert.triggered ? `hf_alert(${hfAlert.reason})` : hfLivePromotion.reason,
      requiredMissing,
      livePromotionStatus: hfLivePromotion.status,
      gateStatus: hfTuningPhase.gateStatus,
      gateProgress: hfTuningPhase.gateProgress,
      gateRemainingTrades: hfTuningPhase.gateRemainingTrades,
      generatedAt: new Date().toISOString()
    };
  }
  if (hfLivePromotion.status === "PASS" && hfNextAction.status === "LIVE_READY") {
    return {
      status: "PASS",
      action: "promotion_review_ready",
      reason: "all_required_checks_passed",
      requiredMissing,
      livePromotionStatus: hfLivePromotion.status,
      gateStatus: hfTuningPhase.gateStatus,
      gateProgress: hfTuningPhase.gateProgress,
      gateRemainingTrades: hfTuningPhase.gateRemainingTrades,
      generatedAt: new Date().toISOString()
    };
  }
  return {
    status: "HOLD",
    action: hfNextAction.action,
    reason: hfNextAction.reason,
    requiredMissing,
    livePromotionStatus: hfLivePromotion.status,
    gateStatus: hfTuningPhase.gateStatus,
    gateProgress: hfTuningPhase.gateProgress,
    gateRemainingTrades: hfTuningPhase.gateRemainingTrades,
    generatedAt: new Date().toISOString()
  };
}

function deriveHfTuningPhase(
  perfLoop: PerformanceLoopUpdateResult,
  hfAlert: HfAnomalyAlert | null,
  hfShadowTrend: HfShadowTrendSummary | null
): HfTuningPhaseSummary {
  return deriveHfTuningPhaseCore({
    perfGate: {
      status: perfLoop.gate.status,
      progress: perfLoop.gate.progress
    },
    tradeCount: perfLoop.tradeCount,
    alert: hfAlert
      ? {
          triggered: hfAlert.triggered,
          reason: hfAlert.reason
        }
      : null,
    shadowTrend: hfShadowTrend
      ? {
          alertTriggeredRate: hfShadowTrend.alertTriggeredRate
        }
      : null,
    requiredTrades: PERFORMANCE_LOOP_REQUIRED_TRADES
  });
}

function deriveHfTuningAdvice(
  tuningPhase: HfTuningPhaseSummary,
  dryExec: DryExecBuildResult
): HfTuningAdvice {
  return deriveHfTuningAdviceCore({
    tuningPhase: {
      phase: tuningPhase.phase,
      reason: tuningPhase.reason
    },
    hfSentimentGate: {
      explainLine: dryExec.hfSentimentGate.explainLine,
      scoreFloor: dryExec.hfSentimentGate.scoreFloor,
      minArticleCount: dryExec.hfSentimentGate.minArticleCount,
      maxNewsAgeHours: dryExec.hfSentimentGate.maxNewsAgeHours
    }
  });
}

function buildHfSoftGateExplainLine(
  policy: HfSoftGatePolicy,
  checkedCandidates: number,
  stats: {
    statusNotOk: number;
    unsupportedLabel: number;
    lowScore: number;
    lowArticleCount: number;
    staleNews: number;
    earningsWindowBlocked: number;
  },
  gate: {
    applied: number;
    reliefCount: number;
    tightenCount: number;
    netMinConvictionDelta: number;
    blockedNegative: number;
  }
): string {
  if (!policy.enabled) return "hf_off";
  const blockers: Array<{ key: string; count: number }> = [
    { key: "status", count: stats.statusNotOk },
    { key: "neutral", count: stats.unsupportedLabel },
    { key: "score", count: stats.lowScore },
    { key: "articles", count: stats.lowArticleCount },
    { key: "stale", count: stats.staleNews },
    { key: "earnings_block", count: stats.earningsWindowBlocked }
  ].filter((item) => item.count > 0);
  const blockerSummary =
    blockers.length > 0
      ? blockers
          .sort((a, b) => b.count - a.count)
          .slice(0, 3)
          .map((item) => `${item.key}:${item.count}`)
          .join(",")
      : "none";

  if (gate.applied <= 0) {
    return `checked=${checkedCandidates} no_adjustment blockers=${blockerSummary}`;
  }
  return `checked=${checkedCandidates} applied=${gate.applied}(tighten=${gate.tightenCount},relief=${gate.reliefCount}) netDelta=${gate.netMinConvictionDelta} blockedNeg=${gate.blockedNegative} blockers=${blockerSummary}`;
}

function evaluateHfAnomalyAlert(hfShadow: HfShadowSummary, hfDrift: HfDriftAlert): HfAnomalyAlert {
  const enabled = readBoolEnv("HF_ALERT_ENABLED", true);
  const shadowPayloadDeltaAbs = Math.max(1, Math.round(readNonNegativeNumberEnv("HF_ALERT_SHADOW_PAYLOAD_DELTA_ABS", 2)));
  const shadowNotionalDeltaAbs = clamp(readNonNegativeNumberEnv("HF_ALERT_SHADOW_NOTIONAL_DELTA_ABS", 1000), 0, 1000000);
  const shadowSkippedDeltaAbs = Math.max(1, Math.round(readNonNegativeNumberEnv("HF_ALERT_SHADOW_SKIPPED_DELTA_ABS", 2)));
  if (!enabled) {
    const disabled: HfAnomalyAlert = {
      enabled,
      triggered: false,
      reason: "disabled",
      shadowCompared: hfShadow.compared,
      shadowPayloadDelta: hfShadow.payloadDelta,
      shadowNotionalDelta: hfShadow.notionalDelta,
      shadowSkippedDelta: hfShadow.skippedDelta,
      driftTriggered: hfDrift.triggered,
      thresholds: { shadowPayloadDeltaAbs, shadowNotionalDeltaAbs, shadowSkippedDeltaAbs }
    };
    console.log(
      `[HF_ALERT] enabled=false triggered=false reason=disabled shadowCompared=${disabled.shadowCompared} shadowPayloadDelta=${disabled.shadowPayloadDelta} shadowNotionalDelta=${disabled.shadowNotionalDelta.toFixed(2)} shadowSkippedDelta=${disabled.shadowSkippedDelta} driftTriggered=${disabled.driftTriggered}`
    );
    return disabled;
  }

  const reasons: string[] = [];
  if (hfDrift.triggered) reasons.push(`drift:${hfDrift.reason}`);
  if (hfShadow.enabled && hfShadow.compared) {
    if (Math.abs(hfShadow.payloadDelta) >= shadowPayloadDeltaAbs) {
      reasons.push(`shadow_payload_delta_abs>=${shadowPayloadDeltaAbs}`);
    }
    if (Math.abs(hfShadow.notionalDelta) >= shadowNotionalDeltaAbs) {
      reasons.push(`shadow_notional_delta_abs>=${shadowNotionalDeltaAbs}`);
    }
    if (Math.abs(hfShadow.skippedDelta) >= shadowSkippedDeltaAbs) {
      reasons.push(`shadow_skipped_delta_abs>=${shadowSkippedDeltaAbs}`);
    }
  }

  const alert: HfAnomalyAlert = {
    enabled,
    triggered: reasons.length > 0,
    reason: reasons.length > 0 ? reasons.join("|") : "none",
    shadowCompared: hfShadow.compared,
    shadowPayloadDelta: hfShadow.payloadDelta,
    shadowNotionalDelta: hfShadow.notionalDelta,
    shadowSkippedDelta: hfShadow.skippedDelta,
    driftTriggered: hfDrift.triggered,
    thresholds: { shadowPayloadDeltaAbs, shadowNotionalDeltaAbs, shadowSkippedDeltaAbs }
  };
  const logPrefix = alert.triggered ? "WARN" : "INFO";
  console.log(
    `[HF_ALERT] level=${logPrefix} enabled=true triggered=${alert.triggered} reason=${alert.reason} shadowCompared=${alert.shadowCompared} shadowPayloadDelta=${alert.shadowPayloadDelta} shadowNotionalDelta=${alert.shadowNotionalDelta.toFixed(2)} shadowSkippedDelta=${alert.shadowSkippedDelta} driftTriggered=${alert.driftTriggered} thresholds=payload:${shadowPayloadDeltaAbs},notional:${shadowNotionalDeltaAbs},skipped:${shadowSkippedDeltaAbs}`
  );
  return alert;
}

function parseHfShadowHistoryLine(line: string): HfShadowHistoryRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = parseJsonText<HfShadowHistoryRecord>(trimmed, "hf_shadow_history_line");
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.at !== "string" || typeof parsed.stage6Hash !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseHfEvidenceHistoryLine(line: string): HfEvidenceHistoryRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = parseJsonText<Partial<HfEvidenceHistoryRecord>>(trimmed, "hf_evidence_history_line");
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.at !== "string" || typeof parsed.stage6Hash !== "string") return null;
    if (typeof parsed.stage6File !== "string" || typeof parsed.profile !== "string") return null;
    if (typeof parsed.hfLivePromotionStatus !== "string") return null;
    if (typeof parsed.hfPayloadProbeStatus !== "string") return null;
    return parsed as HfEvidenceHistoryRecord;
  } catch {
    return null;
  }
}

async function loadHfEvidenceHistory(): Promise<HfEvidenceHistoryRecord[]> {
  try {
    const raw = await readFile(HF_EVIDENCE_HISTORY_PATH, "utf8");
    return raw
      .split("\n")
      .map((line) => parseHfEvidenceHistoryLine(line))
      .filter((row): row is HfEvidenceHistoryRecord => row != null);
  } catch {
    return [];
  }
}

function computeHfEvidenceHistorySummary(
  records: HfEvidenceHistoryRecord[],
  windowSize = HF_EVIDENCE_HISTORY_WINDOW
): HfEvidenceHistorySummary {
  const latest = records.length > 0 ? records[records.length - 1] : null;
  const window = records.slice(-Math.max(1, windowSize));
  const recentPassCount = window.filter((row) => row.hfLivePromotionStatus === "PASS").length;
  const recentHoldCount = window.filter((row) => row.hfLivePromotionStatus === "HOLD").length;
  const recentBlockCount = window.filter((row) => row.hfLivePromotionStatus === "BLOCK").length;
  const recentAlertCount = window.filter((row) => row.hfAlertTriggered).length;

  return {
    historySize: records.length,
    latestAt: latest?.at ?? null,
    latestStage6Hash: latest?.stage6Hash ?? null,
    latestLivePromotionStatus: latest?.hfLivePromotionStatus ?? "N/A",
    latestPayloadProbeStatus: latest?.hfPayloadProbeStatus ?? "N/A",
    latestAlertTriggered: latest?.hfAlertTriggered ?? false,
    latestGateProgress: latest?.perfGateProgress ?? "N/A",
    recentWindowSize: window.length,
    recentPassCount,
    recentHoldCount,
    recentBlockCount,
    recentAlertCount
  };
}

async function appendHfEvidenceHistory(
  record: HfEvidenceHistoryRecord
): Promise<HfEvidenceHistorySummary> {
  await mkdir("state", { recursive: true });
  const history = await loadHfEvidenceHistory();
  history.push(record);
  const trimmed = history.slice(-HF_EVIDENCE_HISTORY_MAX_ROWS);
  const jsonl = trimmed.map((row) => JSON.stringify(row)).join("\n");
  await writeFile(HF_EVIDENCE_HISTORY_PATH, `${jsonl}\n`, "utf8");
  console.log(`[STATE] saved ${HF_EVIDENCE_HISTORY_PATH} rows=${trimmed.length}`);
  const summary = computeHfEvidenceHistorySummary(trimmed, HF_EVIDENCE_HISTORY_WINDOW);
  console.log(
    `[HF_EVIDENCE] history=${summary.historySize} latestAt=${summary.latestAt ?? "N/A"} latestStage6Hash=${summary.latestStage6Hash ? summary.latestStage6Hash.slice(0, 12) : "none"} latestLive=${summary.latestLivePromotionStatus} latestProbe=${summary.latestPayloadProbeStatus} latestAlert=${summary.latestAlertTriggered} latestGate=${summary.latestGateProgress} window=${summary.recentWindowSize} pass=${summary.recentPassCount} hold=${summary.recentHoldCount} block=${summary.recentBlockCount} alerts=${summary.recentAlertCount}`
  );
  return summary;
}

async function loadHfShadowHistory(): Promise<HfShadowHistoryRecord[]> {
  try {
    const raw = await readFile(HF_SHADOW_HISTORY_PATH, "utf8");
    return raw
      .split("\n")
      .map((line) => parseHfShadowHistoryLine(line))
      .filter((row): row is HfShadowHistoryRecord => row != null);
  } catch {
    return [];
  }
}

function computeHfShadowTrendSummary(
  records: HfShadowHistoryRecord[],
  windowSize = HF_SHADOW_HISTORY_WINDOW
): HfShadowTrendSummary {
  const window = records.slice(-Math.max(1, windowSize));
  const compared = window.filter((row) => row.hfShadowCompared);
  const comparedCount = compared.length;
  const alertTriggeredRuns = compared.filter((row) => row.hfAlertTriggered).length;
  const avgAbsPayloadDelta =
    comparedCount > 0
      ? Number(
          (
            compared.reduce((acc, row) => acc + Math.abs(row.hfShadowPayloadDelta), 0) / comparedCount
          ).toFixed(2)
        )
      : 0;
  const avgAbsNotionalDelta =
    comparedCount > 0
      ? Number(
          (
            compared.reduce((acc, row) => acc + Math.abs(row.hfShadowNotionalDelta), 0) / comparedCount
          ).toFixed(2)
        )
      : 0;
  const avgAbsSkippedDelta =
    comparedCount > 0
      ? Number(
          (
            compared.reduce((acc, row) => acc + Math.abs(row.hfShadowSkippedDelta), 0) / comparedCount
          ).toFixed(2)
        )
      : 0;
  const zeroPayloadRuns = window.filter((row) => row.payloadCount === 0).length;
  const alertTriggeredRate =
    comparedCount > 0 ? Number((alertTriggeredRuns / comparedCount).toFixed(4)) : 0;
  const zeroPayloadRate =
    window.length > 0 ? Number((zeroPayloadRuns / window.length).toFixed(4)) : 0;

  return {
    historySize: records.length,
    windowSize: window.length,
    comparedRuns: comparedCount,
    alertTriggeredRuns,
    alertTriggeredRate,
    avgAbsPayloadDelta,
    avgAbsNotionalDelta,
    avgAbsSkippedDelta,
    zeroPayloadRate,
    latestAt: window.length > 0 ? window[window.length - 1].at : null
  };
}

async function appendHfShadowHistory(
  record: HfShadowHistoryRecord
): Promise<HfShadowTrendSummary> {
  await mkdir("state", { recursive: true });
  const history = await loadHfShadowHistory();
  history.push(record);
  const trimmed = history.slice(-HF_SHADOW_HISTORY_MAX_ROWS);
  const jsonl = trimmed.map((row) => JSON.stringify(row)).join("\n");
  await writeFile(HF_SHADOW_HISTORY_PATH, `${jsonl}\n`, "utf8");
  console.log(`[STATE] saved ${HF_SHADOW_HISTORY_PATH} rows=${trimmed.length}`);
  const trend = computeHfShadowTrendSummary(trimmed, HF_SHADOW_HISTORY_WINDOW);
  console.log(
    `[HF_SHADOW_TREND] history=${trend.historySize} window=${trend.windowSize} compared=${trend.comparedRuns} alertTriggered=${trend.alertTriggeredRuns} alertRate=${trend.alertTriggeredRate.toFixed(4)} avgAbsPayloadDelta=${trend.avgAbsPayloadDelta.toFixed(2)} avgAbsNotionalDelta=${trend.avgAbsNotionalDelta.toFixed(2)} avgAbsSkippedDelta=${trend.avgAbsSkippedDelta.toFixed(2)} zeroPayloadRate=${trend.zeroPayloadRate.toFixed(4)} latest=${trend.latestAt ?? "N/A"}`
  );
  return trend;
}

async function saveHfShadowSummary(summary: HfShadowSummary): Promise<void> {
  await mkdir("state", { recursive: true });
  await writeFile(HF_SHADOW_STATE_PATH, JSON.stringify(summary, null, 2), "utf8");
  console.log(`[STATE] saved ${HF_SHADOW_STATE_PATH}`);
}

function computeHfShadowSummary(
  actionable: Stage6CandidateSummary[],
  stage6Hash: string,
  regime: RegimeSelection,
  guardControl: GuardControlGate,
  onDryExec: DryExecBuildResult
): HfShadowSummary {
  const enabled = readBoolEnv("HF_SHADOW_ENABLED", false);
  if (!enabled) {
    const summary: HfShadowSummary = {
      enabled,
      compared: false,
      reason: "disabled",
      onPayloadCount: onDryExec.payloads.length,
      offPayloadCount: onDryExec.payloads.length,
      payloadDelta: 0,
      onSkippedCount: onDryExec.skipped.length,
      offSkippedCount: onDryExec.skipped.length,
      skippedDelta: 0,
      onNotional: roundToCent(sumNotional(onDryExec.payloads)),
      offNotional: roundToCent(sumNotional(onDryExec.payloads)),
      notionalDelta: 0,
      onOnlySymbols: [],
      offOnlySymbols: [],
      skipReasonDelta: "none",
      generatedAt: new Date().toISOString()
    };
    console.log(
      `[HF_SHADOW] enabled=false compared=false reason=disabled onPayloads=${summary.onPayloadCount} offPayloads=${summary.offPayloadCount} payloadDelta=${summary.payloadDelta} onSkipped=${summary.onSkippedCount} offSkipped=${summary.offSkippedCount} skippedDelta=${summary.skippedDelta} onNotional=${summary.onNotional.toFixed(2)} offNotional=${summary.offNotional.toFixed(2)} notionalDelta=${summary.notionalDelta.toFixed(2)} onOnly=none offOnly=none skipReasonDelta=none`
    );
    return summary;
  }

  const offDryExecBase = buildDryExecPayloads(actionable, stage6Hash, regime, {
    hfSoftGateEnabled: false,
    hfNegativeSizeReductionEnabled: false
  });
  const offDryExecAfterRegime = applyEntryGuardToDryExec(offDryExecBase, regime);
  const offDryExec = applyGuardControlGateToDryExec(offDryExecAfterRegime, guardControl);
  const onSymbols = new Set(onDryExec.payloads.map((row) => row.symbol));
  const offSymbols = new Set(offDryExec.payloads.map((row) => row.symbol));
  const onOnlySymbols = [...onSymbols].filter((symbol) => !offSymbols.has(symbol)).sort((a, b) => a.localeCompare(b));
  const offOnlySymbols = [...offSymbols].filter((symbol) => !onSymbols.has(symbol)).sort((a, b) => a.localeCompare(b));
  const onNotional = roundToCent(sumNotional(onDryExec.payloads));
  const offNotional = roundToCent(sumNotional(offDryExec.payloads));
  const summary: HfShadowSummary = {
    enabled,
    compared: true,
    reason: "ok",
    onPayloadCount: onDryExec.payloads.length,
    offPayloadCount: offDryExec.payloads.length,
    payloadDelta: onDryExec.payloads.length - offDryExec.payloads.length,
    onSkippedCount: onDryExec.skipped.length,
    offSkippedCount: offDryExec.skipped.length,
    skippedDelta: onDryExec.skipped.length - offDryExec.skipped.length,
    onNotional,
    offNotional,
    notionalDelta: roundToCent(onNotional - offNotional),
    onOnlySymbols,
    offOnlySymbols,
    skipReasonDelta: buildSkipReasonDelta(onDryExec.skipReasonCounts, offDryExec.skipReasonCounts),
    generatedAt: new Date().toISOString()
  };

  console.log(
    `[HF_SHADOW] enabled=true compared=true reason=ok onPayloads=${summary.onPayloadCount} offPayloads=${summary.offPayloadCount} payloadDelta=${summary.payloadDelta} onSkipped=${summary.onSkippedCount} offSkipped=${summary.offSkippedCount} skippedDelta=${summary.skippedDelta} onNotional=${summary.onNotional.toFixed(2)} offNotional=${summary.offNotional.toFixed(2)} notionalDelta=${summary.notionalDelta.toFixed(2)} onOnly=${summarizeSymbols(summary.onOnlySymbols)} offOnly=${summarizeSymbols(summary.offOnlySymbols)} skipReasonDelta=${summary.skipReasonDelta}`
  );
  return summary;
}

function buildHfShadowHistoryRecord(
  stage6: Stage6LoadResult,
  dryExec: DryExecBuildResult,
  hfShadow: HfShadowSummary,
  hfAlert: HfAnomalyAlert,
  perfLoop: PerformanceLoopUpdateResult
): HfShadowHistoryRecord {
  return {
    at: new Date().toISOString(),
    stage6Hash: stage6.sha256,
    stage6File: stage6.fileName,
    profile: dryExec.regime.profile,
    regimeSource: dryExec.regime.source,
    vix: dryExec.regime.vix,
    payloadCount: dryExec.payloads.length,
    skippedCount: dryExec.skipped.length,
    hfSoftEnabled: dryExec.hfSentimentGate.enabled,
    hfSoftApplied: dryExec.hfSentimentGate.applied,
    hfSoftNetDelta: dryExec.hfSentimentGate.netMinConvictionDelta,
    hfSoftExplain: dryExec.hfSentimentGate.explainLine,
    hfShadowEnabled: hfShadow.enabled,
    hfShadowCompared: hfShadow.compared,
    hfShadowPayloadDelta: hfShadow.payloadDelta,
    hfShadowNotionalDelta: hfShadow.notionalDelta,
    hfShadowSkippedDelta: hfShadow.skippedDelta,
    hfAlertEnabled: hfAlert.enabled,
    hfAlertTriggered: hfAlert.triggered,
    hfAlertReason: hfAlert.reason,
    perfGateStatus: perfLoop.gate.status,
    perfGateProgress: perfLoop.gate.progress
  };
}

function buildHfEvidenceHistoryRecord(
  stage6: Stage6LoadResult,
  dryExec: DryExecBuildResult,
  hfLivePromotion: HfLivePromotionSummary,
  hfPayloadProbeStatus: HfPayloadProbeGateSummary,
  hfAlert: HfAnomalyAlert,
  perfLoop: PerformanceLoopUpdateResult
): HfEvidenceHistoryRecord {
  return {
    at: new Date().toISOString(),
    stage6Hash: stage6.sha256,
    stage6File: stage6.fileName,
    profile: dryExec.regime.profile,
    payloadCount: dryExec.payloads.length,
    skippedCount: dryExec.skipped.length,
    hfLivePromotionStatus: hfLivePromotion.status,
    hfLivePromotionReason: hfLivePromotion.reason,
    hfLivePromotionRequiredMissing: hfLivePromotion.requiredMissing,
    hfPayloadProbeStatus: hfPayloadProbeStatus.status,
    hfPayloadProbeReason: hfPayloadProbeStatus.reason,
    hfAlertTriggered: hfAlert.triggered,
    hfAlertReason: hfAlert.reason,
    perfGateStatus: perfLoop.gate.status,
    perfGateProgress: perfLoop.gate.progress,
    perfGateRemainingTrades: perfLoop.gate.remainingTrades
  };
}

async function loadRunState(): Promise<SidecarRunState | null> {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    const parsed = parseJsonText<SidecarRunState>(raw, "sidecar_run_state");
    if (!parsed?.lastStage6Sha256) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function saveRunState(
  result: Stage6LoadResult,
  mode: string,
  previous: SidecarRunState | null,
  consumedForceSendKey?: string
): Promise<void> {
  await mkdir("state", { recursive: true });
  const nextState: SidecarRunState = {
    lastStage6Sha256: result.sha256,
    lastStage6FileId: result.fileId,
    lastStage6FileName: result.fileName,
    lastMode: mode,
    lastSentAt: new Date().toISOString(),
    lastForceSendKey: consumedForceSendKey ?? previous?.lastForceSendKey ?? ""
  };
  await writeFile(STATE_PATH, JSON.stringify(nextState, null, 2), "utf8");
  console.log(`[STATE] saved ${STATE_PATH}`);
}

async function saveDryExecPreview(
  result: Stage6LoadResult,
  dryExec: DryExecBuildResult,
  preflight: PreflightResult,
  ledger: OrderLedgerUpdateResult,
  brokerSubmit: BrokerSubmitSummary,
  hfPayloadProbe: HfPayloadProbeSummary,
  guardControl: GuardControlGate,
  approvalQueueGate: ApprovalQueueGateSummary,
  hfDrift?: HfDriftAlert,
  hfShadow?: HfShadowSummary,
  hfAlert?: HfAnomalyAlert,
  hfShadowTrend?: HfShadowTrendSummary,
  hfTuningPhase?: HfTuningPhaseSummary,
  hfTuningAdvice?: HfTuningAdvice,
  hfFreeze?: HfFreezeSummary,
  hfLivePromotion?: HfLivePromotionSummary,
  hfNextAction?: HfNextActionSummary,
  hfDailyVerdict?: HfDailyVerdictSummary,
  hfPayloadPathSticky?: HfPayloadPathStickyAudit,
  hfEvidenceSummary?: HfEvidenceHistorySummary
): Promise<void> {
  const cfg = loadRuntimeConfig();
  const shadowDataBus = buildShadowDataBusSummary();
  const shadowDataParsing = buildShadowFieldParsingSummary(selectShadowParsingCandidates(result));
  const hfPayloadProbeStatus = deriveHfPayloadProbeGateSummary(dryExec, hfPayloadProbe);
  const stage6ContractReasonCountsPrimary = result.contractContext?.decisionReasonCountsPrimary ?? {};
  const stage6SkipHintCountsPrimary = mapStage6DecisionReasonCountsToSkipCounts(
    stage6ContractReasonCountsPrimary
  );
  await mkdir("state", { recursive: true });
  const preview = {
    stage6File: result.fileName,
    stage6FileId: result.fileId,
    stage6Hash: result.sha256,
    generatedAt: new Date().toISOString(),
    regime: dryExec.regime,
    notionalPerOrder: dryExec.notionalPerOrder,
    maxOrders: dryExec.maxOrders,
    maxTotalNotional: dryExec.maxTotalNotional,
    minConviction: dryExec.minConviction,
    minConvictionPolicy: dryExec.minConvictionPolicy,
    hfSentimentGate: dryExec.hfSentimentGate,
    hfPayloadProbe,
    hfPayloadProbeStatus,
    hfDriftAlert: hfDrift ?? null,
    hfShadow: hfShadow ?? null,
    hfAlert: hfAlert ?? null,
    hfShadowTrend: hfShadowTrend ?? null,
    hfTuningPhase: hfTuningPhase ?? null,
    hfTuningAdvice: hfTuningAdvice ?? null,
    hfFreeze: hfFreeze ?? null,
    hfLivePromotion: hfLivePromotion ?? null,
    hfNextAction: hfNextAction ?? null,
    hfDailyVerdict: hfDailyVerdict ?? null,
    hfPayloadPathSticky: hfPayloadPathSticky ?? null,
    hfEvidenceSummary: hfEvidenceSummary ?? null,
    minStopDistancePct: dryExec.minStopDistancePct,
    maxStopDistancePct: dryExec.maxStopDistancePct,
    stopDistancePolicy: dryExec.stopDistancePolicy,
    entryFeasibility: dryExec.entryFeasibility,
    stage6Contract: dryExec.stage6Contract,
    stage6ContractReasonCountsPrimary,
    stage6SkipHintCountsPrimary,
    idempotency: dryExec.idempotency,
    orderLifecycle: ledger,
    brokerSubmission: brokerSubmit,
    preflight,
    guardControl,
    approvalQueueGate,
    shadowDataBus,
    shadowDataParsing,
    mode: {
      readOnly: cfg.readOnly,
      execEnabled: cfg.execEnabled,
      liveMode: !cfg.readOnly && cfg.execEnabled,
      simulationLiveParity: cfg.simulationLiveParity
    },
    payloadCount: dryExec.payloads.length,
    skippedCount: dryExec.skipped.length,
    skipReasonCounts: dryExec.skipReasonCounts,
    payloads: dryExec.payloads,
    skipped: dryExec.skipped
  };
  await writeFile(DRY_EXEC_PREVIEW_PATH, JSON.stringify(preview, null, 2), "utf8");
  console.log(`[DRY_EXEC] payloads=${dryExec.payloads.length} skipped=${dryExec.skipped.length}`);
  console.log(
    `[SHADOW_PARSE] total=${shadowDataParsing.totalCandidates} av=${shadowDataParsing.alphaVantageParsed} (${shadowDataParsing.alphaVantageCoveragePct.toFixed(1)}%) sec=${shadowDataParsing.secEdgarParsed} (${shadowDataParsing.secEdgarCoveragePct.toFixed(1)}%) avSymbols=${shadowDataParsing.alphaVantageSymbols.slice(0, 3).join(",") || "none"} secSymbols=${shadowDataParsing.secEdgarSymbols.slice(0, 3).join(",") || "none"}`
  );
  console.log(`[SKIP_REASONS] ${formatSkipReasonCounts(dryExec.skipReasonCounts)}`);
  console.log(
    `[APPROVAL_QUEUE] enabled=${approvalQueueGate.enabled} required=${approvalQueueGate.required} enforced=${approvalQueueGate.enforced} previewBypassed=${approvalQueueGate.previewBypassed} queueLoaded=${approvalQueueGate.queueLoaded} total=${approvalQueueGate.total} pending=${approvalQueueGate.pending} approved=${approvalQueueGate.approved} rejected=${approvalQueueGate.rejected} expired=${approvalQueueGate.expired} matchedApproved=${approvalQueueGate.matchedApproved} matchedPending=${approvalQueueGate.matchedPending} createdPending=${approvalQueueGate.createdPending} blocked=${approvalQueueGate.blocked} reason=${approvalQueueGate.reason} blockedSymbols=${summarizeSymbols(approvalQueueGate.blockedSymbols)}`
  );
  console.log(
    `[BROKER_SUBMIT] enabled=${brokerSubmit.enabled} active=${brokerSubmit.active} reason=${brokerSubmit.reason} requirePerfGateGo=${brokerSubmit.requirePerfGateGo} requireHfPass=${brokerSubmit.requireHfLivePromotionPass} perfGate=${brokerSubmit.perfGateStatus} perfReason=${brokerSubmit.perfGateReason} hfLive=${brokerSubmit.hfLivePromotionStatus} hfReason=${brokerSubmit.hfLivePromotionReason} attempted=${brokerSubmit.attempted} submitted=${brokerSubmit.submitted} failed=${brokerSubmit.failed} skipped=${brokerSubmit.skipped}`
  );
  console.log(`[SKIP_DETAILS] ${formatSkipDetails(dryExec.skipped)}`);
  console.log(
    `[STAGE6_CONTRACT] enforce=${dryExec.stage6Contract.enforce} checked=${dryExec.stage6Contract.checked} executable=${dryExec.stage6Contract.executable} watchlist=${dryExec.stage6Contract.watchlist} blocked=${dryExec.stage6Contract.blocked}`
  );
  console.log(
    `[STAGE6_CONTRACT_REASON_PRIMARY] raw=${formatSkipReasonCounts(stage6ContractReasonCountsPrimary)} mapped=${formatSkipReasonCounts(stage6SkipHintCountsPrimary)}`
  );
  console.log(
    `[CONV_POLICY] base=${dryExec.minConvictionPolicy.base} applied=${dryExec.minConvictionPolicy.applied} floor=${dryExec.minConvictionPolicy.floor} ceiling=${dryExec.minConvictionPolicy.ceiling} vix+${dryExec.minConvictionPolicy.marketTighten} quality-${dryExec.minConvictionPolicy.qualityRelief} sampleN=${dryExec.minConvictionPolicy.sampleCount} q${Math.round(dryExec.minConvictionPolicy.sampleQuantileQ * 100)}=${dryExec.minConvictionPolicy.sampleQuantileValue ?? "N/A"} cap=${dryExec.minConvictionPolicy.sampleCap ?? "N/A"}`
  );
  console.log(
    `[HF_SOFT_GATE] enabled=${dryExec.hfSentimentGate.enabled} floor=${dryExec.hfSentimentGate.scoreFloor} minArticles=${dryExec.hfSentimentGate.minArticleCount} maxNewsAgeH=${dryExec.hfSentimentGate.maxNewsAgeHours} earningsWindow=${dryExec.hfSentimentGate.earningsWindowEnabled} blockD=${dryExec.hfSentimentGate.earningsBlockDays} reduceD=${dryExec.hfSentimentGate.earningsReduceDays} reduceFactor=${dryExec.hfSentimentGate.earningsReduceFactor} reliefMax=${dryExec.hfSentimentGate.positiveReliefMax} tightenMax=${dryExec.hfSentimentGate.negativeTightenMax} applied=${dryExec.hfSentimentGate.applied} relief=${dryExec.hfSentimentGate.reliefCount} tighten=${dryExec.hfSentimentGate.tightenCount} blockedNegative=${dryExec.hfSentimentGate.blockedNegative} earningsBlocked=${dryExec.hfSentimentGate.earningsBlocked} earningsReduced=${dryExec.hfSentimentGate.earningsReduced} netConvDelta=${dryExec.hfSentimentGate.netMinConvictionDelta} sizeReduceEnabled=${dryExec.hfSentimentGate.sizeReductionEnabled} sizeReducePct=${dryExec.hfSentimentGate.sizeReductionPct} sizeReduced=${dryExec.hfSentimentGate.sizeReducedCount} sizeReductionNotional=${dryExec.hfSentimentGate.sizeReductionNotionalTotal.toFixed(2)} explain=${dryExec.hfSentimentGate.explainLine}`
  );
  console.log(
    `[HF_PAYLOAD_PROBE] mode=${hfPayloadProbe.requestedMode} active=${hfPayloadProbe.active} modified=${hfPayloadProbe.modified} reason=${hfPayloadProbe.reason} symbol=${hfPayloadProbe.symbol ?? "none"} basePayloads=${hfPayloadProbe.basePayloadCount} baseSkipped=${hfPayloadProbe.baseSkippedCount} baseApplied=${hfPayloadProbe.baseApplied} baseTighten=${hfPayloadProbe.baseTighten} baseRelief=${hfPayloadProbe.baseRelief} baseSizeReduced=${hfPayloadProbe.baseSizeReduced} baseSizeSaved=${hfPayloadProbe.baseSizeReductionNotional.toFixed(2)}`
  );
  console.log(
    `[HF_PAYLOAD_PROBE_STATUS] status=${hfPayloadProbeStatus.status} reason=${hfPayloadProbeStatus.reason} payloads=${hfPayloadProbeStatus.payloadCount} hfApplied=${hfPayloadProbeStatus.hfApplied} tighten=${hfPayloadProbeStatus.tightenCount} sizeReduceEnabled=${hfPayloadProbeStatus.sizeReduceEnabled} sizeReduced=${hfPayloadProbeStatus.sizeReducedCount} savedNotional=${hfPayloadProbeStatus.savedNotional.toFixed(2)} forced=${hfPayloadProbeStatus.forced}`
  );
  if (hfDrift) {
    console.log(
      `[HF_DRIFT_SUMMARY] triggered=${hfDrift.triggered} reason=${hfDrift.reason} requirePayload=${hfDrift.requirePayload} payloads=${hfDrift.payloadCount} currentApplied=${hfDrift.currentAppliedRatio.toFixed(4)} baselineApplied=${hfDrift.baselineAppliedRatio.toFixed(4)} currentNegative=${hfDrift.currentNegativeRatio.toFixed(4)} baselineNegative=${hfDrift.baselineNegativeRatio.toFixed(4)}`
    );
  }
  if (hfAlert) {
    console.log(
      `[HF_ALERT_SUMMARY] triggered=${hfAlert.triggered} reason=${hfAlert.reason} shadowCompared=${hfAlert.shadowCompared} shadowPayloadDelta=${hfAlert.shadowPayloadDelta} shadowNotionalDelta=${hfAlert.shadowNotionalDelta.toFixed(2)} shadowSkippedDelta=${hfAlert.shadowSkippedDelta} driftTriggered=${hfAlert.driftTriggered}`
    );
  }
  if (hfTuningAdvice) {
    console.log(
      `[HF_TUNING_ADVICE] status=${hfTuningAdvice.status} action=${hfTuningAdvice.action} variable=${hfTuningAdvice.variable ?? "none"} current=${hfTuningAdvice.currentValue != null ? hfTuningAdvice.currentValue.toFixed(4) : "n/a"} suggested=${hfTuningAdvice.suggestedValue != null ? hfTuningAdvice.suggestedValue.toFixed(4) : "n/a"} reason=${hfTuningAdvice.reason} confidence=${hfTuningAdvice.confidence}`
    );
  }
  if (hfFreeze) {
    console.log(
      `[HF_FREEZE] enabled=${hfFreeze.enabled} status=${hfFreeze.status} reason=${hfFreeze.reason} recommendation=${hfFreeze.recommendation} progress=${hfFreeze.observedTrades}/${hfFreeze.requiredProgress} stable=${hfFreeze.stableRunStreak}/${hfFreeze.stableRunsTarget} alert=${hfFreeze.alertStreak}/${hfFreeze.alertStreakThreshold} shadowRate=${hfFreeze.shadowAlertRate.toFixed(4)} shadowMax=${hfFreeze.maxShadowAlertRate.toFixed(4)} hfAlert=${hfFreeze.hfAlertTriggered} frozenAt=${hfFreeze.frozenAt ?? "n/a"}`
    );
  }
  if (hfLivePromotion) {
    console.log(
      `[HF_LIVE_PROMOTION] status=${hfLivePromotion.status} reason=${hfLivePromotion.reason} recommendation=${hfLivePromotion.recommendation} required=${hfLivePromotion.requiredPass}/${hfLivePromotion.requiredTotal} requiredMissing=${hfLivePromotion.requiredMissing.length ? hfLivePromotion.requiredMissing.join(",") : "none"} requiredHint=${hfLivePromotion.requiredHintToken} requiredHintText=${hfLivePromotion.requiredHintText} pass=${hfLivePromotion.checklistPass}/${hfLivePromotion.checklistTotal} reqPerfGateGo=${hfLivePromotion.policy.requirePerfGateGo} reqFreezeFrozen=${hfLivePromotion.policy.requireFreezeFrozen} reqShadowStable=${hfLivePromotion.policy.requireShadowStable} reqPayloadPathVerified=${hfLivePromotion.policy.requirePayloadPathVerified} perfGateGo=${hfLivePromotion.checks.perfGateGo} freezeFrozen=${hfLivePromotion.checks.freezeFrozen} alertClear=${hfLivePromotion.checks.alertClear} shadowStable=${hfLivePromotion.checks.shadowStable} payloadPathVerified=${hfLivePromotion.checks.payloadPathVerified} payloadPathSource=${hfLivePromotion.payloadPathSource} payloadPathVerifiedAt=${hfLivePromotion.payloadPathVerifiedAt ?? "n/a"} probeActive=${hfLivePromotion.checks.probeActive} probeMode=${hfLivePromotion.checks.probeMode}`
    );
  }
  if (hfNextAction) {
    console.log(
      `[HF_NEXT_ACTION] status=${hfNextAction.status} action=${hfNextAction.action} reason=${hfNextAction.reason} hint=${hfNextAction.hint} requiredMissing=${hfNextAction.requiredMissing.length ? hfNextAction.requiredMissing.join(",") : "none"} livePromotion=${hfNextAction.livePromotionStatus} gate=${hfNextAction.gateStatus} progress=${hfNextAction.gateProgress} remainingTrades=${hfNextAction.gateRemainingTrades}`
    );
  }
  if (hfPayloadPathSticky) {
    console.log(
      `[HF_PAYLOAD_PATH_STICKY] priorStage6Hash=${hfPayloadPathSticky.priorStage6Hash ? hfPayloadPathSticky.priorStage6Hash.slice(0, 12) : "none"} stage6HashChanged=${hfPayloadPathSticky.stage6HashChanged} stickyEligible=${hfPayloadPathSticky.stickyEligible} stickyCarried=${hfPayloadPathSticky.stickyCarried} stickyReset=${hfPayloadPathSticky.stickyReset} reason=${hfPayloadPathSticky.stickyResetReason} currentVerified=${hfPayloadPathSticky.currentVerified} currentSource=${hfPayloadPathSticky.currentSource} resolvedVerified=${hfPayloadPathSticky.resolvedVerified} resolvedSource=${hfPayloadPathSticky.resolvedSource}`
    );
  }
  if (hfEvidenceSummary) {
    console.log(
      `[HF_EVIDENCE] history=${hfEvidenceSummary.historySize} latestAt=${hfEvidenceSummary.latestAt ?? "N/A"} latestStage6Hash=${hfEvidenceSummary.latestStage6Hash ? hfEvidenceSummary.latestStage6Hash.slice(0, 12) : "none"} latestLive=${hfEvidenceSummary.latestLivePromotionStatus} latestProbe=${hfEvidenceSummary.latestPayloadProbeStatus} latestAlert=${hfEvidenceSummary.latestAlertTriggered} latestGate=${hfEvidenceSummary.latestGateProgress} window=${hfEvidenceSummary.recentWindowSize} pass=${hfEvidenceSummary.recentPassCount} hold=${hfEvidenceSummary.recentHoldCount} block=${hfEvidenceSummary.recentBlockCount} alerts=${hfEvidenceSummary.recentAlertCount}`
    );
  }
  console.log(`[STATE] saved ${DRY_EXEC_PREVIEW_PATH}`);
}

function makeDefaultBatchId(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `stage6-${yyyy}${mm}${dd}`;
}

function sanitizeBatchId(value: string): string {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 48);
}

function buildPerformancePolicyFingerprint(dryExec: DryExecBuildResult): string {
  return [
    `profile=${dryExec.regime.profile}`,
    `conv=${dryExec.minConviction}`,
    `convBase=${dryExec.minConvictionPolicy.base}`,
    `convQCap=${dryExec.minConvictionPolicy.sampleCap ?? "n/a"}`,
    `hfSoft=${dryExec.hfSentimentGate.enabled ? "on" : "off"}`,
    `hfSoftDelta=${dryExec.hfSentimentGate.netMinConvictionDelta}`,
    `hfEarnWin=${dryExec.hfSentimentGate.earningsWindowEnabled ? "on" : "off"}`,
    `hfEarnBlk=${dryExec.hfSentimentGate.earningsBlockDays}`,
    `hfEarnRed=${dryExec.hfSentimentGate.earningsReduceDays}`,
    `stopMin=${dryExec.minStopDistancePct}`,
    `stopMax=${dryExec.maxStopDistancePct}`,
    `entryEnf=${dryExec.entryFeasibility.enforce}`,
    `entryMaxDist=${dryExec.entryFeasibility.maxDistancePct}`,
    `bucketEnf=${dryExec.stage6Contract.enforce}`
  ].join(";");
}

function csvCell(value: string | number | null): string {
  const raw = value == null ? "" : String(value);
  if (/[",\n]/.test(raw)) return `"${raw.replace(/"/g, "\"\"")}"`;
  return raw;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(4));
  }
  return Number(sorted[mid].toFixed(4));
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Number((values.reduce((acc, value) => acc + value, 0) / values.length).toFixed(4));
}

function deriveTradeMetrics(row: PerformanceLoopRow): Pick<PerformanceLoopRow, "RMultiple" | "slipPct"> {
  const entryFilled = parseFiniteNumber(row.entryFilled);
  const entryPlanned = parseFiniteNumber(row.entryPlanned);
  const stopPlanned = parseFiniteNumber(row.stopPlanned);
  const exitPrice = parseFiniteNumber(row.exitPrice);

  let rMultiple: number | null = null;
  if (entryFilled != null && stopPlanned != null && exitPrice != null) {
    const risk = entryFilled - stopPlanned;
    if (risk > 0) {
      rMultiple = Number(((exitPrice - entryFilled) / risk).toFixed(4));
    }
  }

  let slipPct: number | null = null;
  if (entryFilled != null && entryPlanned != null && entryPlanned > 0) {
    slipPct = Number((Math.abs(entryFilled - entryPlanned) / entryPlanned * 100).toFixed(4));
  }

  return { RMultiple: rMultiple, slipPct };
}

function normalizeLoopRow(row: PerformanceLoopRow): PerformanceLoopRow {
  const derived = deriveTradeMetrics(row);
  return {
    ...row,
    RMultiple: derived.RMultiple,
    slipPct: derived.slipPct
  };
}

function hasPreflightPassNote(row: PerformanceLoopRow): boolean {
  return typeof row.notes === "string" && row.notes.includes("preflight=PREFLIGHT_PASS");
}

function derivePlannedRMultiple(row: PerformanceLoopRow): number | null {
  const entryPlanned = parseFiniteNumber(row.entryPlanned);
  const stopPlanned = parseFiniteNumber(row.stopPlanned);
  const targetPlanned = parseFiniteNumber(row.targetPlanned);
  if (entryPlanned == null || stopPlanned == null || targetPlanned == null) return null;
  const risk = entryPlanned - stopPlanned;
  if (risk <= 0) return null;
  return Number(((targetPlanned - entryPlanned) / risk).toFixed(4));
}

function buildPerformanceSnapshot(rows: PerformanceLoopRow[]): PerformanceLoopSnapshot {
  const tradeCount = rows.length;
  const explicitFilledCount = rows.filter((row) => parseFiniteNumber(row.entryFilled) != null).length;
  const explicitClosedRows = rows.filter((row) => parseFiniteNumber(row.exitPrice) != null);
  const explicitClosedCount = explicitClosedRows.length;

  const explicitRValues = explicitClosedRows
    .map((row) => parseFiniteNumber(row.RMultiple))
    .filter((value): value is number => value != null);
  const explicitAvgR =
    explicitRValues.length > 0
      ? Number((explicitRValues.reduce((acc, value) => acc + value, 0) / explicitRValues.length).toFixed(4))
      : null;

  let filledCount = explicitFilledCount;
  let closedCount = explicitClosedCount;
  let avgR = explicitAvgR;
  let kpiSource: PerformanceLoopSnapshot["kpiSource"] = "none";

  if (explicitFilledCount > 0 && explicitClosedCount > 0 && explicitAvgR != null) {
    kpiSource = "realized";
  } else {
    const preflightPassRows = rows.filter(hasPreflightPassNote);
    const proxyFilledCount = preflightPassRows.length;
    const proxyRValues = preflightPassRows
      .map((row) => derivePlannedRMultiple(row))
      .filter((value): value is number => value != null);
    const proxyClosedCount = proxyRValues.length;
    const proxyAvgR = average(proxyRValues);

    if (explicitFilledCount === 0 && proxyFilledCount > 0) {
      filledCount = proxyFilledCount;
    }
    if (explicitClosedCount === 0 && proxyClosedCount > 0) {
      closedCount = proxyClosedCount;
    }
    if (explicitAvgR == null && proxyAvgR != null) {
      avgR = proxyAvgR;
    }
    if (filledCount > 0 && closedCount > 0 && avgR != null) {
      kpiSource = "proxy_preflight";
    }
  }

  const fillRatePct = tradeCount > 0 ? Number(((filledCount / tradeCount) * 100).toFixed(2)) : null;

  const holdErrors = explicitClosedRows
    .map((row) => {
      const planned = parseFiniteNumber(row.holdDaysPlanned);
      const actual = parseFiniteNumber(row.holdDaysActual);
      if (planned == null || actual == null) return null;
      return Math.abs(actual - planned);
    })
    .filter((value): value is number => value != null);
  const medianHoldErrorDays = median(holdErrors);

  // Optional marker for manual post-trade QA. Keep at 0 unless explicitly flagged in notes.
  const noReasonDrift = rows.filter((row) => row.notes.includes("[REASON_DRIFT]")).length;

  return {
    at: new Date().toISOString(),
    tradeCount,
    filledCount,
    closedCount,
    fillRatePct,
    avgR,
    medianHoldErrorDays,
    noReasonDrift,
    kpiSource
  };
}

function toPerformanceCsv(rows: PerformanceLoopRow[]): string {
  const header = [
    "runDate",
    "symbol",
    "modelRank",
    "execRank",
    "AQ",
    "XS",
    "decisionReason",
    "entryPlanned",
    "entryFilled",
    "stopPlanned",
    "targetPlanned",
    "exitPrice",
    "exitReason",
    "holdDaysPlanned",
    "holdDaysActual",
    "RMultiple",
    "slipPct",
    "marketRegime",
    "notes"
  ];

  const ordered = [...rows].sort((a, b) => {
    const tsA = Date.parse(a.runDate);
    const tsB = Date.parse(b.runDate);
    if (Number.isFinite(tsA) && Number.isFinite(tsB) && tsA !== tsB) return tsA - tsB;
    return a.symbol.localeCompare(b.symbol);
  });

  const body = ordered.map((row) =>
    [
      row.runDate,
      row.symbol,
      row.modelRank,
      row.execRank,
      row.AQ,
      row.XS,
      row.decisionReason,
      row.entryPlanned,
      row.entryFilled,
      row.stopPlanned,
      row.targetPlanned,
      row.exitPrice,
      row.exitReason,
      row.holdDaysPlanned,
      row.holdDaysActual,
      row.RMultiple,
      row.slipPct,
      row.marketRegime,
      row.notes
    ]
      .map((value) => csvCell(value as string | number | null))
      .join(",")
  );

  return [header.join(","), ...body].join("\n");
}

function evaluatePerformanceLoopGate(
  latestSnapshot: PerformanceLoopSnapshot | null,
  tradeCount: number
): PerformanceLoopGate {
  const requiredTrades = PERFORMANCE_LOOP_REQUIRED_TRADES;
  // Use row-count as single source of truth for gate progress.
  // Snapshot tradeCount is milestone-based and can be stale between milestones (e.g. 13 rows but last snapshot at 11).
  const observedTrades = Number.isFinite(Number(tradeCount)) ? Number(tradeCount) : 0;
  const remainingTrades = Math.max(0, requiredTrades - observedTrades);
  const progressPct = Number(
    clamp((Math.min(observedTrades, requiredTrades) / requiredTrades) * 100, 0, 100).toFixed(1)
  );

  if (observedTrades < requiredTrades) {
    return {
      status: "PENDING_SAMPLE",
      reason: `sample_insufficient(trades=${observedTrades},required>=${requiredTrades})`,
      progress: `${Math.min(observedTrades, requiredTrades)}/${requiredTrades}`,
      observedTrades,
      requiredTrades,
      remainingTrades,
      progressPct
    };
  }

  const snapshotTradeCount = Number(latestSnapshot?.tradeCount ?? 0);
  const snapshotFilledCount = Number(latestSnapshot?.filledCount ?? 0);
  const snapshotClosedCount = Number(latestSnapshot?.closedCount ?? 0);
  const snapshotAvgR = Number(latestSnapshot?.avgR);
  const hasFillTelemetry = Number.isFinite(snapshotFilledCount) && snapshotFilledCount > 0;
  const hasClosedTelemetry = Number.isFinite(snapshotClosedCount) && snapshotClosedCount > 0;
  const hasAvgRTelemetry = Number.isFinite(snapshotAvgR);
  if (
    !latestSnapshot ||
    snapshotTradeCount <= 0 ||
    !hasFillTelemetry ||
    !hasClosedTelemetry ||
    !hasAvgRTelemetry
  ) {
    return {
      status: "NO_DATA",
      reason: `kpi_unavailable(filled=${snapshotFilledCount}|closed=${snapshotClosedCount}|avgR=${hasAvgRTelemetry ? snapshotAvgR.toFixed(4) : "n/a"})`,
      progress: `${requiredTrades}/${requiredTrades}`,
      observedTrades,
      requiredTrades,
      remainingTrades: 0,
      progressPct: 100
    };
  }

  const passFill = Number(latestSnapshot?.fillRatePct) >= 60;
  const passAvgR = Number(latestSnapshot?.avgR) > 0;
  const passDrift = Number(latestSnapshot?.noReasonDrift) === 0;
  const failReasons: string[] = [];
  if (!passFill) failReasons.push("fill_rate_below_60");
  if (!passAvgR) failReasons.push("avgR_not_positive");
  if (!passDrift) failReasons.push("reason_drift_detected");

  return {
    status: failReasons.length === 0 ? "GO" : "NO_GO",
    reason: failReasons.length === 0 ? "all_must_pass_checks_ok" : failReasons.join("|"),
    progress: `${requiredTrades}/${requiredTrades}`,
    observedTrades,
    requiredTrades,
    remainingTrades: 0,
    progressPct: 100
  };
}

function buildPerformanceLoopAlertMessage(
  result: PerformanceLoopUpdateResult,
  milestone: number
): string {
  const snapshot = result.latestSnapshot;
  const fillRate =
    snapshot && Number.isFinite(Number(snapshot.fillRatePct))
      ? `${Number(snapshot.fillRatePct).toFixed(2)}%`
      : "N/A";
  const avgR =
    snapshot && Number.isFinite(Number(snapshot.avgR))
      ? Number(snapshot.avgR).toFixed(4)
      : "N/A";
  const holdErr =
    snapshot && Number.isFinite(Number(snapshot.medianHoldErrorDays))
      ? Number(snapshot.medianHoldErrorDays).toFixed(2)
      : "N/A";
  const drift =
    snapshot && Number.isFinite(Number(snapshot.noReasonDrift))
      ? Number(snapshot.noReasonDrift)
      : "N/A";

  const statusIcon =
    result.gate.status === "GO"
      ? "✅"
      : result.gate.status === "NO_GO"
        ? "⚠️"
        : "ℹ️";

  return [
    `${statusIcon} Stage6 Performance Loop Milestone`,
    `Batch: ${result.batchId}`,
    `Milestone: ${milestone} trades`,
    `Gate: ${result.gate.status} (${result.gate.reason})`,
    `Progress: ${result.gate.progress}`,
    `ETA: remainingTrades=${result.gate.remainingTrades} progressPct=${result.gate.progressPct.toFixed(1)}%`,
    `KPI: source=${snapshot?.kpiSource ?? "none"} fillRate=${fillRate} avgR=${avgR} holdErrMedian=${holdErr} noReasonDrift=${drift}`
  ].join("\n");
}

async function loadPerformanceLoopState(
  policyFingerprint: string
): Promise<PerformanceLoopState> {
  const now = new Date().toISOString();
  const batchOverride = sanitizeBatchId(process.env.STAGE6_PERF_BATCH_ID || "");

  const buildEmpty = (batchId: string): PerformanceLoopState => ({
    batchId,
    createdAt: now,
    updatedAt: now,
    policyFingerprint,
    rows: {},
    snapshots: [],
    notifiedMilestones: []
  });

  try {
    const raw = await readFile(PERFORMANCE_LOOP_JSON_PATH, "utf8");
    const parsed = parseJsonText<Partial<PerformanceLoopState>>(raw, "performance_loop_state");
    const currentBatchRaw = typeof parsed.batchId === "string" ? parsed.batchId : "";
    const currentBatch = sanitizeBatchId(currentBatchRaw);
    const resolvedBatch = batchOverride || currentBatch || makeDefaultBatchId();

    if (batchOverride && currentBatch && currentBatch !== batchOverride) {
      return buildEmpty(batchOverride);
    }

    const rows =
      parsed && typeof parsed.rows === "object" && parsed.rows
        ? (parsed.rows as Record<string, PerformanceLoopRow>)
        : {};
    const snapshots = Array.isArray(parsed?.snapshots)
      ? (parsed.snapshots as PerformanceLoopSnapshot[])
      : [];
    const notifiedMilestones = Array.isArray(parsed?.notifiedMilestones)
      ? Array.from(
          new Set(
            parsed.notifiedMilestones
              .map((value) => Number(value))
              .filter((value) => Number.isFinite(value) && value > 0)
              .map((value) => Math.round(value))
          )
        )
      : [];

    return {
      batchId: resolvedBatch,
      createdAt:
        typeof parsed?.createdAt === "string" && parsed.createdAt
          ? parsed.createdAt
          : now,
      updatedAt:
        typeof parsed?.updatedAt === "string" && parsed.updatedAt
          ? parsed.updatedAt
          : now,
      policyFingerprint:
        typeof parsed?.policyFingerprint === "string" && parsed.policyFingerprint
          ? parsed.policyFingerprint
          : policyFingerprint,
      rows,
      snapshots,
      notifiedMilestones
    };
  } catch {
    return buildEmpty(batchOverride || makeDefaultBatchId());
  }
}

async function savePerformanceLoopState(state: PerformanceLoopState): Promise<void> {
  await mkdir("state", { recursive: true });
  await writeFile(PERFORMANCE_LOOP_JSON_PATH, JSON.stringify(state, null, 2), "utf8");
  await writeFile(PERFORMANCE_LOOP_CSV_PATH, toPerformanceCsv(Object.values(state.rows)), "utf8");
  console.log(`[STATE] saved ${PERFORMANCE_LOOP_JSON_PATH}`);
  console.log(`[STATE] saved ${PERFORMANCE_LOOP_CSV_PATH}`);
}

async function updatePerformanceLoop(
  stage6: Stage6LoadResult,
  actionable: Stage6CandidateSummary[],
  dryExec: DryExecBuildResult,
  preflight: PreflightResult
): Promise<PerformanceLoopUpdateResult> {
  const policyFingerprint = buildPerformancePolicyFingerprint(dryExec);
  const state = await loadPerformanceLoopState(policyFingerprint);
  const now = new Date().toISOString();
  const candidateMap = new Map<string, Stage6CandidateSummary>();
  [...stage6.modelTopCandidates, ...stage6.candidates, ...actionable].forEach((row) => {
    if (row?.symbol) candidateMap.set(row.symbol, row);
  });

  let upserted = 0;
  let touched = 0;
  let latestSnapshot: PerformanceLoopSnapshot | null =
    state.snapshots.length > 0 ? state.snapshots[state.snapshots.length - 1] : null;
  let alertMessage: string | null = null;

  for (const payload of dryExec.payloads) {
    if (isLifecycleExitActionType(payload.actionType)) continue;
    const rowId =
      payload.idempotencyKey || buildOrderIdempotencyKey(stage6.sha256, payload.symbol, payload.side);
    const stage6Row = candidateMap.get(payload.symbol);
    const existing = state.rows[rowId];

    const baseRow: PerformanceLoopRow = {
      rowId,
      runDate: now,
      stage6Hash: stage6.sha256,
      stage6File: stage6.fileName,
      symbol: payload.symbol,
      modelRank: stage6Row?.modelRank ?? null,
      execRank: stage6Row?.executionRank ?? null,
      AQ: stage6Row?.qualityScore ?? null,
      XS: stage6Row?.executionScore ?? null,
      decisionReason: stage6Row?.decisionReason ?? "n/a",
      entryPlanned: payload.limit_price,
      entryFilled: null,
      stopPlanned: payload.stop_loss.stop_price,
      targetPlanned: payload.take_profit.limit_price,
      exitPrice: null,
      exitReason: null,
      holdDaysPlanned: null,
      holdDaysActual: null,
      RMultiple: null,
      slipPct: null,
      marketRegime: dryExec.regime.profile,
      notes: `preflight=${preflight.code};stage6=${stage6.sha256.slice(0, 12)}`
    };

    if (!existing) {
      state.rows[rowId] = normalizeLoopRow(baseRow);
      upserted += 1;
      touched += 1;
      continue;
    }

    // Preserve post-trade manual/actual fields while refreshing latest signal metadata.
    const merged: PerformanceLoopRow = {
      ...existing,
      ...baseRow,
      entryFilled: existing.entryFilled,
      exitPrice: existing.exitPrice,
      exitReason: existing.exitReason,
      holdDaysPlanned: existing.holdDaysPlanned,
      holdDaysActual: existing.holdDaysActual,
      notes: existing.notes || baseRow.notes
    };
    state.rows[rowId] = normalizeLoopRow(merged);
    touched += 1;
  }

  if (touched === 0) {
    const currentTradeCount = Object.keys(state.rows).length;
    const lastSnapshotTradeCount =
      state.snapshots.length > 0
        ? Number(state.snapshots[state.snapshots.length - 1]?.tradeCount ?? 0)
        : 0;
    const previousMilestoneBucket = Math.floor(lastSnapshotTradeCount / 10);
    const currentMilestoneBucket = Math.floor(currentTradeCount / 10);
    const crossedMilestones: number[] = [];
    if (currentTradeCount > 0 && currentMilestoneBucket > previousMilestoneBucket) {
      for (let bucket = previousMilestoneBucket + 1; bucket <= currentMilestoneBucket; bucket += 1) {
        crossedMilestones.push(bucket * 10);
      }
    }

    if (crossedMilestones.length > 0) {
      const snapshot = buildPerformanceSnapshot(Object.values(state.rows));
      state.snapshots.push(snapshot);
      latestSnapshot = snapshot;
      const alertMessages: string[] = [];
      const milestoneCandidates = crossedMilestones.filter((milestone) => [10, 20].includes(milestone));
      for (const milestone of milestoneCandidates) {
        const alreadyNotified = state.notifiedMilestones.includes(milestone);
        if (alreadyNotified) continue;
        const gate = evaluatePerformanceLoopGate(snapshot, currentTradeCount);
        state.notifiedMilestones.push(milestone);
        alertMessages.push(
          buildPerformanceLoopAlertMessage(
            {
              batchId: state.batchId,
              tradeCount: currentTradeCount,
              snapshotCount: state.snapshots.length,
              gate,
              latestSnapshot: snapshot,
              alertMessage: null,
              updated: true
            },
            milestone
          )
        );
      }
      state.updatedAt = now;
      await savePerformanceLoopState(state);
      const gate = evaluatePerformanceLoopGate(latestSnapshot, currentTradeCount);
      console.log(
        `[PERF_LOOP] batch=${state.batchId} backfill milestones=${crossedMilestones.join(",")} totalTrades=${currentTradeCount} snapshots=${state.snapshots.length} gate=${gate.status} reason=${gate.reason} progress=${gate.progress}`
      );
      return {
        batchId: state.batchId,
        tradeCount: currentTradeCount,
        snapshotCount: state.snapshots.length,
        gate,
        latestSnapshot,
        alertMessage: alertMessages.length > 0 ? alertMessages.join("\n\n") : null,
        updated: true
      };
    }

    if (currentTradeCount > 0 && currentTradeCount !== lastSnapshotTradeCount) {
      const snapshot = buildPerformanceSnapshot(Object.values(state.rows));
      state.snapshots.push(snapshot);
      state.updatedAt = now;
      await savePerformanceLoopState(state);
      const gate = evaluatePerformanceLoopGate(snapshot, currentTradeCount);
      console.log(
        `[PERF_LOOP] batch=${state.batchId} resync_snapshot trades=${currentTradeCount} lastSnapshotTrades=${lastSnapshotTradeCount} snapshots=${state.snapshots.length} gate=${gate.status} reason=${gate.reason} progress=${gate.progress}`
      );
      return {
        batchId: state.batchId,
        tradeCount: currentTradeCount,
        snapshotCount: state.snapshots.length,
        gate,
        latestSnapshot: snapshot,
        alertMessage: null,
        updated: true
      };
    }

    const gate = evaluatePerformanceLoopGate(latestSnapshot, Object.keys(state.rows).length);
    console.log(
      `[PERF_LOOP] batch=${state.batchId} no-op (payloads=0) totalTrades=${Object.keys(state.rows).length}`
    );
    return {
      batchId: state.batchId,
      tradeCount: Object.keys(state.rows).length,
      snapshotCount: state.snapshots.length,
      gate,
      latestSnapshot,
      alertMessage: null,
      updated: false
    };
  }

  state.updatedAt = now;
  state.policyFingerprint = policyFingerprint;

  const currentTradeCount = Object.keys(state.rows).length;
  const lastSnapshotTradeCount =
    state.snapshots.length > 0
      ? Number(state.snapshots[state.snapshots.length - 1]?.tradeCount ?? 0)
      : 0;
  const previousMilestoneBucket = Math.floor(lastSnapshotTradeCount / 10);
  const currentMilestoneBucket = Math.floor(currentTradeCount / 10);
  const crossedMilestones: number[] = [];
  if (currentTradeCount > 0 && currentMilestoneBucket > previousMilestoneBucket) {
    for (let bucket = previousMilestoneBucket + 1; bucket <= currentMilestoneBucket; bucket += 1) {
      crossedMilestones.push(bucket * 10);
    }
  }

  const snapshot = buildPerformanceSnapshot(Object.values(state.rows));
  state.snapshots.push(snapshot);
  latestSnapshot = snapshot;
  console.log(
    `[PERF_LOOP_KPI] source=${snapshot.kpiSource} trades=${snapshot.tradeCount} fillRatePct=${snapshot.fillRatePct ?? "N/A"} avgR=${snapshot.avgR ?? "N/A"} holdErrMedian=${snapshot.medianHoldErrorDays ?? "N/A"} noReasonDrift=${snapshot.noReasonDrift}`
  );

  if (crossedMilestones.length > 0) {
    const alertMessages: string[] = [];
    const milestoneCandidates = crossedMilestones.filter((milestone) => [10, 20].includes(milestone));
    for (const milestone of milestoneCandidates) {
      const alreadyNotified = state.notifiedMilestones.includes(milestone);
      if (alreadyNotified) continue;
      const gate = evaluatePerformanceLoopGate(snapshot, currentTradeCount);
      state.notifiedMilestones.push(milestone);
      alertMessages.push(
        buildPerformanceLoopAlertMessage(
          {
            batchId: state.batchId,
            tradeCount: currentTradeCount,
            snapshotCount: state.snapshots.length,
            gate,
            latestSnapshot: snapshot,
            alertMessage: null,
            updated: true
          },
          milestone
        )
      );
    }
    if (alertMessages.length > 0) {
      alertMessage = alertMessages.join("\n\n");
    }
  }

  await savePerformanceLoopState(state);
  const gate = evaluatePerformanceLoopGate(latestSnapshot, currentTradeCount);
  console.log(
    `[PERF_LOOP] batch=${state.batchId} upserted=${upserted} touched=${touched} totalTrades=${currentTradeCount} snapshots=${state.snapshots.length} gate=${gate.status} reason=${gate.reason} progress=${gate.progress}`
  );
  return {
    batchId: state.batchId,
    tradeCount: currentTradeCount,
    snapshotCount: state.snapshots.length,
    gate,
    latestSnapshot,
    alertMessage,
    updated: true
  };
}

async function loadOrderIdempotencyState(): Promise<OrderIdempotencyState> {
  try {
    const raw = await readFile(ORDER_IDEMPOTENCY_PATH, "utf8");
    const parsed = parseJsonText<Partial<OrderIdempotencyState>>(raw, "order_idempotency_state");
    const orders =
      parsed && typeof parsed === "object" && parsed.orders && typeof parsed.orders === "object"
        ? (parsed.orders as OrderIdempotencyState["orders"])
        : {};
    const updatedAt = typeof parsed?.updatedAt === "string" ? parsed.updatedAt : "";
    return { orders, updatedAt };
  } catch {
    return { orders: {}, updatedAt: "" };
  }
}

async function saveOrderIdempotencyState(state: OrderIdempotencyState): Promise<void> {
  await mkdir("state", { recursive: true });
  await writeFile(ORDER_IDEMPOTENCY_PATH, JSON.stringify(state, null, 2), "utf8");
  console.log(`[STATE] saved ${ORDER_IDEMPOTENCY_PATH}`);
}

function pruneOrderIdempotencyState(state: OrderIdempotencyState, ttlDays: number): number {
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - ttlMs;
  let removed = 0;
  for (const [key, entry] of Object.entries(state.orders)) {
    const ts = Date.parse(entry.lastSeenAt);
    if (!Number.isFinite(ts) || ts < cutoff) {
      delete state.orders[key];
      removed += 1;
    }
  }
  return removed;
}

async function applyOrderIdempotency(
  stage6: Stage6LoadResult,
  dryExec: DryExecBuildResult,
  options?: {
    persistNewEntries?: boolean;
    phase?: "preflight" | "final";
  }
): Promise<DryExecBuildResult> {
  const cfg = loadRuntimeConfig();
  const enabled = readBoolEnv("ORDER_IDEMPOTENCY_ENABLED", true);
  const enforceDryRun = readBoolEnv("ORDER_IDEMPOTENCY_ENFORCE_DRY_RUN", false);
  const ttlDays = Math.max(1, readPositiveNumberEnv("ORDER_IDEMPOTENCY_TTL_DAYS", 30));
  const enforced = enabled && (cfg.execEnabled || enforceDryRun);
  const persistNewEntries = options?.persistNewEntries ?? true;
  const phase = options?.phase ?? "final";

  if (!enabled) {
    return {
      ...dryExec,
      idempotency: {
        enabled,
        enforced,
        ttlDays,
        newCount: 0,
        duplicateCount: 0
      }
    };
  }

  const state = await loadOrderIdempotencyState();
  const pruned = pruneOrderIdempotencyState(state, ttlDays);
  const now = new Date().toISOString();
  const payloads: DryExecOrderPayload[] = [];
  const skipped = [...dryExec.skipped];
  let duplicateCount = 0;
  let newCount = 0;
  let changed = persistNewEntries && pruned > 0;

  for (const payload of dryExec.payloads) {
    const key = payload.idempotencyKey || buildOrderIdempotencyKey(stage6.sha256, payload.symbol, payload.side);
    payload.idempotencyKey = key;
    const existing = state.orders[key];
    if (existing) {
      duplicateCount += 1;
      if (enforced) {
        const existingFirstSeen = existing.firstSeenAt || "n/a";
        const existingStage6 = existing.stage6File || "n/a";
        const detail = `key=${key.slice(0, 18)}...|firstSeenAt=${existingFirstSeen}|stage6=${existingStage6}`;
        skipped.push({ symbol: payload.symbol, reason: "idempotency_duplicate", detail });
        continue;
      }
      payloads.push(payload);
      continue;
    }

    newCount += 1;
    payloads.push(payload);
    if (persistNewEntries) {
      state.orders[key] = {
        symbol: payload.symbol,
        side: payload.side,
        stage6Hash: stage6.sha256,
        stage6File: stage6.fileName,
        firstSeenAt: now,
        lastSeenAt: now
      };
      changed = true;
    }
  }

  if (changed) {
    state.updatedAt = now;
    await saveOrderIdempotencyState(state);
  }
  console.log(
    `[ORDER_IDEMP] phase=${phase} enabled=${enabled} enforce=${enforced} persist=${persistNewEntries} ttlDays=${ttlDays} new=${newCount} duplicate=${duplicateCount} pruned=${pruned}`
  );

  const nextDryExec: DryExecBuildResult = {
    ...dryExec,
    payloads,
    skipped,
    skipReasonCounts: buildSkipReasonCounts(skipped),
    idempotency: {
      enabled,
      enforced,
      ttlDays,
      newCount,
      duplicateCount
    }
  };
  return {
    ...nextDryExec,
    actionIntent: rebuildActionIntentSummary(nextDryExec)
  };
}

async function loadOrderLedgerState(): Promise<OrderLedgerState> {
  try {
    const raw = await readFile(ORDER_LEDGER_PATH, "utf8");
    const parsed = parseJsonText<Partial<OrderLedgerState>>(raw, "order_ledger_state");
    const orders =
      parsed && typeof parsed === "object" && parsed.orders && typeof parsed.orders === "object"
        ? (parsed.orders as Record<string, OrderLedgerRecord>)
        : {};
    return {
      orders,
      updatedAt: typeof parsed?.updatedAt === "string" ? parsed.updatedAt : ""
    };
  } catch {
    return { orders: {}, updatedAt: "" };
  }
}

async function saveOrderLedgerState(state: OrderLedgerState): Promise<void> {
  await mkdir("state", { recursive: true });
  await writeFile(ORDER_LEDGER_PATH, JSON.stringify(state, null, 2), "utf8");
  console.log(`[STATE] saved ${ORDER_LEDGER_PATH}`);
}

function pruneOrderLedgerState(state: OrderLedgerState, ttlDays: number): number {
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - ttlMs;
  let removed = 0;
  for (const [key, row] of Object.entries(state.orders)) {
    const ts = Date.parse(row.updatedAt);
    if (!Number.isFinite(ts) || ts < cutoff) {
      delete state.orders[key];
      removed += 1;
    }
  }
  return removed;
}

async function updateOrderLedger(
  stage6: Stage6LoadResult,
  mode: string,
  dryExec: DryExecBuildResult,
  preflight: PreflightResult,
  brokerSubmit: BrokerSubmitSummary
): Promise<OrderLedgerUpdateResult> {
  const enabled = readBoolEnv("ORDER_LIFECYCLE_ENABLED", true);
  const ttlDays = Math.max(1, readPositiveNumberEnv("ORDER_LEDGER_TTL_DAYS", 90));
  const hasSubmitted = brokerSubmit.submitted > 0;
  const targetStatus: OrderLifecycleStatus = hasSubmitted ? "submitted" : "planned";

  if (!enabled) {
    return { enabled, targetStatus: "none", upserted: 0, transitioned: 0, unchanged: 0, pruned: 0 };
  }

  const state = await loadOrderLedgerState();
  const now = new Date().toISOString();
  const pruned = pruneOrderLedgerState(state, ttlDays);
  let upserted = 0;
  let transitioned = 0;
  let unchanged = 0;
  let changed = pruned > 0;

  for (const payload of dryExec.payloads) {
    const key = payload.idempotencyKey;
    const existing = state.orders[key];
    const brokerRow = brokerSubmit.orders[key];
    const rowStatus = brokerRow?.submitted
      ? (brokerRow.brokerStatus ?? "submitted")
      : ("planned" as OrderLifecycleStatus);
    const rowReason = brokerRow?.submitted
      ? "order_submitted_to_broker"
      : brokerSubmit.active && brokerRow?.attempted
        ? `order_submit_failed:${brokerRow.reason}`
        : `order_submit_skipped:${brokerSubmit.reason}`;
    const rowSource = brokerRow?.submitted ? "execution_pipeline" : "dry_run_pipeline";
    const brokerOrderId = brokerRow?.submitted ? brokerRow.brokerOrderId : null;
    if (!existing) {
      upserted += 1;
      changed = true;
      state.orders[key] = {
        idempotencyKey: key,
        symbol: payload.symbol,
        side: payload.side,
        stage6Hash: stage6.sha256,
        stage6File: stage6.fileName,
        mode,
        clientOrderId: payload.client_order_id,
        status: rowStatus,
        statusReason: rowReason,
        preflightCode: preflight.code,
        regimeProfile: dryExec.regime.profile,
        notional: payload.notional,
        limitPrice: payload.limit_price,
        takeProfitPrice: payload.take_profit.limit_price,
        stopLossPrice: payload.stop_loss.stop_price,
        brokerOrderId,
        createdAt: now,
        updatedAt: now,
        history: [
          {
            at: now,
            from: null,
            to: rowStatus,
            reason: rowReason,
            source: rowSource
          }
        ]
      };
      continue;
    }

    const canTransition = isTransitionAllowed(existing.status, rowStatus);
    const shouldTransition = canTransition && existing.status !== rowStatus;

    if (shouldTransition) {
      transitioned += 1;
      changed = true;
      existing.history.push({
        at: now,
        from: existing.status,
        to: rowStatus,
        reason: rowReason,
        source: rowSource
      });
      existing.status = rowStatus;
      existing.statusReason = rowReason;
    } else {
      unchanged += 1;
      if (!canTransition) {
        console.warn(
          `[ORDER_LEDGER] invalid transition key=${key} from=${existing.status} to=${rowStatus} (ignored)`
        );
      }
    }

    existing.stage6Hash = stage6.sha256;
    existing.stage6File = stage6.fileName;
    existing.mode = mode;
    existing.clientOrderId = payload.client_order_id;
    existing.preflightCode = preflight.code;
    existing.regimeProfile = dryExec.regime.profile;
    existing.notional = payload.notional;
    existing.limitPrice = payload.limit_price;
    existing.takeProfitPrice = payload.take_profit.limit_price;
    existing.stopLossPrice = payload.stop_loss.stop_price;
    existing.brokerOrderId = brokerOrderId;
    existing.updatedAt = now;
  }

  if (changed) {
    state.updatedAt = now;
    await saveOrderLedgerState(state);
  }

  console.log(
    `[ORDER_LEDGER] enabled=${enabled} target=${targetStatus} ttlDays=${ttlDays} upserted=${upserted} transitioned=${transitioned} unchanged=${unchanged} pruned=${pruned}`
  );

  return { enabled, targetStatus, upserted, transitioned, unchanged, pruned };
}

function buildRunModeLabel(dryExec: DryExecBuildResult, guardControl: GuardControlGate): string {
  const cfg = loadRuntimeConfig();
  const shadowDataBus = buildShadowDataBusSummary();
  const approvalCfg = buildApprovalQueueGateConfig();
  const lifecycleThresholds = resolveLifecycleHeldConvictionThresholds(cfg.positionLifecycle);
  const heartbeatOnDedupe = readBoolEnv("TELEGRAM_HEARTBEAT_ON_DEDUPE", false);
  const sourcePriorityRaw = (process.env.REGIME_VIX_SOURCE_PRIORITY || "realtime_first").trim().toLowerCase();
  const sourcePriority = sourcePriorityRaw === "snapshot_first" ? "snapshot_first" : "realtime_first";
  const snapshotMaxAgeMin = Math.max(0, readNumberEnv("REGIME_SNAPSHOT_MAX_AGE_MIN", 10));
  const idempotencyEnabled = readBoolEnv("ORDER_IDEMPOTENCY_ENABLED", true);
  const idempotencyEnforceDryRun = readBoolEnv("ORDER_IDEMPOTENCY_ENFORCE_DRY_RUN", false);
  const idempotencyTtlDays = Math.max(1, readPositiveNumberEnv("ORDER_IDEMPOTENCY_TTL_DAYS", 30));
  const preflightEnabled = readBoolEnv("PREFLIGHT_ENABLED", true);
  const allowEntryOutsideRth = readBoolEnv("ALLOW_ENTRY_OUTSIDE_RTH", false);
  const dailyMaxNotional = readNonNegativeNumberEnv("DAILY_MAX_NOTIONAL", 5000);
  const orderLifecycleEnabled = readBoolEnv("ORDER_LIFECYCLE_ENABLED", true);
  const orderLedgerTtlDays = Math.max(1, readPositiveNumberEnv("ORDER_LEDGER_TTL_DAYS", 90));
  const stage6ExecutionBucketEnforce = readBoolEnv("STAGE6_EXECUTION_BUCKET_ENFORCE", true);
  const actionableVerdicts = resolveActionableVerdicts();
  const regimeQualityEnabled = readBoolEnv("REGIME_QUALITY_GUARD_ENABLED", true);
  const regimeQualityMinScore = readPositiveNumberEnv("REGIME_QUALITY_MIN_SCORE", 60);
  const regimeHysteresisEnabled = readBoolEnv("REGIME_HYSTERESIS_ENABLED", true);
  const regimeMinHoldMin = Math.max(0, readNonNegativeNumberEnv("REGIME_MIN_HOLD_MIN", 30));
  const regimeVixMismatchPct = readPositiveNumberEnv("REGIME_VIX_MISMATCH_PCT", 8);
  const lifecycleExitFullMaxLossPct = clamp(
    readNonNegativeNumberEnv("POSITION_LIFECYCLE_EXIT_FULL_MAX_LOSS_PCT", 0.08),
    0.01,
    0.5
  );
  const lifecycleExitPartialMaxLossPct = clamp(
    readNonNegativeNumberEnv("POSITION_LIFECYCLE_EXIT_PARTIAL_MAX_LOSS_PCT", 0.05),
    0.01,
    0.5
  );
  const lifecycleScaleDownMaxLossPct = clamp(
    readNonNegativeNumberEnv("POSITION_LIFECYCLE_SCALE_DOWN_MAX_LOSS_PCT", 0.03),
    0.005,
    0.5
  );
  const lifecycleRiskOffIntradayShockPct = clamp(
    readNonNegativeNumberEnv("POSITION_LIFECYCLE_RISK_OFF_INTRADAY_SHOCK_PCT", 0.025),
    0.005,
    0.3
  );
  const lifecycleTakeProfitPartialPct = clamp(
    readNonNegativeNumberEnv("POSITION_LIFECYCLE_TAKE_PROFIT_PARTIAL_PCT", 0.18),
    0.02,
    2
  );
  const lifecycleScaleUpMaxChaseFromAvgEntryPct = clamp(
    readNonNegativeNumberEnv("POSITION_LIFECYCLE_SCALE_UP_MAX_CHASE_FROM_AVG_ENTRY_PCT", 0.03),
    0,
    0.5
  );
  const lifecycleScaleUpMaxIntradayGainPct = clamp(
    readNonNegativeNumberEnv("POSITION_LIFECYCLE_SCALE_UP_MAX_INTRADAY_GAIN_PCT", 0.02),
    0,
    0.5
  );
  const lifecycleStaleHoldDays = clamp(
    readNonNegativeNumberEnv("POSITION_LIFECYCLE_STALE_HOLD_DAYS", 15),
    1,
    365
  );
  return [
    `READ_ONLY=${cfg.readOnly}`,
    `EXEC_ENABLED=${cfg.execEnabled}`,
    `SIMULATION_LIVE_PARITY=${cfg.simulationLiveParity}`,
    `PROFILE=${dryExec.regime.profile}`,
    `NOTIONAL=${dryExec.notionalPerOrder}`,
    `MAX_ORDERS=${dryExec.maxOrders}`,
    `MAX_TOTAL_NOTIONAL=${dryExec.maxTotalNotional}`,
    `MIN_CONV=${dryExec.minConviction}`,
    `STOP_MIN=${dryExec.minStopDistancePct}`,
    `STOP_MAX=${dryExec.maxStopDistancePct}`,
    `STOP_POLICY_SYNC_STAGE6=${dryExec.stopDistancePolicy.syncWithStage6}`,
    `STOP_POLICY=${dryExec.stopDistancePolicy.strategy}`,
    `STOP_CONFIG=${dryExec.stopDistancePolicy.configuredMinPct}~${dryExec.stopDistancePolicy.configuredMaxPct}`,
    `STOP_STAGE6=${dryExec.stopDistancePolicy.stage6MinPct}~${dryExec.stopDistancePolicy.stage6MaxPct}`,
    `ENTRY_FEAS_ENFORCE=${dryExec.entryFeasibility.enforce}`,
    `ENTRY_MAX_DISTANCE_PCT=${dryExec.entryFeasibility.maxDistancePct}`,
    `STAGE6_EXEC_BUCKET_ENFORCE=${stage6ExecutionBucketEnforce}`,
    `ACTIONABLE_VERDICTS=${formatActionableVerdicts(actionableVerdicts)}`,
    `POSITION_LIFECYCLE_ENABLED=${cfg.positionLifecycle.enabled}`,
    `POSITION_LIFECYCLE_PREVIEW_ONLY=${cfg.positionLifecycle.previewOnly}`,
    `POSITION_LIFECYCLE_ACTION_TYPES=${cfg.positionLifecycle.allowedActionTypes.join("/")}`,
    `POSITION_LIFECYCLE_SCALE_UP_MIN_CONVICTION=${cfg.positionLifecycle.scaleUpMinConviction}`,
    `POSITION_LIFECYCLE_SCALE_DOWN_PCT=${cfg.positionLifecycle.scaleDownPct}`,
    `POSITION_LIFECYCLE_EXIT_PARTIAL_PCT=${cfg.positionLifecycle.exitPartialPct}`,
    `POSITION_LIFECYCLE_SCALE_DOWN_MAX_CONVICTION=${lifecycleThresholds.scaleDownMax}`,
    `POSITION_LIFECYCLE_EXIT_PARTIAL_MAX_CONVICTION=${lifecycleThresholds.exitPartialMax}`,
    `POSITION_LIFECYCLE_EXIT_FULL_MAX_CONVICTION=${lifecycleThresholds.exitFullMax}`,
    `POSITION_LIFECYCLE_EXIT_ON_WATCHLIST=${lifecycleThresholds.exitOnWatchlist}`,
    `POSITION_LIFECYCLE_EXIT_ON_BLOCKED=${lifecycleThresholds.exitOnBlocked}`,
    `POSITION_LIFECYCLE_EXIT_FULL_MAX_LOSS_PCT=${lifecycleExitFullMaxLossPct}`,
    `POSITION_LIFECYCLE_EXIT_PARTIAL_MAX_LOSS_PCT=${lifecycleExitPartialMaxLossPct}`,
    `POSITION_LIFECYCLE_SCALE_DOWN_MAX_LOSS_PCT=${lifecycleScaleDownMaxLossPct}`,
    `POSITION_LIFECYCLE_RISK_OFF_INTRADAY_SHOCK_PCT=${lifecycleRiskOffIntradayShockPct}`,
    `POSITION_LIFECYCLE_TAKE_PROFIT_PARTIAL_PCT=${lifecycleTakeProfitPartialPct}`,
    `POSITION_LIFECYCLE_SCALE_UP_MAX_CHASE_FROM_AVG_ENTRY_PCT=${lifecycleScaleUpMaxChaseFromAvgEntryPct}`,
    `POSITION_LIFECYCLE_SCALE_UP_MAX_INTRADAY_GAIN_PCT=${lifecycleScaleUpMaxIntradayGainPct}`,
    `POSITION_LIFECYCLE_STALE_HOLD_DAYS=${lifecycleStaleHoldDays}`,
    `LIFECYCLE_SELFTEST=${readBoolEnv("LIFECYCLE_SELFTEST", false)}`,
    `APPROVAL_REQUIRED=${approvalCfg.required}`,
    `APPROVAL_ENFORCE_IN_PREVIEW=${approvalCfg.enforceInPreview}`,
    `APPROVAL_REQUEST_TTL_MINUTES=${approvalCfg.requestTtlMinutes}`,
    `HF_SENTIMENT_SOFT_GATE_ENABLED=${readBoolEnv("HF_SENTIMENT_SOFT_GATE_ENABLED", false)}`,
    `HF_SENTIMENT_SCORE_FLOOR=${clamp(readNonNegativeNumberEnv("HF_SENTIMENT_SCORE_FLOOR", 0.55), 0.5, 0.95)}`,
    `HF_SENTIMENT_MIN_ARTICLE_COUNT=${Math.max(0, Math.round(readNonNegativeNumberEnv("HF_SENTIMENT_MIN_ARTICLE_COUNT", 2)))}`,
    `HF_SENTIMENT_MAX_NEWS_AGE_HOURS=${clamp(readNonNegativeNumberEnv("HF_SENTIMENT_MAX_NEWS_AGE_HOURS", 24), 1, 240)}`,
    `HF_EARNINGS_WINDOW_ENABLED=${readBoolEnv("HF_EARNINGS_WINDOW_ENABLED", true)}`,
    `HF_EARNINGS_WINDOW_BLOCK_DAYS=${Math.max(0, Math.round(readNonNegativeNumberEnv("HF_EARNINGS_WINDOW_BLOCK_DAYS", 1)))}`,
    `HF_EARNINGS_WINDOW_REDUCE_DAYS=${Math.max(0, Math.round(readNonNegativeNumberEnv("HF_EARNINGS_WINDOW_REDUCE_DAYS", 3)))}`,
    `HF_EARNINGS_WINDOW_REDUCE_FACTOR=${clamp(readNonNegativeNumberEnv("HF_EARNINGS_WINDOW_REDUCE_FACTOR", 0.3), 0, 1)}`,
    `HF_SENTIMENT_POSITIVE_RELIEF_MAX=${clamp(readNonNegativeNumberEnv("HF_SENTIMENT_POSITIVE_RELIEF_MAX", 1.0), 0, 3)}`,
    `HF_SENTIMENT_NEGATIVE_TIGHTEN_MAX=${clamp(readNonNegativeNumberEnv("HF_SENTIMENT_NEGATIVE_TIGHTEN_MAX", 2.0), 0, 4)}`,
    `HF_PAYLOAD_PROBE_MODE=${parseHfPayloadProbeMode(process.env.HF_PAYLOAD_PROBE_MODE)}`,
    `HF_NEGATIVE_SIZE_REDUCTION_ENABLED=${readBoolEnv("HF_NEGATIVE_SIZE_REDUCTION_ENABLED", false)}`,
    `HF_NEGATIVE_SIZE_REDUCTION_PCT=${clamp(readNonNegativeNumberEnv("HF_NEGATIVE_SIZE_REDUCTION_PCT", 0.15), 0, 0.5)}`,
    `HF_SHADOW_ENABLED=${readBoolEnv("HF_SHADOW_ENABLED", false)}`,
    `HF_ALERT_ENABLED=${readBoolEnv("HF_ALERT_ENABLED", true)}`,
    `HF_ALERT_SHADOW_PAYLOAD_DELTA_ABS=${Math.max(1, Math.round(readNonNegativeNumberEnv("HF_ALERT_SHADOW_PAYLOAD_DELTA_ABS", 2)))}`,
    `HF_ALERT_SHADOW_NOTIONAL_DELTA_ABS=${clamp(readNonNegativeNumberEnv("HF_ALERT_SHADOW_NOTIONAL_DELTA_ABS", 1000), 0, 1000000)}`,
    `HF_ALERT_SHADOW_SKIPPED_DELTA_ABS=${Math.max(1, Math.round(readNonNegativeNumberEnv("HF_ALERT_SHADOW_SKIPPED_DELTA_ABS", 2)))}`,
    `HF_DRIFT_ALERT_ENABLED=${readBoolEnv("HF_DRIFT_ALERT_ENABLED", true)}`,
    `HF_DRIFT_ALERT_WINDOW_RUNS=${Math.max(3, Math.min(30, Math.round(readNonNegativeNumberEnv("HF_DRIFT_ALERT_WINDOW_RUNS", 8))))}`,
    `HF_DRIFT_ALERT_MIN_HISTORY=${Math.max(2, Math.round(readNonNegativeNumberEnv("HF_DRIFT_ALERT_MIN_HISTORY", 4)))}`,
    `HF_DRIFT_ALERT_MIN_CANDIDATES=${Math.max(1, Math.round(readNonNegativeNumberEnv("HF_DRIFT_ALERT_MIN_CANDIDATES", 3)))}`,
    `HF_DRIFT_ALERT_NEGATIVE_RATIO_SPIKE=${clamp(readNonNegativeNumberEnv("HF_DRIFT_ALERT_NEGATIVE_RATIO_SPIKE", 0.75), 0, 1)}`,
    `HF_DRIFT_ALERT_NEGATIVE_RATIO_DELTA=${clamp(readNonNegativeNumberEnv("HF_DRIFT_ALERT_NEGATIVE_RATIO_DELTA", 0.35), 0, 1)}`,
    `HF_DRIFT_ALERT_APPLIED_RATIO_DROP=${clamp(readNonNegativeNumberEnv("HF_DRIFT_ALERT_APPLIED_RATIO_DROP", 0.25), 0, 1)}`,
    `HF_DRIFT_ALERT_APPLIED_RATIO_FLOOR=${clamp(readNonNegativeNumberEnv("HF_DRIFT_ALERT_APPLIED_RATIO_FLOOR", 0.15), 0, 1)}`,
    `HF_DRIFT_ALERT_REQUIRE_PAYLOAD=${readBoolEnv("HF_DRIFT_ALERT_REQUIRE_PAYLOAD", true)}`,
    `HF_TUNING_FREEZE_ENABLED=${readBoolEnv("HF_TUNING_FREEZE_ENABLED", false)}`,
    `HF_TUNING_FREEZE_STABLE_RUNS=${Math.max(1, Math.round(readNonNegativeNumberEnv("HF_TUNING_FREEZE_STABLE_RUNS", 3)))}`,
    `HF_TUNING_UNFREEZE_ALERT_STREAK=${Math.max(1, Math.round(readNonNegativeNumberEnv("HF_TUNING_UNFREEZE_ALERT_STREAK", 2)))}`,
    `HF_TUNING_FREEZE_REQUIRE_PROGRESS=${Math.max(1, Math.round(readNonNegativeNumberEnv("HF_TUNING_FREEZE_REQUIRE_PROGRESS", 20)))}`,
    `HF_TUNING_FREEZE_MAX_SHADOW_ALERT_RATE=${clamp(readNonNegativeNumberEnv("HF_TUNING_FREEZE_MAX_SHADOW_ALERT_RATE", 0.1), 0, 1)}`,
    `HF_LIVE_PROMOTION_REQUIRE_PERF_GATE_GO=${readBoolEnv("HF_LIVE_PROMOTION_REQUIRE_PERF_GATE_GO", true)}`,
    `HF_LIVE_PROMOTION_REQUIRE_FREEZE_FROZEN=${readBoolEnv("HF_LIVE_PROMOTION_REQUIRE_FREEZE_FROZEN", true)}`,
    `HF_LIVE_PROMOTION_REQUIRE_SHADOW_STABLE=${readBoolEnv("HF_LIVE_PROMOTION_REQUIRE_SHADOW_STABLE", true)}`,
    `HF_LIVE_PROMOTION_REQUIRE_PAYLOAD_PATH_VERIFIED=${readBoolEnv("HF_LIVE_PROMOTION_REQUIRE_PAYLOAD_PATH_VERIFIED", true)}`,
    `HF_LIVE_PROMOTION_PAYLOAD_PATH_STICKY_HOURS=${clamp(readNonNegativeNumberEnv("HF_LIVE_PROMOTION_PAYLOAD_PATH_STICKY_HOURS", 168), 0, 720)}`,
    `SHADOW_DATA_BUS_ENABLED=${shadowDataBus.enabled}`,
    `SHADOW_DATA_BUS_MODE=${shadowDataBus.mode}`,
    `SHADOW_DATA_SOURCES=${formatShadowDataBusSources(shadowDataBus)}`,
    `SHADOW_DATA_KEYS=${formatShadowDataBusKeyReadiness(shadowDataBus)}`,
    `SOURCE_PRIORITY=${sourcePriority}`,
    `SNAPSHOT_MAX_AGE_MIN=${snapshotMaxAgeMin}`,
    `ORDER_IDEMP_ENABLED=${idempotencyEnabled}`,
    `ORDER_IDEMP_ENFORCE_DRY_RUN=${idempotencyEnforceDryRun}`,
    `ORDER_IDEMP_TTL_DAYS=${idempotencyTtlDays}`,
    `PREFLIGHT_ENABLED=${preflightEnabled}`,
    `PREFLIGHT_SOFT_CODES=${String(process.env.PREFLIGHT_SOFT_CODES || "PREFLIGHT_MARKET_CLOSED")}`,
    `LIVE_ORDER_SUBMIT_ENABLED=${readBoolEnv("LIVE_ORDER_SUBMIT_ENABLED", false)}`,
    `LIVE_ORDER_SUBMIT_REQUIRE_PERF_GATE_GO=${readBoolEnv("LIVE_ORDER_SUBMIT_REQUIRE_PERF_GATE_GO", true)}`,
    `LIVE_ORDER_SUBMIT_REQUIRE_HF_LIVE_PROMOTION_PASS=${readBoolEnv("LIVE_ORDER_SUBMIT_REQUIRE_HF_LIVE_PROMOTION_PASS", true)}`,
    `ALLOW_ENTRY_OUTSIDE_RTH=${allowEntryOutsideRth}`,
    `DAILY_MAX_NOTIONAL=${dailyMaxNotional}`,
    `ORDER_LIFECYCLE_ENABLED=${orderLifecycleEnabled}`,
    `ORDER_LEDGER_TTL_DAYS=${orderLedgerTtlDays}`,
    `REGIME_QUALITY_GUARD_ENABLED=${regimeQualityEnabled}`,
    `REGIME_QUALITY_MIN_SCORE=${regimeQualityMinScore}`,
    `REGIME_HYSTERESIS_ENABLED=${regimeHysteresisEnabled}`,
    `REGIME_MIN_HOLD_MIN=${regimeMinHoldMin}`,
    `REGIME_VIX_MISMATCH_PCT=${regimeVixMismatchPct}`,
    `GUARD_CONTROL_ENFORCE=${guardControl.enforce}`,
    `GUARD_CONTROL_MAX_AGE_MIN=${guardControl.maxAgeMin}`,
    `GUARD_CONTROL_AGE_MIN=${guardControl.ageMin != null ? guardControl.ageMin.toFixed(1) : "N/A"}`,
    `GUARD_CONTROL_BLOCKED=${guardControl.blocked}`,
    `GUARD_CONTROL_LEVEL=${guardControl.level != null ? `L${guardControl.level}` : "N/A"}`,
    `GUARD_CONTROL_STALE=${guardControl.stale}`,
    `HEARTBEAT=${heartbeatOnDedupe}`
  ].join(";");
}

function formatVix(vix: number | null): string {
  return vix == null ? "N/A" : vix.toFixed(2);
}

function buildShadowDataBusSummary(): ShadowDataBusSummary {
  const enabled = readBoolEnv("SHADOW_DATA_BUS_ENABLED", false);
  const mode: ShadowDataBusSummary["mode"] = enabled ? "shadow_only" : "off";
  const sources: ShadowDataBusSummary["sources"] = {
    alpacaReadOnly: enabled && readBoolEnv("SHADOW_SOURCE_ALPACA_ENABLED", true),
    alphaVantage: enabled && readBoolEnv("SHADOW_SOURCE_ALPHA_VANTAGE_ENABLED", true),
    secEdgar: enabled && readBoolEnv("SHADOW_SOURCE_SEC_EDGAR_ENABLED", true),
    perplexity: enabled && readBoolEnv("SHADOW_SOURCE_PERPLEXITY_ENABLED", true),
    supabase: enabled && readBoolEnv("SHADOW_SOURCE_SUPABASE_ENABLED", false)
  };
  const enabledSourceCount = Object.values(sources).filter((value) => value).length;
  const alphaVantageReady = hasValue(process.env.ALPHA_VANTAGE_API_KEY) || hasValue(process.env.ALPHA_VANTAGE_KEY);
  const perplexityReady = hasValue(process.env.PERPLEXITY_API_KEY) || hasValue(process.env.VITE_PERPLEXITY_API_KEY);
  const keyReadiness: ShadowDataBusSummary["keyReadiness"] = {
    alphaVantage: alphaVantageReady,
    perplexity: perplexityReady,
    supabase:
      hasValue(process.env.SUPABASE_URL) &&
      (hasValue(process.env.SUPABASE_SERVICE_ROLE_KEY) || hasValue(process.env.SUPABASE_ANON_KEY)),
    alpaca: hasValue(process.env.ALPACA_KEY_ID) && hasValue(process.env.ALPACA_SECRET_KEY)
  };
  return {
    enabled,
    mode,
    sources,
    enabledSourceCount,
    keyReadiness
  };
}

function formatShadowDataBusSources(summary: ShadowDataBusSummary): string {
  const labels: string[] = [];
  if (summary.sources.alpacaReadOnly) labels.push("alpaca");
  if (summary.sources.alphaVantage) labels.push("alpha_vantage");
  if (summary.sources.secEdgar) labels.push("sec_edgar");
  if (summary.sources.perplexity) labels.push("perplexity");
  if (summary.sources.supabase) labels.push("supabase");
  return labels.length > 0 ? labels.join(",") : "none";
}

function formatShadowDataBusKeyReadiness(summary: ShadowDataBusSummary): string {
  return [
    `av:${summary.keyReadiness.alphaVantage ? "ok" : "missing"}`,
    `px:${summary.keyReadiness.perplexity ? "ok" : "missing"}`,
    `sb:${summary.keyReadiness.supabase ? "ok" : "missing"}`,
    `alpaca:${summary.keyReadiness.alpaca ? "ok" : "missing"}`
  ].join(",");
}

function buildShadowFieldParsingSummary(candidates: Stage6CandidateSummary[]): ShadowFieldParsingSummary {
  const totalCandidates = candidates.length;
  const alphaVantageSymbols = candidates
    .filter((row) => row.shadowIntel?.alphaVantage)
    .map((row) => row.symbol);
  const secEdgarSymbols = candidates.filter((row) => row.shadowIntel?.secEdgar).map((row) => row.symbol);
  const alphaVantageParsed = alphaVantageSymbols.length;
  const secEdgarParsed = secEdgarSymbols.length;
  const alphaVantageCoveragePct =
    totalCandidates > 0 ? Number(((alphaVantageParsed / totalCandidates) * 100).toFixed(2)) : 0;
  const secEdgarCoveragePct =
    totalCandidates > 0 ? Number(((secEdgarParsed / totalCandidates) * 100).toFixed(2)) : 0;
  return {
    totalCandidates,
    alphaVantageParsed,
    secEdgarParsed,
    alphaVantageCoveragePct,
    secEdgarCoveragePct,
    alphaVantageSymbols,
    secEdgarSymbols
  };
}

function formatShadowFieldParsingSummary(summary: ShadowFieldParsingSummary): string {
  const avSample = summary.alphaVantageSymbols.slice(0, 3).join("/") || "none";
  const secSample = summary.secEdgarSymbols.slice(0, 3).join("/") || "none";
  return `total:${summary.totalCandidates}|av:${summary.alphaVantageParsed}(${summary.alphaVantageCoveragePct.toFixed(1)}%)|sec:${summary.secEdgarParsed}(${summary.secEdgarCoveragePct.toFixed(1)}%)|avSample:${avSample}|secSample:${secSample}`;
}

function selectShadowParsingCandidates(stage6: Stage6LoadResult): Stage6CandidateSummary[] {
  if (Array.isArray(stage6.candidates) && stage6.candidates.length > 0) {
    return stage6.candidates;
  }
  const merged: Stage6CandidateSummary[] = [];
  const pushUnique = (rows: Stage6CandidateSummary[] | undefined) => {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (!row?.symbol) continue;
      const existingIndex = merged.findIndex((item) => item.symbol === row.symbol);
      if (existingIndex === -1) {
        merged.push(row);
      } else if (!merged[existingIndex].shadowIntel && row.shadowIntel) {
        merged[existingIndex] = row;
      }
    }
  };
  pushUnique(stage6.contractContext?.modelTop6);
  pushUnique(stage6.contractContext?.executablePicks);
  pushUnique(stage6.contractContext?.watchlistTop);
  return merged;
}

function printRunSummary(
  event: "sent" | "dedupe" | "blocked_preflight",
  stage6: Stage6LoadResult,
  actionableCount: number,
  dryExec: DryExecBuildResult,
  preflight: PreflightResult,
  ledger: OrderLedgerUpdateResult,
  brokerSubmit: BrokerSubmitSummary,
  approvalQueueGate: ApprovalQueueGateSummary,
  hfPayloadProbe: HfPayloadProbeSummary,
  hfDrift?: HfDriftAlert,
  hfShadow?: HfShadowSummary,
  hfAlert?: HfAnomalyAlert,
  hfShadowTrend?: HfShadowTrendSummary,
  hfTuningPhase?: HfTuningPhaseSummary,
  hfTuningAdvice?: HfTuningAdvice,
  hfFreeze?: HfFreezeSummary,
  hfLivePromotion?: HfLivePromotionSummary,
  hfNextAction?: HfNextActionSummary,
  hfDailyVerdict?: HfDailyVerdictSummary,
  hfPayloadPathSticky?: HfPayloadPathStickyAudit,
  hfEvidenceSummary?: HfEvidenceHistorySummary
): void {
  const shadowDataBus = buildShadowDataBusSummary();
  const shadowDataBusSources = formatShadowDataBusSources(shadowDataBus);
  const shadowDataBusKeys = formatShadowDataBusKeyReadiness(shadowDataBus);
  const shadowDataBusSummary = `enabled:${shadowDataBus.enabled}|mode:${shadowDataBus.mode}|sources:${shadowDataBusSources}|keys:${shadowDataBusKeys}`;
  const approvalQueueSummary = formatApprovalQueueGateSummary(approvalQueueGate);
  const shadowFieldParsing = buildShadowFieldParsingSummary(selectShadowParsingCandidates(stage6));
  const shadowFieldParsingSummary = formatShadowFieldParsingSummary(shadowFieldParsing);
  const actionIntentSummary = `enabled:${dryExec.actionIntent.enabled}|preview:${dryExec.actionIntent.previewOnly}|entry_new:${dryExec.actionIntent.counts.ENTRY_NEW}|hold_wait:${dryExec.actionIntent.counts.HOLD_WAIT}|scale_up:${dryExec.actionIntent.counts.SCALE_UP}|scale_down:${dryExec.actionIntent.counts.SCALE_DOWN}|exit_partial:${dryExec.actionIntent.counts.EXIT_PARTIAL}|exit_full:${dryExec.actionIntent.counts.EXIT_FULL}`;
  const hfDriftSummary = hfDrift
    ? `enabled:${hfDrift.enabled}|triggered:${hfDrift.triggered}|reason:${hfDrift.reason}|requirePayload:${hfDrift.requirePayload}|payloads:${hfDrift.payloadCount}|currentApplied:${hfDrift.currentAppliedRatio.toFixed(4)}|baselineApplied:${hfDrift.baselineAppliedRatio.toFixed(4)}|currentNegative:${hfDrift.currentNegativeRatio.toFixed(4)}|baselineNegative:${hfDrift.baselineNegativeRatio.toFixed(4)}`
    : "n/a";
  const hfShadowSummary = buildHfShadowSummaryForRun(hfShadow ?? null);
  const hfAlertSummary = buildHfAlertSummaryForRun(hfAlert ?? null);
  const hfShadowTrendSummary = buildHfShadowTrendSummaryForRun(hfShadowTrend ?? null);
  const hfTuningPhaseSummary = buildHfTuningPhaseSummaryForRun(hfTuningPhase ?? null);
  const hfTuningAdviceSummary = buildHfTuningAdviceSummaryForRun(hfTuningAdvice ?? null);
  const hfPayloadProbeSummary = buildHfPayloadProbeSummaryForRun(hfPayloadProbe ?? null);
  const hfPayloadProbeGateSummary = buildHfPayloadProbeGateSummaryForRun(
    deriveHfPayloadProbeGateSummary(dryExec, hfPayloadProbe)
  );
  const hfFreezeSummary = buildHfFreezeSummaryForRun(hfFreeze ?? null);
  const hfLivePromotionSummary = buildHfLivePromotionSummaryForRun(hfLivePromotion ?? null);
  const hfNextActionSummary = buildHfNextActionSummaryForRun(hfNextAction ?? null);
  const hfDailyVerdictSummary = buildHfDailyVerdictSummaryForRun(hfDailyVerdict ?? null);
  const hfPayloadPathStickySummary = buildHfPayloadPathStickySummaryForRun(hfPayloadPathSticky ?? null);
  const hfEvidenceSummaryForRun = buildHfEvidenceSummaryForRun(hfEvidenceSummary ?? null);
  const brokerSubmitSummary = `enabled:${brokerSubmit.enabled}|active:${brokerSubmit.active}|reason:${brokerSubmit.reason}|requirePerfGateGo:${brokerSubmit.requirePerfGateGo}|requireHfPass:${brokerSubmit.requireHfLivePromotionPass}|perfGate:${brokerSubmit.perfGateStatus}|perfReason:${brokerSubmit.perfGateReason}|hfLive:${brokerSubmit.hfLivePromotionStatus}|hfReason:${brokerSubmit.hfLivePromotionReason}|attempted:${brokerSubmit.attempted}|submitted:${brokerSubmit.submitted}|failed:${brokerSubmit.failed}|skipped:${brokerSubmit.skipped}`;
  const stage6ContractReasonCountsPrimary = stage6.contractContext?.decisionReasonCountsPrimary ?? {};
  const stage6SkipHintCountsPrimary = mapStage6DecisionReasonCountsToSkipCounts(
    stage6ContractReasonCountsPrimary
  );
  const stage6ContractReasonsPrimarySummary = formatSkipReasonCounts(stage6ContractReasonCountsPrimary);
  const stage6SkipHintsPrimarySummary = formatSkipReasonCounts(stage6SkipHintCountsPrimary);
  const hfSoftExplainToken = dryExec.hfSentimentGate.explainLine.replace(/\s+/g, "_");
  const tuningForLog = hfTuningPhase ?? {
    phase: "OBSERVE_ONLY" as HfTuningPhase,
    reason: "no_perf_loop",
    recommendation: "collect_more_runs",
    gateStatus: "PENDING_SAMPLE" as PerformanceLoopGateStatus,
    gateProgress: "N/A",
    gateRemainingTrades: PERFORMANCE_LOOP_REQUIRED_TRADES,
    gateProgressPct: 0,
    observedTrades: 0,
    requiredTrades: PERFORMANCE_LOOP_REQUIRED_TRADES,
    alertTriggered: false,
    shadowAlertRate: 0,
    generatedAt: new Date().toISOString()
  };
  console.log(
    `[HF_TUNING_PHASE] phase=${tuningForLog.phase} reason=${tuningForLog.reason} recommendation=${tuningForLog.recommendation} gate=${tuningForLog.gateStatus} progress=${tuningForLog.gateProgress} remainingTrades=${tuningForLog.gateRemainingTrades} progressPct=${tuningForLog.gateProgressPct.toFixed(1)} trades=${tuningForLog.observedTrades}/${tuningForLog.requiredTrades} alertTriggered=${tuningForLog.alertTriggered} shadowAlertRate=${tuningForLog.shadowAlertRate.toFixed(4)}`
  );
  const adviceForLog = hfTuningAdvice ?? {
    status: "HOLD" as HfTuningAdviceStatus,
    action: "collect_more_runs",
    variable: null,
    currentValue: null,
    suggestedValue: null,
    reason: "no_tuning_advice",
    confidence: "low" as const,
    generatedAt: new Date().toISOString()
  };
  console.log(
    `[HF_TUNING_ADVICE] status=${adviceForLog.status} action=${adviceForLog.action} variable=${adviceForLog.variable ?? "none"} current=${adviceForLog.currentValue != null ? adviceForLog.currentValue.toFixed(4) : "n/a"} suggested=${adviceForLog.suggestedValue != null ? adviceForLog.suggestedValue.toFixed(4) : "n/a"} reason=${adviceForLog.reason} confidence=${adviceForLog.confidence}`
  );
  const probeForLog = hfPayloadProbe ?? {
    requestedMode: "off" as HfPayloadProbeMode,
    active: false,
    modified: false,
    reason: "not_requested",
    symbol: null,
    basePayloadCount: 0,
    baseSkippedCount: 0,
    baseApplied: 0,
    baseTighten: 0,
    baseRelief: 0,
    baseSizeReduced: 0,
    baseSizeReductionNotional: 0,
    generatedAt: new Date().toISOString()
  };
  console.log(
    `[HF_PAYLOAD_PROBE] mode=${probeForLog.requestedMode} active=${probeForLog.active} modified=${probeForLog.modified} reason=${probeForLog.reason} symbol=${probeForLog.symbol ?? "none"} basePayloads=${probeForLog.basePayloadCount} baseSkipped=${probeForLog.baseSkippedCount} baseApplied=${probeForLog.baseApplied} baseTighten=${probeForLog.baseTighten} baseRelief=${probeForLog.baseRelief} baseSizeReduced=${probeForLog.baseSizeReduced} baseSizeSaved=${probeForLog.baseSizeReductionNotional.toFixed(2)}`
  );
  console.log(`[HF_PAYLOAD_PROBE_STATUS] ${hfPayloadProbeGateSummary}`);
  const freezeForLog = hfFreeze ?? {
    enabled: false,
    status: "DISABLED" as HfFreezeStatus,
    reason: "not_available",
    recommendation: "n/a",
    observedTrades: 0,
    requiredProgress: PERFORMANCE_LOOP_REQUIRED_TRADES,
    stableRunStreak: 0,
    stableRunsTarget: Math.max(1, Math.round(readNonNegativeNumberEnv("HF_TUNING_FREEZE_STABLE_RUNS", 3))),
    alertStreak: 0,
    alertStreakThreshold: Math.max(1, Math.round(readNonNegativeNumberEnv("HF_TUNING_UNFREEZE_ALERT_STREAK", 2))),
    shadowAlertRate: 0,
    maxShadowAlertRate: clamp(readNonNegativeNumberEnv("HF_TUNING_FREEZE_MAX_SHADOW_ALERT_RATE", 0.1), 0, 1),
    hfAlertTriggered: false,
    frozenAt: null,
    updatedAt: new Date().toISOString()
  };
  console.log(
    `[HF_FREEZE] enabled=${freezeForLog.enabled} status=${freezeForLog.status} reason=${freezeForLog.reason} recommendation=${freezeForLog.recommendation} progress=${freezeForLog.observedTrades}/${freezeForLog.requiredProgress} stable=${freezeForLog.stableRunStreak}/${freezeForLog.stableRunsTarget} alert=${freezeForLog.alertStreak}/${freezeForLog.alertStreakThreshold} shadowRate=${freezeForLog.shadowAlertRate.toFixed(4)} shadowMax=${freezeForLog.maxShadowAlertRate.toFixed(4)} hfAlert=${freezeForLog.hfAlertTriggered} frozenAt=${freezeForLog.frozenAt ?? "n/a"}`
  );
  const livePromotionForLog = hfLivePromotion ?? {
    status: "HOLD" as HfLivePromotionStatus,
    reason: "not_available",
    recommendation: "collect_more_evidence",
    payloadPathSource: "none" as const,
    payloadPathVerifiedAt: null,
    policy: {
      requirePerfGateGo: true,
      requireFreezeFrozen: true,
      requireShadowStable: true,
      requirePayloadPathVerified: true
    },
    checks: {
      perfGateGo: false,
      freezeFrozen: false,
      alertClear: true,
      shadowStable: false,
      payloadPathVerified: false,
      probeActive: false,
      probeMode: "off" as HfPayloadProbeMode
    },
    requiredPass: 1,
    requiredTotal: 5,
    requiredMissing: ["perfGateGo", "freezeFrozen", "shadowStable", "payloadPathVerified"],
    requiredHintToken: "wait_perf_gate_go+wait_freeze_frozen+stabilize_shadow_trend+verify_payload_path",
    requiredHintText:
      "wait for perf gate GO; wait for HF freeze status FROZEN; collect stable shadow trend; verify payload path via probe/live payload",
    checklistPass: 0,
    checklistTotal: 5,
    generatedAt: new Date().toISOString()
  };
  console.log(
    `[HF_LIVE_PROMOTION] status=${livePromotionForLog.status} reason=${livePromotionForLog.reason} recommendation=${livePromotionForLog.recommendation} required=${livePromotionForLog.requiredPass}/${livePromotionForLog.requiredTotal} requiredMissing=${livePromotionForLog.requiredMissing.length ? livePromotionForLog.requiredMissing.join(",") : "none"} requiredHint=${livePromotionForLog.requiredHintToken} requiredHintText=${livePromotionForLog.requiredHintText} pass=${livePromotionForLog.checklistPass}/${livePromotionForLog.checklistTotal} reqPerfGateGo=${livePromotionForLog.policy.requirePerfGateGo} reqFreezeFrozen=${livePromotionForLog.policy.requireFreezeFrozen} reqShadowStable=${livePromotionForLog.policy.requireShadowStable} reqPayloadPathVerified=${livePromotionForLog.policy.requirePayloadPathVerified} perfGateGo=${livePromotionForLog.checks.perfGateGo} freezeFrozen=${livePromotionForLog.checks.freezeFrozen} alertClear=${livePromotionForLog.checks.alertClear} shadowStable=${livePromotionForLog.checks.shadowStable} payloadPathVerified=${livePromotionForLog.checks.payloadPathVerified} payloadPathSource=${livePromotionForLog.payloadPathSource} payloadPathVerifiedAt=${livePromotionForLog.payloadPathVerifiedAt ?? "n/a"} probeActive=${livePromotionForLog.checks.probeActive} probeMode=${livePromotionForLog.checks.probeMode}`
  );
  const nextActionForLog = hfNextAction ?? {
    status: "MONITOR" as HfNextActionStatus,
    action: "monitor",
    reason: "not_available",
    hint: "none",
    requiredMissing: [],
    livePromotionStatus: livePromotionForLog.status,
    gateStatus: tuningForLog.gateStatus,
    gateProgress: tuningForLog.gateProgress,
    gateRemainingTrades: tuningForLog.gateRemainingTrades,
    generatedAt: new Date().toISOString()
  };
  console.log(
    `[HF_NEXT_ACTION] status=${nextActionForLog.status} action=${nextActionForLog.action} reason=${nextActionForLog.reason} hint=${nextActionForLog.hint} requiredMissing=${nextActionForLog.requiredMissing.length ? nextActionForLog.requiredMissing.join(",") : "none"} livePromotion=${nextActionForLog.livePromotionStatus} gate=${nextActionForLog.gateStatus} progress=${nextActionForLog.gateProgress} remainingTrades=${nextActionForLog.gateRemainingTrades}`
  );
  const dailyVerdictForLog = hfDailyVerdict ?? {
    status: "HOLD" as HfDailyVerdictStatus,
    action: nextActionForLog.action,
    reason: nextActionForLog.reason,
    requiredMissing: nextActionForLog.requiredMissing,
    livePromotionStatus: nextActionForLog.livePromotionStatus,
    gateStatus: nextActionForLog.gateStatus,
    gateProgress: nextActionForLog.gateProgress,
    gateRemainingTrades: nextActionForLog.gateRemainingTrades,
    generatedAt: new Date().toISOString()
  };
  console.log(
    `[HF_DAILY_VERDICT] status=${dailyVerdictForLog.status} action=${dailyVerdictForLog.action} reason=${dailyVerdictForLog.reason} requiredMissing=${dailyVerdictForLog.requiredMissing.length ? dailyVerdictForLog.requiredMissing.join(",") : "none"} livePromotion=${dailyVerdictForLog.livePromotionStatus} gate=${dailyVerdictForLog.gateStatus} progress=${dailyVerdictForLog.gateProgress} remainingTrades=${dailyVerdictForLog.gateRemainingTrades}`
  );
  if (hfPayloadPathSticky) {
    console.log(
      `[HF_PAYLOAD_PATH_STICKY] priorStage6Hash=${hfPayloadPathSticky.priorStage6Hash ? hfPayloadPathSticky.priorStage6Hash.slice(0, 12) : "none"} stage6HashChanged=${hfPayloadPathSticky.stage6HashChanged} stickyEligible=${hfPayloadPathSticky.stickyEligible} stickyCarried=${hfPayloadPathSticky.stickyCarried} stickyReset=${hfPayloadPathSticky.stickyReset} reason=${hfPayloadPathSticky.stickyResetReason} currentVerified=${hfPayloadPathSticky.currentVerified} currentSource=${hfPayloadPathSticky.currentSource} resolvedVerified=${hfPayloadPathSticky.resolvedVerified} resolvedSource=${hfPayloadPathSticky.resolvedSource}`
    );
  }
  if (hfEvidenceSummary) {
    console.log(
      `[HF_EVIDENCE] history=${hfEvidenceSummary.historySize} latestAt=${hfEvidenceSummary.latestAt ?? "N/A"} latestStage6Hash=${hfEvidenceSummary.latestStage6Hash ? hfEvidenceSummary.latestStage6Hash.slice(0, 12) : "none"} latestLive=${hfEvidenceSummary.latestLivePromotionStatus} latestProbe=${hfEvidenceSummary.latestPayloadProbeStatus} latestAlert=${hfEvidenceSummary.latestAlertTriggered} latestGate=${hfEvidenceSummary.latestGateProgress} window=${hfEvidenceSummary.recentWindowSize} pass=${hfEvidenceSummary.recentPassCount} hold=${hfEvidenceSummary.recentHoldCount} block=${hfEvidenceSummary.recentBlockCount} alerts=${hfEvidenceSummary.recentAlertCount}`
    );
  }
  console.log(
    `[STAGE6_CONTRACT_REASON_PRIMARY] raw=${stage6ContractReasonsPrimarySummary} mapped=${stage6SkipHintsPrimarySummary}`
  );
  console.log(
    `[RUN_SUMMARY] event=${event} stage6=${stage6.fileName} hash=${stage6.sha256.slice(0, 12)} profile=${dryExec.regime.profile} source=${dryExec.regime.source} vix=${formatVix(dryExec.regime.vix)} actionable=${actionableCount} payloads=${dryExec.payloads.length} skipped=${dryExec.skipped.length} skip_reasons=${formatSkipReasonCounts(dryExec.skipReasonCounts)} stage6_contract_enforce=${dryExec.stage6Contract.enforce} stage6_contract_checked=${dryExec.stage6Contract.checked} stage6_contract_blocked=${dryExec.stage6Contract.blocked} stage6_contract_reason_primary=${stage6ContractReasonsPrimarySummary} stage6_skip_hint_primary=${stage6SkipHintsPrimarySummary} entry_feas_enforce=${dryExec.entryFeasibility.enforce} entry_feas_checked=${dryExec.entryFeasibility.checked} entry_feas_blocked=${dryExec.entryFeasibility.blocked} hf_soft_enabled=${dryExec.hfSentimentGate.enabled} hf_soft_applied=${dryExec.hfSentimentGate.applied} hf_soft_blocked_negative=${dryExec.hfSentimentGate.blockedNegative} hf_soft_earnings_blocked=${dryExec.hfSentimentGate.earningsBlocked} hf_soft_earnings_reduced=${dryExec.hfSentimentGate.earningsReduced} hf_soft_net_delta=${dryExec.hfSentimentGate.netMinConvictionDelta} hf_soft_size_enabled=${dryExec.hfSentimentGate.sizeReductionEnabled} hf_soft_size_reduced=${dryExec.hfSentimentGate.sizeReducedCount} hf_soft_size_saved_notional=${dryExec.hfSentimentGate.sizeReductionNotionalTotal.toFixed(2)} hf_soft_explain=${hfSoftExplainToken} hf_payload_probe_forced=${hfPayloadProbeSummary} hf_payload_probe_status=${hfPayloadProbeGateSummary} hf_payload_path_sticky=${hfPayloadPathStickySummary} hf_evidence=${hfEvidenceSummaryForRun} hf_drift=${hfDriftSummary} hf_shadow=${hfShadowSummary} hf_shadow_trend=${hfShadowTrendSummary} hf_tuning_phase=${hfTuningPhaseSummary} hf_tuning_advice=${hfTuningAdviceSummary} hf_freeze=${hfFreezeSummary} hf_live_promotion=${hfLivePromotionSummary} hf_next_action=${hfNextActionSummary} hf_daily_verdict=${hfDailyVerdictSummary} hf_alert=${hfAlertSummary} approval_queue=${approvalQueueSummary} shadow_data_bus=${shadowDataBusSummary} shadow_parse=${shadowFieldParsingSummary} action_intent=${actionIntentSummary} broker_submit=${brokerSubmitSummary} idemp_new=${dryExec.idempotency.newCount} idemp_dup=${dryExec.idempotency.duplicateCount} idemp_enforced=${dryExec.idempotency.enforced} preflight=${preflight.status}:${preflight.code} preflight_blocking=${preflight.blocking} preflight_would_block_live=${preflight.wouldBlockLive} ledger_target=${ledger.targetStatus} ledger_upserted=${ledger.upserted} ledger_transitioned=${ledger.transitioned} ledger_unchanged=${ledger.unchanged}`
  );
}

function shouldSend(state: SidecarRunState | null, result: Stage6LoadResult, mode: string): boolean {
  if (!state) return true;
  return !(state.lastStage6Sha256 === result.sha256 && state.lastMode === mode);
}

async function main() {
  printStartupSummary();
  const cfg = loadRuntimeConfig();
  runLifecycleSelfTestIfEnabled(cfg);
  const accessToken = await getGoogleAccessToken();
  const stage6 = await loadLatestStage6FromDrive(accessToken);
  printStage6Lock(stage6);
  validateTriggerContext(stage6);
  const baseRegime = await resolveRegimeSelection(accessToken);
  const regime = await applyRegimeGuards(baseRegime);
  const regimeVix = regime.vix == null ? "N/A" : regime.vix.toFixed(2);
  console.log(
    `[REGIME] profile=${regime.profile.toUpperCase()} base=${regime.baseProfile.toUpperCase()} source=${regime.source} vix=${regimeVix} on<=${regime.riskOnThreshold} off>=${regime.riskOffThreshold}`
  );
  console.log(
    `[REGIME_QUALITY] score=${regime.quality.score} status=${regime.quality.status.toUpperCase()} min=${regime.quality.minScore} forceRiskOff=${regime.quality.forceRiskOff} reasons=${regime.quality.reasons.join("|") || "none"}`
  );
  console.log(
    `[REGIME_HYST] prev=${regime.hysteresis.previousProfile ?? "none"} desired=${regime.hysteresis.desiredProfile} applied=${regime.hysteresis.appliedProfile} holdRemainingMin=${regime.hysteresis.holdRemainingMin} reason=${regime.hysteresis.reason}`
  );
  if (regime.entryGuard.blocked) {
    console.warn(`[ENTRY_GUARD] blocked=true reason=${regime.entryGuard.reason}`);
  }
  const guardControl = await resolveGuardControlGate();
  if (guardControl.enforce) {
    const levelLabel = guardControl.level != null ? `L${guardControl.level}` : "N/A";
    console.log(
      `[GUARD_CONTROL] enforce=true blocked=${guardControl.blocked} wouldBlockLive=${guardControl.wouldBlockLive} stale=${guardControl.stale} ageMin=${guardControl.ageMin != null ? guardControl.ageMin.toFixed(1) : "N/A"} maxAgeMin=${guardControl.maxAgeMin} reason=${guardControl.reason} level=${levelLabel} updatedAt=${guardControl.updatedAt ?? "N/A"}`
    );
  }
  if (guardControl.blocked) {
    console.warn(`[ENTRY_GUARD] blocked=true reason=${guardControl.reason}`);
  }
  if (regime.diagnostics.length > 0) {
    regime.diagnostics.forEach((line) => console.log(`[REGIME_DIAG] ${line}`));
  }
  const actionableVerdicts = resolveActionableVerdicts();
  console.log(
    `[ACTIONABLE_POLICY] includeSpeculative=${actionableVerdicts.has("SPECULATIVE_BUY")} verdicts=${formatActionableVerdicts(actionableVerdicts)}`
  );
  const actionableRaw = getActionableCandidates(stage6.candidates, actionableVerdicts);
  const hfPayloadProbeApplied = applyHfPayloadProbe(actionableRaw, cfg);
  const actionable = hfPayloadProbeApplied.actionable;
  let lifecycleHeldSymbols: Set<string> | undefined;
  let lifecycleHeldContext: Map<string, HeldPositionSnapshot> | undefined;
  if (cfg.positionLifecycle.enabled && !cfg.positionLifecycle.previewOnly) {
    try {
      lifecycleHeldContext = await loadHeldPositionSnapshots();
      lifecycleHeldSymbols = new Set([...lifecycleHeldContext.keys()]);
      console.log(
        `[LIFECYCLE_PLAN] held_positions=${lifecycleHeldSymbols.size} symbols=${
          lifecycleHeldSymbols.size > 0 ? [...lifecycleHeldSymbols].slice(0, 10).join("/") : "none"
        }`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[LIFECYCLE_PLAN] held_position_fetch_failed=${message.slice(0, 180)}`);
    }
  }
  if (hfPayloadProbeApplied.summary.requestedMode !== "off") {
    console.warn(
      `[HF_PAYLOAD_PROBE] mode=${hfPayloadProbeApplied.summary.requestedMode} active=${hfPayloadProbeApplied.summary.active} reason=${hfPayloadProbeApplied.summary.reason} symbol=${hfPayloadProbeApplied.summary.symbol ?? "none"}`
    );
  }
  const lifecycleCandidateInputs = mergeLifecycleHeldCandidates(actionable, stage6, lifecycleHeldSymbols);
  if (lifecycleCandidateInputs.length !== actionable.length) {
    console.log(
      `[LIFECYCLE_PLAN] merged_candidates base=${actionable.length} merged=${lifecycleCandidateInputs.length} heldMatched=${lifecycleCandidateInputs.length - actionable.length}`
    );
  }
  const dryExecBaseRaw = buildDryExecPayloads(lifecycleCandidateInputs, stage6.sha256, regime, {
    lifecycleHeldSymbols,
    lifecycleHeldContext
  });
  const hfPayloadProbe = finalizeHfPayloadProbeSummary(hfPayloadProbeApplied.summary, dryExecBaseRaw);
  const dryExecBase = dryExecBaseRaw;
  console.log(
    `[STAGE6_CONTRACT] enforce=${dryExecBase.stage6Contract.enforce} checked=${dryExecBase.stage6Contract.checked} executable=${dryExecBase.stage6Contract.executable} watchlist=${dryExecBase.stage6Contract.watchlist} blocked=${dryExecBase.stage6Contract.blocked}`
  );
  console.log(
    `[ENTRY_FEASIBILITY] enforce=${dryExecBase.entryFeasibility.enforce} maxDistancePct=${dryExecBase.entryFeasibility.maxDistancePct} checked=${dryExecBase.entryFeasibility.checked} blocked=${dryExecBase.entryFeasibility.blocked}`
  );
  console.log(
    `[ACTION_INTENT] enabled=${dryExecBase.actionIntent.enabled} previewOnly=${dryExecBase.actionIntent.previewOnly} allowed=${dryExecBase.actionIntent.allowedActionTypes.join("/")} counts=ENTRY_NEW:${dryExecBase.actionIntent.counts.ENTRY_NEW},HOLD_WAIT:${dryExecBase.actionIntent.counts.HOLD_WAIT},SCALE_UP:${dryExecBase.actionIntent.counts.SCALE_UP},SCALE_DOWN:${dryExecBase.actionIntent.counts.SCALE_DOWN},EXIT_PARTIAL:${dryExecBase.actionIntent.counts.EXIT_PARTIAL},EXIT_FULL:${dryExecBase.actionIntent.counts.EXIT_FULL}`
  );
  const dryExecAfterRegime = applyEntryGuardToDryExec(dryExecBase, regime);
  const dryExec = applyGuardControlGateToDryExec(dryExecAfterRegime, guardControl);
  const hfShadow = computeHfShadowSummary(actionable, stage6.sha256, regime, guardControl, dryExec);
  await saveHfShadowSummary(hfShadow);
  const mode = buildRunModeLabel(dryExec, guardControl);
  const priorState = await loadRunState();
  const forceSendOnce = readBoolEnv("FORCE_SEND_ONCE", false);
  const forceSendKey = `${stage6.sha256}:${mode}`;
  const forceSendAlreadyConsumed = priorState?.lastForceSendKey === forceSendKey;
  const forceSendBypassDedupe = forceSendOnce && !forceSendAlreadyConsumed;

  if (forceSendOnce) {
    if (forceSendBypassDedupe) {
      console.warn(
        `[FORCE_SEND_ONCE] bypassing dedupe for one run key=${stage6.sha256.slice(0, 12)} (hash/mode scope)`
      );
    } else {
      console.warn(
        `[FORCE_SEND_ONCE] already consumed for current hash/mode key=${stage6.sha256.slice(0, 12)}`
      );
    }
  }

  if (!shouldSend(priorState, stage6, mode) && !forceSendBypassDedupe) {
    console.log(`[DEDUPE] SKIP send (same hash/mode) sha256=${stage6.sha256.slice(0, 12)} mode=${mode}`);
    await sendHeartbeatOnDedupe(stage6, mode);
    const dedupePreflight: PreflightResult = {
      enabled: readBoolEnv("PREFLIGHT_ENABLED", true),
      enforced: false,
      blocking: false,
      wouldBlockLive: false,
      simulatedLiveParity: cfg.simulationLiveParity && !cfg.execEnabled,
      status: "skip",
      code: "PREFLIGHT_NOT_RUN_DEDUPE",
      message: "dedupe skip: preflight not executed",
      requiredNotional: roundToCent(sumNotional(dryExec.payloads)),
      dailyMaxNotional: readNonNegativeNumberEnv("DAILY_MAX_NOTIONAL", 5000),
      allowEntryOutsideRth: readBoolEnv("ALLOW_ENTRY_OUTSIDE_RTH", false),
      accountStatus: null,
      buyingPower: null,
      marketOpen: null,
      nextOpen: null
    };
    const dedupeLedger: OrderLedgerUpdateResult = {
      enabled: readBoolEnv("ORDER_LIFECYCLE_ENABLED", true),
      targetStatus: "none",
      upserted: 0,
      transitioned: 0,
      unchanged: 0,
      pruned: 0
    };
    const dedupeBrokerSubmit: BrokerSubmitSummary = {
      enabled: readBoolEnv("LIVE_ORDER_SUBMIT_ENABLED", false),
      active: false,
      reason: "dedupe_skip",
      requirePerfGateGo: readBoolEnv("LIVE_ORDER_SUBMIT_REQUIRE_PERF_GATE_GO", true),
      requireHfLivePromotionPass: readBoolEnv(
        "LIVE_ORDER_SUBMIT_REQUIRE_HF_LIVE_PROMOTION_PASS",
        true
      ),
      perfGateStatus: "N/A",
      perfGateReason: "not_checked",
      hfLivePromotionStatus: "N/A",
      hfLivePromotionReason: "not_checked",
      attempted: 0,
      submitted: 0,
      failed: 0,
      skipped: 0,
      orders: {}
    };
    const dedupeApprovalGate = createApprovalQueueGateSummary(
      buildApprovalQueueGateConfig(),
      "not_evaluated_dedupe"
    );
    printRunSummary(
      "dedupe",
      stage6,
      actionable.length,
      dryExec,
      dedupePreflight,
      dedupeLedger,
      dedupeBrokerSubmit,
      dedupeApprovalGate,
      hfPayloadProbe,
      undefined,
      hfShadow,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    );
    return;
  }
  const preflightDryExec = await applyOrderIdempotency(stage6, dryExec, {
    persistNewEntries: false,
    phase: "preflight"
  });
  const preflight = await runPreflightGate(preflightDryExec);
  console.log(
    `[PREFLIGHT] status=${preflight.status.toUpperCase()} code=${preflight.code} enforced=${preflight.enforced} blocking=${preflight.blocking} wouldBlockLive=${preflight.wouldBlockLive} liveParity=${preflight.simulatedLiveParity} required=${preflight.requiredNotional.toFixed(2)} buyingPower=${preflight.buyingPower != null ? preflight.buyingPower.toFixed(2) : "N/A"}`
  );
  const preflightBlockingHardFail = readBoolEnv("PREFLIGHT_BLOCKING_HARD_FAIL", true);
  const preflightSoftCodes = new Set(
    String(process.env.PREFLIGHT_SOFT_CODES || "PREFLIGHT_MARKET_CLOSED")
      .split(",")
      .map((code) => code.trim())
      .filter(Boolean)
  );
  const preflightSoftCodeMatched = preflightSoftCodes.has(preflight.code);
  const shouldHardFailAfterSummary =
    preflight.blocking && cfg.execEnabled && preflightBlockingHardFail && !preflightSoftCodeMatched;
  if (preflight.blocking && cfg.execEnabled) {
    if (shouldHardFailAfterSummary) {
      console.warn(
        `[PREFLIGHT] blocking gate detected; continuing to produce full summary before hard-fail code=${preflight.code}`
      );
    } else if (!preflightBlockingHardFail) {
      console.log(
        `[PREFLIGHT] blocking gate suppressed by PREFLIGHT_BLOCKING_HARD_FAIL=false code=${preflight.code}`
      );
    } else if (preflightSoftCodeMatched) {
      console.log(
        `[PREFLIGHT] blocking gate suppressed by PREFLIGHT_SOFT_CODES code=${preflight.code}`
      );
    }
  }
  let finalDryExec = preflightDryExec;
  let approvalQueueGate = createApprovalQueueGateSummary(
    buildApprovalQueueGateConfig(),
    preflight.blocking ? "preflight_blocking" : "not_evaluated"
  );
  if (!preflight.blocking) {
    const approvalResult = await applyApprovalQueueGate(accessToken, stage6, preflightDryExec, preflight, cfg);
    approvalQueueGate = approvalResult.summary;
    finalDryExec = await applyOrderIdempotency(stage6, approvalResult.dryExec, {
      persistNewEntries: true,
      phase: "final"
    });
  } else {
    console.log(
      `[ORDER_IDEMP] phase=final deferred=true reason=preflight_blocking code=${preflight.code}`
    );
  }
  const postPreflightDryExec = applyPreflightGateToDryExec(finalDryExec, preflight);
  const hfDrift = await updateHfDriftAlert(stage6, postPreflightDryExec, actionable.length);
  const hfAlert = evaluateHfAnomalyAlert(hfShadow, hfDrift);
  const perfLoop = await updatePerformanceLoop(stage6, actionable, postPreflightDryExec, preflight);
  const hfShadowHistoryRecord = buildHfShadowHistoryRecord(
    stage6,
    postPreflightDryExec,
    hfShadow,
    hfAlert,
    perfLoop
  );
  const hfShadowTrend = await appendHfShadowHistory(hfShadowHistoryRecord);
  const hfTuningPhase = deriveHfTuningPhase(perfLoop, hfAlert, hfShadowTrend);
  const hfTuningAdvice = deriveHfTuningAdvice(hfTuningPhase, postPreflightDryExec);
  const hfFreeze = await updateHfFreezeSummary(hfTuningPhase, hfShadowTrend, hfAlert);
  const currentPayloadPathVerification = evaluateCurrentPayloadPathVerification(postPreflightDryExec, hfPayloadProbe);
  const payloadPathVerification = await resolvePayloadPathVerificationStatus(
    stage6.sha256,
    currentPayloadPathVerification
  );
  console.log(
    `[HF_PAYLOAD_PATH_STICKY] priorStage6Hash=${payloadPathVerification.stickyAudit.priorStage6Hash ? payloadPathVerification.stickyAudit.priorStage6Hash.slice(0, 12) : "none"} stage6HashChanged=${payloadPathVerification.stickyAudit.stage6HashChanged} stickyEligible=${payloadPathVerification.stickyAudit.stickyEligible} stickyCarried=${payloadPathVerification.stickyAudit.stickyCarried} stickyReset=${payloadPathVerification.stickyAudit.stickyReset} reason=${payloadPathVerification.stickyAudit.stickyResetReason} currentVerified=${payloadPathVerification.stickyAudit.currentVerified} currentSource=${payloadPathVerification.stickyAudit.currentSource} resolvedVerified=${payloadPathVerification.stickyAudit.resolvedVerified} resolvedSource=${payloadPathVerification.stickyAudit.resolvedSource}`
  );
  const hfLivePromotion = deriveHfLivePromotionSummary(
    perfLoop,
    hfFreeze,
    hfAlert,
    hfShadowTrend,
    hfPayloadProbe,
    payloadPathVerification
  );
  const brokerSubmit = await submitOrdersToBroker(postPreflightDryExec, preflight, hfLivePromotion);
  const ledger = await updateOrderLedger(stage6, mode, postPreflightDryExec, preflight, brokerSubmit);
  const hfNextAction = deriveHfNextActionSummary(
    hfLivePromotion,
    hfTuningPhase,
    hfTuningAdvice,
    hfFreeze,
    hfAlert
  );
  const hfDailyVerdict = deriveHfDailyVerdictSummary(
    hfLivePromotion,
    hfNextAction,
    hfAlert,
    hfTuningPhase
  );
  const hfPayloadProbeStatus = deriveHfPayloadProbeGateSummary(postPreflightDryExec, hfPayloadProbe);
  const hfEvidenceRecord = buildHfEvidenceHistoryRecord(
    stage6,
    postPreflightDryExec,
    hfLivePromotion,
    hfPayloadProbeStatus,
    hfAlert,
    perfLoop
  );
  const hfEvidenceSummary = await appendHfEvidenceHistory(hfEvidenceRecord);
  await saveDryExecPreview(
    stage6,
    postPreflightDryExec,
    preflight,
    ledger,
    brokerSubmit,
    hfPayloadProbe,
    guardControl,
    approvalQueueGate,
    hfDrift,
    hfShadow,
    hfAlert,
    hfShadowTrend,
    hfTuningPhase,
    hfTuningAdvice,
    hfFreeze,
    hfLivePromotion,
    hfNextAction,
    hfDailyVerdict,
    payloadPathVerification.stickyAudit,
    hfEvidenceSummary
  );
  await sendSimulationTelegram(
    stage6,
    actionable,
    actionableVerdicts,
    postPreflightDryExec,
    preflight,
    ledger,
    brokerSubmit,
    guardControl,
    hfLivePromotion,
    hfPayloadProbe,
    hfNextAction
  );
  await sendPerformanceLoopMilestoneAlert(perfLoop);
  if (preflight.blocking && cfg.execEnabled) {
    console.log(
      `[STATE] skip saveRunState due preflight blocking (code=${preflight.code}) to keep rerun eligibility on same stage6 hash`
    );
  } else {
    await saveRunState(stage6, mode, priorState, forceSendBypassDedupe ? forceSendKey : undefined);
  }
  const runSummaryEvent: "sent" | "blocked_preflight" = shouldHardFailAfterSummary
    ? "blocked_preflight"
    : "sent";
  printRunSummary(
    runSummaryEvent,
    stage6,
    actionable.length,
    postPreflightDryExec,
    preflight,
    ledger,
    brokerSubmit,
    approvalQueueGate,
    hfPayloadProbe,
    hfDrift,
    hfShadow,
    hfAlert,
    hfShadowTrend,
    hfTuningPhase,
    hfTuningAdvice,
    hfFreeze,
    hfLivePromotion,
    hfNextAction,
    hfDailyVerdict,
    payloadPathVerification.stickyAudit,
    hfEvidenceSummary
  );
  if (shouldHardFailAfterSummary) {
    throw new Error(`Preflight blocked execution: ${preflight.code} | ${preflight.message}`);
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[DRY_RUN] FAIL ${message}`);
  if (error instanceof Error) {
    console.error(`[DRY_RUN] ERROR_CLASS ${error.name}`);
    if (error.stack) {
      console.error(`[DRY_RUN] STACK ${error.stack}`);
    }
  }
  try {
    await sendFailureAlert(message);
  } catch (notifyError) {
    const notifyMessage = notifyError instanceof Error ? notifyError.message : String(notifyError);
    console.error(`[DRY_RUN] ALERT_NOTIFY_FAIL ${notifyMessage}`);
  }
  process.exit(1);
});
