export const DEFAULT_POLICY_VERSION = "stage6-exec-v1.0-rc1";

export type SidecarRuntimeConfig = {
  execEnabled: boolean;
  readOnly: boolean;
  policyVersion: string;
  timezone: string;
};

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

export function loadRuntimeConfig(): SidecarRuntimeConfig {
  return {
    execEnabled: envBool(process.env.EXEC_ENABLED, false),
    readOnly: envBool(process.env.READ_ONLY, true),
    policyVersion: process.env.POLICY_VERSION?.trim() || DEFAULT_POLICY_VERSION,
    timezone: process.env.TZ?.trim() || "America/New_York"
  };
}
