#!/usr/bin/env node
// resolve-patch-targets.mjs — print the patch set's target→backup mapping that
// apply-diff-patches.sh uses, so the runbook's re-port loop can be driven from
// one source of truth instead of a hand-copied list. Run after editing
// TARGETS in apply-diff-patches.sh:
//
//   node ~/.dsh-tui/patches/resolve-patch-targets.mjs           # "abs/path|backup-name" lines
//   node ~/.dsh-tui/patches/resolve-patch-targets.mjs --paths   # resolved absolute paths only
//
// Plain JS, shell-friendly output. Used by the CUSTOMIZATIONS.md runbook (§3
// Step 3/5) so the re-port loop iterates exactly the files the apply script
// knows about, instead of a hand-copied list that can drift.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PATCH_DIR = dirname(fileURLToPath(import.meta.url));
const applyScript = readFileSync(join(PATCH_DIR, 'apply-diff-patches.sh'), 'utf8');
const pathsOnly = process.argv.includes('--paths');

// Resolve $DSH_HOME / $HOME the way the shell script does by default.
const dshHome = process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh');
const tuiPkg = join(dshHome, 'profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui');

// `TARGETS` is a bash array of "$VAR/lib/...|backup-name" quoted entries; pull
// each quoted entry and substitute the two shell variables it may use.
const block = applyScript.match(/declare -a TARGETS=\(([\s\S]*?)\n\)/);
if (!block) {
  console.error('cannot find the TARGETS array in apply-diff-patches.sh');
  process.exit(1);
}
const entries = [...block[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);

for (const entry of entries) {
  const [rawTarget, backup] = entry.split('|');
  const target = rawTarget
    .replaceAll('$DSH_HOME', dshHome)
    .replaceAll('$HOME', process.env.HOME ?? '')
    .replaceAll('$TUI_PKG', tuiPkg)
    .replaceAll('${DSH_HOME}', dshHome)
    .replaceAll('${TUI_PKG}', tuiPkg);
  console.log(pathsOnly ? target : `${target}|${backup}`);
}
