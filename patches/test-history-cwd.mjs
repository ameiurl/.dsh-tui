#!/usr/bin/env node
// test-history-cwd.mjs — behaviour check for customization F2
// ("↑/↓ and Ctrl+R read the persisted history scoped to the working directory").
//
//   node ~/.dsh-tui/patches/test-history-cwd.mjs
//
// Exercises the shipped `lib/types/history.js` inside a throwaway HOME, so the
// checks run against the real module while never touching the user's
// `~/.dsh-tui/history.jsonl` (the real file's size+mtime is re-checked at the
// end as a belt-and-braces guarantee). Asserts:
//
//   * an appended entry is tagged with the directory it was submitted in;
//   * a scoped read returns that directory's entries only, newest first;
//   * a directory with no entries of its own falls back to the untagged legacy
//     pool, and stops falling back as soon as it has entries;
//   * an unscoped read still returns every entry;
//   * dedupe is per directory — the same text submitted elsewhere is its own
//     entry, so a merged one could never carry the wrong directory.

import { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PATCH_DIR = dirname(fileURLToPath(import.meta.url));
const HOME_DIR = dirname(dirname(PATCH_DIR));
const TUI = process.env.DSH_TUI_PKG
  ?? join(HOME_DIR, '.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui');

let failures = 0;
/** The report goes to stderr so it is never mistaken for program output. */
const report = line => process.stderr.write(`${line}\n`);
const check = (cond, msg) => {
  if (cond) report(`ok  : ${msg}`);
  else { report(`FAIL: ${msg}`); failures += 1; }
};
const texts = entries => entries.map(entry => entry.text).join(' | ');

// Snapshot the real history before anything loads, and re-check it at the end.
const REAL_HOME = process.env.HOME ?? process.env.USERPROFILE ?? '';
const REAL_HISTORY = join(REAL_HOME, '.dsh-tui/history.jsonl');
const stampOf = path => {
  try { const s = statSync(path); return `${s.size}:${s.mtimeMs}`; }
  catch { return 'absent'; }
};
const realBefore = stampOf(REAL_HISTORY);

// Redirect DATA_DIR into a throwaway HOME *before* the module reads paths.js:
// `DATA_DIR` is resolved at import time from `os.homedir()`.
const tmpHome = mkdtempSync(join(tmpdir(), 'dsh-history-cwd-'));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const { DATA_DIR } = await import(join(TUI, 'lib/types/utils/paths.js'));
if (!DATA_DIR.startsWith(tmpHome)) {
  report(`ABORT: refusing to run — DATA_DIR resolved to ${DATA_DIR}, not under ${tmpHome}`);
  process.exit(1);
}
const { appendHistory, loadHistory } = await import(join(TUI, 'lib/types/history.js'));
const HISTORY_FILE = join(DATA_DIR, 'history.jsonl');
check(true, `isolated run: history lives in ${DATA_DIR}`);

const A = '/proj/alpha';
const B = '/proj/beta';
const C = '/proj/gamma';

// ── tagging + scoping ───────────────────────────────────────────────────────
await appendHistory('alpha one', A);
await appendHistory('alpha two', A);
await appendHistory('beta one', B);

check(texts(loadHistory(A)) === 'alpha two | alpha one',
  `a scoped read returns ${A}'s entries only, newest first (${texts(loadHistory(A))})`);
check(texts(loadHistory(B)) === 'beta one',
  `a scoped read returns ${B}'s entries only (${texts(loadHistory(B))})`);
check(loadHistory(C).length === 0,
  'a directory never used has nothing to show while the legacy pool is empty');
check(loadHistory().length === 3, 'an unscoped read still returns every entry');
check(texts(loadHistory()) === 'beta one | alpha two | alpha one', 'unscoped order stays newest first');
check(readFileSync(HISTORY_FILE, 'utf8').includes(`"cwd":"${A}"`),
  'entries on disk carry their submitting directory');

// ── dedupe is per directory ─────────────────────────────────────────────────
await appendHistory('beta one', B);
check(texts(loadHistory(B)) === 'beta one', 'a repeat submit in the same directory only advances its timestamp');
check(loadHistory().length === 3, 'and adds no new line to the file');

await appendHistory('beta one', A);
check(texts(loadHistory(A)) === 'beta one | alpha two | alpha one',
  "the same text submitted in another directory is that directory's own entry");
check(loadHistory().length === 4, 'and is appended rather than folded into the previous entry');

// ── legacy (untagged) entries as the fallback pool ──────────────────────────
rmSync(HISTORY_FILE, { force: true });
appendFileSync(HISTORY_FILE, `${JSON.stringify({ text: 'legacy cmd', ts: 1 })}\n`);
await appendHistory('gamma one', A);

check(texts(loadHistory(C)) === 'legacy cmd',
  `an unused directory falls back to the untagged legacy pool (${texts(loadHistory(C))})`);
check(texts(loadHistory(A)) === 'gamma one',
  'a directory with entries of its own does NOT see the legacy pool');
check(loadHistory().length === 2, 'the unscoped read still sees both');

// ── the run left the user's real history alone ──────────────────────────────
check(stampOf(REAL_HISTORY) === realBefore,
  `the real history file was untouched (${REAL_HISTORY})`);

rmSync(tmpHome, { recursive: true, force: true });
report(failures === 0
  ? '\nPASS: ↑/↓ and Ctrl+R read the current directory\'s history, with the legacy pool as fallback.'
  : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
