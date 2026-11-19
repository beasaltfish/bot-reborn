# The agent loop

One roadmap item in, one pull request out. The person writes the queue and merges;
the loop does the rest.

## The queue

`docs/roadmap.md`, written by a person, read by machines. A `ready` item is one
somebody is willing to merge. `blocked` says what it waits for. Nothing else
writes that file — not the script, not the agent.

## One pass

```bash
scripts/agent-loop.sh --item 2              # work locally; no push, no PR
scripts/agent-loop.sh --item 2 --dry-run    # print every command it would run
scripts/agent-loop.sh --item 2 --ship       # push the branch and open the PR
```

What it does, in order:

1. Reads the item and refuses anything that is not `ready` (exit 3) or missing (exit 2).
2. `git worktree add ../.worktrees/agent-<n> -b agent/item-<n> main`.
3. Copies `docs/superpowers/` into the worktree: the spec and plan are git-ignored,
   and an agent without them invents its own requirements.
4. Runs `opencode run --agent orchestrator` there, with the item's acceptance text
   and the house rules (superpowers flow, small commits, no push, no roadmap edits).
5. Runs `npm install`, `npm test`, `npm run typecheck`, `npm run build` **itself**.
   The agent's summary is not evidence.
6. Only then: `--ship` pushes and opens the PR; without it, prints the two commands.

## When it stops

- **Timeout** (default 2700 s) or a non-zero agent exit: exit 4, worktree kept,
  path printed. Read the worktree, decide, then `git worktree remove`.
- **Red tests**: exit 4, same. Never let a red branch reach a PR.

## What stays with the person

- Writing the queue and the acceptance line. This is the only step that cannot be
  tested, so it is the one that must not be delegated.
- Merging. Branch protection requires the CI check and one approval.
- The stop decisions above.

## Turning the gate on (done once, 2026-11-19)

`main` requires the two CI jobs, with `strict` (a branch behind `main` must
merge it first):

```bash
gh api -X PUT "repos/{owner}/{repo}/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["js", "firmware"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
gh api repos/{owner}/{repo}/branches/main/protection
```

No approving review is required, on purpose: this is a one-person repository and
GitHub does not let you approve your own pull request. The review that matters
is the loop's reviewer plus the merge click.

## Cost and honesty

- One pass is roughly one full session with two or three specialists; it is not
  cheap, and it is serial on purpose. Review bandwidth is the bottleneck, not
  generation.
- Tests cannot tell whether the shopping list recommends the right board. A fresh
  reviewer with a different model reads the diff for that, and a person still
  samples. Read `docs/superpowers/specs/2026-11-19-agent-loop-design.md` §6 before
  trusting a green run.
