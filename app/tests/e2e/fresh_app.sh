#!/bin/zsh
# Start the app on fresh data (port 5152, or MPH_TEST_PORT) with the October inward imported. Usage: fresh_app.sh <data-dir> [log-name]
# Fresh data starts from the real v0.4 seed named by Workbooks/private-test-data.json (see private-data.js); skipped without it.
set -u
E2E=${0:A:h}
PORT=${MPH_TEST_PORT:-5152}
export MPH_PORT=$PORT
MPH_DLL=${MPH_DLL:-"${E2E:h:h}/src/MPHRegister.Api/bin/Debug/net10.0/MPH Register.dll"}
INWARD="$(node $E2E/private-data.js workbooks)/INWARD REG.-OCT.-26-27.xlsm"
SEED=$(node $E2E/private-data.js seed) || exit $(( $? == 3 ? 0 : 1 ))
B=http://127.0.0.1:$PORT
lsof -ti tcp:$PORT | xargs kill 2>/dev/null; sleep 0.5
rm -rf $1 && mkdir -p $1 && cp "$SEED" $1/mph-data.db
(cd /tmp && MPH_DATA_DIR=$1 MPH_NO_BROWSER=1 nohup dotnet "$MPH_DLL" > /tmp/mph-${2:-fresh}.log 2>&1 &)
for i in {1..80}; do curl -s -o /dev/null $B/api/info && break; sleep 0.25; done
[[ ${3:-import} == import ]] && curl -s -X POST -H 'X-MPH-Request: 1' -F "file=@$INWARD" -F commit=true $B/api/import > /dev/null
curl -s $B/api/info
