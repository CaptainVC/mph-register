#!/bin/sh
# Windows only (CI, Git Bash): an installed app of version 0.0.1 finds version 0.0.2 in a release served on this computer,
# downloads it, closes and comes back as 0.0.2, keeping the old app as "MPH Register.previous.exe". Data is untouched.
set -eu
root=$(git rev-parse --show-toplevel)
work=$(cygpath -u "${RUNNER_TEMP:-$(mktemp -d)}")/self-update
port=5171
base=http://127.0.0.1:$port
rm -rf "$work"
mkdir -p "$work/app" "$work/release" "$work/data"

publish() {
  dotnet publish "$root/app/src/MPHRegister.Api" -c Release -r win-x64 --self-contained -nologo -v q -p:Version="$1" \
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=None -o "$2"
}
publish 0.0.1 "$work/old"
publish 0.0.2 "$work/new"
cp "$work/old/MPH Register.exe" "$work/app/"
asset="$work/release/MPH-Register-win-x64.exe"
cp "$work/new/MPH Register.exe" "$asset"
size=$(wc -c < "$asset" | tr -d ' ')
digest=$(sha256sum "$asset" | cut -d' ' -f1)
cat > "$work/release/latest.json" <<EOF
{"tag_name":"v0.0.2","body":"- Test release","assets":[{"name":"MPH-Register-win-x64.exe","size":$size,"digest":"sha256:$digest","browser_download_url":"http://127.0.0.1:8099/MPH-Register-win-x64.exe"}]}
EOF

python -m http.server 8099 --bind 127.0.0.1 --directory "$(cygpath -w "$work/release")" > "$work/server.log" 2>&1 &
server=$!
cleanup() {
  taskkill //F //IM "MPH Register.exe" > /dev/null 2>&1 || true
  kill "$server" 2> /dev/null || true
}
trap cleanup EXIT
fail() {
  echo "::error::$1"
  for log in "$work/app.log" "$work/server.log"; do echo "--- $log"; cat "$log" || true; done
  ls -la "$work/app"
  exit 1
}
version() { curl -fsS "$base/api/info" 2> /dev/null | python -c "import json, sys; print(json.load(sys.stdin)['version'])"; }

MPH_PORT=$port MPH_DATA_DIR=$(cygpath -w "$work/data") MPH_NO_BROWSER=1 MPH_UPDATE_URL=http://127.0.0.1:8099/latest.json \
  "$work/app/MPH Register.exe" > "$work/app.log" 2>&1 &
for _ in $(seq 60); do version > /dev/null && break; sleep 1; done
[ "$(version)" = 0.0.1 ] || fail "The old app did not start."

status=$(curl -fsS "$base/api/updates?refresh=true")
echo "$status"
echo "$status" | python -c "import json, sys; s = json.load(sys.stdin); sys.exit(0 if s['available'] and s['canInstall'] and s['latestVersion'] == '0.0.2' else 1)" \
  || fail "The installed app did not offer 0.0.2."

curl -fsS -X POST -H "X-MPH-Request: 1" "$base/api/updates/install" || fail "Installing was refused."
now=""
for _ in $(seq 120); do
  now=$(version || true)
  [ "$now" = 0.0.2 ] && break
  sleep 1
done
[ "$now" = 0.0.2 ] || fail "The app did not come back as 0.0.2 (it answers: ${now:-nothing})."
[ -f "$work/app/MPH Register.previous.exe" ] || fail "The old app was not kept."
for _ in $(seq 30); do [ -f "$work/app/MPH Register.update.exe" ] || break; sleep 1; done
[ ! -f "$work/app/MPH Register.update.exe" ] || fail "The downloaded copy was not removed."
[ -f "$work/data/mph-data.db" ] || fail "The data file is missing."
echo "Self-update passed: 0.0.1 -> 0.0.2, old app kept as MPH Register.previous.exe."
