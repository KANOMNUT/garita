#!/bin/sh
# StopFailure hook (.claude/settings.json): append a mechanical snapshot of the
# working tree to the active run's checkpoint directory. Protocol and limits:
# docs/claude/agent-checkpoints.md. Does nothing unless
# .claude/checkpoints/<branch>/ledger.md exists. Always exits 0.
input=$(cat)
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
branch=$(git branch --show-current 2>/dev/null | tr / -)
dir=".claude/checkpoints/$branch"
[ -n "$branch" ] && [ -f "$dir/ledger.md" ] || exit 0
{
  printf '\n## %s %s\n\n```\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$(printf '%s' "$input" | grep -oE '"(hook_event_name|error|agent_type|agent_id)" *: *"[^"]*"' | tr '\n' ' ')"
  git --no-optional-locks status --short
  git --no-optional-locks diff --stat
  printf '```\n'
} >> "$dir/snapshots.md" 2>/dev/null
exit 0
