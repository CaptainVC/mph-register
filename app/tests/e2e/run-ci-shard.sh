#!/bin/sh
set -eu

shard=${1:?Usage: sh tests/e2e/run-ci-shard.sh <1|2|3|4>}
case "$shard" in
  1)
    set -- ui-register-financial-year ui-register-search ui-financial-year-views ui-dashboard-party ui-dashboard-compare ui-invoice-undo ui-bills-bulk ui-invoice-restore ui-partywise
    ;;
  2)
    set -- ui-party-filter-clear ui-controls ui-row-filters ui-partywise ui-bill-row-moves ui-select-fit ui-bill-count ui-register-bill-no ui-register-warnings
    ;;
  3)
    set -- ui-sticky-columns ui-no-bill-party ui-sister-firms ui-bill-no-edit ui-i18n ui-inline-edit ui-entry-delete ui-excel-export ui-return-to-origin ui-partywise-stock
    ;;
  4)
    set -- ui-import-marks ui-import-history ui-toast-click-through ui-updates ui-rollback ui-aawak ui-aawak-totals ui-linked-entry ui-date-picker ui-laptop-layout
    ;;
  *)
    printf 'Unknown screen-regression shard: %s\n' "$shard" >&2
    exit 2
    ;;
esac

export MPH_PORT="${MPH_PORT:-5160}"
export MPH_BASE_URL="${MPH_BASE_URL:-http://127.0.0.1:$MPH_PORT}"
export MPH_NO_BROWSER="${MPH_NO_BROWSER:-1}"
export MPH_BROWSER_CHANNEL="${MPH_BROWSER_CHANNEL:-chromium}"
: "${MPH_DATA_DIR:?MPH_DATA_DIR must point to a fresh test directory}"

log_dir=${RUNNER_TEMP:-${TMPDIR:-/tmp}}
dotnet "src/backend/MPHRegister.Api/bin/Debug/net10.0/MPH Register.dll" > "$log_dir/mph-register-shard-$shard.log" 2>&1 &
app_pid=$!
trap 'kill "$app_pid" 2>/dev/null || true' EXIT

ready=false
attempt=0
while [ "$attempt" -lt 40 ]; do
  if curl --fail --silent "$MPH_BASE_URL/api/info" > /dev/null; then
    ready=true
    break
  fi
  sleep 0.5
  attempt=$((attempt + 1))
done
if [ "$ready" != true ]; then
  printf 'The app did not become ready for shard %s. See %s/mph-register-shard-%s.log.\n' "$shard" "$log_dir" "$shard" >&2
  exit 1
fi

for test in "$@"; do
  printf 'Running %s (shard %s)\n' "$test" "$shard"
  node "tests/e2e/$test.js"
done
