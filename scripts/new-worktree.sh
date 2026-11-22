#!/bin/sh
# Starts a task in its own folder next to main: sh scripts/new-worktree.sh <branch-name>
# A new branch starts from the latest origin/main; an existing branch (for example someone's open PR) is checked out as is.
# Then: work, commit, run the tests, git push -u origin <branch-name>, open a PR (gh pr create) and, once the checks are
# green, gh pr merge --squash (GitHub deletes the branch; --delete-branch would fail here because main is checked out
# in its own folder). gh needs: export GH_TOKEN="$(gh auth token --user CaptainVC)"
# Finally, from the project folder: git worktree remove <branch-name> && git branch -D <branch-name>
set -eu
name=${1:?Usage: sh scripts/new-worktree.sh <branch-name>}
common=$(cd "$(git rev-parse --git-common-dir)" && pwd)
project=$(dirname "$common")
dir="$project/$name"
[ -e "$dir" ] && { echo "$dir already exists." >&2; exit 1; }

git -C "$project" fetch --quiet --prune origin
if git -C "$project" show-ref --verify --quiet "refs/heads/$name"; then
  git -C "$project" worktree add "$dir" "$name"
elif git -C "$project" show-ref --verify --quiet "refs/remotes/origin/$name"; then
  git -C "$project" worktree add --track -b "$name" "$dir" "origin/$name"
else
  git -C "$project" worktree add --no-track -b "$name" "$dir" origin/main
fi
echo "Ready: cd \"$dir\""
