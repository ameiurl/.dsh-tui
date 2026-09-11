# Claude Code style diff + flat all-projects resume for dsh-tui

> 📖 **升级后把全部定制补回来，请看 [`CUSTOMIZATIONS.md`](CUSTOMIZATIONS.md)**（功能清单 + 重打手册）。

Two customizations live here:

1. **Diff rendering** — `dsh --profile dsh-tui` renders edit/write diffs exactly
   like Claude Code: **unified layout with real line numbers, context lines and
   `+`/`-` markers** (instead of the default side-by-side panes), plus a Claude
   Code diff palette.
2. **Resume & input history** — `/resume` lists **every project's** sessions in
   one flat list (no workspace rail, no per-directory grouping), and ↑/↓ recall
   the persisted input history from earlier sessions (one shared history file).

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
| `dsh-tui .../screens/SessionBrowser.js` | resume opens on **all projects** (`allProjects: true`), never enters the workspace page (`level` pinned to `'sessions'`, `setLevel` a no-op) and never shows the directory rail (`workspaceRail = false`); `mod+a` is inert and the scope row is no longer a menu trigger. Thin patch — the right-click menu, pins, rename/delete/clean, Tab preview and `mod+s` runs filter all stay |
| `dsh-tui .../sessions/view.js` | no `▣ <path>` project group headers: the `kind: 'project'` rows that `buildView` emitted in all-projects mode are gone, so every session is one flat list (current project's sessions still sort first) |
| `dsh-tui .../i18n.js` | `session-hint-list*` no longer advertise `← 工作目录` / `右键菜单` (keys that no longer exist in this fork) |

A self-contained behaviour test ships with the patch set — it renders the browser
headlessly (fake channel, fake streams, nothing written) and asserts the flat list:

```bash
node ~/.dsh-tui/patches/test-resume-flat.mjs
```

> History itself is deliberately **stock**: a short-lived variant tagged each
> history entry with its `cwd` and filtered `loadHistory()` per directory, but it
> was reverted — ↑/↓ recalls the one shared history file again. `history.js` and
> `history.d.ts` are therefore not in the patch set.

Deliberately **stock** (previously customized, removed in the 0.10.0 → 0.10.1 move):
`SessionListRow.js` (titles truncate again), `Chat.js` / `StatusLine.js` and the vim
parts of `PromptInput.js` (vim is OFF by default, `/vim` enables it, and the
`INSERT`/`NORMAL` indicator lives in the input box as upstream ships it),
and the `ToolFileDiff` `.d.ts` (the optional `oldStart`/`newStart` fields are
produced and read in plain JS; the declaration only matters to `tsc`, so it is not
patched — add a `declare module` augmentation in your own project if you ever need it).

The component patch is version-sensitive: `apply-diff-patches.sh` refuses to
install a backup that no longer passes `node --check` against a newer upstream.
