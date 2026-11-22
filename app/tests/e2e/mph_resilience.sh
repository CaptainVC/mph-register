#!/bin/zsh
# Resilience: restarts, hard kills mid-save, backups, single instance, damaged/empty/newer data and config files.
# Starts from an empty folder, so it also covers the empty "skeleton" config: the import adds the register's parties as inactive.
set -u
export MPH_PORT=5152
E2E=${0:A:h}
APP_DLL=${MPH_DLL:-"${E2E:h:h}/src/MPHRegister.Api/bin/Debug/net10.0/MPH Register.dll"}
WORKBOOK="$(node $E2E/private-data.js workbooks)/INWARD REG.-OCT.-26-27.xlsm"
# A party of the October register for the saves (real names come from the private file, see private-data.js).
PARTY=$(node $E2E/private-data.js parties.bigParty) || exit $(( $? == 3 ? 0 : 1 ))
B=http://127.0.0.1:5152
H='X-MPH-Request: 1'
PASS=0; FAILS=()
ok() { if eval "$2"; then PASS=$((PASS+1)); else FAILS+=("$1"); fi }
run_app() { if [[ -n ${MPH_BIN:-} ]]; then exec "$MPH_BIN"; else exec dotnet "$APP_DLL"; fi }
start() { MPH_DATA_DIR=$1 MPH_NO_BROWSER=1 run_app < /dev/null > /tmp/mph-res.log 2>&1 & APP=$!; for i in {1..60}; do curl -s -o /dev/null $B/api/info && return 0; kill -0 $APP 2>/dev/null || return 1; sleep 0.2; done; return 1; }
stop() { kill ${2:-} $APP 2>/dev/null; wait $APP 2>/dev/null; }
count() { curl -s $B/api/info | node -pe 'JSON.parse(require("fs").readFileSync(0)).entries'; }
db_count() { sqlite3 "$1" "select count(*) from entries;"; }
backups() { print -l $1/backups/mph-data-*.db(N) | grep -c . ; }
entry() { echo "{\"registerMonth\":\"2026-11\",\"inwardNo\":$1,\"entryDate\":\"2026-11-03\",\"party\":\"$PARTY\",\"designNo\":\"D$1\",\"lotNo\":\"\",\"repair\":false,\"than\":10,\"tp\":0,\"twoPart\":0,\"finish\":\"S2G\",\"shortThan\":null,\"dispatches\":[{\"qty\":4,\"gatePass\":\"G$1\",\"date\":\"2026-11-04\"}]}"; }

D=/tmp/mph-res; rm -rf $D; mkdir -p $D

# 1. Fresh start, import, restart keeps everything.
start $D; ok "fresh start" '[[ $? -eq 0 ]]'
ok "fresh start makes no backup" '[[ $(backups $D) -eq 0 ]]'
curl -s -X POST -H "$H" -F "file=@$WORKBOOK" -F commit=true $B/api/import > /dev/null
ok "import 985" '[[ $(count) -eq 985 ]]'
stop
start $D
ok "data survives normal restart" '[[ $(count) -eq 985 ]]'
ok "backup on start (import backup + start backup)" '[[ $(backups $D) -eq 2 ]]'
NEWEST=$(ls $D/backups/mph-data-*-start.db | tail -1)
ok "start backup is a complete, healthy copy" '[[ $(db_count $NEWEST) -eq 985 && $(sqlite3 $NEWEST "pragma integrity_check") == ok ]]'

# 2. Hard kill (like a power cut) while saving: every acknowledged save must survive.
ACKED=0
( for n in {1..400}; do code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$H" -H 'Content-Type: application/json' -d "$(entry $n)" $B/api/entries); [[ $code == 200 ]] && echo $n >> $D/acked.txt; done ) &
LOOP=$!
sleep 1.5
kill -9 $APP; wait $APP 2>/dev/null; wait $LOOP 2>/dev/null
ACKED=$(wc -l < $D/acked.txt | tr -d ' ')
echo "acknowledged saves before kill -9: $ACKED"
ok "some saves happened before the kill" '[[ $ACKED -gt 5 ]]'
ok "integrity ok after kill -9" '[[ $(sqlite3 $D/mph-data.db "pragma integrity_check") == ok ]]'
ok "foreign keys ok after kill -9" '[[ -z $(sqlite3 $D/mph-data.db "pragma foreign_key_check") ]]'
SAVED=$(sqlite3 $D/mph-data.db "select count(*) from entries where register_month='2026-11'")
ok "every acknowledged save survived (acked=$ACKED saved=$SAVED)" '[[ $SAVED -ge $ACKED && $SAVED -le $((ACKED+1)) ]]'
ok "no half-saved entry (each Nov entry has its dispatch)" '[[ $(sqlite3 $D/mph-data.db "select count(*) from entries e where register_month=\"2026-11\" and not exists (select 1 from dispatches d where d.entry_id=e.id)") -eq 0 ]]'
start $D
ok "restarts cleanly after kill -9" '[[ $(count) -eq $((985+SAVED)) ]]'

# 3. Second launch while running: exits quickly, first keeps serving.
(MPH_DATA_DIR=$D MPH_NO_BROWSER=1 run_app) < /dev/null > /tmp/mph-res2.log 2>&1
SECOND=$?
ok "second launch exits cleanly" '[[ $SECOND -eq 0 ]] && grep -q "already running" /tmp/mph-res2.log'
ok "first instance still serving" '[[ $(count) -eq $((985+SAVED)) ]]'
stop

# 4. Backup rotation keeps 30.
for i in {1..35}; do : > $D/backups/mph-data-2020010$((i%9+1))-0000$((i%10))0-$(printf %03d $i)-start.db; done
start $D; stop
ok "backups trimmed to 30" '[[ $(backups $D) -eq 30 ]]'
ok "newest real backup kept" '[[ $(db_count $(ls $D/backups/mph-data-2026*-start.db | tail -1)) -eq $((985+SAVED)) ]]'

# 5. Damaged files are refused, never overwritten.
for kind in corrupt garbage empty newer; do
  X=/tmp/mph-res-$kind; rm -rf $X; mkdir -p $X; cp $D/mph-data.db $X/mph-data.db
  case $kind in
    corrupt) dd if=/dev/urandom of=$X/mph-data.db bs=4096 seek=20 count=30 conv=notrunc 2>/dev/null ;;
    garbage) head -c 200000 /dev/urandom > $X/mph-data.db ;;
    empty)   : > $X/mph-data.db ;;
    newer)   sqlite3 $X/mph-data.db "pragma user_version=99" ;;
  esac
  BEFORE=$(shasum $X/mph-data.db | cut -d' ' -f1)
  MPH_DATA_DIR=$X MPH_NO_BROWSER=1 run_app < /dev/null > /tmp/mph-res-$kind.log 2>&1 &
  P=$!; sleep 4
  SERVING=$(curl -s -o /dev/null -w '%{http_code}' $B/api/info)
  kill $P 2>/dev/null; wait $P 2>/dev/null
  echo "[$kind] $(tr '\n' ' ' < /tmp/mph-res-$kind.log | cut -c1-220)"
  ok "$kind file: app refuses to run" '[[ $SERVING != 200 ]]'
  ok "$kind file: left untouched" '[[ $(shasum $X/mph-data.db | cut -d" " -f1) == $BEFORE ]]'
  ok "$kind file: explains what to do" 'grep -qiE "restore|newer version|backup" /tmp/mph-res-$kind.log'
done

# 6. Hard kill while the config file is being saved: it is written in one piece, so it is always complete.
start $D
( for n in {1..400}; do t=light; (( n % 2 )) && t=dark; curl -s -o /dev/null -X PUT -H "$H" -H 'Content-Type: application/json' -d "{\"display\":{\"theme\":\"$t\",\"showExcelImport\":true}}" $B/api/settings; done ) &
LOOP=$!
sleep 1.5
kill -9 $APP; wait $APP 2>/dev/null; wait $LOOP 2>/dev/null
ok "config file complete after kill -9" 'node -e "JSON.parse(require(\"fs\").readFileSync(process.argv[1], \"utf8\"))" $D/mph-config.json'
start $D
ok "restarts with its config after kill -9" '[[ $(count) -eq $((985+SAVED)) ]]'
stop

# 7. Unusable config files are refused and left untouched, like data files.
for kind in broken empty newer; do
  X=/tmp/mph-res-config-$kind; rm -rf $X; mkdir -p $X; cp $D/mph-data.db $D/mph-config.json $X/
  case $kind in
    broken) print -n '{ "parties": [ ' > $X/mph-config.json ;;
    empty)  : > $X/mph-config.json ;;
    newer)  node -e 'const f=process.argv[1];const c=JSON.parse(require("fs").readFileSync(f,"utf8"));c.configVersion=99;require("fs").writeFileSync(f,JSON.stringify(c))' $X/mph-config.json ;;
  esac
  CBEFORE=$(shasum $X/mph-config.json | cut -d' ' -f1); DBEFORE=$(shasum $X/mph-data.db | cut -d' ' -f1)
  MPH_DATA_DIR=$X MPH_NO_BROWSER=1 run_app < /dev/null > /tmp/mph-res-config-$kind.log 2>&1 &
  P=$!; sleep 4
  SERVING=$(curl -s -o /dev/null -w '%{http_code}' $B/api/info)
  kill $P 2>/dev/null; wait $P 2>/dev/null
  echo "[config $kind] $(tr '\n' ' ' < /tmp/mph-res-config-$kind.log | cut -c1-220)"
  ok "$kind config: app refuses to run" '[[ $SERVING != 200 ]]'
  ok "$kind config: config and data file left untouched" '[[ $(shasum $X/mph-config.json | cut -d" " -f1) == $CBEFORE && $(shasum $X/mph-data.db | cut -d" " -f1) == $DBEFORE ]]'
  ok "$kind config: explains what to do" 'grep -qiE "config file" /tmp/mph-res-config-$kind.log'
done

# 8. A config file that went missing comes back from the newest backup.
X=/tmp/mph-res-noconfig; rm -rf $X; mkdir -p $X/backups; cp $D/mph-data.db $X/; cp $D/backups/mph-config-*.json $X/backups/
start $X
ok "missing config put back from its backup" 'grep -q "was put back" /tmp/mph-res.log && [[ -s $X/mph-config.json ]]'
ok "parties back with it" '[[ $(curl -s $B/api/masters | node -pe "JSON.parse(require(\"fs\").readFileSync(0)).parties.length") -gt 10 ]]'
stop

echo "PASSED $PASS"
if (( ${#FAILS} )); then echo "FAILED ${#FAILS}"; printf '  %s\n' "${FAILS[@]}"; false; else echo "PASS: resilience"; fi
