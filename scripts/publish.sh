#!/bin/sh
# Publishes the app from this checkout as single self-contained files: Builds/mac/MPH Register (Apple silicon) and
# Builds/windows/MPH Register.exe, in the Builds folder next to the checkout (or MPH_BUILDS). Each file is swapped in
# only after it is complete, so an app that is running keeps running; restart it to use the new build.
set -eu
root=$(git rev-parse --show-toplevel)
builds=${MPH_BUILDS:-$(cd "$root/.." && pwd)/Builds}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

for target in osx-arm64:mac:"MPH Register" win-x64:windows:"MPH Register.exe"; do
  rid=${target%%:*}; rest=${target#*:}; folder=${rest%%:*}; file=${rest#*:}
  dotnet publish "$root/app/src/MPHRegister.Api" -c Release -r "$rid" --self-contained -nologo -v q \
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:DebugType=None -o "$work/$rid"
  mkdir -p "$builds/$folder"
  cp "$work/$rid/$file" "$builds/$folder/.$file.new"
  mv -f "$builds/$folder/.$file.new" "$builds/$folder/$file"
  echo "Published $builds/$folder/$file"
done
