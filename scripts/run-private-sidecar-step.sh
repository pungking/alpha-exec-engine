#!/usr/bin/env bash
set -eu
umask 077
private_dir=$(mktemp -d "${RUNNER_TEMP:?}/sidecar-private.XXXXXX")
# Keep existing producers and their step outputs unchanged, but not their public logs.
export GITHUB_STEP_SUMMARY="$private_dir/summary.md"
status=0
bash --noprofile --norc -eo pipefail "$1" > "$private_dir/output.log" 2>&1 || status=$?
printf '[SIDECAR_PRIVATE_STEP] exitCode=%s rawOutputPublished=false\n' "$status"
exit "$status"
