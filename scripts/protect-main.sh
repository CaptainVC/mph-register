#!/bin/sh
# Turns on server-side protection of main. Needs GitHub Pro (or a public repo): on GitHub Free, private repos cannot
# protect branches and GitHub answers "Upgrade to GitHub Pro". Safe to run again; it updates the existing rules.
# Rules: changes only through pull requests (no approval needed, since GitHub does not let authors approve their own),
# CI and the PR summary check must pass on an up-to-date branch, no force pushes, no deleting main, linear history.
set -eu
REPO=CaptainVC/mph-register
GH_TOKEN="${GH_TOKEN:-$(gh auth token --user CaptainVC)}"
export GH_TOKEN

RULES='{
  "name": "Protect main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "Build and test (ubuntu-latest)" },
          { "context": "Build and test (windows-latest)" },
          { "context": "No real data" },
          { "context": "PR has a short summary" } ] } }
  ]
}'

existing=$(gh api "repos/$REPO/rulesets" --jq '.[] | select(.name == "Protect main") | .id')
if [ -n "$existing" ]; then
  echo "$RULES" | gh api -X PUT "repos/$REPO/rulesets/$existing" --input - --jq '"Updated ruleset \(.id): \(.name)"'
else
  echo "$RULES" | gh api -X POST "repos/$REPO/rulesets" --input - --jq '"Created ruleset \(.id): \(.name)"'
fi
