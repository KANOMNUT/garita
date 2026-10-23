# Agent checkpoints

Multi-agent runs die on the session rate limit. Several agents can die at once, and sometimes the main session dies with them. `SendMessage` resume works only while the same session still holds the agent IDs, and it can fail even then ("could not be resumed"). After `/clear` or in a new session, nothing that lived only in context survives. This protocol puts everything a resume needs on disk, so any session can pick up every task.

## Rules

1. **Files, not context.** Everything lives in `.claude/checkpoints/<branch>/`, where `/` in the branch name becomes `-`. The directory is gitignored: it is run-scoped scratch, stays out of path-limited commits and out of `git status`, and survives `/clear`, restarts and new sessions on the same checkout. It is not `.claude/agent-memory/`, which is tracked memory that outlives a run.
   - `ledger.md`: one per run. The main session (or whoever dispatches) is its only writer.
   - `<task-id>-<agent>.md`: one checkpoint per task. Only the agent that owns the task writes it. The brief names the file, so two agents never share one.
   - `snapshots.md`: appended by the StopFailure hook. Nobody edits it.
2. **Write ahead.** The main session updates the ledger before it acts: the task row and brief before a dispatch, the sha right after a commit, a user decision as soon as it is given. A brief is on disk before its dispatch, either as a section of a `docs/impl/` file or under the ledger's Briefs.
3. **Agents checkpoint** within their first few steps, after each sub-step, before any build or test that takes more than a minute, and before the final report. The final report goes into the checkpoint's Report section, with Status `done`, before it is sent. A report that never reached the main session is still on disk.
4. **The tree wins.** On a resume, `git status --short` and `git diff` show what actually landed; the checkpoint says why and what comes next. When they disagree, trust the tree and fix the checkpoint.
5. **Verify Done, do not redo it.** A resumed agent re-runs the gate of each Done item instead of repeating the work.
6. **Ownership is by file.** The ledger row lists the paths each task owns, with one owner per file per wave. An agent edits only its paths and its checkpoint. The main session commits per task with path-limited commits.

## Checkpoint template

Rewrite the whole file each time (Write, not append), so it always reads as the current state.

```markdown
# <task-id> <agent>: <one-line task>

Brief: <docs/impl/<file>.md#<section> | ledger.md#<task-id>>
Owns: <paths>
Status: running | blocked | done
Updated: <YYYY-MM-DD HH:MM> after <sub-step>

## Done
- <item>: <gate that proves it>

## In progress
- <what, which file, how far>

## Next
1. <the very next action>

## Gates
- <command>: pass | fail | not run (<when>)

## Decisions and assumptions
- <what, and why>

## Report
<empty until done; then the final report verbatim, written before it is sent>
```

## Ledger template

```markdown
# Run ledger: <branch>

## Cold start
Branch `<branch>`, base main `<sha>`. Plan: <docs/impl/... or none>.
Run rules: <e.g. every commit carries [skip ci]; agents make no git writes>.
Dirty before the run, never commit: <paths>.
1. Read this file and `snapshots.md`.
2. Compare `git log --oneline <sha>..HEAD` with Commits and `git status --short` with Tasks.
3. Resume every task that is not `done` or `committed` with path 2 of `docs/claude/agent-checkpoints.md`.

## Waves
| Wave | Tasks | Gate before the next wave |
|---|---|---|

## Tasks
| ID | Agent (type, id) | Owns | Checkpoint | Status |
|---|---|---|---|---|

Status: todo, running, done (report in the checkpoint), committed, blocked.

## Briefs
### <task-id>
<the brief verbatim, or a pointer to its docs/impl section>

## Commits
| sha | Tasks | Paths |
|---|---|---|

## User decisions
- <date>: <decision>

## Log
- <date time>: dispatched, died, resumed, reported, committed.
```

Record each agent ID at dispatch. A dead agent's transcript stays at `~/.claude/projects/<project>/<session-id>/subagents/agent-<id>.jsonl` for `cleanupPeriodDays` (30 by default); it is the last fallback when a checkpoint is stale. When a background agent's failure notification arrives, copy its last output into the Log before anything else, because that notification exists only in context.

## Resume

### Path 1: same session, agent ID known

`SendMessage` to the agent ID:

> You were cut off by a session limit. Before anything else, read your checkpoint `<abs path>`, then run `git status --short` and `git diff -- <owned paths>`. The tree wins over the checkpoint: fix the checkpoint to match it. Do not redo Done items; re-run their gates. Own only the files in your ledger row; no git writes. Continue from Next, keep checkpointing, and write your report into the checkpoint before you send it. Reply in caveman ultra.

If the resume fails or the agent does not answer, use path 2. Log the outcome either way.

### Path 2: cold session, or the resume failed

The main session runs the ledger's Cold start, then spawns a fresh agent of the same type for each open task:

> Resume task <task-id> of the run in `<abs path>/ledger.md`. Read the ledger (Cold start, your row, your brief), then your checkpoint `<abs path>`, then run `git status --short` and `git diff -- <owned paths>`. The tree wins over the checkpoint: fix the checkpoint to match it. Do not redo Done items; re-run their gates. Own only the files in your ledger row; no git writes. Continue from Next in the same checkpoint file, and write your report into it before you send it. Reply in caveman ultra.

A task without a checkpoint file never started, or died before its first write: dispatch it again from its brief. Record the new agent ID in its row.

## Snapshot hook

`.claude/settings.json` runs `.claude/hooks/checkpoint-snapshot.sh` on `StopFailure`, which the hooks reference describes as running "instead of Stop when the turn ends due to an API error". Its error values include `rate_limit`, and Claude Code ignores its output and exit code, so it can neither block nor loop. When the current branch has a ledger, the script appends a timestamp, the hook's event, error and agent fields, `git status --short` and `git diff --stat` to `snapshots.md`; otherwise it does nothing. It runs git with `--no-optional-locks`, so it never holds `index.lock` during a commit, and it always exits 0. It writes to `snapshots.md`, not the ledger, so it cannot race the main session's edits of the ledger.

Limits, from the hooks and sub-agents references:

- StopFailure also fires when a subagent dies on an API error (observed 2026-10-15: entries with `agent_id`, `agent_type` and `error: rate_limit`). Match `agent_id` to the ledger's Tasks rows to see which agent died. The git output is the one shared working tree, not that agent's own changes, and parallel failures can interleave in `snapshots.md`.
- `SubagentStop` is documented only for a subagent that finishes, not for one that dies on an error, so it is not hooked. A finished agent's checkpoint (Status `done` with its Report) covers that case.

The checkpoints are the record; the snapshot is a backstop.

## Cleanup

When the run's last commit lands (the release commit, or the branch merge), copy any user decision that is not yet in `docs/impl/` or `CHANGELOG.md` into the right file, then delete `.claude/checkpoints/<branch>/`. Delete an abandoned run's directory together with its branch.
