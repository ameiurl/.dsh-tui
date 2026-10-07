# Claude Code style diff + flat current-directory resume for dsh-tui

> 📖 **升级后把全部定制补回来，请看 [`CUSTOMIZATIONS.md`](CUSTOMIZATIONS.md)**（功能清单 + 重打手册）。

Three customizations live here:

1. **Diff rendering** — `dsh --profile dsh-tui` renders edit/write diffs exactly
   like Claude Code: **unified layout with real line numbers, context lines and
   `+`/`-` markers** (instead of the default side-by-side panes), plus a Claude
   Code diff palette.
2. **Resume & input history** — `/resume` lists the **current working
   directory's** sessions with **no workspace rail** (the session screen
   keeps its search, rename, delete, live-status and session-hosting keys, but
   the rail and every other directory are out of reach), and ↑/↓ (plus Ctrl+R)
   recall the persisted `history.jsonl` **scoped to the current working
   directory**: each entry is tagged with the directory it was submitted in, and
   untagged entries written before the tagging stay as a fallback until a
   directory has entries of its own.
3. **`/resume` names a session the way Claude Code does** — a row's title
   follows Claude's own order: a written title (provider/AI, or `/rename` and
   recap) first, then the **most recent** human prompt, then the opening
   prompt, then the working directory's basename. Both prompt levels are
   normalized to one line and clipped at 200 characters, exactly as Claude
   normalizes its `lastPrompt` fallback. A prompt that is nothing but a
   filesystem address is stepped over at both levels, so a path pasted,
   dropped or `@`-mentioned as the opening message never becomes the name —
   and neither does dsh's own **deterministic placeholder**: when nothing has
   named a session, `dsh-session-title` appends the opening prompt *truncated*
   as a `session/title` event (`source.kind: 'fallback'`), and taking that at
   face value is what made rows show `@modules/client/…/A` — identical for
   every session that opened on the same file — instead of a name. Only a
   title a provider or a person actually wrote counts.

## User-level settings (survive upgrades)

- `~/.dsh-tui/themes/claude-code.json` / `claude-code-light.json` — diff palette
  based on Claude Code v2.1.201's built-in `theme.ts`, with the dark line
  backgrounds overridden per user preference (added `#005F00` deep green,
  removed `#5F0000` deep red; CC's originals were `#225C2B`/`#7A2936`).
- `~/.dsh-tui/theme.json` — activates `claude-code`.
- `~/.dsh/profiles/dsh-tui/cordis.patch.yml` — `dsh-tui.diffLayout: unified`
  (also changeable in-app via `/settings`, which writes this same row). dsh
  0.1.7 dropped the separate `~/.dsh/settings.yaml` document — user settings are
  loader patch rows now, and a row **replaces** the entry's whole `config`, so it
  restates the bundle's keys. The pre-0.1.7 document is preserved as
  `~/.dsh/settings.yaml.imported`.

## Patched files (re-apply after upgrades)

One command after any `dsh` upgrade (or anytime — it's idempotent):

```bash
dsh-patch          # check + re-apply only what the upgrade reverted
dsh-patch check    # report only, change nothing (exit 1 = something differs)
dsh-patch patch    # apply diffs/*.patch onto what is installed (fuzz 3)
dsh-patch apply    # force-copy all backups
```

When an upgrade moves the code a patch was built against, the script no longer
refuses: it applies `diffs/<name>.patch` **to the installed file** with
`patch --fuzz=3`, installs the result only when every hunk landed and
`node --check` passes, and reports how it landed — `PATCHED-DRIFT` when the
hunks matched their context exactly and only the line numbers moved (the diff
still fits; re-port to re-anchor it), `PATCHED-FUZZ` when the context matched
loosely (the hunks may have attached to the wrong lines — read the diff before
trusting it; a stamp in `state/` still makes a second run say `OK-PATCHED`
instead of patching a patched file). Neither is a re-port, so the runbook below
still applies.

The alias lives in `~/.zshrc` / `~/.bashrc` and points at
`~/.dsh-tui/patches/apply-diff-patches.sh`. It compares each installed file
against the `backup/` copies, syntax-checks (`node --check`) before writing,
and gates **per target**: every target names its owning package, and
`patch-base-versions.json` records the version each patch was built against
(`patch-base-version` stays the dsh-tui entry of that same baseline). A target
whose package has moved on is reported as `NEEDS-REPORT` and skipped — the
other targets still apply, so a dsh-tui upgrade can no longer block the
tool-package patches (or the reverse). Writes use `cp --remove-destination`:
pnpm's `node_modules` entries are hardlinks into the pnpm store, and a plain
`cp` writes through them, leaving the store patched so that a reinstall of the
same version silently resurrects the patch.

After any re-apply, check that the docs still describe what is installed:

```bash
bash ~/.dsh-tui/patches/check-doc-consistency.sh   # exit 0 = docs and code agree
```

It asserts the version table, each customization's code facts and the scripts
these docs name. Documentation drifts precisely during upgrades — the 0.10.1
move left a "resume browser = stock" conclusion that the code had outgrown — so
it belongs at the end of every one.

### Where the backups live

| dir | contents |
| --- | --- |
| `backup/` | full patched files — what `dsh-patch` restores |
| `original/` | pristine upstream files (from the exact npm versions listed below) |
| `diffs/*.patch` | unified diffs original→patched, named after the backup file — **view what was changed**: `cat ~/.dsh-tui/patches/diffs/AssistantToolUseMessage.js.patch`, and the source `dsh-patch patch` applies |
| `state/*.sha1` | fingerprint of what a diff run installed (git-ignored), so re-runs are idempotent |

Sources: `@deepseek-ai/dsh-tool-fs@0.2.0-rc.2`,
`@deepseek-ai/dsh-tool-str-replace-editor@0.2.0-rc.2`,
`@deepseek-harness-tui/dsh-tui@0.12.0`.

| file | change |
| --- | --- |
| `dsh-tool-fs/lib/index.js` | `computeHunkDiffs` + `presentationMeta` now carry 1-based `oldStart`/`newStart` per hunk |
| `dsh-tool-str-replace-editor/lib/index.js` | `str_replace` returns `{message, before, after}`, result-time hunk diffs with line numbers via `presentationMeta` + new `presentResult` (model-facing output text unchanged) |
| `dsh-tui .../components/messages/AssistantToolUseMessage.js` | unified diff renderer: CC-style `%Nd`+marker gutter, context lines, green/red full-row background bands (`diffAddedDimmed`/`diffRemovedDimmed`), word-level highlight (added words green-bg `diffAddedWord`, default ink, no bold; removed rows unstyled), `+N -M` change-count summary line, diff bodies never folded/hidden (`DIFF_BODY_MAX_LINES = Infinity`), new-file diffs preview only the `+N` stat + first 10 content lines (`NEW_FILE_DIFF_MAX_LINES = 11`, Ctrl+O expands the rest); tool-card hover keeps its background (upstream `hoverTint` branch removed) |
| `dsh-tui .../history.js` | entries are persisted with the directory they were submitted in (`cwd`); one `scopeToCwd` helper narrows both reads — `loadHistory(cwd)` (newest first, Ctrl+R) and `loadHistoryOldestFirst(cwd)` (the composer's walk, added upstream in 0.11.x) — falling back to the untagged legacy pool while the directory has none of its own. An argument-less read still returns everything, and the consecutive-duplicate dedupe only folds entries from the same directory |
| `dsh-tui .../components/PromptInput.js` | ↑/↓ seed from the persisted history file scoped to `channel.cwd` (re-seeded when the working directory changes), submit with `appendHistory(text, channel.cwd)`, and at the suggestion-menu boundary they fall through into history |
| `dsh-tui .../screens/Chat.js` | Ctrl+R (the `history` action) fills its search dialog from `loadHistory(channel.cwd)`, so the search covers exactly what ↑/↓ walks |
| `dsh-tui .../screens/sessionSupervisor/useSessionSupervisor.js` | **F3 fork** (0.11.x replaced `screens/SessionBrowser.js` with this screen): the workspace rail is never rendered (`railVisible = false`), the keyboard starts in the list and `←` is inert (`activateRail` empty, `activePane` pinned to `list`), the selection is synthesized from `channel.cwd` instead of a rail row, and the rows are the sessions whose recorded cwd `samePath`-matches it — every other directory is unreachable, and the empty-registry fallback group can no longer pull in another project's history. Search, live status, rename, delete, Ctrl+N/Ctrl+X and pins stay |
| `dsh-tui .../screens/SessionSupervisor.js` | Ctrl+N starts the session in that pinned directory (`newSessionIn(selected)`) instead of in the rail's focused workspace. Test: `node ~/.dsh-tui/patches/test-resume-flat.mjs` |
| `dsh-tui .../i18n.js` | `supervisor-hint-list` drops the `←/→ switch pane` wording (the fork has no second pane to advertise) |
| `dsh-tui .../dsh-adapter/sessions/digest.js` | **title chain** for `/resume` rows, in Claude Code's own order: a `session/title` event a **provider** (`auto`) or a **person** (`renamed`) wrote wins, else the **most recent** human prompt (`lastPromptOf`, newlines folded and clipped at `LAST_PROMPT_TITLE_CHARS = 200` the way Claude normalizes its `lastPrompt`), else the opening prompt (same normalization), else the working directory's basename. Both prompt levels step over a candidate that is nothing but a filesystem address (`isFileAddress`), and an address-only session still counts as a conversation (`hasPrompt`), so it never reaches the destructive empty-session clean-up. dsh's own **deterministic placeholder** (`source.kind: 'fallback'` — the opening prompt truncated by `dsh-session-title`) is not a name: `titleOf` marks it `strong: false`, all three scan sites (head/tail windows, the deep reverse scan, the appended-suffix update) refuse it, and a tail holding only a placeholder no longer claims `titleComplete` — the provider title may sit in the unseen middle, where the deep scan then finds it. Test: `node ~/.dsh-tui/patches/test-resume-title-chain.mjs` |
| `dsh-tui .../dsh-adapter/sessions/store.js` | **cache epoch** for that change: `SCHEMA_VERSION` 4 → 5, because a cached `title` means something different now. A version 4 index can hold a placeholder path as a name and would keep serving it forever (the log never changed, so the revision keeps hitting), so version 4 is not in the readable set — the index is dropped whole and every title is re-derived. No manual cache clearing, and an old process writing the index back as version 4 is not trusted either |

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
