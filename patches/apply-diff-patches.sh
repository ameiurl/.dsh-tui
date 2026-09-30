#!/usr/bin/env bash
# dsh-diff-patch — check / re-apply the Claude Code unified-diff patches after
# a `dsh` upgrade wipes the launcher-managed node_modules.
#
# Usage:
#   dsh-patch           auto: restore every target it can reach — the whole-file
#                       backup when it applies, else the stored unified diff
#   dsh-patch check     report only, never modify (exit 1 when a target differs,
#                       is missing, or has drifted off its baseline)
#   dsh-patch patch     apply diffs/<name>.patch onto whatever is installed
#                       (`patch --fuzz=3`); install only when every hunk landed
#                       and `node --check` passes, and say whether it needed fuzz
#   dsh-patch apply     force-copy all backups over their targets (the explicit
#                       downgrade path — re-port before using it on drift)
#   dsh-patch diff      print the unified diff between each installed file and
#                       its patched backup (what an upgrade reverted)
#
# Two restoration paths, in order of trust:
#
#   1. whole-file restore — the installed file still equals original/<name>
#      (i.e. the upstream this patch was built for), so backup/<name> is copied
#      verbatim. Byte-exact and idempotent.
#   2. unified diff — the file matches neither original nor backup, which is
#      what an upgrade that moved the code leaves behind. diffs/<name>.patch is
#      applied TO THE INSTALLED FILE with `patch --fuzz=3`; the result is
#      installed only when every hunk landed and `node --check` passes. This is
#      what keeps a version bump from leaving the customizations un-applied:
#      the diff rides along with upstream's line shifts instead of refusing.
#      The two ways a hunk can land are not equally trustworthy, so they are
#      reported apart: an OFFSET (line numbers moved, context matched exactly)
#      means the diff still fits — PATCHED, or PATCHED-DRIFT when the baseline
#      also moved — while FUZZ (context matched loosely) means the hunk may
#      have attached to the wrong lines: PATCHED-FUZZ, re-port before trusting
#      it. Either way a clean application is not a re-port, so CUSTOMIZATIONS.md
#      §3 still applies.
#
# Copies use `cp --remove-destination` so the write never follows pnpm's
# hardlink into the content-addressable store: a plain `cp` rewrites the store
# inode too, and the next reinstall of that same version then silently
# resurrects the patch (or hides that an upgrade reverted it). Diff-applied
# files are written through a temp file and moved into place for the same
# reason (mv replaces the directory entry, never the store inode).
#
# Version guard — per target, not global. Every target names the package that
# owns it, and ./patch-base-versions.json records the version each patch was
# built against. A drifted target is no longer skipped outright; it is restored
# through path 2 and reported, so an upgrade can no longer leave the whole set
# un-applied. state/<name>.sha1 records what a diff run installed, so a second
# run reports OK-PATCHED instead of patching an already-patched file.

set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP="$DIR/backup"
ORIGINAL="$DIR/original"
DIFFS="$DIR/diffs"
STATE="$DIR/state"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
MODE="${1:-auto}"
TUI_PKG="$DSH_HOME/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui"
TOOLS="$DSH_HOME/profiles/node_modules/@deepseek-ai"
BASE_JSON="$DIR/patch-base-versions.json"

# Scratch space for `patch -o` results. Kept inside the patch dir so a sandboxed
# or /tmp-less environment still works; removed on every exit path.
WORK="$DIR/.tmp.$$"
mkdir -p "$WORK" "$STATE"
trap 'rm -rf "$WORK"' EXIT

# target|backup-file|package-dir|package-name
declare -a TARGETS=(
  "$TOOLS/dsh-tool-fs/lib/index.js|dsh-tool-fs.index.js|$TOOLS/dsh-tool-fs|@deepseek-ai/dsh-tool-fs"
  "$TOOLS/dsh-tool-str-replace-editor/lib/index.js|dsh-tool-str-replace-editor.index.js|$TOOLS/dsh-tool-str-replace-editor|@deepseek-ai/dsh-tool-str-replace-editor"
  "$TUI_PKG/lib/types/components/messages/AssistantToolUseMessage.js|AssistantToolUseMessage.js|$TUI_PKG|@deepseek-harness-tui/dsh-tui"
  # F2 input history: tag each entry with the directory it was submitted in and
  # read it back scoped to the current working directory (untagged legacy
  # entries act as a fallback until the directory has entries of its own).
  "$TUI_PKG/lib/types/history.js|history.js|$TUI_PKG|@deepseek-harness-tui/dsh-tui"
  # F2 ↑/↓ walk: seed from that scoped history — re-seeded when the working
  # directory changes — and tag what this session submits.
  "$TUI_PKG/lib/types/components/PromptInput.js|PromptInput.js|$TUI_PKG|@deepseek-harness-tui/dsh-tui"
  # F2 Ctrl+R: the search dialog reads through the same scoped loadHistory().
  "$TUI_PKG/lib/types/screens/Chat.js|Chat.js|$TUI_PKG|@deepseek-harness-tui/dsh-tui"
  # F3 resume browser: 0.11.x moved it from screens/SessionBrowser.js (gone) to
  # the sessionSupervisor screen. The fork hides the workspace rail and pins the
  # pane to THIS terminal's working directory — no other directory is reachable.
  "$TUI_PKG/lib/types/screens/sessionSupervisor/useSessionSupervisor.js|useSessionSupervisor.js|$TUI_PKG|@deepseek-harness-tui/dsh-tui"
  # F3 Ctrl+N follows that pinned directory now that the rail cannot name one.
  "$TUI_PKG/lib/types/screens/SessionSupervisor.js|SessionSupervisor.js|$TUI_PKG|@deepseek-harness-tui/dsh-tui"
  # F3 hint copy for that screen (no rail, so no ←/→ pane switch to advertise).
  "$TUI_PKG/lib/types/i18n.js|i18n.js|$TUI_PKG|@deepseek-harness-tui/dsh-tui"
  # F5 `recapOnOpen` was a target here until 0.11.2: 0.11.1 dropped the key from
  # the adapter's Config schema while keeping the /settings row and the read, so
  # saving it failed with 'not volatile'. 0.11.2 declares the field again AND
  # derives volatility from SETTING_DEFINITIONS (which lists recapOnOpen), so the
  # customization is stock again — retired, not re-ported. See CUSTOMIZATIONS.md
  # §2 (retired list).
  # F4 resume titles: a session with no title event is named the way Claude
  # Code names one — its most recent human prompt first (normalized to one
  # line, clipped at 200 characters), its opening prompt second, and the
  # working directory's basename last.
  "$TUI_PKG/lib/types/dsh-adapter/sessions/digest.js|digest.js|$TUI_PKG|@deepseek-harness-tui/dsh-tui"
)

# Baseline version for a package name, from ./patch-base-versions.json.
base_version() {
  node -p "require('$BASE_JSON')['$1'] ?? '?'" 2>/dev/null || echo '?'
}
# Installed version of the package in a directory, or '?' when unreadable.
installed_version() {
  node -p "require('$1/package.json').version" 2>/dev/null || echo '?'
}
# Content hash of a file, or '' when no hashing tool exists.
file_hash() {
  if command -v sha1sum >/dev/null 2>&1; then
    sha1sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 1 "$1" | cut -d' ' -f1
  else
    echo ''
  fi
}
# What a previous diff run installed for a backup name: "<file-hash> <patch-hash>".
stamp_of() {
  [[ -f "$STATE/$1.sha1" ]] && cat "$STATE/$1.sha1" || echo ''
}
# Apply ./diffs/<name>.patch TO <installed>, writing the result to <out>.
# Returns 0 only when every hunk landed. Both streams are captured because GNU
# patch reports the hunk outcomes — including "with fuzz N", the ONLY tell that
# a hunk matched loosely — on STDOUT; stderr only carries hard errors. (Before
# the 0.12.0 re-port this captured stderr alone and ran patch with `-s`: the
# failure report quoted an empty file, and patch's chatter leaked into the
# report at column 0.)
# `--read-only=ignore` drops the "file ... is read-only; trying to patch anyway"
# warning, which is meaningless here: `-o` never writes the installed file.
apply_udiff() {
  local installed="$1" patchfile="$2" out="$3"
  patch -p0 --fuzz=3 --read-only=ignore --no-backup-if-mismatch -o "$out" "$installed" \
    < "$patchfile" >"$WORK/patch.out" 2>"$WORK/patch.err"
}
# Did the application above need fuzz? patch writes "(offset N lines)" for a
# pure shift and "with fuzz N" only when it had to loosen the context match —
# an offset is the diff still fitting, fuzz is the diff guessing.
patch_was_fuzzy() {
  grep -q 'with fuzz' "$WORK/patch.out" 2>/dev/null
}

needs_apply=0
drift=0
declare -a ELIGIBLE=()

for entry in "${TARGETS[@]}"; do
  IFS='|' read -r target file pkgdir pkgname <<<"$entry"
  backup="$BACKUP/$file"
  orig="$ORIGINAL/$file"
  patchfile="$DIFFS/$file.patch"
  if [[ ! -f "$target" ]]; then
    echo "MISSING: ${target#$DSH_HOME/}  (upgrade moved it? re-port this file)"
    drift=1
    continue
  fi
  if [[ ! -f "$backup" ]]; then
    echo "NOBACKUP: $backup"
    drift=1
    continue
  fi
  cur="$(installed_version "$pkgdir")"
  want="$(base_version "$pkgname")"
  drifted=0
  [[ "$cur" == "?" || "$want" == "?" || "$cur" != "$want" ]] && drifted=1

  if cmp -s "$target" "$backup"; then
    echo "OK:      ${target#$DSH_HOME/}"
    continue
  fi
  needs_apply=1

  # Already restored by an earlier diff run? Same installed bytes, same patch.
  stamp="$(stamp_of "$file")"
  if [[ -n "$stamp" && -f "$patchfile" ]]; then
    read -r stamped_file stamped_patch <<<"$stamp"
    if [[ "$(file_hash "$target")" == "$stamped_file" && "$(file_hash "$patchfile")" == "$stamped_patch" ]]; then
      echo "OK-PATCHED: ${target#$DSH_HOME/}  (diff already applied; re-port still advised)"
      [[ "$drifted" -eq 1 ]] && drift=1
      continue
    fi
  fi

  # `apply` is the explicit force: it never inspects, it just copies later on.
  if [[ "$MODE" == "apply" ]]; then
    continue
  fi

  # Path 1: the installed file is still the upstream this patch was built on,
  # so the backup can be dropped in verbatim. `patch` mode skips it on purpose:
  # that mode exists to apply diffs, not to copy files.
  if [[ "$MODE" != "patch" && -f "$orig" ]] && cmp -s "$target" "$orig"; then
    if [[ "$MODE" == "check" ]]; then
      echo "DIFFERS: ${target#$DSH_HOME/}  (restorable: whole-file backup)"
    else
      echo "COPY:    ${target#$DSH_HOME/}"
    fi
    ELIGIBLE+=("$entry")
    continue
  fi

  # Path 2: upstream moved on — try the stored diff against what is installed.
  if [[ ! -f "$patchfile" ]]; then
    echo "NEEDS-REPORT: ${target#$DSH_HOME/}"
    echo "         no diffs/$file.patch to apply — re-port this file"
    drift=1
    continue
  fi
  if apply_udiff "$target" "$patchfile" "$WORK/$file"; then
    if node --check "$WORK/$file" >/dev/null 2>&1; then
      fuzzy=0
      patch_was_fuzzy && fuzzy=1
      if [[ "$MODE" == "check" ]]; then
        if [[ "$fuzzy" -eq 1 ]]; then
          echo "DIFFERS: ${target#$DSH_HOME/}  (restorable: unified diff ONLY WITH FUZZ — re-port this file)"
          drift=1
        else
          echo "DIFFERS: ${target#$DSH_HOME/}  (restorable: unified diff, context matched exactly)"
          [[ "$drifted" -eq 1 ]] && drift=1
        fi
      elif cp --remove-destination "$WORK/$file" "$target"; then
        if [[ "$fuzzy" -eq 1 ]]; then
          # Fuzz = the context matched loosely, so the hunks may sit on the
          # wrong lines. Still worth installing (it is our change and node
          # --check gates it), but never worth trusting without reading.
          echo "PATCHED-FUZZ: ${target#$DSH_HOME/}"
          echo "         hunks matched WITH FUZZ — read the diff, then re-port (CUSTOMIZATIONS.md §3)"
          drift=1
        elif [[ "$drifted" -eq 1 ]]; then
          echo "PATCHED-DRIFT: ${target#$DSH_HOME/}"
          echo "         $pkgname installed $cur | patch built for $want — diff applied at offset only; re-port to be sure"
          drift=1
        else
          echo "PATCHED: ${target#$DSH_HOME/}  (unified diff applied)"
        fi
        [[ -n "$(file_hash "$patchfile")" ]] && echo "$(file_hash "$target") $(file_hash "$patchfile")" > "$STATE/$file.sha1"
      else
        echo "ABORT: cannot write ${target#$DSH_HOME/}" >&2
        exit 1
      fi
      continue
    fi
    echo "NEEDS-REPORT: ${target#$DSH_HOME/}"
    echo "         $pkgname installed $cur | patch built for $want — diff output fails node --check"
    drift=1
    continue
  fi
  echo "NEEDS-REPORT: ${target#$DSH_HOME/}"
  echo "         $pkgname installed $cur | patch built for $want — diffs/$file.patch does not apply cleanly"
  # The failing hunks are on stdout ("N out of M hunks FAILED"); stderr only
  # speaks for hard errors (missing file, malformed patch). Quote whichever
  # stream has something to say — the hunk list is the useful half.
  fail_note="$(grep -hE 'FAILED|malformed|No such|does not exist' "$WORK/patch.out" "$WORK/patch.err" 2>/dev/null | head -4)"
  [[ -z "$fail_note" ]] && fail_note="$(sed -n '1,4p' "$WORK/patch.err")"
  [[ -n "$fail_note" ]] && printf '%s\n' "$fail_note" | sed 's/^/         /'
  drift=1
done

echo "dsh-tui installed: $(installed_version "$TUI_PKG") | patch built against: $(cat "$DIR/patch-base-version" 2>/dev/null || echo '?')"
echo "tool packages:     dsh-tool-fs $(installed_version "$TOOLS/dsh-tool-fs") | dsh-tool-str-replace-editor $(installed_version "$TOOLS/dsh-tool-str-replace-editor")"
if [[ "$drift" -eq 1 ]]; then
  echo "⚠  drift / unusable targets above. A drifted target is restored through"
  echo "   diffs/*.patch and stamped OK-PATCHED; PATCHED-FUZZ means the hunks"
  echo "   matched loosely (read them), NEEDS-REPORT means re-port that file onto"
  echo "   what is installed, then bump patch-base-versions.json (and"
  echo "   patch-base-version for the profile)."
fi

if [[ "$MODE" == "check" ]]; then
  exit $(( needs_apply || drift ))
fi

if [[ "$MODE" == "diff" ]]; then
  for entry in "${TARGETS[@]}"; do
    IFS='|' read -r target file pkgdir pkgname <<<"$entry"
    backup="$BACKUP/$file"
    [[ -f "$target" && -f "$backup" ]] || continue
    if ! cmp -s "$target" "$backup"; then
      echo "=== ${target#$DSH_HOME/} (installed → patched) ==="
      diff -u "$target" "$backup" | head -80
    fi
  done
  exit 0
fi

# auto restores the reachable targets collected above; `apply` is the explicit
# force over every target — including ones unrelated to the collected set.
declare -a RUN=()
if [[ "$MODE" == "apply" ]]; then
  RUN=("${TARGETS[@]}")
elif [[ "$MODE" == "patch" ]]; then
  RUN=()   # diffs were already applied in the scan above
else
  RUN=("${ELIGIBLE[@]}")
fi

applied=0
for entry in "${RUN[@]}"; do
  IFS='|' read -r target file pkgdir pkgname <<<"$entry"
  backup="$BACKUP/$file"
  [[ -f "$target" && -f "$backup" ]] || continue
  if [[ "$backup" == *.js ]] && ! node --check "$backup" >/dev/null 2>&1; then
    echo "ABORT: backup fails syntax check: $backup" >&2
    exit 1
  fi
  if ! cmp -s "$target" "$backup"; then
    # --remove-destination breaks a pnpm store hardlink instead of writing
    # through it (see the header): the store copy stays pristine. A refused
    # write is fatal — reporting "applied" over a read-only target is how a run
    # looks successful while nothing changed.
    if ! cp --remove-destination "$backup" "$target"; then
      echo "ABORT: cannot write ${target#$DSH_HOME/}" >&2
      exit 1
    fi
    echo "applied: ${target#$DSH_HOME/}"
    applied=$((applied + 1))
  fi
done

if [[ "$applied" -eq 0 && "$needs_apply" -eq 0 && "$drift" -eq 0 ]]; then
  echo "Nothing to do — every target already matches its patched backup."
fi
echo "Done. Theme files, ~/.dsh-tui/theme.json and the profile's cordis.patch.yml"
echo "live outside node_modules and survive upgrades (0.1.7 dropped ~/.dsh/settings.yaml"
echo "in favour of that patch file) — only the files above need re-patching."
