#!/usr/bin/env bash
# dsh-diff-patch — check / re-apply the Claude Code unified-diff patches after
# a `dsh` upgrade wipes the launcher-managed node_modules.
#
# Usage:
#   dsh-patch           check every file; re-apply only the ones that differ
#   dsh-patch check     report only, never modify (exit 1 when something differs)
#   dsh-patch apply     force-copy all backups over their targets
#   dsh-patch diff      print the unified diff between each installed file and
#                       its patched backup (what an upgrade reverted)
#
# Each patched file is restored from ./backup and syntax-checked with
# `node --check` before being installed; a failing check aborts WITHOUT
# touching the target. When the installed dsh-tui version differs from the
# version the patch was built against, a warning is printed (the patch may
# need re-porting to a changed upstream file).

set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP="$DIR/backup"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
MODE="${1:-auto}"
TUI_PKG="$DSH_HOME/profiles/tui/node_modules/@deepseek-harness-tui/dsh-tui"

declare -a TARGETS=(
  "$DSH_HOME/profiles/node_modules/@deepseek-ai/dsh-tool-fs/lib/index.js|dsh-tool-fs.index.js"
  "$DSH_HOME/profiles/node_modules/@deepseek-ai/dsh-tool-str-replace-editor/lib/index.js|dsh-tool-str-replace-editor.index.js"
  "$TUI_PKG/lib/types/components/messages/AssistantToolUseMessage.js|AssistantToolUseMessage.js"
  "$TUI_PKG/lib/types/dsh-adapter/channel.d.ts|channel.d.ts"
  "$TUI_PKG/lib/types/components/sessions/SessionListRow.js|SessionListRow.js"
  "$TUI_PKG/lib/types/components/PromptInput.js|PromptInput.js"
  "$TUI_PKG/lib/types/screens/Chat.js|Chat.js"
  "$TUI_PKG/lib/types/screens/StatusLine.js|StatusLine.js"
  "$TUI_PKG/lib/types/screens/SessionBrowser.js|SessionBrowser.js"
  "$TUI_PKG/lib/types/i18n.js|i18n.js"
)

needs_apply=0
for entry in "${TARGETS[@]}"; do
  target="${entry%%|*}"
  backup="$BACKUP/${entry##*|}"
  if [[ ! -f "$target" ]]; then
    echo "MISSING: ${target#$DSH_HOME/}  (upgrade moved it? patch needs re-porting)"
    needs_apply=1
    continue
  fi
  if [[ ! -f "$backup" ]]; then
    echo "NOBACKUP: $backup"
    needs_apply=1
    continue
  fi
  if cmp -s "$target" "$backup"; then
    echo "OK:      ${target#$DSH_HOME/}"
  else
    echo "DIFFERS: ${target#$DSH_HOME/}"
    needs_apply=1
  fi
done

# Version guard: the patch was built against a specific upstream snapshot.
if [[ -f "$TUI_PKG/package.json" ]]; then
  cur="$(node -p "require('$TUI_PKG/package.json').version" 2>/dev/null || echo '?')"
  base="$(cat "$DIR/patch-base-version" 2>/dev/null || echo '?')"
  echo "dsh-tui installed: $cur | patch built against: $base"
  if [[ "$cur" != "?" && "$base" != "?" && "$cur" != "$base" ]]; then
    echo "⚠  version changed — files are still copied (syntax-checked), but if the"
    echo "   upstream file changed structurally the patch may need re-porting."
  fi
fi

if [[ "$MODE" == "check" ]]; then
  exit $(( needs_apply ))
fi

if [[ "$MODE" == "diff" ]]; then
  for entry in "${TARGETS[@]}"; do
    target="${entry%%|*}"
    backup="$BACKUP/${entry##*|}"
    [[ -f "$target" && -f "$backup" ]] || continue
    if ! cmp -s "$target" "$backup"; then
      echo "=== ${target#$DSH_HOME/} (installed → patched) ==="
      diff -u "$target" "$backup" | head -80
    fi
  done
  exit 0
fi

if [[ "$MODE" == "apply" || "$needs_apply" -eq 1 ]]; then
  for entry in "${TARGETS[@]}"; do
    target="${entry%%|*}"
    backup="$BACKUP/${entry##*|}"
    [[ -f "$target" && -f "$backup" ]] || continue
    if [[ "$backup" == *.js ]] && ! node --check "$backup" >/dev/null 2>&1; then
      echo "ABORT: backup fails syntax check: $backup" >&2
      exit 1
    fi
    if ! cmp -s "$target" "$backup"; then
      cp "$backup" "$target"
      echo "applied: ${target#$DSH_HOME/}"
    fi
  done
fi

echo "Done. Theme files, ~/.dsh-tui/theme.json and ~/.dsh/settings.yaml live in"
echo "user directories and survive upgrades — only the files above need re-patching."
