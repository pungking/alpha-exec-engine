export const DEFAULT_POLICY_VERSION = "stage6-exec-v1.0-rc1";

export type LifecycleActionType =
  | "ENTRY_NEW"
  | "HOLD_WAIT"
  | "SCALE_UP"
  | "SCALE_DOWN"
  | "EXIT_PARTIAL"
  | "EXIT_FULL";

export type PositionLifecycleConfig = {
  enabled: boolean;
  previewOnly: boolean;
  allowedActionTypes: LifecycleActionType[];
  priorities: Record<LifecycleActionType, number>;
  scaleUpMinConviction: number;
  scaleDownPct: number;
  exitPartialPct: number;
};

export type SidecarRuntimeConfig = {
  execEnabled: boolean;
  readOnly: boolean;
  simulationLiveParity: boolean;
  policyVersion: string;
  timezone: string;
  positionLifecycle: PositionLifecycleConfig;
};

const DEFAULT_ACTION_PRIORITIES: Record<LifecycleActionType, number> = {
  ENTRY_NEW: 4,
  HOLD_WAIT: 3,
  SCALE_UP: 5,
  SCALE_DOWN: 2,
  EXIT_PARTIAL: 2,
  EXIT_FULL: 1
};

const LIFECYCLE_ACTION_SET = new Set<LifecycleActionType>([
  "ENTRY_NEW",
  "HOLD_WAIT",
  "SCALE_UP",
  "SCALE_DOWN",
  "EXIT_PARTIAL",
  "EXIT_FULL"
]);

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function envNumber(value: string | undefined, fallback: number): number {
  if (value == null || !value.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function parseLifecycleActionTypes(
  rawValue: string | undefined,
  fallback: LifecycleActionType[]
): LifecycleActionType[] {
  if (!rawValue || !rawValue.trim()) return fallback;
  const mapped = rawValue
    .split(",")
    .map((token) => token.trim().toUpperCase())
    .filter((token): token is LifecycleActionType => LIFECYCLE_ACTION_SET.has(token as LifecycleActionType));
  if (mapped.length === 0) return fallback;
  return Array.from(new Set(mapped));
}

export function loadRuntimeConfig(): SidecarRuntimeConfig {
  const scaleUpMinConviction = Math.max(
    0,
    Math.min(100, envNumber(process.env.POSITION_LIFECYCLE_SCALE_UP_MIN_CONVICTION, 82))
  );
  const scaleDownPct = Math.max(
    0.01,
    Math.min(1, envNumber(process.env.POSITION_LIFECYCLE_SCALE_DOWN_PCT, 0.35))
  );
  const exitPartialPct = Math.max(
    0.01,
    Math.min(1, envNumber(process.env.POSITION_LIFECYCLE_EXIT_PARTIAL_PCT, 0.5))
  );
  const lifecycleFallbackActions: LifecycleActionType[] = ["ENTRY_NEW", "HOLD_WAIT"];
  const lifecycleActions = parseLifecycleActionTypes(
    process.env.POSITION_LIFECYCLE_ACTION_TYPES,
    lifecycleFallbackActions
  );

  return {
    execEnabled: envBool(process.env.EXEC_ENABLED, false),
    readOnly: envBool(process.env.READ_ONLY, true),
    simulationLiveParity: envBool(process.env.SIMULATION_LIVE_PARITY, true),
    policyVersion: process.env.POLICY_VERSION?.trim() || DEFAULT_POLICY_VERSION,
    timezone: process.env.TZ?.trim() || "America/New_York",
    positionLifecycle: {
      enabled: envBool(process.env.POSITION_LIFECYCLE_ENABLED, false),
      previewOnly: envBool(process.env.POSITION_LIFECYCLE_PREVIEW_ONLY, true),
      allowedActionTypes: lifecycleActions,
      priorities: { ...DEFAULT_ACTION_PRIORITIES },
      scaleUpMinConviction,
      scaleDownPct,
      exitPartialPct
    }
  };
}
