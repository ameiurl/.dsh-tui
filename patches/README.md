# Claude Code style diff + flat current-directory resume for dsh-tui

> 📖 **升级后把全部定制补回来，请看 [`CUSTOMIZATIONS.md`](CUSTOMIZATIONS.md)**（功能清单 + 重打手册）。

Three customizations live here:

1. **Diff rendering** — `dsh --profile dsh-tui` renders edit/write diffs exactly
   like Claude Code: **unified layout with real line numbers, context lines and
   `+`/`-` markers** (instead of the default side-by-side panes), plus a Claude
   Code diff palette.
2. **Resume** — `/resume` lists the **current working directory's** sessions with
   **no workspace rail** (the session screen keeps its search, rename, delete,
   live-status and session-hosting keys, but the rail and every other directory
   are out of reach). The list itself is easier to read than stock: **every
   other row carries a zebra band** so two-line rows no longer run together, and
   **Ctrl+P / Ctrl+K** step the cursor up and **Ctrl+N / Ctrl+J** step it down —
   `p`/`n` are emacs' previous/next, `k`/`j` the second pair — beside the
   arrows. Enter on the **first** row resumes that session — the
   new-session card it used to stand for is gone, so **Ctrl+T** is what creates
   (Ctrl+N belongs to the list now).
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

**Retired into stock upstream (do not re-add):** the **cwd-scoped input history**
— 0.15.0 ships the whole chain itself (`historyProjectKey`,
`appendHistory(text, cwd)`, `loadHistory(cwd)`, `loadHistoryOldestFirst(cwd)`, a
per-project cap and the untagged legacy pool, plus `PromptInput` re-seeding per
directory and `Chat.js` reading `loadHistory(channel.cwd)`), so `history.js`,
`PromptInput.js` and `Chat.js` left the patch set; and `recapOnOpen` (F5), which
0.11.2 declares and makes volatile on its own. Two F2 details went with the
retirement: the suggestion-menu boundary ↑/↓ wraps again (stock) instead of
falling into history, and untagged legacy entries join **every** project's view
(stock's union) instead of yielding once a directory has entries of its own.
`test-history-cwd.mjs` and `test-recap-setting.mjs` are kept as guards on those
upstream contracts.

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
`@deepseek-harness-tui/dsh-tui@0.15.0`.

| file | change |
| --- | --- |
| `dsh-tool-fs/lib/index.js` | every mutation's diff is emitted as **unified patch text** — `{path, patch}` with `@@ -a,b +c,d @@` + hunk lines for edits, `@@ -0,0 +1,N @@` for creations — so the TUI's own `parseFilePatch()` numbers it. The meta validator takes that shape *and* the old `oldText`/`newText` pair (replayed sessions keep rendering) |
| `dsh-tool-str-replace-editor/lib/index.js` | `str_replace` returns `{message, before, after}` and its result-time diff card (upstream has no `presentationMeta` here at all) travels in the same patch-text shape via `presentResult`; the model-facing output text is unchanged |
| `dsh-tui .../components/messages/AssistantToolUseMessage.js` | unified diff rows for `card: 'diff'`: **upstream numbers every line** from the parsed patch (`gutter`, right-aligned to the file's largest number; `(+N -M)` stat and `⋯` between hunks are upstream too), and this patch adds the Claude Code treatment — full-row green/red bands (`diffAddedDimmed`/`diffRemovedDimmed`) with default ink, word-level `diffAddedWord` background on the changed words of equal-length removed→added runs (`wordSegments`/`segmentNodes`), unified bodies never folded (`Infinity`; split panes keep upstream's 8), a created file previewing its diffstat plus the first 10 lines (`NEW_FILE_DIFF_MAX_LINES = 11`, Ctrl+O expands the rest), tool-card hover keeping its background (upstream `hoverTint` branch removed), and a legacy-shape branch (`legacyDiffLines`) that numbers `{oldText,newText,oldStart,newStart}` payloads too — the shape old hosts and every already-recorded card carry. Test: `node ~/.dsh-tui/patches/test-f1-diff-rows.mjs` |
| `dsh-tui .../screens/sessionSupervisor/useSessionSupervisor.js` | **F2 fork** (0.11.x replaced `screens/SessionBrowser.js` with this screen): the workspace rail is never rendered (`railVisible = false`), the keyboard starts in the list and `←` is inert (`activateRail` empty, `activePane` pinned to `list`), the selection is synthesized from `channel.cwd` instead of a rail row, and the rows are the sessions whose recorded cwd `samePath`-matches it — every other directory is unreachable, and the empty-registry fallback group can no longer pull in another project's history. Search, live status, rename, delete, Ctrl+N/Ctrl+X and pins stay |
| `dsh-tui .../screens/SessionSupervisor.js` | **Ctrl+T** starts the session in that pinned directory (`newSessionIn(selected)`) instead of in the rail's focused workspace, and the 「＋ 新建会话」 row is gone (the cursor space is sessions only). Enter therefore opens the row it is on — the stock `sessionIndex === 0` branch that started a session instead is deleted, and an empty list does nothing. Adds the fork's movement keys — **Ctrl+P / Ctrl+K up, Ctrl+N / Ctrl+J down** (`listKeyStep(input, key, event)`: `p`/`n`/`k` are ordinary control bytes so the bare byte and the kitty/modifyOtherKeys spelling agree, while Ctrl+J needs its own spelling — a terminal without extended keys sends **LF**, which Ink names `enter` with no modifier, so the raw byte plus `keypress.name` is the only signal; pasted line breaks excluded — this is also why Ctrl+N could leave the create action, which moved to Ctrl+T), shared with the foreign-source lists, and passes `striped` from the row's **absolute** index. Test: `node ~/.dsh-tui/patches/test-resume-flat.mjs` |
| `dsh-tui .../components/sessions/SessionListRow.js` | the 「当前」 badge is removed whole — prop, `currentText`, its term in the title budget, the JSX branch and the `supervisor-current` string; and a `striped` prop paints the row's whole two-line surface (`toolCardBackground`, the row states its own width so the band reaches the pane edge), hover blue still overriding it; everything else about the row (title truncation, pins, live glyphs) stays upstream |
| `dsh-tui .../i18n.js` | `supervisor-hint-list` drops the `←/→ switch pane` wording (the fork has no second pane to advertise) and advertises the fork's own keys (`Ctrl+P/N move · Ctrl+T new`) |
| `dsh-tui .../dsh-adapter/sessions/digest.js` | **F3 title chain** for `/resume` rows, in Claude Code's own order: a `session/title` event a **provider** (`auto`) or a **person** (`renamed`) wrote wins, else the **most recent** human prompt (`lastPromptOf`, newlines folded and clipped at `LAST_PROMPT_TITLE_CHARS = 200` the way Claude normalizes its `lastPrompt`), else the opening prompt (same normalization), else the working directory's basename. Both prompt levels step over a candidate that is nothing but a filesystem address (`isFileAddress`), and an address-only session still counts as a conversation (`hasPrompt`), so it never reaches the destructive empty-session clean-up. dsh's own **deterministic placeholder** (`source.kind: 'fallback'` — the opening prompt truncated by `dsh-session-title`) is not a name: `titleOf` marks it `strong: false`, all three scan sites (head/tail windows, the deep reverse scan, the appended-suffix update) refuse it, and a tail holding only a placeholder no longer claims `titleComplete` — the provider title may sit in the unseen middle, where the deep scan then finds it. Test: `node ~/.dsh-tui/patches/test-resume-title-chain.mjs` |
| `dsh-tui .../dsh-adapter/sessions/store.js` | **cache epoch** for that change: `SCHEMA_VERSION` 4 → 5, because a cached `title` means something different now. A version 4 index can hold a placeholder path as a name and would keep serving it forever (the log never changed, so the revision keeps hitting), so version 4 is not in the readable set — the index is dropped whole and every title is re-derived. No manual cache clearing, and an old process writing the index back as version 4 is not trusted either |

> **Reverted experiments (do not re-add):** a **cwd-scoped input history** was
> reverted once during the 0.10.1 move, then restored as F2, and finally
> **retired in 0.15.0** because upstream ships it itself (see the headline
> note above — no `history.js`/`PromptInput.js`/`Chat.js` rows in the table any
> more). For the resume browser three rejected variants are on
> record: a thin patch that kept the rail and only removed the grouping,
> lowering the rail's minimum width from 120 to 90 columns, and making the fork
> default to `allProjects: true` (every project). The wanted behaviour is the
> fork **scoped to the current directory**: no rail, one flat list, no way to
> widen the scope.

Deliberately **stock** (previously customized, removed in the 0.10.0 → 0.10.1 move,
or retired since):
the **vim wiring** in `Chat.js` /
`StatusLine.js` and the vim parts of `PromptInput.js` (vim is OFF by default, `/vim`
enables it, and the `INSERT`/`NORMAL` indicator lives in the input box as upstream
ships it),
the **cwd-scoped input history** (upstream-owned since 0.15.0, which also
took `Chat.js` and `PromptInput.js` out of the patch set entirely), the
`recapOnOpen` schema field (F5 — upstream-owned since 0.11.2),
and the `ToolFileDiff` `.d.ts` (the optional `oldStart`/`newStart` fields are
produced and read in plain JS; the declaration only matters to `tsc`, so it is not
patched — add a `declare module` augmentation in your own project if you ever need it).

The component patch is version-sensitive: `apply-diff-patches.sh` refuses to
install a backup that no longer passes `node --check` against a newer upstream.
