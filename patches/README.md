# Claude Code style diff + flat all-projects resume for dsh-tui

> 📖 **升级后把全部定制补回来，请看 [`CUSTOMIZATIONS.md`](CUSTOMIZATIONS.md)**（功能清单 + 重打手册）。

Two customizations live here:

1. **Diff rendering** — `dsh --profile dsh-tui` renders edit/write diffs exactly
   like Claude Code: **unified layout with real line numbers, context lines and
   `+`/`-` markers** (instead of the default side-by-side panes), plus a Claude
   Code diff palette.
2. **Cross-session input history** — ↑/↓ recall the persisted `history.jsonl`
   (one shared history file; `/resume` itself is stock and stays scoped to the
   current working directory).

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

Sources: `@deepseek-ai/dsh-tool-fs@0.1.2-rc.1`,
`@deepseek-ai/dsh-tool-str-replace-editor@0.1.2-rc.1`,
`@deepseek-harness-tui/dsh-tui@0.10.1`.

| file | change |
| --- | --- |
| `dsh-tool-fs/lib/index.js` | `computeHunkDiffs` + `presentationMeta` now carry 1-based `oldStart`/`newStart` per hunk |
| `dsh-tool-str-replace-editor/lib/index.js` | `str_replace` returns `{message, before, after}`, result-time hunk diffs with line numbers via `presentationMeta` + new `presentResult` (model-facing output text unchanged) |
| `dsh-tui .../components/messages/AssistantToolUseMessage.js` | unified diff renderer: CC-style `%Nd`+marker gutter, context lines, green/red full-row background bands (`diffAddedDimmed`/`diffRemovedDimmed`), word-level highlight (added words green-bg `diffAddedWord`, default ink, no bold; removed rows unstyled), `+N -M` change-count summary line, diff bodies never folded/hidden (`DIFF_BODY_MAX_LINES = Infinity`), new-file diffs preview only the `+N` stat + first 10 content lines (`NEW_FILE_DIFF_MAX_LINES = 11`, Ctrl+O expands the rest); tool-card hover keeps its background (upstream `hoverTint` branch removed) |
| `dsh-tui .../components/PromptInput.js` | ↑/↓ seed from the persisted history file (the whole file — one shared history across directories), and at the suggestion-menu boundary they fall through into history |

> **Reverted experiments (do not re-add):**
> (1) a flat **all-projects resume** (`SessionBrowser.js` + `sessions/view.js` +
> `i18n.js` — `allProjects: true`, `level` pinned to `'sessions'`,
> `workspaceRail = false`, no `▣ <path>` group rows), and (2) **cwd-scoped input
> history** (`history.js` + `history.d.ts`, each entry tagged with its submitting
> directory). Resume stays stock: scoped to the current working directory, rail /
> right-click menu / pins intact, `mod+a` shows every directory.

Deliberately **stock** (previously customized, removed in the 0.10.0 → 0.10.1 move):
`SessionListRow.js` (titles truncate again), `Chat.js` / `StatusLine.js` and the vim
parts of `PromptInput.js` (vim is OFF by default, `/vim` enables it, and the
`INSERT`/`NORMAL` indicator lives in the input box as upstream ships it),
`SessionBrowser.js` + `i18n.js` (resume opens scoped to the current working
directory with the rail, right-click menu and pins intact — `mod+a` shows all
directories; that default has no settings/env/CLI switch and is not remembered),
and the `ToolFileDiff` `.d.ts` (the optional `oldStart`/`newStart` fields are
produced and read in plain JS; the declaration only matters to `tsc`, so it is not
patched — add a `declare module` augmentation in your own project if you ever need it).

The component patch is version-sensitive: `apply-diff-patches.sh` refuses to
install a backup that no longer passes `node --check` against a newer upstream.
