# Claude Code style diff in dsh-tui

Makes `dsh --profile tui` render edit/write diffs exactly like Claude Code:
**unified layout with real line numbers, context lines and `+`/`-` markers**
(instead of the default side-by-side panes), plus a Claude Code diff palette.

## User-level settings (survive upgrades)

- `~/.dsh-tui/themes/claude-code.json` / `claude-code-light.json` — diff palette
  based on Claude Code v2.1.201's built-in `theme.ts`, with the dark line
  backgrounds overridden per user preference (added `#005F00` deep green,
  removed `#5F0000` deep red; CC's originals were `#225C2B`/`#7A2936`).
- `~/.dsh-tui/theme.json` — activates `claude-code`.
- `~/.dsh/settings.yaml` — `dsh-tui: { diffLayout: unified }` (also changeable
  in-app via `/settings`).

## Patched files (re-apply after upgrades)

One command after any `dsh` upgrade (or anytime — it's idempotent):

```bash
dsh-patch          # check + re-apply only what the upgrade reverted
dsh-patch check    # report only, change nothing (exit 1 = something differs)
dsh-patch apply    # force-copy all backups
```

The alias lives in `~/.zshrc` / `~/.bashrc` and points at
`~/.dsh-tui/patches/apply-diff-patches.sh`. It compares each installed file
against the `backup/` copies, syntax-checks (`node --check`) before writing,
and warns when the installed `dsh-tui` version differs from the one the patch
was built against (`patch-base-version`).

### Where the backups live

| dir | contents |
| --- | --- |
| `backup/` | full patched files — what `dsh-patch` restores |
| `original/` | pristine upstream files (from the exact npm versions listed below) |
| `diffs/*.patch` | unified diffs original→patched — **view what was changed**: `cat ~/.dsh-tui/patches/diffs/AssistantToolUseMessage.patch` |

Sources: `@deepseek-ai/dsh-tool-fs@0.1.0-rc.8`,
`@deepseek-ai/dsh-tool-str-replace-editor@0.1.0-rc.8`,
`@deepseek-harness-tui/dsh-tui@0.9.0`.

| file | change |
| --- | --- |
| `dsh-tool-fs/lib/index.js` | `computeHunkDiffs` + `presentationMeta` now carry 1-based `oldStart`/`newStart` per hunk |
| `dsh-tool-str-replace-editor/lib/index.js` | `str_replace` returns `{message, before, after}`, result-time hunk diffs with line numbers via `presentationMeta` + new `presentResult` (model-facing output text unchanged) |
| `dsh-tui .../AssistantToolUseMessage.js` | unified diff renderer: CC-style `%Nd`+marker gutter, context lines, green/red full-row background bands (`diffAddedDimmed`/`diffRemovedDimmed`), word-level highlight (added words green-bg `diffAddedWord`, default ink, no bold; removed rows unstyled), `+N -M` change-count summary line, diff bodies never folded (`DIFF_BODY_MAX_LINES = Infinity`) |
| `dsh-tui .../channel.d.ts` | `ToolFileDiff` type gains optional `oldStart`/`newStart` |
| `dsh-tui .../sessions/SessionListRow.js` | session list title shows the full text (no `truncateWidth` cut) — one line, no wrap |

The component patch is version-sensitive: `apply-diff-patches.sh` refuses to
install a backup that no longer passes `node --check` against a newer upstream.
