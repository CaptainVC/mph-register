#!/bin/zsh
# Full regression run: fresh data folder, start app, import, verify every value, API tests, browser tests.
# The fresh data folder starts from the real v0.4 seed named by Workbooks/private-test-data.json (see private-data.js).
set -u
export MPH_PORT=5152
E2E=${0:A:h}
SEED=$(node $E2E/private-data.js seed) || exit $(( $? == 3 ? 0 : 1 ))
APP_ROOT=${E2E:h:h}
ROOT=${APP_ROOT:h}
MPH_DLL=${MPH_DLL:-"$APP_ROOT/src/MPHRegister.Api/bin/Debug/net10.0/MPH Register.dll"}
export NODE_PATH=${NODE_PATH:-/tmp/mph-ui-test/node_modules}
PY=${MPH_PY:-/tmp/mph-workbook-analysis-env/bin/python}
DATA=/tmp/mph-app-test
WORKBOOK="${MPH_WORKBOOKS:-${ROOT:h}/Workbooks}/INWARD REG.-OCT.-26-27.xlsm"
B=http://127.0.0.1:5152

[[ -z ${MPH_BIN:-} ]] && (cd $APP_ROOT && dotnet build MPHRegister.sln -nologo -v q 2>&1 | grep -E 'error|warning|Build succeeded' | sort -u)
rm -rf $DATA && mkdir -p $DATA && cp "$SEED" $DATA/mph-data.db
if [[ -n ${MPH_BIN:-} ]]; then
  (cd /tmp && MPH_DATA_DIR=$DATA MPH_NO_BROWSER=1 "$MPH_BIN" > /tmp/mph-app.log 2>&1) &
else
  (cd /tmp && MPH_DATA_DIR=$DATA MPH_NO_BROWSER=1 dotnet "$MPH_DLL" > /tmp/mph-app.log 2>&1) &
fi
APP_PID=$!
for i in {1..40}; do curl -s -o /dev/null $B/api/info && break; sleep 0.25; done

SHA_BEFORE=$(shasum -a 256 "$WORKBOOK" | cut -d' ' -f1)
curl -s -X POST -H 'X-MPH-Request: 1' -F "file=@$WORKBOOK" -F commit=true $B/api/import \
  | node -e 'const r=JSON.parse(require("fs").readFileSync(0));console.log("IMPORT imported",r.imported,"entries",r.entries,"dispatches",r.dispatches,"errors",r.errors.length,"warnings",r.warnings.length)'
$PY $E2E/mph_verify_import.py "$WORKBOOK" $DATA/mph-data.db; VERIFY=$?
node $E2E/mph_api_tests.mjs; API=$?
node $E2E/ui-test.js; UI=$?
SHA_AFTER=$(shasum -a 256 "$WORKBOOK" | cut -d' ' -f1)
echo "WORKBOOK UNCHANGED: $([ "$SHA_BEFORE" = "$SHA_AFTER" ] && echo YES || echo NO)"

kill $APP_PID; wait $APP_PID 2>/dev/null; lsof -ti tcp:5152 | xargs kill 2>/dev/null
head -2 /tmp/mph-app.log
echo "RESULTS verify=$VERIFY api=$API ui=$UI"
[[ $VERIFY -eq 0 && $API -eq 0 && $UI -eq 0 && "$SHA_BEFORE" = "$SHA_AFTER" ]]
