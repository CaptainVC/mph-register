#!/bin/sh
# One-time setup of the repository; run it from the project folder or any worktree (worktrees share these settings).
#
# Layout: one project folder holds the bare repository and one folder per worktree, next to the files git never sees:
#   mph-register/.bare        the repository        mph-register/main        worktree of main (pull only, never edit)
#   mph-register/.git         "gitdir: ./.bare"     mph-register/<task>      one worktree per task (scripts/new-worktree.sh)
#   mph-register/Workbooks    Excel workbooks the tests read, with History/ for older months
#   mph-register/Builds       the published apps (scripts/publish.sh)
#
# The repository is public and holds test data only. The hooks refuse any commit or push that carries real data of the
# firm or of a party (scripts/privacy_check.py): they read the real names from the config and data files and from the
# workbooks on this machine, which never enter git. Real names that the real-workbook suites need live in
# Workbooks/private-test-data.json (see app/tests/e2e/private-data.js).
#
# A new machine starts with (gh must be logged in as CaptainVC):
#   mkdir mph-register && cd mph-register
#   gh repo clone CaptainVC/mph-register .bare -- --bare && echo "gitdir: ./.bare" > .git
#   git config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*" && git worktree add main main
#   sh main/scripts/setup-repo.sh && git fetch origin && git -C main branch --set-upstream-to=origin/main main
#
# This Mac has two GitHub logins in gh and a work account is the active one, so the repository is told to commit and
# push as CaptainVC. Nothing secret is stored: the token is read from the gh keyring when git asks for it.
set -eu
git config core.hooksPath .githooks
git config user.name "CaptainVC"
git config user.email "100281435+CaptainVC@users.noreply.github.com"
git config --unset-all credential.https://github.com.helper 2>/dev/null || true
git config credential.https://github.com.helper ""
git config --add credential.https://github.com.helper '!f() { test "$1" = get || exit 0; echo username=CaptainVC; echo "password=$(gh auth token --user CaptainVC)"; }; f'

py=$(command -v python3 || command -v python) && "$py" "$(git rev-parse --show-toplevel)/scripts/privacy_check.py" --refresh

echo "Ready: pushes to main are refused, real data is refused, commits are by CaptainVC, git pushes use the CaptainVC login."
echo 'For gh commands run first:  export GH_TOKEN="$(gh auth token --user CaptainVC)"'
