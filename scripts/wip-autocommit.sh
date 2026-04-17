#!/bin/bash
# Hourly working-tree safety snapshot.
# Captures tracked + untracked changes into a snapshot commit and force-pushes
# it to refs/heads/wip/auto-<branch> on origin. Never touches the working tree
# or the active branch.

set -euo pipefail

REPO="/Users/akashdesai/projects/kashklicks"
cd "$REPO"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export GIT_TERMINAL_PROMPT=0

# Bail if nothing to save.
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  echo "$(date -Iseconds) clean — nothing to back up"
  exit 0
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
WIP_BRANCH="wip/auto-${CURRENT_BRANCH}"
TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S %z')"

# stash create produces a dangling commit representing the current working
# tree + index + (with -u) untracked files. It does NOT modify the working tree.
SNAPSHOT="$(git stash create -u "wip snapshot: ${TIMESTAMP}" || true)"

if [ -z "$SNAPSHOT" ]; then
  echo "$(date -Iseconds) no snapshot produced"
  exit 0
fi

# Point (or create) the local wip branch at the snapshot.
git update-ref "refs/heads/${WIP_BRANCH}" "$SNAPSHOT"

# Force-push: this branch is a rolling mirror of current work, always overwritten.
git push --force origin "${WIP_BRANCH}" >/dev/null 2>&1 \
  && echo "$(date -Iseconds) pushed ${WIP_BRANCH} @ ${SNAPSHOT:0:7}" \
  || echo "$(date -Iseconds) push failed for ${WIP_BRANCH}"
