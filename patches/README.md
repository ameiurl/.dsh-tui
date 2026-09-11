# Claude Code style diff + flat current-directory resume for dsh-tui

> 📖 **升级后把全部定制补回来，请看 [`CUSTOMIZATIONS.md`](CUSTOMIZATIONS.md)**（功能清单 + 重打手册）。

Two customizations live here:

1. **Diff rendering** — `dsh --profile dsh-tui` renders edit/write diffs exactly
   like Claude Code: **unified layout with real line numbers, context lines and
   `+`/`-` markers** (instead of the default side-by-side panes), plus a Claude
   Code diff palette.
2. **Resume & input history** — `/resume` lists the **current working
   directory's** sessions in one flat list (no workspace rail, no per-directory
   grouping, no drill-in page), and ↑/↓ (plus Ctrl+R) recall the persisted
   `history.jsonl` **scoped to the current working directory**: each entry is
   tagged with the directory it was submitted in, and untagged entries written
   before the tagging stay as a fallback until a directory has entries of its own.

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
| `diffs/*.patch` | unified diffs original→patched, named after the backup file — **view what was changed**: `cat ~/.dsh-tui/patches/diffs/AssistantToolUseMessage.js.patch` |

Sources: `@deepseek-ai/dsh-tool-fs@0.1.2-rc.1`,
`@deepseek-ai/dsh-tool-str-replace-editor@0.1.2-rc.1`,
`@deepseek-harness-tui/dsh-tui@0.10.1`.

| file | change |
| --- | --- |
| `dsh-tool-fs/lib/index.js` | `computeHunkDiffs` + `presentationMeta` now carry 1-based `oldStart`/`newStart` per hunk |
| `dsh-tool-str-replace-editor/lib/index.js` | `str_replace` returns `{message, before, after}`, result-time hunk diffs with line numbers via `presentationMeta` + new `presentResult` (model-facing output text unchanged) |
| `dsh-tui .../components/messages/AssistantToolUseMessage.js` | unified diff renderer: CC-style `%Nd`+marker gutter, context lines, green/red full-row background bands (`diffAddedDimmed`/`diffRemovedDimmed`), word-level highlight (added words green-bg `diffAddedWord`, default ink, no bold; removed rows unstyled), `+N -M` change-count summary line, diff bodies never folded/hidden (`DIFF_BODY_MAX_LINES = Infinity`), new-file diffs preview only the `+N` stat + first 10 content lines (`NEW_FILE_DIFF_MAX_LINES = 11`, Ctrl+O expands the rest); tool-card hover keeps its background (upstream `hoverTint` branch removed) |
| `dsh-tui .../history.js` | entries are persisted with the directory they were submitted in (`cwd`); `loadHistory(cwd)` returns that directory's entries only, falling back to the untagged legacy pool while the directory has none of its own. `loadHistory()` with no argument still returns everything, and the consecutive-duplicate dedupe only folds entries from the same directory |
| `dsh-tui .../components/PromptInput.js` | ↑/↓ seed from the persisted history file scoped to `channel.cwd` (re-seeded when the working directory changes), submit with `appendHistory(text, channel.cwd)`, and at the suggestion-menu boundary they fall through into history |
| `dsh-tui .../screens/Chat.js` | Ctrl+R (the `history` action) fills its search dialog from `loadHistory(channel.cwd)`, so the search covers exactly what ↑/↓ walks |
| `dsh-tui .../screens/SessionBrowser.js` | **whole-file fork**: resume drops the workspace rail, the `▣ <path>` project grouping and the `←` drill-in page, and keeps the stock current-directory scope (`allProjects: false`, `mod+a` inert), so it shows this project's sessions in one flat MRU list. Search, preview, rename, delete, clean and the `mod+s` runs filter stay; pins and the right-click menu do not exist in this fork. Test: `node ~/.dsh-tui/patches/test-resume-flat.mjs` |
| `dsh-tui .../i18n.js` | `session-hint-list*` drop the rail / right-click-menu / scope-toggle wording (the fork advertises only the keys it keeps) |

> **Reverted experiments (do not re-add):** a **cwd-scoped input history** was
> reverted once during the 0.10.1 move, back when the resume browser was still
> meant to list every project. It is **deliberately back** now — see the
> `history.js` row above, including the legacy fallback that removes the
> empty-↑/↓ cost — because the wanted resume behaviour turned out to be the
> current directory. For the resume browser three rejected variants are on
> record: a thin patch that kept the rail and only removed the grouping,
> lowering the rail's minimum width from 120 to 90 columns, and making the fork
> default to `allProjects: true` (every project). The wanted behaviour is the
> fork **scoped to the current directory**: no rail, one flat list, no way to
> widen the scope.

Deliberately **stock** (previously customized, removed in the 0.10.0 → 0.10.1 move):
`SessionListRow.js` (titles truncate again), the **vim wiring** in `Chat.js` /
`StatusLine.js` and the vim parts of `PromptInput.js` (vim is OFF by default, `/vim`
enables it, and the `INSERT`/`NORMAL` indicator lives in the input box as upstream
ships it — `Chat.js` is in the patch set for its Ctrl+R line only),
and the `ToolFileDiff` `.d.ts` (the optional `oldStart`/`newStart` fields are
produced and read in plain JS; the declaration only matters to `tsc`, so it is not
patched — add a `declare module` augmentation in your own project if you ever need it).

The component patch is version-sensitive: `apply-diff-patches.sh` refuses to
install a backup that no longer passes `node --check` against a newer upstream.
