#!/bin/zsh
# Every suite, each on fresh data, on port 5152 (never touches the try-out app on 5151).
# "Fresh data" starts from the real v0.4 seed (Workbooks/private-test-data.json names it, see private-data.js; the
# committed tests/fixtures/v04-seeded.db is synthetic): the app moves its frozen seed lists into a new config file,
# so the suites never depend on the real config file (which the user may change). Skipped without the private file.
set -u
export MPH_PORT=5152
E2E=${0:A:h}
SEED=$(node $E2E/private-data.js seed) || exit $(( $? == 3 ? 0 : 1 ))
APP_ROOT=${E2E:h:h}
ROOT=${APP_ROOT:h}
API=$APP_ROOT/src/backend/MPHRegister.Api
export MPH_DLL="$API/bin/Debug/net10.0/MPH Register.dll"
export NODE_PATH=${NODE_PATH:-/tmp/mph-ui-test/node_modules}
PY=${MPH_PY:-/tmp/mph-workbook-analysis-env/bin/python}
B=http://127.0.0.1:5152
WB=$(node $E2E/private-data.js workbooks)
INWARD="$WB/INWARD REG.-OCT.-26-27.xlsm"
BILLS="$WB/MPH BILL--OCT.-26-27.xlsm"
H='X-MPH-Request: 1'
SHA_IN=$(shasum -a 256 "$INWARD" | cut -d' ' -f1); SHA_BI=$(shasum -a 256 "$BILLS" | cut -d' ' -f1)
results=()
fresh() {
  lsof -ti tcp:5152 | xargs kill 2>/dev/null; sleep 0.5
  rm -rf $1 && mkdir -p $1 && cp "$SEED" $1/mph-data.db
  (MPH_DATA_DIR=$1 MPH_NO_BROWSER=1 dotnet "$MPH_DLL" > /tmp/mph-all-$2.log 2>&1 &)
  for i in {1..60}; do curl -s -o /dev/null $B/api/info && break; sleep 0.25; done
  curl -s -X POST -H "$H" -F "file=@$INWARD" -F commit=true $B/api/import > /dev/null
}
run() { local name=$1; shift; "$@" > /tmp/mph-all-$name.out 2>&1; local code=$?; results+=("$name=$code"); tail -3 /tmp/mph-all-$name.out | sed "s/^/  [$name] /"; }

lsof -ti tcp:5152 | xargs kill 2>/dev/null; sleep 1
(cd $APP_ROOT && dotnet build MPHRegister.sln -nologo -v q 2>&1 | grep -E 'error|warning|Build succeeded' | sort -u)
run unit dotnet test $APP_ROOT/MPHRegister.sln --no-build -nologo -v q
[[ -f /tmp/mph_bills.json ]] || $PY $APP_ROOT/tools/mph_bill_extract.py "$BILLS" > /dev/null
run inward zsh $E2E/mph_full_test.sh
fresh /tmp/mph-all-billing billing; run billing-api node $E2E/mph_billing_tests.mjs
fresh /tmp/mph-all-import import
curl -s -X POST -H "$H" -F "file=@$BILLS" -F commit=true $B/api/billing/import > /tmp/mph-billimport.json
run bill-import node $E2E/mph_billimport_summary.js
run bill-verify $PY $E2E/mph_verify_bills.py
fresh /tmp/mph-all-ui ui; run billing-ui node $E2E/ui-billing.js
run controls-ui node $E2E/ui-controls.js
run partywise-ui node $E2E/ui-partywise.js
fresh /tmp/mph-all-dash dash; run dashboard-ui node $E2E/ui-dashboard.js
lsof -ti tcp:5152 | xargs kill 2>/dev/null
run resilience zsh $E2E/mph_resilience.sh
echo "WORKBOOKS UNCHANGED: $([ "$SHA_IN" = "$(shasum -a 256 "$INWARD" | cut -d' ' -f1)" ] && [ "$SHA_BI" = "$(shasum -a 256 "$BILLS" | cut -d' ' -f1)" ] && echo YES || echo NO)"
echo "RESULTS ${results[*]}"
echo "TRY-OUT APP ON 5151 STILL RUNNING: $(lsof -nP -iTCP:5151 -sTCP:LISTEN >/dev/null && echo YES || echo NO)"
[[ "${results[*]}" != *"=1"* ]]
