#!/bin/sh
# Decides whether .github/workflows/release.yml publishes a release; prints publish=true|false and tag=vX.Y.Z for
# $GITHUB_OUTPUT. It publishes the <Version> in app/Directory.Build.props when that version has no release yet and is
# higher than the latest release. Nothing to publish (that version is out already) is not an error; a version that is
# lower than the latest, a tag that does not match <Version>, or a release from outside main is.
# Needs REF (refs/heads/main or refs/tags/v…), SHA (the commit to publish) and gh with GH_TOKEN.
set -eu
root=$(git rev-parse --show-toplevel)
version=$(sed -n 's:.*<Version>\(.*\)</Version>.*:\1:p' "$root/app/Directory.Build.props")
tag="v$version"
fail() { echo "::error::$1" >&2; exit 1; }
answer() { echo "publish=$1"; echo "tag=$tag"; exit 0; }

echo "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "<Version>$version</Version> in app/Directory.Build.props should look like 0.7.2."
case "$REF" in
  refs/tags/*)
    [ "${REF#refs/tags/}" = "$tag" ] || fail "Tag ${REF#refs/tags/} does not match <Version>$version</Version> in app/Directory.Build.props."
    git merge-base --is-ancestor "$SHA" origin/main || fail "Tag a commit that is on main." ;;
  refs/heads/main) ;;
  *) fail "Releases are made from main, not $REF." ;;
esac

if gh release view "$tag" > /dev/null 2>&1; then
  echo "::notice::$tag is already published, so there is nothing new to publish." >&2
  answer false
fi
tagged=$(git rev-parse -q --verify "refs/tags/$tag^{commit}" || true)
[ -z "$tagged" ] || [ "$tagged" = "$SHA" ] || fail "Tag $tag is already on another commit. Raise <Version> or delete the tag."
latest=$(gh release view --json tagName --jq .tagName 2> /dev/null || true)
if [ -n "$latest" ]; then
  highest=$(printf '%s\n%s\n' "${latest#v}" "$version" | sort -V | tail -n 1)
  [ "$highest" = "$version" ] || fail "$tag is lower than the latest release $latest. Raise <Version> above ${latest#v}."
fi
echo "::notice::Publishing $tag (latest release: ${latest:-none})." >&2
answer true
