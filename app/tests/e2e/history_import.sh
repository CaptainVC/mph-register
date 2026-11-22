#!/bin/zsh
# Import every month's inward register (Apr→Nov) and bill workbook (Apr→Oct) into fresh data on port 5152 (or MPH_TEST_PORT),
# apply the confirmed corrections and sister-firm groups (both kept next to the workbooks, named by
# Workbooks/private-test-data.json, see private-data.js) before the bills, then verify. Usage: history_import.sh [data-dir]
# The data folder is emptied first; build into a scratch folder and copy the two files where they belong.
set -u
E2E=${0:A:h}
CORRECTIONS=$(node $E2E/private-data.js corrections) || exit $(( $? == 3 ? 0 : 1 ))
GROUPS=$(node $E2E/private-data.js sisterGroups) || exit 1
APP_ROOT=${E2E:h:h}
ROOT=${APP_ROOT:h}
WB=$(node $E2E/private-data.js workbooks)
HISTORY=$WB/History
PY=${MPH_PY:-/tmp/mph-workbook-analysis-env/bin/python}
export MPH_TEST_PORT=${MPH_TEST_PORT:-5152}
B=http://127.0.0.1:$MPH_TEST_PORT
export BASE=$B
H='X-MPH-Request: 1'
DATA=${1:-/tmp/mph-history}
zsh $E2E/fresh_app.sh $DATA history noimport > /dev/null
summary() { node -e '
const r = JSON.parse(require("fs").readFileSync(0));
if (r.registerMonth !== undefined) console.log(`  inward ${r.registerMonth} imported=${r.imported} new=${r.entries} carry-rows=${r.carriedOver} merged=${r.mergedCarryovers} than=${r.than} errors=${r.errors.length} warnings=${r.warnings.length}`, r.errors.slice(0, 3).map((e) => `[row ${e.row}] ${e.message}`).join(" | "));
else console.log(`  bills ${r.fileName} imported=${r.imported} bills=${r.invoices} total=${r.total} linked=${r.linkedEntries} unmatched=${r.unmatchedLines.length} suggestions=${r.suggestions.length} added=${r.addedParties.length} errors=${r.errors.length}`, r.errors.slice(0, 3).join(" | "));
'; }
inward() { curl -s -X POST -H "$H" -F "file=@$1" -F "month=$2" -F commit=true $B/api/import | tee /tmp/mph-history-inward-$2.json | summary; }
bills() { curl -s -X POST -H "$H" -F "file=@$1" -F commit=true $B/api/billing/import | tee /tmp/mph-history-bills-$2.json | summary; }

echo "INWARD (oldest first)"
inward "$HISTORY/Inwards/INWARD REG.-APR.-26-27.xlsm" 2026-04
inward "$HISTORY/Inwards/INWARD REG.-MAY.-26-27.xlsm" 2026-05
inward "$HISTORY/Inwards/INWARD REG.-JUN.-26-29.xlsm" 2026-06
inward "$HISTORY/Inwards/INWARD REG.-JUL.-26-27.xlsm" 2026-07
inward "$HISTORY/Inwards/INWARD REG.-AUG.-26-27.xlsm" 2026-08
inward "$HISTORY/Inwards/INWARD REG.-SEP.-26-27.xlsm" 2026-09
inward "$WB/INWARD REG.-OCT.-26-27.xlsm" 2026-10
inward "$HISTORY/Inwards/INWARD REG.-NOV.-26-27.xlsm" 2026-11
echo "CORRECTIONS"
node $E2E/apply_corrections.mjs $CORRECTIONS || exit 1
node $E2E/set_sister_groups.mjs $GROUPS || exit 1
echo "BILLS (oldest first)"
bills "$HISTORY/Bills/MPH BILL--APR.-26-27.xlsm" apr
bills "$HISTORY/Bills/MPH BILL--MAY.-26-27.xlsm" may
bills "$HISTORY/Bills/MPH BILL--JUN.-26-27.xlsm" jun
bills "$HISTORY/Bills/MPH BILL--JUL.-26-27.xlsm" jul
bills "$HISTORY/Bills/MPH BILL--AUG.-26-27.xlsm" aug
bills "$HISTORY/Bills/MPH BILL--SEP.-26-27.xlsm" sep
bills "$WB/MPH BILL--OCT.-26-27.xlsm" oct
$PY $E2E/verify_history.py "$DATA/mph-data.db" "$HISTORY" "$WB" $CORRECTIONS
