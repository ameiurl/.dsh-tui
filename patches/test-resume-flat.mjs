#!/usr/bin/env node
// test-resume-flat.mjs — behaviour check for customization F3 on dsh-tui 0.11.x
// ("/resume lists THIS working directory's sessions, flat and rail-free").
//
//   node ~/.dsh-tui/patches/test-resume-flat.mjs
//
// 0.11.x replaced screens/SessionBrowser.js with the sessionSupervisor screen
// (a workspace rail plus a session pane). The fork hides the rail and pins the
// pane to the directory the terminal runs in, so this renders the REAL screen
// through the package's own ink runtime with a fake channel and fake streams
// (nothing is written, no TUI is started) and asserts what a terminal shows:
//
//   * the current directory's session is listed;
//   * two other directories' sessions are not — not by title, not by path;
//   * no workspace rail: no `工作区` section header, no rail rows, no pane hint;
//   * the list hint advertises only the keys this fork keeps (no ←/→ switch);
//   * sub-agent runs stay out of the listing;
//   * Ctrl+T starts a session in the CURRENT directory, not in a rail row
//     (the key moved there because Ctrl+N walks the list now);
//   * Ctrl+P steps UP and Ctrl+N steps DOWN (emacs' own pair), on the bare
//     control byte and on the kitty/modifyOtherKeys spelling alike, while a
//     plain `p`/`n` is still typed into the filter;
//   * Enter opens the FIRST row like any other (there is no new-session card);
//   * every other row paints the zebra band that separates two-line rows.

import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The zebra band is a BACKGROUND, so the check for it has to read escapes —
// and colours are switched off whenever stdout is a pipe (every run of this
// script). Force them the way a terminal would, before ink is imported.
process.env.FORCE_COLOR = '3';

const PATCH_DIR = dirname(fileURLToPath(import.meta.url));
const HOME_DIR = dirname(dirname(PATCH_DIR));
const TUI = process.env.DSH_TUI_PKG
  ?? join(HOME_DIR, '.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui');

const requireFromTui = createRequire(join(TUI, 'package.json'));
const { renderSync } = await import(join(TUI, 'lib/types/ui.js'));
const { SessionSupervisor, listKeyStep } = await import(join(TUI, 'lib/types/screens/SessionSupervisor.js'));
const React = requireFromTui('react');

const HOME = '/home/amei';
const CURRENT = '/home/amei/.dsh-tui';
const OTHER_A = '/server/www/mallphp';
const OTHER_B = '/home/amei/.config';
const session = (id, text, cwd, updatedAt, extra = {}) => ({
  id,
  cwd,
  updatedAt,
  title: { text, source: 'auto', complete: true },
  kind: { kind: 'conversation' },
  hasPrompt: true,
  branch: 'master',
  ...extra,
});
const sessions = [
  session('s1', 'AAA current-dir session', CURRENT, 400),
  session('s2', 'BBB mallphp session', OTHER_A, 300),
  session('s3', 'CCC config session', OTHER_B, 200),
  session('s4', 'RUN hidden subagent', OTHER_A, 100, {
    kind: { kind: 'subagent', parent: 's2' },
  }),
];

const newSessionCalls = [];
const channel = {
  cwd: CURRENT,
  gitBranch: 'master',
  agentId: undefined,
  listSessions: async () => sessions,
  // A registry that DOES name the other directories: the fork must ignore it,
  // not merely have nothing to show.
  listWorkspaceRegistry: async () => ([
    { id: 'w1', path: OTHER_A, title: 'mallphp', present: true, sessionCount: 1 },
    { id: 'w2', path: OTHER_B, title: 'config', present: true, sessionCount: 1 },
  ]),
  resolveWorkspace: async path => ({ path }),
  notify: () => {},
};

let output = '';
const sink = () => ({
  isTTY: true,
  columns: 120,
  rows: 40,
  write: () => true,
  on: () => {}, off: () => {}, removeListener: () => {}, once: () => {}, addListener: () => {},
  cork: () => {}, uncork: () => {},
});
const capture = { ...sink(), write: chunk => { output += chunk; return true; } };
/** Ink pumps input through `readable` + `read()`, so the fake buffers a push. */
class FakeStdin extends EventEmitter {
  constructor() {
    super();
    this.isTTY = true;
    this.buffer = null;
    this.setRawMode = () => {};
    this.setEncoding = () => {};
    this.resume = () => {};
    this.pause = () => {};
    this.ref = () => {};
    this.unref = () => {};
  }
  read() { const data = this.buffer; this.buffer = null; return data; }
  push(text) { this.buffer = Buffer.from(text, 'utf8'); this.emit('readable'); }
  write() { return true; }
}

// Ink also pokes process.stdout directly (alternate screen, mouse tracking), so
// mute it for the duration — this script must leave the calling terminal clean.
const stdin = new FakeStdin();
const realStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = () => true;
const app = renderSync(
  React.createElement(SessionSupervisor, {
    channel,
    home: HOME,
    onClose: () => {},
    onOpenSession: async () => true,
    onNewSession: async (target) => { newSessionCalls.push(target?.path); return true; },
    onStopSession: async () => true,
    approval: null,
    onApprove: () => {},
    liveStateOf: id => (id === 's1' ? { live: true, current: true, status: 'idle' } : undefined),
  }),
  { stdout: capture, stdin, stderr: sink() },
);
await new Promise(r => setTimeout(r, 150));
// Ctrl+T: the stock screen starts a session in the rail's focused workspace,
// and the fork keeps that action but not that key — Ctrl+N walks the list.
stdin.push('\u0014');
await new Promise(r => setTimeout(r, 100));
app.unmount();
await new Promise(r => setTimeout(r, 30));
process.stdout.write = realStdoutWrite;

// Ink repositions the cursor rather than emitting spaces, so strip escapes and
// leftover control bytes, then match on each row's distinctive token.
const stripAnsi = raw => raw
  .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
  .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
  .replace(/\u001b[=>NOPc]/g, '')
  .replace(/[\u0000-\u0008\u000b-\u001f]/g, '');
const plain = stripAnsi(output);

let failures = 0;
/** The report goes to stderr so ink's own escapes never reach it. */
const report = line => process.stderr.write(`${line}\n`);
const check = (cond, msg) => {
  if (cond) report(`ok  : ${msg}`);
  else { report(`FAIL: ${msg}`); failures += 1; }
};

check(plain.includes('AAA'), "the current directory's session is listed");
check(!plain.includes('BBB') && !plain.includes('CCC'),
  'sessions from other working directories are NOT listed');
check(!plain.includes(OTHER_A) && !plain.includes(OTHER_B), 'no other directory appears at all');
check(!plain.includes('RUN hidden subagent'), 'sub-agent runs stay out of the listing');
check((plain.match(/\u2606/g) ?? []).length === 1, `exactly one session row (${(plain.match(/\u2606/g) ?? []).length})`);
check(!plain.includes('\u5de5\u4f5c\u533a'), 'no workspace rail section header');
check(!plain.includes('mallphp') && !plain.includes('config'), 'no rail rows for other workspaces');
check(!plain.includes('\u5207\u6362\u680f\u4f4d') && !plain.includes('switch pane'),
  'the list hint no longer advertises the <-/-> pane switch');
check(!plain.includes('\u5168\u90e8\u5de5\u4f5c\u76ee\u5f55') && !plain.includes('All working directories'),
  'no "all directories" scope is offered');
check(!plain.includes('\u65b0\u5efa\u4f1a\u8bdd'),
  'no new-session row is rendered (Ctrl+T still creates one)');
check(!plain.includes('\u5f53\u524d'),
  'and no "current" badge is drawn, even with a live session in this directory');
check(plain.includes('Ctrl+T') && plain.includes('Ctrl+X'), 'the hint still advertises the keys kept');
check(plain.includes('Ctrl+P/N'), 'and advertises the fork\'s movement pair');
check(plain.includes('Enter'), 'list hint renders');
check(newSessionCalls.length === 1 && newSessionCalls[0] === CURRENT,
  `Ctrl+T starts a session in the current directory (got ${JSON.stringify(newSessionCalls)})`);

// The badge is gone from the COMPONENT, not just from the screen's call: a
// caller that still passes `current` gets a row without it (the prop and the
// `supervisor-current` string are both gone).
const { SessionListRow } = await import(join(TUI, 'lib/types/components/sessions/SessionListRow.js'));
let rowOutput = '';
const rowCapture = { ...sink(), write: chunk => { rowOutput += chunk; return true; } };
const realWriteForRow = process.stdout.write.bind(process.stdout);
process.stdout.write = () => true;
const rowApp = renderSync(
  React.createElement(SessionListRow, {
    session: sessions[0], width: 100, depth: 0, focused: false, pinned: false,
    now: Date.now(), current: true, spinner: undefined,
    onClick: () => {}, onTogglePin: () => {}, onContextMenu: () => {},
  }),
  { stdout: rowCapture, stdin: new FakeStdin(), stderr: sink() },
);
await new Promise(r => setTimeout(r, 100));
rowApp.unmount();
await new Promise(r => setTimeout(r, 30));
process.stdout.write = realWriteForRow;
const rowPlain = stripAnsi(rowOutput);
check(rowPlain.includes('AAA'), 'the row still renders its session title');
check(!rowPlain.includes('当前'),
  'and ignores a `current` prop entirely — the badge is gone from the component');

// F2 fork: the zebra band. Every OTHER row paints its whole surface, which is
// what tells one two-line row from the next; a row without the prop paints no
// background at all. Read from the escapes, because the band IS the change —
// and read at the row, so it survives whatever the screen around it does.
const BACKGROUND_RE = /\u001b\[48;[0-9;]*m/;
const renderOneRow = async (props) => {
  let captured = '';
  const realWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  const app = renderSync(
    React.createElement(SessionListRow, {
      session: sessions[0], width: 100, depth: 0, focused: false, pinned: false,
      now: Date.now(), spinner: undefined,
      onClick: () => {}, onTogglePin: () => {}, onContextMenu: () => {},
      ...props,
    }),
    { stdout: { ...sink(), write: chunk => { captured += chunk; return true; } }, stdin: new FakeStdin(), stderr: sink() },
  );
  await new Promise(r => setTimeout(r, 100));
  app.unmount();
  await new Promise(r => setTimeout(r, 30));
  process.stdout.write = realWrite;
  return captured;
};
const plainRowRaw = await renderOneRow({});
const stripedRowRaw = await renderOneRow({ striped: true });
check(!BACKGROUND_RE.test(plainRowRaw),
  'a row without `striped` paints no background (the pane shows through)');
check(BACKGROUND_RE.test(stripedRowRaw),
  'a `striped` row paints its surface — the band that separates two-line rows');

// Opening the screen must land on the session the user last used — even when an
// OLDER session is live and therefore sorts above it. Asserted behaviourally
// (which session Enter opens): Ink repaints incrementally, so the `❯` position
// inside a captured frame is not a reliable read of the cursor.
const listed = [
  session('s1', 'AAA oldest', CURRENT, 100),
  session('s2', 'BBB live but older', CURRENT, 200),
  session('s3', 'CCC newest', CURRENT, 300),
];
const opened = [];
const focusStdin = new FakeStdin();
const realWriteForFocus = process.stdout.write.bind(process.stdout);
process.stdout.write = () => true;
const focusApp = renderSync(
  React.createElement(SessionSupervisor, {
    channel: { ...channel, listSessions: async () => listed },
    home: HOME,
    onClose: () => {},
    onOpenSession: async (id) => { opened.push(id); return true; },   // the screen passes the session id
    onNewSession: async () => true,
    onStopSession: async () => true,
    approval: null,
    onApprove: () => {},
    liveStateOf: id => (id === 's2' ? { live: true, current: false, status: 'idle' } : undefined),
  }),
  { stdout: { ...sink(), write: () => true }, stdin: focusStdin, stderr: sink() },
);
await new Promise(r => setTimeout(r, 300));
focusStdin.push('\r');
await new Promise(r => setTimeout(r, 300));
focusApp.unmount();
await new Promise(r => setTimeout(r, 30));
process.stdout.write = realWriteForFocus;
check(opened.length === 1 && opened[0] === 's3',
  `Enter on open targets the most recently used session, not the live one (got ${JSON.stringify(opened)})`);

// F2 fork: Ctrl+P steps UP (previous), Ctrl+N steps DOWN (next) — emacs' own
// pair, the directions vim's k/j use. Both are ordinary control bytes, so the
// bare byte and the kitty / modifyOtherKeys spelling arrive as the same `p`/`n`
// plus ctrl, while a plain p/n must still reach the filter. Driven through the
// real screen, and read back through Enter: ink repaints incrementally, so
// where `❯` sits inside a captured frame is not a reliable read of the cursor.
const listKey = (input, key = {}) => listKeyStep(input, key);
check(listKey('p', { ctrl: true }) === -1, 'listKeyStep: `ctrl+p` steps up');
check(listKey('n', { ctrl: true }) === 1, 'listKeyStep: `ctrl+n` steps down');
check(listKey('p') === 0 && listKey('n') === 0,
  'listKeyStep: plain p/n are NOT movement keys (they filter)');
check(listKey('', { return: true }) === 0, 'listKeyStep: Enter is neither');
check(listKey('j', { ctrl: true }) === 0 && listKey('k', { ctrl: true }) === 0,
  'listKeyStep: the retired ctrl+j / ctrl+k pair no longer moves the list');

// Titles, cwd and branch carry no `p`/`n`, so the "a plain letter filters"
// checks below really empty the list instead of silently matching everything.
const walkList = [
  session('w1', 'AAA first', CURRENT, 300),
  session('w2', 'BBB middle', CURRENT, 200),
  session('w3', 'CCC last', CURRENT, 100),
];
/** Open the screen, type raw bytes, then commit with Enter. */
async function walk(keys) {
  const walked = { opened: [], created: [] };
  const walkStdin = new FakeStdin();
  const realWriteForWalk = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  const walkApp = renderSync(
    React.createElement(SessionSupervisor, {
      channel: { ...channel, listSessions: async () => walkList },
      home: HOME,
      onClose: () => {},
      onOpenSession: async (id) => { walked.opened.push(id); return true; },
      onNewSession: async (target) => { walked.created.push(target?.path); return true; },
      onStopSession: async () => true,
      approval: null,
      onApprove: () => {},
      liveStateOf: () => undefined,
    }),
    { stdout: { ...sink(), write: () => true }, stdin: walkStdin, stderr: sink() },
  );
  await new Promise(r => setTimeout(r, 250));
  for (const bytes of keys) {
    walkStdin.push(bytes);
    await new Promise(r => setTimeout(r, 150));
  }
  walkApp.unmount();
  await new Promise(r => setTimeout(r, 30));
  process.stdout.write = realWriteForWalk;
  return walked;
}

// The cursor opens on the most recent session, w1. Ctrl+N walks down one row.
const steppedDown = await walk(['\u000e', '\r']);
check(steppedDown.opened.length === 1 && steppedDown.opened[0] === 'w2',
  `Ctrl+N steps to the next row down (got ${JSON.stringify(steppedDown.opened)})`);
check(steppedDown.created.length === 0,
  `Ctrl+N moves instead of creating a session now (got ${JSON.stringify(steppedDown.created)})`);
// Down then UP is back on w1: if Ctrl+P did nothing, Enter would land on w2 and
// this check would read it.
const steppedBack = await walk(['\u000e', '\u0010', '\r']);
check(steppedBack.opened.length === 1 && steppedBack.opened[0] === 'w1',
  `Ctrl+P steps back up (got ${JSON.stringify(steppedBack.opened)})`);
// The extended-keys spellings, on a terminal that reports modifiers: CSI-u for
// `ctrl+n` (codepoint 110) and `ctrl+p` (112), modifier 5 = ctrl.
const steppedKitty = await walk(['\u001b[110;5u', '\u001b[112;5u', '\r']);
check(steppedKitty.opened.length === 1 && steppedKitty.opened[0] === 'w1',
  `kitty \`ctrl+n\` / \`ctrl+p\` walk down and back up (got ${JSON.stringify(steppedKitty.opened)})`);
// A plain p/n is a filter character, never a movement key: the query matches no
// session, so the list empties and Enter has no row to act on. Had the ctrl
// requirement been dropped, the query would stay empty, all three rows would
// remain and Enter would open w1.
const typedPlain = await walk(['n', '\r']);
check(typedPlain.opened.length === 0,
  `a plain n filters instead of moving (got ${JSON.stringify(typedPlain.opened)})`);
const typedPlainP = await walk(['p', '\r']);
check(typedPlainP.opened.length === 0,
  `a plain p filters instead of moving (got ${JSON.stringify(typedPlainP.opened)})`);
// The fork has no new-session card: row 0 is an ordinary session, so Enter on
// it resumes that session (the stock branch started a NEW one instead).
const enteredFirst = await walk(['\r']);
check(enteredFirst.opened.length === 1 && enteredFirst.opened[0] === 'w1',
  `Enter on the FIRST row opens it (got ${JSON.stringify(enteredFirst.opened)})`);
check(enteredFirst.created.length === 0,
  `Enter never creates a session (got ${JSON.stringify(enteredFirst.created)})`);
// Ctrl+T is the create key, and it is the ONLY thing that creates from here.
const madeOne = await walk(['\u0014']);
check(madeOne.created.length === 1 && madeOne.created[0] === CURRENT,
  `Ctrl+T starts a session in this directory (got ${JSON.stringify(madeOne.created)})`);
check(madeOne.opened.length === 0, 'and opens nothing while it does');

// F2 fork: a record that never held a conversation is not a session this pane
// offers. The catalog keeps one for every terminal that ever started (and for
// ghosts whose log never landed), and with no name to show it renders as the
// directory basename — "☆ ∙ .dsh-tui" — which reads like a directory row. Such
// a record has no events of its own (`updatedAt === createdAt`) and no name
// (`fallback`); anything a terminal is actually using stays listed.
const nameless = (id, bytes) => ({
  ...session(id, '.dsh-tui', CURRENT, 500),
  title: { text: '.dsh-tui', source: 'fallback' },
  bytes,
});
const ghostList = [
  nameless('ghost', undefined),        // no artifact behind it → hidden
  nameless('mounted', undefined),      // the session this terminal is IN, log not landed → hidden too
  nameless('fresh', 320),              // just started, log written → listed
  { ...nameless('named', undefined), title: { text: 'REAL name', source: 'auto' } },  // named → listed
];
let ghostOutput = '';
const ghostStdin = new FakeStdin();
const realWriteForGhost = process.stdout.write.bind(process.stdout);
process.stdout.write = () => true;
const ghostApp = renderSync(
  React.createElement(SessionSupervisor, {
    channel: { ...channel, listSessions: async () => ghostList },
    home: HOME,
    onClose: () => {},
    onOpenSession: async () => true,
    onNewSession: async () => true,
    onStopSession: async () => true,
    approval: null,
    onApprove: () => {},
    liveStateOf: id => (id === 'mounted' ? { live: true, current: true, status: 'idle' } : undefined),
  }),
  { stdout: { ...sink(), write: chunk => { ghostOutput += chunk; return true; } }, stdin: ghostStdin, stderr: sink() },
);
await new Promise(r => setTimeout(r, 250));
ghostApp.unmount();
await new Promise(r => setTimeout(r, 30));
process.stdout.write = realWriteForGhost;
const ghostRows = (stripAnsi(ghostOutput).match(/\u2606/g) ?? []).length;
check(ghostRows === 2,
  `nameless records without an artifact are not listed, mounted or not (rows: ${ghostRows}, want 2 of 4)`);
report(failures === 0
  ? '\nPASS: /resume shows this working directory only, flat and rail-free.'
  : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
