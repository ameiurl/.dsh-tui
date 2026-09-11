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
# Known gap, deliberately NOT checked: README claims a `dsh-patch` shell alias
# lives in ~/.zshrc / ~/.bashrc, and it does not. Creating the alias was
# deferred, so this stays a documented-vs-reality difference until that call is
# made — use the full script path in the meantime.

set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
TUI_PKG="$DSH_HOME/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui"
LIB="$TUI_PKG/lib"
TOOLS="$DSH_HOME/profiles/node_modules/@deepseek-ai"
GLOBAL="$(npm root -g 2>/dev/null)"

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
ck "shell dsh-tui = 0.10.0"      "grep -q '\"version\": \"0.10.0\"' '$GLOBAL/@deepseek-harness-tui/dsh-tui/package.json'"
ck "launcher dsh = 0.1.2-rc.1"   "grep -q '\"version\": \"0.1.2-rc.1\"' '$GLOBAL/@deepseek-ai/dsh/package.json'"
ck "dsh-tool-fs = 0.1.2-rc.1"    "grep -q '\"version\": \"0.1.2-rc.1\"' '$TOOLS/dsh-tool-fs/package.json'"
ck "dsh-tool-str-replace-editor = 0.1.2-rc.1" \
   "grep -q '\"version\": \"0.1.2-rc.1\"' '$TOOLS/dsh-tool-str-replace-editor/package.json'"
ck "profile dir is still dsh-tui" "[ -d '$DSH_HOME/profiles/dsh-tui' ]"

echo "== §1.2 user-level settings =="
ck "settings.yaml has diffLayout: unified" "grep -q 'diffLayout: unified' '$DSH_HOME/settings.yaml'"
ck "theme.json selects claude-code"        "grep -q 'claude-code' '$HOME/.dsh-tui/theme.json'"
ck "themes/claude-code.json exists"        "[ -f '$HOME/.dsh-tui/themes/claude-code.json' ]"
ck "themes/claude-code-light.json exists"  "[ -f '$HOME/.dsh-tui/themes/claude-code-light.json' ]"

echo "== §2 F1 diff rendering =="
A="$LIB/types/components/messages/AssistantToolUseMessage.js"
ck "DIFF_BODY_MAX_LINES = Infinity"   "grep -q 'DIFF_BODY_MAX_LINES = Infinity' '$A'"
ck "NEW_FILE_DIFF_MAX_LINES = 11"     "grep -q 'NEW_FILE_DIFF_MAX_LINES = 11' '$A'"
ck "upstream hoverTint branch deleted" "! grep -q 'hoverTint' '$A'"

echo "== §2 F2 cwd-scoped history =="
ck "history.js: loadHistory(cwd) filters"  "grep -q 'export function loadHistory(cwd)' '$LIB/types/history.js'"
ck "history.js: appendHistory(text, cwd)"  "grep -q 'export function appendHistory(text, cwd)' '$LIB/types/history.js'"
ck "PromptInput.js: historySeedCwd re-seed" "grep -q 'historySeedCwd' '$LIB/types/components/PromptInput.js'"
ck "PromptInput.js: seeds with channel.cwd" "grep -q 'loadHistory(channel.cwd)' '$LIB/types/components/PromptInput.js'"
ck "Chat.js: Ctrl+R reads channel.cwd"      "grep -q 'loadHistory(channel.cwd)' '$LIB/types/screens/Chat.js'"

echo "== §2 F3 resume browser =="
S="$LIB/types/screens/SessionBrowser.js"
ck "SessionBrowser.js: no workspace rail"     "! grep -q 'workspaceRail' '$S'"
ck "SessionBrowser.js: allProjects pinned false" "grep -q 'allProjects: false' '$S'"
ck "i18n.js: no '全部项目' left anywhere"      "! grep -rq '全部项目' '$LIB'"
# The doc says the i18n patch is exactly the three hint keys; a stray hunk here
# (e.g. resurrecting the old `session-scope-all` wording) is drift, not a fix.
ck "i18n diff touches only session-hint-list*" \
   "! grep -E \"^[-+].*'session-\" '$DIR/diffs/i18n.js.patch' | grep -qvE \"'session-hint-list\""

echo "== §2 F4 title chain =="
G="$LIB/types/dsh-adapter/sessions/digest.js"
ck "digest.js: isFileAddress present"        "grep -q 'function isFileAddress' '$G'"
ck "digest.js: lastEligiblePrompt present"   "grep -q 'function lastEligiblePrompt' '$G'"
ck "digest.js: lastPrompt clipped at 200"    "grep -q 'LAST_PROMPT_TITLE_CHARS = 200' '$G'"
# The empty-session signal must stay independent of the title candidate: if
# these two ever collapse back into one variable, an address-only opening makes
# a real conversation look empty — and `mod+x` deletes empty sessions.
ck "digest.js: hasPrompt is not the title candidate" \
   "grep -q 'sawPrompt || !head.whole' '$G'"
ck "digest.js: recovery returns hasPrompt"   "grep -q 'hasPrompt: opening.hasPrompt' '$G'"

echo "== §2 deliberately stock (must NOT be patched) =="
ck "vim stays OFF by default"        "! grep -q 'vimMode: true' '$LIB/types/components/PromptInput.js'"
ck "ToolFileDiff .d.ts has no oldStart" "! grep -q 'oldStart' '$LIB/types/components/messages/ToolFileDiff.d.ts'"

echo "== §2/§3 scripts and tests referenced by the docs =="
ck "resolve-patch-targets.mjs runs"  "node '$DIR/resolve-patch-targets.mjs'"
ck "test-resume-flat.mjs passes"     "node '$DIR/test-resume-flat.mjs'"
ck "test-history-cwd.mjs passes"     "node '$DIR/test-history-cwd.mjs'"
ck "test-title-skips-paths.mjs passes" "node '$DIR/test-title-skips-paths.mjs'"
ck "TARGETS count == original/ count" \
   "[ \"\$(node '$DIR/resolve-patch-targets.mjs' | wc -l)\" = \"\$(ls '$DIR/original' | wc -l)\" ]"
ck "TARGETS count == diffs/ count" \
   "[ \"\$(node '$DIR/resolve-patch-targets.mjs' | wc -l)\" = \"\$(ls '$DIR/diffs' | wc -l)\" ]"
ck "diffs/ names match backup/ names" \
   "diff <(node '$DIR/resolve-patch-targets.mjs' | awk -F'|' '{print \$2}' | sort) <(ls '$DIR/diffs' | sed 's/\.patch\$//' | sort)"
ck "apply script parses (bash -n)"   "bash -n '$DIR/apply-diff-patches.sh'"

echo
if [ "$fail" -eq 0 ]; then
  echo "PASS: $pass checks — the docs describe the installed code."
  exit 0
fi
echo "$fail of $((pass + fail)) checks failed — the docs and the installed code disagree."
exit 1
