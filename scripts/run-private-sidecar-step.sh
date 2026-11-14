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
# Issue #91: optional failure-only preview diagnostic. Only existing safe
# scheduled/repository dispatch binding events may enter this branch.
# "timeout" and "env -i" are GNU runner tools; missing tools fail closed.
if [[ "$binding" == true && "$PAPER_EVIDENCE_PHASE" == "preview" && "$status" -ne 0 ]]; then
  class=UNKNOWN
  private_class_stdout="$private_dir/classifier.stdout"
  # The helper bounds BOTH classifier stdout and stderr in memory; neither
  # raw stream nor helper diagnostics may reach the public runner log.
  # The outer timeout additionally bounds the helper itself.
  if (set -o pipefail; timeout --signal=TERM --kill-after=1s 4s \
      env -i PATH="$PATH" \
      node scripts/probe-private-sidecar-diagnostic.mjs "$private_dir/output.log" \
      | head -c 1025 > "$private_class_stdout") 2>/dev/null; then
    # Suppress redirection errors BEFORE opening a private file: a failed
    # redirection must never print its pathname to public stderr.
    if class_bytes=$(wc -c 2>/dev/null < "$private_class_stdout"); then
      if [[ "$class_bytes" -ge 1 && "$class_bytes" -le 32 ]]; then
        class_candidate=''
        if IFS= read -r class_candidate 2>/dev/null < "$private_class_stdout"; then
          expected_bytes=$(printf '%s\n' "$class_candidate" | wc -c) || expected_bytes=0
          if [[ "$class_bytes" -eq "$expected_bytes" ]]; then
            case "$class_candidate" in
              ENVIRONMENT_MISSING|DRIVE_AUTH_FAILURE|STAGE6_READ_FAILURE|STAGE6_TRIGGER_REJECTED|UNKNOWN)
                class="$class_candidate"
                ;;
            esac
          fi
        fi
      fi
    fi
  fi
  printf 'class=%s rawOutputPublished=false rootCauseVerified=false\n' "$class"
fi
printf '[SIDECAR_PRIVATE_STEP] exitCode=%s rawOutputPublished=false\n' "$status"
exit "$status"
