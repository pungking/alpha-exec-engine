const toNum = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const boolFromEnv = (key, fallback = true) => {
  const raw = process.env[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
};

const parsePositive = (key, fallback) => {
  const n = Number(process.env[key] ?? fallback);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const parseNonNegative = (key, fallback) => {
  const n = Number(process.env[key] ?? fallback);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const guardRiskConfig = () => ({
  enabled: boolFromEnv("OCO_REPAIR_GUARD_RISK_ENABLED", true),
  maxAgeMin: parsePositive("OCO_REPAIR_GUARD_METADATA_MAX_AGE_MIN", 30),
  nearBreachPct: parseNonNegative("OCO_REPAIR_GUARD_NEAR_BREACH_PCT", 1)
});

export const ageMinutes = (iso, nowMs = Date.now()) => {
  const t = Date.parse(String(iso || ""));
  if (!Number.isFinite(t) || t <= 0) return null;
  return (nowMs - t) / 60000;
};

const round = (value, digits = 4) => {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
};

export const evaluateGuardMetadataRisk = ({
  generatedAt,
  currentPrice,
  plannedStopPrice,
  plannedTargetPrice,
  nowMs = Date.now(),
  config = guardRiskConfig()
}) => {
  const current = toNum(currentPrice);
  const stop = toNum(plannedStopPrice);
  const target = toNum(plannedTargetPrice);
  const ageMinRaw = ageMinutes(generatedAt, nowMs);
  const ageMin = round(ageMinRaw, 2);
  const stale = config.enabled && (ageMinRaw == null || ageMinRaw > config.maxAgeMin);
  const stopDistancePct = current != null && stop != null && current > 0 ? ((current - stop) / current) * 100 : null;
  const targetDistancePct = current != null && target != null && current > 0 ? ((target - current) / current) * 100 : null;
  const stopBreached = current != null && stop != null && current <= stop;
  const targetBreached = current != null && target != null && current >= target;
  const nearStopBreach =
    config.enabled &&
    !stopBreached &&
    stopDistancePct != null &&
    stopDistancePct >= 0 &&
    stopDistancePct <= config.nearBreachPct;
  const nearTargetBreach =
    config.enabled &&
    !targetBreached &&
    targetDistancePct != null &&
    targetDistancePct >= 0 &&
    targetDistancePct <= config.nearBreachPct;

  const blockers = [];
  if (stale) blockers.push("guard_metadata_stale");
  if (stopBreached || targetBreached) blockers.push("guard_metadata_breached");
  if (nearStopBreach || nearTargetBreach) blockers.push("guard_metadata_near_breached");

  return {
    generatedAt: generatedAt || null,
    ageMin,
    maxAgeMin: config.maxAgeMin,
    nearBreachPct: config.nearBreachPct,
    enabled: config.enabled,
    stopDistancePct: round(stopDistancePct),
    targetDistancePct: round(targetDistancePct),
    stale,
    stopBreached,
    targetBreached,
    nearStopBreach,
    nearTargetBreach,
    blockers,
    status: blockers.length ? "BLOCK" : "PASS"
  };
};
