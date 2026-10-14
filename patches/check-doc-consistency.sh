#!/usr/bin/env bash
# check-doc-consistency.sh — assert that CUSTOMIZATIONS.md / README.md still
# describe the code that is actually installed.
#
#   bash ~/.dsh-tui/patches/check-doc-consistency.sh
#
# The docs are the authority for the next re-port, so a stale line is not
# cosmetic: §1 pins the versions, §2 lists which files each customization
# touches and what the code does, and §3 names the scripts to run. Every claim
# that can be checked mechanically is checked here, so drift shows up as a
# FAIL instead of as a wrong instruction during an upgrade.
#
# Exit 0 = docs and code agree.
#
# The README's claim that a `dsh-patch` shell alias lives in ~/.zshrc /
# ~/.bashrc was a documented-vs-reality gap for a while; both files now carry
# it, so §3 asserts it instead of excusing it.

set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
TUI_PKG="$DSH_HOME/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui"
LIB="$TUI_PKG/lib"
TOOLS="$DSH_HOME/profiles/node_modules/@deepseek-ai"
GLOBAL="$(npm root -g 2>/dev/null)"
BASE_JSON="$DIR/patch-base-versions.json"
basev() { node -p "require('$BASE_JSON')['$1'] ?? '?'" 2>/dev/null || echo '?'; }
pkgv()  { node -p "require('$1/package.json').version" 2>/dev/null || echo '?'; }

pass=0; fail=0
ck() { # ck <description> <shell condition>
  if ( eval "$2" ) >/dev/null 2>&1; then
    printf '  ok   %s\n' "$1"; pass=$((pass + 1))
  else
    printf '  FAIL %s\n' "$1"; fail=$((fail + 1))
  fi
}

echo "== §1.1 version table =="
ck "profile dsh-tui = $(node -p "require('$TUI_PKG/package.json').version" 2>/dev/null)" \
   "[ \"\$(node -p \"require('$TUI_PKG/package.json').version\")\" = \"\$(cat '$DIR/patch-base-version')\" ]"
SHELL_PKG="$GLOBAL/@deepseek-harness-tui/dsh-tui"
# The shell is a thin delegator whose version should track the profile it
# launches; asserting equality catches both a stale shell and a doc table that
# still names the old one.
ck "shell dsh-tui = $(node -p "require('$SHELL_PKG/package.json').version" 2>/dev/null)" \
   "[ \"\$(node -p \"require('$SHELL_PKG/package.json').version\")\" = \"\$(node -p \"require('$TUI_PKG/package.json').version\")\" ]"
LAUNCHER="$(pkgv "$GLOBAL/@deepseek-ai/dsh")"
TOOL_BASE="$(basev '@deepseek-ai/dsh-tool-fs')"
ck "launcher dsh = $LAUNCHER (read from the installed tree)" \
   "[ -n '$LAUNCHER' ] && [ '$LAUNCHER' != '?' ]"
# The launcher rides its own release train (dsh-tui 0.12.0 ↔ ecosystem
# 0.2.0-rc.2). Assert the DOC names the installed one instead of pinning a
# constant here: an ecosystem upgrade then fails on a stale §1.1 row rather than
# on this line, which nobody remembers to edit.
ck "CUSTOMIZATIONS.md §1.1 records launcher $LAUNCHER" \
   "grep -qE 'launcher / 生态.*$LAUNCHER' '$DIR/CUSTOMIZATIONS.md'"
ck "CUSTOMIZATIONS.md §1.1 records the tool baseline $TOOL_BASE" \
   "grep -qE 'tool 包 .*$TOOL_BASE' '$DIR/CUSTOMIZATIONS.md'"
# The tool packages ride the launcher's ecosystem version and are patched
# separately, so each one is asserted against its own baseline in
# patch-base-versions.json — the same map apply-diff-patches.sh gates on.
ck "dsh-tool-fs = $(basev '@deepseek-ai/dsh-tool-fs')" \
   "[ \"\$(pkgv '$TOOLS/dsh-tool-fs')\" = \"\$(basev '@deepseek-ai/dsh-tool-fs')\" ]"
ck "dsh-tool-str-replace-editor = $(basev '@deepseek-ai/dsh-tool-str-replace-editor')" \
   "[ \"\$(pkgv '$TOOLS/dsh-tool-str-replace-editor')\" = \"\$(basev '@deepseek-ai/dsh-tool-str-replace-editor')\" ]"
ck "patch-base-versions.json parses" "node -e \"require('$BASE_JSON')\""
ck "patch-base-version == patch-base-versions.json[dsh-tui]" \
   "[ \"\$(cat '$DIR/patch-base-version')\" = \"\$(basev '@deepseek-harness-tui/dsh-tui')\" ]"
ck "profile dir is still dsh-tui" "[ -d '$DSH_HOME/profiles/dsh-tui' ]"
# The version table is the first thing an upgrade invalidates and the last thing
# anyone remembers to edit: assert the docs actually SAY the baseline this
# checkout is built against (the label above only reports the installed one).
BASE="$(cat "$DIR/patch-base-version")"
ck "CUSTOMIZATIONS.md §1.1 records the baseline $BASE" \
   "grep -qE 'patch-base-version.+\`$BASE\`' '$DIR/CUSTOMIZATIONS.md'"
ck "README.md source list names dsh-tui@$BASE" \
   "grep -q 'dsh-tui@$BASE' '$DIR/README.md'"

echo "== §1.2 user-level settings =="
# dsh 0.1.7 dropped the separate settings document: user settings are patch rows
# in the profile's own cordis.patch.yml now (what /settings writes). diffLayout
# is the one F1 depends on — `auto` goes side-by-side on wide terminals and the
# Claude Code unified rendering never shows.
PROFILE_PATCH="$DSH_HOME/profiles/dsh-tui/cordis.patch.yml"
ck "profile patch sets dsh-tui.diffLayout: unified" \
   "grep -q 'diffLayout: unified' '$PROFILE_PATCH'"
ck "profile patch still restates the dsh-tui bundle config (it REPLACES it)" \
   "grep -q 'effort: max' '$PROFILE_PATCH' && grep -q 'provider: deepseek-official' '$PROFILE_PATCH'"
ck "the removed settings.yaml is gone (not silently unread)" \
   "[ ! -f '$DSH_HOME/settings.yaml' ]"
ck "legacy settings kept for reference" "[ -f '$DSH_HOME/settings.yaml.imported' ]"
ck "theme.json selects claude-code"        "grep -q 'claude-code' '$HOME/.dsh-tui/theme.json'"
ck "themes/claude-code.json exists"        "[ -f '$HOME/.dsh-tui/themes/claude-code.json' ]"
ck "themes/claude-code-light.json exists"  "[ -f '$HOME/.dsh-tui/themes/claude-code-light.json' ]"

echo "== §2 F1 diff rendering (upstream numbers, our bands) =="
A="$LIB/types/components/messages/AssistantToolUseMessage.js"
# 0.15.0 re-port (plan D): the tools hand the UI unified patch TEXT and the
# stock parser (components/diffPatch.js) numbers it, so the renderer no longer
# derives numbers itself — it only adds the Claude Code row bands, the
# word-level segments, the never-fold cap and the hover fix on top.
ck "renderer: unified diff bodies are never folded" \
   "grep -q 'newFileDiff ? NEW_FILE_DIFF_MAX_LINES : Infinity' '$A'"
ck "renderer: new-file preview cap = 11"   "grep -q 'const NEW_FILE_DIFF_MAX_LINES = 11' '$A'"
ck "renderer: split panes keep the upstream 8" "grep -q 'const DIFF_BODY_MAX_LINES = 8' '$A'"
ck "renderer: rows carry the CC band" \
   "grep -q 'function diffRowBackground(tone)' '$A' && grep -q \"'diffAddedDimmed'\" '$A'"
ck "renderer: word-level segments" \
   "grep -q 'function wordSegments' '$A' && grep -q 'function segmentNodes' '$A'"
ck "renderer: numbered gutters come from the parsed patch" "grep -q 'gutter: gutterOf(' '$A'"
ck "renderer: a create is detected by its all-added hunk" \
   "grep -q \"hunk.lines.every(line => line.kind === 'add')\" '$A'"
# The pre-0.15.0 tool patch (old hosts, and every card already in a session
# log) sends `{oldText,newText,oldStart,newStart}`: the renderer line-diffs the
# sides itself so those cards keep a real gutter instead of bare markers.
ck "renderer: legacy hunks keep their line numbers" \
   "grep -q 'function legacyDiffLines' '$A' && grep -q \"typeof diff.oldStart === 'number'\" '$A'"
ck "renderer: upstream hoverTint branch deleted" "! grep -q 'hoverTint' '$A'"
ck "renderer: diffRows test seam exported" "grep -q 'export function diffRows' '$A'"
# F1's tool half: the two packages carry the diff at all (str_replace has no
# presentationMeta upstream) and now emit `@@` hunks instead of old/new texts,
# which is what lets the STOCK parser number Edit/Write lines.
TFS="$TOOLS/dsh-tool-fs/lib/index.js"
TSR="$TOOLS/dsh-tool-str-replace-editor/lib/index.js"
ck "tool-fs: hunks serialized as patch text" \
   "grep -q 'function hunksPatch' '$TFS' && grep -q 'patch: hunksPatch(patch.hunks)' '$TFS'"
ck "tool-fs: creates render as all-added patches" \
   "grep -q 'function newFileDiff' '$TFS' && grep -q '@@ -0,0 +1,\${lines.length} @@' '$TFS'"
ck "tool-fs: meta validator takes patch text" "grep -q 'typeof patch === \"string\"' '$TFS'"
# `hunk.oldStart` is jsdiff's own field, read to write the `@@` header — what
# must be gone is OUR added property (`oldStart: …` on the emitted diff).
ck "tool-fs: the old oldStart/newStart fields are gone" "! grep -q 'oldStart:' '$TFS'"
ck "str-replace: same patch-text shape" \
   "grep -q 'function hunksPatch' '$TSR' && grep -q 'typeof d.patch === \"string\"' '$TSR'"
ck "str-replace: result diff card present"  "grep -q 'presentResult(args, result)' '$TSR'"
# The tool patch must be exactly the diff feature: a stale backup built
# on 0.1.2-rc.1 would drag removed upstream work (scope-aware prompts, the
# REMEDIES refactor) back in.
ck "tool-fs patch carries no upstream rollback" \
   "! grep -qE '^[-+].*(scope-aware|REMEDIES)' '$DIR/diffs/dsh-tool-fs.index.js.patch'"
ck "F1 behaviour test passes"               "node '$DIR/test-f1-diff-rows.mjs'"

echo "== §2 retired: cwd-scoped history is stock upstream (0.15.0) =="
# F2 was a patch (history.js + PromptInput.js + Chat.js) until 0.15.0 shipped the
# whole chain upstream. The assertions below pin THAT upstream contract — the one
# test-history-cwd.mjs guards — plus the fact that the three files left the patch
# set. Note the field name: upstream writes `project`, the retired patch `cwd`.
ck "history.js: loadHistory(cwd) filters"  "grep -q 'export function loadHistory(cwd)' '$LIB/types/history.js'"
ck "history.js: appendHistory(text, cwd)"  "grep -q 'export function appendHistory(text, cwd)' '$LIB/types/history.js'"
ck "history.js: loadHistoryOldestFirst(cwd) filters"    "grep -q 'export function loadHistoryOldestFirst(cwd)' '$LIB/types/history.js'"
ck "history.js: one project key normalizes a directory" "grep -q 'export function historyProjectKey(cwd)' '$LIB/types/history.js'"
# Stock is a UNION: an untagged legacy entry is visible to every project, unlike
# the retired patch, whose pool yielded once a directory had entries of its own.
ck "history.js: untagged entries join every view (stock union)" \
   "grep -q 'entry.project === undefined || entry.project === project' '$LIB/types/history.js'"
ck "PromptInput.js: seeds per directory"    "grep -q 'historySeededProject' '$LIB/types/components/PromptInput.js'"
ck "PromptInput.js: seeds with channel.cwd" "grep -q 'loadHistoryOldestFirst(channel.cwd)' '$LIB/types/components/PromptInput.js'"
ck "PromptInput.js: submits tagged with channel.cwd"    "grep -q 'appendHistory(text, channel.cwd)' '$LIB/types/components/PromptInput.js'"
ck "Chat.js: Ctrl+R reads channel.cwd"      "grep -q 'loadHistory(channel.cwd)' '$LIB/types/screens/Chat.js'"
# Retired means gone from the set, not merely failing to apply.
ck "F2: history/PromptInput/Chat are no longer patch targets" \
   "! node '$DIR/resolve-patch-targets.mjs' 2>/dev/null | grep -qE '/(history|PromptInput|Chat)\\.js\\|'"
ck "F2: no F2 backup/original/diff left behind" \
   "[ ! -f '$DIR/original/history.js' ] && [ ! -f '$DIR/original/PromptInput.js' ] && [ ! -f '$DIR/original/Chat.js' ] && [ ! -f '$DIR/diffs/history.js.patch' ] && [ ! -f '$DIR/diffs/PromptInput.js.patch' ] && [ ! -f '$DIR/diffs/Chat.js.patch' ]"

echo "== §2 F2 resume screen (sessionSupervisor) =="
# 0.11.x deleted screens/SessionBrowser.js: /resume is the sessionSupervisor
# screen (workspace rail + session pane). The fork hides the rail and pins the
# pane to the terminal's own directory, so the anchors moved with it.
SUP="$LIB/types/screens/sessionSupervisor/useSessionSupervisor.js"
SS="$LIB/types/screens/SessionSupervisor.js"
ck "old SessionBrowser target is gone upstream" "[ ! -f '$LIB/types/screens/SessionBrowser.js' ]"
ck "patch set follows it to sessionSupervisor" \
   "! grep -E '^  \"[^\"]*SessionBrowser' '$DIR/apply-diff-patches.sh' && grep -q 'sessionSupervisor/useSessionSupervisor.js' '$DIR/apply-diff-patches.sh'"
ck "hook: rail is never rendered"          "grep -q 'const railVisible = false' '$SUP'"
ck "hook: rows matched by directory"    "grep -q 'filter(session => samePath(session.cwd, channel.cwd))' '$SUP'"
ck "hook: the list owns the keyboard"      "grep -q \"useState('list')\" '$SUP'"
# The F3 fork also drops the new-session row and the "当前" badge: the list is
# sessions only, and Ctrl+T (advertised in the hint) is the way to create one.
ck "screen: no new-session row"             "! grep -q \"t('supervisor-new-session')\" '$SS'"
ck "screen: no current badge"               "! grep -q 'current: state?.current' '$SS'"
# The badge is gone WHOLE: prop, budget term, JSX and its i18n string.
ROW="$LIB/types/components/sessions/SessionListRow.js"
ck "row: the current badge is gone from the component" "! grep -q 'current' '$ROW'"
# (the path is $LIB/types/i18n.js — $LIB/i18n.js does not exist, and `! grep` on a
# missing file passes vacuously, which is how this line guarded nothing at all)
ck "i18n: the badge string is gone too" "! grep -q \"'supervisor-current'\" '$LIB/types/i18n.js'"
ck "targets: SessionListRow.js is a patch target" \
   "grep -q 'SessionListRow.js|SessionListRow.js' '$DIR/apply-diff-patches.sh'"
ck "hook: the cursor space is sessions only" "! grep -q 'cardFocused' '$SUP'"
# The default cursor is the most recently used session in this directory,
# derived from the pane's own list (the rail grouping has no key for it).
ck "hook: opens on the most recent session" \
   "grep -q 'for (const session of listedSessions)' '$SUP' && ! grep -q 'mostRecentIn' '$SUP'"
# A nameless record with no artifact behind it is not offered as a session.
ck "hook: artifact-less records are not listed" \
   "grep -q 'session.title?.source !== .fallback. || session.bytes !== undefined' '$SUP'"
ck "hook: no rail-picked selection state left" \
   "! grep -qE 'selectedPath|selectedUnregistered|selectionManual' '$SUP'"
ck "i18n.js: no '全部项目' left anywhere"      "! grep -rq '全部项目' '$LIB'"
# The doc says the i18n patch is exactly the one hint key this screen renders
# (no rail, so no ←/→ pane switch to advertise). A stray hunk is drift.
ck "i18n diff touches only the keys this fork owns" \
   "! grep -E \"^[-+].*'supervisor-\" '$DIR/diffs/i18n.js.patch' | grep -qvE \"'supervisor-(hint-list|current)\""
# The fork's own additions to that list: emacs' Ctrl+P/N movement pair, a zebra
# band on every other row, and an Enter that opens the row it stands on (the
# stock new-session card branch is gone; creating moved off Ctrl+N to Ctrl+T
# precisely because Ctrl+N walks the list now).
ck "screen: the movement keys are answered once per key" \
   "grep -q 'const step = listKeyStep(input, key, event)' '$SS' && grep -q 'step === -1' '$SS' && grep -q 'step === 1' '$SS'"
ck "screen: listKeyStep is Ctrl+P/K up, Ctrl+N/J down" \
   "grep -qF \"isMod(key) && (input === 'p' || input === 'k')\" '$SS' && grep -qF \"isMod(key) && (input === 'n' || input === 'j')\" '$SS'"
ck "screen: listKeyStep accepts Ctrl+J's bare LF spelling" \
   "grep -qF \"key.isPasted !== true && event?.keypress?.name === 'enter'\" '$SS'"
ck "screen: the retired Ctrl+F is unbound" \
   "! grep -qF \"input === 'f'\" '$SS'"
ck "screen: Ctrl+T is what creates now" \
   "grep -qF \"isMod(key) && input === 't'\" '$SS' && grep -q 'newSessionIn(selected)' '$SS'"
ck "i18n: the hint advertises Ctrl+P/N and Ctrl+T" \
   "grep -q 'Ctrl+P/N 移动 · Ctrl+T 新建' '$LIB/types/i18n.js'"
ck "screen: every other row is striped by ABSOLUTE index" \
   "grep -q 'striped: (sessionTop + index) % 2 === 1' '$SS'"
ck "screen: Enter on row 0 opens it, never creates" \
   "! grep -q 'if (sessionIndex === 0)' '$SS'"
ck "row: striped paints the surface" \
   "grep -q 'striped = false' '$ROW' && grep -qF 'striped ? STRIPE_BACKGROUND' '$ROW'"
ck "row: the band is an explicit 256 index, not a theme surface" \
   "grep -qF \"const STRIPE_BACKGROUND = 'ansi256(237)'\" '$ROW' && ! grep -qF \"STRIPE_BACKGROUND = 'toolCardBackground\" '$ROW'"
ck "row: the band reaches the pane edge" "grep -q 'flexShrink: 0, width: width,' '$ROW'"
ck "test-resume-flat.mjs covers the keys and the band" \
   "grep -q 'listKeyStep' '$DIR/test-resume-flat.mjs' && grep -q 'striped: true' '$DIR/test-resume-flat.mjs' && grep -q '48;5;237' '$DIR/test-resume-flat.mjs'"
ck "CUSTOMIZATIONS.md documents the pair and the band" \
   "grep -q 'Ctrl+P / Ctrl+K 向上，Ctrl+N / Ctrl+J 向下' '$DIR/CUSTOMIZATIONS.md' && grep -q '上下分得清' '$DIR/CUSTOMIZATIONS.md' && grep -q 'ansi256(237)' '$DIR/CUSTOMIZATIONS.md' && grep -q '塌成同一个 59 号中灰' '$DIR/CUSTOMIZATIONS.md' && grep -q 'Ctrl+T 新建会话' '$DIR/CUSTOMIZATIONS.md' && grep -q 'LF（0x0A）' '$DIR/CUSTOMIZATIONS.md'"
ck "README.md documents the keys and the band" \
   "grep -q 'Ctrl+P / Ctrl+K' '$DIR/README.md' && grep -q 'Ctrl+N / Ctrl+J' '$DIR/README.md' && grep -q 'zebra band' '$DIR/README.md' && grep -q 'Ctrl+T' '$DIR/README.md'"

echo "== §2 F3 title chain (Claude Code's order) =="
G="$LIB/types/dsh-adapter/sessions/digest.js"
ck "digest.js: lastPromptOf present"         "grep -q 'function lastPromptOf' '$G'"
ck "digest.js: normalizeLastPrompt present"  "grep -q 'function normalizeLastPrompt' '$G'"
ck "digest.js: lastPrompt clipped at 200"    "grep -q 'LAST_PROMPT_TITLE_CHARS = 200' '$G'"
# Claude's order: the RECENT prompt is asked for before the opening one, and
# only when no title event was written.
ck "digest.js: recent prompt precedes the first" \
   "grep -q 'const named = recent ?? opening' '$G'"
ck "digest.js: isFileAddress present"        "grep -q 'function isFileAddress' '$G'"
ck "digest.js: title candidate skips addresses" \
   "grep -q 'opening === undefined && human?.text !== undefined && !isFileAddress(human.text)' '$G'"
ck "digest.js: recent prompt skips addresses" \
   "grep -q 'found?.text !== undefined && !isFileAddress(found.text)' '$G'"
# An address-only opening must stay a CONVERSATION: every human message counts
# as evidence while only `opening` holds the title candidate, and the recovery
# scan reports hasPrompt separately. Collapsing the two makes such a session
# look empty — and `mod+x` deletes empty sessions. 0.10.2 upstream tracks that
# evidence as `hasHumanMessage` and folds it into completeness, which is the
# same separation; the shape is pinned because the F4 filter rides on it.
ck "digest.js: hasPrompt counts any human message" \
   "grep -q 'const hasPrompt = hasHumanMessage || !completeHead' '$G'"
ck "digest.js: humanPrompt result is consumed as { text }" \
   "grep -q 'const human = humanPrompt(line)' '$G'"
ck "digest.js: recovery skips an address opening" \
   "grep -q 'prompt?.text !== undefined && !isFileAddress(prompt.text)' '$G'"
# 0.10.2 verifies a log's first line is a real `session` line before calling it
# completely read; a fixture opening with anything else reports an empty session
# as a full conversation (see §4's 0.10.2 row). Keep the fixture honest.
ck "title-chain fixture opens with a real session first line" \
   "grep -q \"type: 'session', version: 0\" '$DIR/test-resume-title-chain.mjs'"
ck "digest.js: recovery returns hasPrompt"   "grep -q 'hasPrompt: opening.hasPrompt' '$G'"
# dsh writes a deterministic PLACEHOLDER when nothing named a session: the
# opening prompt, truncated, as `source.kind: 'fallback'`. It names nothing —
# the row that showed `@modules/client/…/A` came from it — so titleOf
# classifies it not-strong ONCE and every scan site refuses it: three sites
# take `title?.strong`, the appended-suffix update takes `found?.strong`.
ck "digest.js: the placeholder is classified not-strong" \
   "grep -q \"strong: kind !== 'fallback'\" '$G'"
# Head window, tail window, deep reverse scan and the appended suffix all
# refuse dsh's `fallback` placeholder.
ck "digest.js: four scan sites require a strong title" \
   "[ \"\$(grep -c 'strong === true' '$G')\" = 4 ]"
ck "digest.js: the suffix update requires a strong title" \
   "grep -q 'found?.strong === true' '$G'"
# A tail holding only a placeholder must not mark the read complete: the name
# that wins may sit in the unseen middle, which is what the deep scan is for.
ck "digest.js: completeness no longer follows a placeholder" \
   "grep -q 'completeHead || tailTitle !== undefined' '$G'"
# The opening prompt is a title candidate too, so it gets the same one-line,
# 200-character normalization the recent prompt gets: it used to reach the row
# raw, and a multi-line opening wrapped the row it was naming.
ck "digest.js: the opening prompt is normalized as well" \
   "grep -q 'opening = normalizeLastPrompt(human.text)' '$G'"
# F4 changed what a cached title MEANS, so the version 4 index — which can
# hold a placeholder path as a name and would serve it on every cache hit —
# must be unreadable. The bump IS the mechanism; no manual cache clearing.
S="$LIB/types/dsh-adapter/sessions/store.js"
ck "store.js: cache epoch bumped to 5"     "grep -q 'const SCHEMA_VERSION = 5' '$S'"
ck "store.js: a version 4 index is discarded" \
   "grep -q \"file\\['version'\\] !== SCHEMA_VERSION && file\\['version'\\] !== 3 && file\\['version'\\] !== 2\" '$S'"
ck "store.js is a patch target" \
   "grep -q 'sessions/store.js|store.js' '$DIR/apply-diff-patches.sh'"
ck "the title-chain test covers the placeholder" \
   "grep -q 'a placeholder does not bury the provider title' '$DIR/test-resume-title-chain.mjs'"

echo "== §2 deliberately stock (must NOT be patched) =="
ck "vim stays OFF by default"        "! grep -q 'vimMode: true' '$LIB/types/components/PromptInput.js'"
ck "ToolFileDiff .d.ts has no oldStart" "! grep -q 'oldStart' '$LIB/types/components/messages/ToolFileDiff.d.ts'"
# F5 (`recapOnOpen`) was a patch target until 0.11.2, which declares the field
# and makes it volatile on its own; the patch was retired, so the file must stay
# out of TARGETS and the stock contract (key + volatility + writability) is
# asserted by the test instead of by a diff.
ck "F5 recapOnOpen stays stock (dsh-adapter/index.js not a target)" \
   "! node '$DIR/resolve-patch-targets.mjs' | grep -q 'dsh-adapter.index.js'"
ck "test-recap-setting.mjs passes (F5 stock contract)" \
   "node '$DIR/test-recap-setting.mjs'"

echo "== §2/§3 scripts and tests referenced by the docs =="
ck "resolve-patch-targets.mjs runs"  "node '$DIR/resolve-patch-targets.mjs'"
ck "test-resume-flat.mjs passes"     "node '$DIR/test-resume-flat.mjs'"
ck "test-history-cwd.mjs passes (F2 stock contract)" "node '$DIR/test-history-cwd.mjs'"
ck "test-resume-title-chain.mjs passes" "node '$DIR/test-resume-title-chain.mjs'"
ck "TARGETS count == original/ count" \
   "[ \"\$(node '$DIR/resolve-patch-targets.mjs' | wc -l)\" = \"\$(ls '$DIR/original' | wc -l)\" ]"
ck "TARGETS count == diffs/ count" \
   "[ \"\$(node '$DIR/resolve-patch-targets.mjs' | wc -l)\" = \"\$(ls '$DIR/diffs' | wc -l)\" ]"
ck "diffs/ names match backup/ names" \
   "diff <(node '$DIR/resolve-patch-targets.mjs' | awk -F'|' '{print \$2}' | sort) <(ls '$DIR/diffs' | sed 's/\.patch\$//' | sort)"
ck "apply script parses (bash -n)"   "bash -n '$DIR/apply-diff-patches.sh'"
ck "apply script breaks pnpm hardlinks before writing" \
   "grep -q 'cp --remove-destination' '$DIR/apply-diff-patches.sh'"
ck "apply script gates versions per target (NEEDS-REPORT)" \
   "grep -q 'NEEDS-REPORT' '$DIR/apply-diff-patches.sh'"
ck "apply script reads the per-package baseline map" \
   "grep -q 'patch-base-versions.json' '$DIR/apply-diff-patches.sh'"
# An upgrade that moves the code no longer leaves the set un-applied: the stored
# unified diff is applied to what is installed (fuzz 3), syntax-gated, stamped.
ck "apply script applies diffs directly (patch --fuzz=3)" \
   "grep -q 'patch -p0 --fuzz=3' '$DIR/apply-diff-patches.sh'"
ck "apply script reports PATCHED-DRIFT for a moved baseline" \
   "grep -q 'PATCHED-DRIFT' '$DIR/apply-diff-patches.sh'"
ck "apply script is idempotent on diff-applied files (OK-PATCHED)" \
   "grep -q 'OK-PATCHED' '$DIR/apply-diff-patches.sh'"
# 0.12.0: GNU patch reports the hunk outcomes — including "with fuzz N" — on
# STDOUT. Capturing stderr alone (with -s) left NEEDS-REPORT quoting an empty
# file and leaked patch's chatter into the report; the fix greps the captured
# stdout and reports fuzz apart from a mere line-number offset.
ck "apply script captures patch's stdout (the hunk/fuzz report)" \
   "grep -q 'patch.out' '$DIR/apply-diff-patches.sh'"
ck "apply script tells fuzz apart from a line-number offset" \
   "grep -q 'patch_was_fuzzy' '$DIR/apply-diff-patches.sh' && grep -q 'PATCHED-FUZZ' '$DIR/apply-diff-patches.sh'"
ck "apply script quotes the failing hunks on NEEDS-REPORT" \
   "grep -q 'fail_note' '$DIR/apply-diff-patches.sh'"
ck "apply script silences the read-only warning -o makes meaningless" \
   "grep -q -- '--read-only=ignore' '$DIR/apply-diff-patches.sh'"
ck "apply script aborts when a target cannot be written" \
   "grep -q 'ABORT: cannot write' '$DIR/apply-diff-patches.sh'"
ck "apply script's closing note names the profile patch (not the dropped settings.yaml)" \
   "grep -q \"profile's cordis.patch.yml\" '$DIR/apply-diff-patches.sh'"
ck "every target has a stored diff to fall back on" \
   "[ \"\$(node '$DIR/resolve-patch-targets.mjs' | wc -l)\" = \"\$(ls '$DIR/diffs'/*.patch | wc -l)\" ]"
# The runbook must name a command that actually exists. `dsh-patch` is only a
# convenience alias the doc says how to add, so what is asserted is the script
# path both files tell the reader to run.
ck "runbook names the apply script by path" \
   "grep -q 'bash ~/.dsh-tui/patches/apply-diff-patches.sh' '$DIR/CUSTOMIZATIONS.md'"
ck "README points at the same script" \
   "grep -q 'apply-diff-patches.sh' '$DIR/README.md'"

echo "== §3 stored diffs are exact against the documented baseline =="
# A re-ported baseline is exact: each diffs/<name>.patch applies to its
# original/ at fuzz 0 and reproduces backup/ byte-for-byte. Fuzz is the apply
# script's fallback for an upgrade that moved the code; a baseline that already
# needs it is drift, not a port (see §4's 0.11.2 row).
RT="$(mktemp -d)"
rt_bad=0
while IFS='|' read -r target name; do
  [ -f "$DIR/original/$name" ] && [ -f "$DIR/diffs/$name.patch" ] || continue
  if patch -p0 --fuzz=0 --no-backup-if-mismatch -s -o "$RT/$name" "$DIR/original/$name" \
       < "$DIR/diffs/$name.patch" 2>/dev/null && cmp -s "$RT/$name" "$DIR/backup/$name"; then
    :
  else
    printf '  FAIL diff is not exact (fuzz 0 / == backup): %s\n' "$name"
    rt_bad=$((rt_bad + 1))
  fi
done < <(node "$DIR/resolve-patch-targets.mjs")
rm -rf "$RT"
if [ "$rt_bad" -eq 0 ]; then
  printf '  ok   every stored diff applies at fuzz 0 and equals backup/\n'; pass=$((pass + 1))
else
  fail=$((fail + rt_bad))
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "PASS: $pass checks — the docs describe the installed code."
  exit 0
fi
echo "$fail of $((pass + fail)) checks failed — the docs and the installed code disagree."
exit 1
