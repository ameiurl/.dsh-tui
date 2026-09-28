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
//   * Ctrl+N starts a session in the CURRENT directory, not in a rail row.

import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PATCH_DIR = dirname(fileURLToPath(import.meta.url));
const HOME_DIR = dirname(dirname(PATCH_DIR));
const TUI = process.env.DSH_TUI_PKG
  ?? join(HOME_DIR, '.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui');

const requireFromTui = createRequire(join(TUI, 'package.json'));
const { renderSync } = await import(join(TUI, 'lib/types/ui.js'));
const { SessionSupervisor } = await import(join(TUI, 'lib/types/screens/SessionSupervisor.js'));
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
    liveStateOf: () => undefined,
  }),
  { stdout: capture, stdin, stderr: sink() },
);
await new Promise(r => setTimeout(r, 150));
// Ctrl+N: the stock screen starts a session in the rail's focused workspace.
stdin.push('\u000e');
await new Promise(r => setTimeout(r, 100));
app.unmount();
await new Promise(r => setTimeout(r, 30));
process.stdout.write = realStdoutWrite;

// Ink repositions the cursor rather than emitting spaces, so strip escapes and
// leftover control bytes, then match on each row's distinctive token.
const plain = output
  .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
  .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
  .replace(/\u001b[=>NOPc]/g, '')
  .replace(/[\u0000-\u0008\u000b-\u001f]/g, '');

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
check(plain.includes('Ctrl+N') && plain.includes('Ctrl+X'), 'the hint still advertises the keys kept');
check(plain.includes('Enter'), 'list hint renders');
check(newSessionCalls.length === 1 && newSessionCalls[0] === CURRENT,
  `Ctrl+N starts a session in the current directory (got ${JSON.stringify(newSessionCalls)})`);
report(failures === 0
  ? '\nPASS: /resume shows this working directory only, flat and rail-free.'
  : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
