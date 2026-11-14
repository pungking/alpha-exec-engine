#!/usr/bin/env bash
set -eu
umask 077
private_dir=$(mktemp -d "${RUNNER_TEMP:?}/sidecar-private.XXXXXX")
# Keep existing producers and their step outputs unchanged, but not their public logs.
export GITHUB_STEP_SUMMARY="$private_dir/summary.md"
status=0
# Provenance only: failures never rerun or prevent the existing producer.
binding=false
if [[ -n "${PAPER_EVIDENCE_PHASE:-}" && "${GITHUB_WORKFLOW:-}" == "sidecar-dry-run" && ( "${GITHUB_EVENT_NAME:-}" == "schedule" || "${GITHUB_EVENT_NAME:-}" == "repository_dispatch" ) ]]; then
  binding=true
  node scripts/paper-runtime-private-binding.mjs begin "$PAPER_EVIDENCE_PHASE" > "$private_dir/binding-begin.log" 2>&1 || true
fi
bash --noprofile --norc -eo pipefail "$1" > "$private_dir/output.log" 2>&1 || status=$?
if [[ "$binding" == true ]]; then
  node scripts/paper-runtime-private-binding.mjs finish "$PAPER_EVIDENCE_PHASE" "$status" > "$private_dir/binding-end.log" 2>&1 || true
fi
if [[ "$status" -ne 0 && "${PAPER_EVIDENCE_PHASE:-}" == "preview" && "${GITHUB_WORKFLOW:-}" == "sidecar-dry-run" ]]; then
  classification=$(node scripts/classify-private-sidecar-failure.mjs "$private_dir/output.log" 2>/dev/null) || classification=UNKNOWN
  # Defensive allowlist even if the classifier is replaced or fails unexpectedly.
  case "$classification" in
    ENVIRONMENT_MISSING|DRIVE_AUTH_FAILURE|STAGE6_READ_FAILURE|STAGE6_TRIGGER_REJECTED|UNKNOWN) ;;
    *) classification=UNKNOWN ;;
  esac
  printf '[SIDECAR_BOOTSTRAP_CLASS] class=%s rawOutputPublished=false rootCauseVerified=false\n' "$classification"
fi
printf '[SIDECAR_PRIVATE_STEP] exitCode=%s rawOutputPublished=false\n' "$status"
exit "$status"
