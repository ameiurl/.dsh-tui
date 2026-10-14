#!/usr/bin/env node
// test-history-cwd.mjs — stock-contract guard for retired customization F2
// ("↑/↓ and Ctrl+R read the persisted history scoped to the working directory").
//
//   node ~/.dsh-tui/patches/test-history-cwd.mjs
//
// F2 used to be a patch (history.js + PromptInput.js + Chat.js). 0.15.0 ships
// the whole chain upstream — `historyProjectKey()`, `appendHistory(text, cwd)`,
// `loadHistory(cwd)`, `loadHistoryOldestFirst(cwd)` — so the patch was retired
// and this test flipped from "our patch behaves" to "upstream still behaves":
// if a later version drops the directory scope again, it fires.
//
// Exercises the shipped `lib/types/history.js` inside a throwaway HOME, so the
// checks run against the real module while never touching the user's
// `~/.dsh-tui/history.jsonl` (the real file's size+mtime is re-checked at the
// end as a belt-and-braces guarantee). Asserts:
//
//   * an appended entry is tagged on disk with the normalized project key of
//     the directory it was submitted in (upstream's field is `project`, not the
//     retired patch's `cwd`);
//   * a scoped read returns that directory's entries only, newest first, and a
//     never-used directory is empty while no legacy entries exist;
//   * the composer's own read (`loadHistoryOldestFirst(cwd)`) is scoped the same
//     way and keeps chronological order — Ctrl+R and ↑/↓ must never disagree
//     about which directory they are showing;
//   * an unscoped read still returns every entry;
//   * dedupe is per project — the same text submitted elsewhere is its own
//     entry, so a merged one could never carry the wrong directory;
//   * untagged legacy entries are shown by EVERY scoped view (upstream's
//     `inProject` is a union, not the retired patch's pool that yields once the
//     directory has entries of its own) — recorded here so the difference stays
//     deliberate.

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
const { appendHistory, historyProjectKey, loadHistory, loadHistoryOldestFirst } =
  await import(join(TUI, 'lib/types/history.js'));
const HISTORY_FILE = join(DATA_DIR, 'history.jsonl');
check(true, `isolated run: history lives in ${DATA_DIR}`);

const A = '/proj/alpha';
const B = '/proj/beta';
const C = '/proj/gamma';

// ── tagging + scoping ───────────────────────────────────────────────────────
check(historyProjectKey(A) === A,
  `the project key of ${A} is its resolved path (${historyProjectKey(A)})`);
check(historyProjectKey(`${A}/`) === historyProjectKey(A),
  'a trailing slash names the same project (the alias that used to split a directory)');

await appendHistory('alpha one', A);
await appendHistory('alpha two', A);
await appendHistory('beta one', B);

check(texts(loadHistory(A)) === 'alpha two | alpha one',
  `a scoped read returns ${A}'s entries only, newest first (${texts(loadHistory(A))})`);
check(texts(loadHistory(B)) === 'beta one',
  `a scoped read returns ${B}'s entries only (${texts(loadHistory(B))})`);
check(texts(loadHistory(`${A}/`)) === 'alpha two | alpha one',
  'the trailing-slash spelling reads the same history');
check(loadHistory(C).length === 0,
  'a directory never used has nothing to show while the legacy pool is empty');
check(texts(loadHistoryOldestFirst(A)) === 'alpha one | alpha two',
  `the composer's read is scoped too, oldest first (${texts(loadHistoryOldestFirst(A))})`);
check(loadHistoryOldestFirst(C).length === 0,
  "a never-used directory's composer read is empty as well");
check(texts(loadHistoryOldestFirst()) === 'alpha one | alpha two | beta one',
  'an unscoped composer read stays chronological');
check(loadHistory().length === 3, 'an unscoped read still returns every entry');
check(texts(loadHistory()) === 'beta one | alpha two | alpha one', 'unscoped order stays newest first');
check(readFileSync(HISTORY_FILE, 'utf8').includes(`"project":"${A}"`),
  'entries on disk carry their submitting directory (upstream field: project)');

// ── dedupe is per project ───────────────────────────────────────────────────
await appendHistory('beta one', B);
check(texts(loadHistory(B)) === 'beta one', 'a repeat submit in the same directory only advances its timestamp');
check(loadHistory().length === 3, 'and adds no new line to the file');

await appendHistory('beta one', A);
check(texts(loadHistory(A)) === 'beta one | alpha two | alpha one',
  "the same text submitted in another directory is that directory's own entry");
check(loadHistory().length === 4, 'and is appended rather than folded into the previous entry');

// ── legacy (untagged) entries join every view ───────────────────────────────
rmSync(HISTORY_FILE, { force: true });
appendFileSync(HISTORY_FILE, `${JSON.stringify({ text: 'legacy cmd', ts: 1 })}\n`);
await appendHistory('gamma one', A);

check(texts(loadHistory(C)) === 'legacy cmd',
  `an unused directory still sees the untagged legacy pool (${texts(loadHistory(C))})`);
check(texts(loadHistoryOldestFirst(C)) === 'legacy cmd',
  'the composer read sees the same legacy pool');
check(texts(loadHistory(A)) === 'gamma one | legacy cmd',
  'a directory with entries of its own ALSO sees the legacy pool (stock union, by design)');
check(loadHistory().length === 2, 'the unscoped read still sees both');

// ── the run left the user's real history alone ──────────────────────────────
check(stampOf(REAL_HISTORY) === realBefore,
  `the real history file was untouched (${REAL_HISTORY})`);

rmSync(tmpHome, { recursive: true, force: true });
report(failures === 0
  ? '\nPASS: directory-scoped input history is still upstream stock (F2 retired).'
  : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
