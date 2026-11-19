#!/bin/sh
# One roadmap item in, one branch out. The agent does the work; this script
# decides whether the work is worth a pull request, and it does that by running
# the tests itself rather than believing the agent's summary.
#
#   scripts/agent-loop.sh --item 2                 # work locally, no push
#   scripts/agent-loop.sh --item 2 --dry-run       # print the plan only
#   scripts/agent-loop.sh --item 2 --ship          # push the branch and open a PR
#
# Exit codes: 0 ok, 2 no such item, 3 item is not ready, 4 the work is not green.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
ITEM=
MODEL=
SHIP=0
DRY=0
TIMEOUT=2700

while [ $# -gt 0 ]; do
  case "$1" in
    --item) ITEM=${2:-}; shift 2 ;;
    --model) MODEL=${2:-}; shift 2 ;;
    --timeout) TIMEOUT=${2:-}; shift 2 ;;
    --ship) SHIP=1; shift ;;
    --dry-run) DRY=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "$ITEM" ] || { echo "usage: $0 --item <n> [--model p/m#v] [--timeout s] [--ship] [--dry-run]" >&2; exit 2; }

cd "$ROOT"
SUMMARY=$(node tools/roadmap.js "$ITEM") || exit $?
STATUS=$(printf '%s\n' "$SUMMARY" | head -1 | cut -f1)
TITLE=$(printf '%s\n' "$SUMMARY" | head -1 | cut -f2-)
BODY=$(printf '%s\n' "$SUMMARY" | tail -n +2)

if [ "$STATUS" != "ready" ]; then
  echo "item $ITEM is '$STATUS', not ready: $TITLE" >&2
  exit 3
fi

WT="$ROOT/../.worktrees/agent-$ITEM"
BRANCH="agent/item-$ITEM"
PROMPT_FILE="${TMPDIR:-/tmp}/agent-loop-$ITEM-$$.md"

cat > "$PROMPT_FILE" <<PROMPT
You are working in a git worktree on branch $BRANCH. One roadmap item, one PR.

# Item $ITEM: $TITLE

$BODY

# How to work

1. Read the spec and plan under docs/superpowers/ (they are copied into this
   worktree; they are normally git-ignored). If there is no spec for this item,
   say so in your first message and stop.
2. Use the superpowers flow: writing-plans for the work, executing-plans to do
   it, test-driven-development for every behaviour change.
3. Run \`npm test\`, \`npm run typecheck\` and \`npm run build\` before you say you
   are done; this script runs them again afterwards and does not believe you.
4. Commit in small steps with this repository's style: \`feat(...)\`, \`fix(...)\`,
   \`docs:\`.
5. Do not edit docs/roadmap.md, .github/, or anything outside this worktree.
   Do not push. Do not open a pull request.

When you finish, print a short summary: what changed, which tests you ran, and
anything you had to decide that the plan did not cover.
PROMPT

run_cmd() {
  if [ "$DRY" = "1" ]; then
    printf 'would run: %s\n' "$*"
  else
    "$@"
  fi
}

echo "item $ITEM: $TITLE"
if [ -e "$WT" ] || git show-ref --quiet "refs/heads/$BRANCH"; then
  echo "a worktree or branch for item $ITEM already exists; finish or remove it first:" >&2
  echo "  git -C \"$WT\" status" >&2
  echo "  git worktree remove --force \"$WT\" && git branch -D $BRANCH" >&2
  exit 5
fi
run_cmd git worktree add "$WT" -b "$BRANCH" main

if [ -d "$ROOT/docs/superpowers" ]; then
  run_cmd mkdir -p "$WT/docs"
  run_cmd cp -R "$ROOT/docs/superpowers" "$WT/docs/"
else
  echo "note: no docs/superpowers here, the agent will have no spec" >&2
fi

OPENCODE_ARGS="run --agent orchestrator --auto --title \"item $ITEM: $TITLE\""
[ -n "$MODEL" ] && OPENCODE_ARGS="$OPENCODE_ARGS --model $MODEL"

if [ "$DRY" = "1" ]; then
  printf 'would run (in %s, timeout %ss): opencode %s <prompt>\n' "$WT" "$TIMEOUT" "$OPENCODE_ARGS"
  printf 'prompt file: %s\n' "$PROMPT_FILE"
  printf 'would then run: npm install && npm test && npm run typecheck && npm run build\n'
  [ "$SHIP" = "1" ] && printf 'would then run: git push -u origin %s && gh pr create --base main --head %s\n' "$BRANCH" "$BRANCH"
  exit 0
fi

# `timeout` is GNU; macOS has none. Run in the background and watch the clock.
( cd "$WT" && opencode $OPENCODE_ARGS "$(cat "$PROMPT_FILE")" ) &
AGENT=$!
WAITED=0
while kill -0 "$AGENT" 2>/dev/null; do
  if [ "$WAITED" -ge "$TIMEOUT" ]; then
    kill "$AGENT" 2>/dev/null || true
    echo "timed out after ${TIMEOUT}s; worktree kept at $WT" >&2
    exit 4
  fi
  sleep 10
  WAITED=$((WAITED + 10))
done
wait "$AGENT" || { echo "the agent exited non-zero; worktree kept at $WT" >&2; exit 4; }

cd "$WT"
# Rebase onto the base branch while the branch is still private: the tests must
# run on the result a reviewer will actually see. A conflict is a judgement call,
# so it stops here instead of letting the agent guess.
git fetch origin
if ! git rebase origin/main; then
  git rebase --abort
  echo "the branch does not rebase onto main; worktree kept at $WT" >&2
  exit 4
fi
[ -d server/models ] && [ -f server/models/silero_vad.onnx ] || sh server/models/fetch.sh
npm install --no-audit --no-fund
npm test
npm run typecheck
npm run build

if [ "$SHIP" = "1" ]; then
  git push -u origin "$BRANCH"
  gh pr create --base main --head "$BRANCH" --title "item $ITEM: $TITLE" --body-file "$ROOT/.github/pull_request_template.md"
  echo "PR opened. Merge is yours."
else
  echo "green. to open a PR:"
  echo "  git -C $WT push -u origin $BRANCH"
  echo "  gh pr create --base main --head $BRANCH --title \"item $ITEM: $TITLE\""
fi
