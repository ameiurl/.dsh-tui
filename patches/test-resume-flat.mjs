#!/usr/bin/env node
// test-resume-flat.mjs — headless render check for customization F2
// ("resume / session browser lists every project in one flat list").
//
//   node ~/.dsh-tui/patches/test-resume-flat.mjs
//
// Renders the real SessionBrowser with a fake channel through the package's own
// ink runtime and asserts what the terminal would show:
//   * sessions from three different working directories are all listed;
//   * no `▣ <path>` project group headers (the list is flat);
//   * no directory rail rows, no rail switch hint, no workspace drill-in page;
//   * the scope row still reads as "all working directories";
//   * sub-agent runs stay folded by default;
//   * the list hint no longer advertises the rail / right-click menu.
//
// Nothing is written and no TUI is started: stdout/stdin are fakes.

import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PATCH_DIR = dirname(fileURLToPath(import.meta.url));
// <home>/.dsh-tui/patches -> <home>
const HOME_DIR = dirname(dirname(PATCH_DIR));
const TUI = process.env.DSH_TUI_PKG
  ?? join(HOME_DIR, '.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui');

// ESM ignores NODE_PATH, so resolve react through CJS from the package root.
const requireFromTui = createRequire(join(TUI, 'package.json'));
const { renderSync } = await import(join(TUI, 'lib/types/ui.js'));
const { SessionBrowser } = await import(join(TUI, 'lib/types/screens/SessionBrowser.js'));
const React = requireFromTui('react');

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

const HOME = '/home/amei';
const CURRENT = '/home/amei/.dsh-tui';
const sessions = [
  session('s1', 'AAA current-dir session', CURRENT, 400),
  session('s2', 'BBB mallphp session', '/server/www/mallphp', 300),
  session('s3', 'CCC config session', '/home/amei/.config', 200),
  session('s4', 'RUN hidden subagent', '/server/www/mallphp', 100, {
    kind: { kind: 'subagent', parent: 's2' },
  }),
];

const channel = {
  cwd: CURRENT,
  gitBranch: 'master',
  agentId: undefined,
  listSessions: async () => sessions,
  notify: () => {},
  deleteSession: async () => true,
  renameSessionTo: async () => true,
  previewSession: async () => [],
};

// Ink enters the alternate screen / mouse-tracking modes on its own output
// stream, so the render goes to a sink and the report goes to stderr — the
// terminal running this script never sees stray escapes.
const sink = () => ({
  isTTY: true,
  columns: 120,
  rows: 40,
  write: () => true,
  on: () => {}, off: () => {}, removeListener: () => {}, once: () => {}, addListener: () => {},
  cork: () => {}, uncork: () => {},
});
let output = '';
const capture = { ...sink(), write: chunk => { output += chunk; return true; } };
/** App's input wiring calls addListener/setRawMode/setEncoding on stdin. */
class FakeStdin extends EventEmitter {
  constructor() {
    super();
    this.isTTY = true;
    this.setRawMode = () => {};
    this.setEncoding = () => {};
    this.resume = () => {};
    this.pause = () => {};
    this.ref = () => {};
    this.unref = () => {};
    this.read = () => null;
  }
  write() { return true; }
}

// Ink also pokes process.stdout directly (alternate screen, mouse tracking), so
// mute it for the duration — this script must leave the calling terminal clean.
const realStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = () => true;
const app = renderSync(
  React.createElement(SessionBrowser, {
    channel,
    home: HOME,
    sameProject: (a, b) => a === b,
    onClose: () => {},
  }),
  { stdout: capture, stdin: new FakeStdin(), stderr: sink() },
);
await new Promise(r => setTimeout(r, 150));
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
/** The report goes to stderr so the render's own escapes never reach it. */
const report = line => process.stderr.write(`${line}\n`);
const check = (cond, msg) => {
  if (cond) report(`ok  : ${msg}`);
  else { report(`FAIL: ${msg}`); failures += 1; }
};

const seen = ['AAA', 'BBB', 'CCC'].filter(token => plain.includes(token));
check(seen.length === 3, `sessions from 3 working directories are listed (${seen.join(',') || 'none'})`);
check((plain.match(/☆/g) ?? []).length === 3, `exactly three session rows (${(plain.match(/☆/g) ?? []).length})`);
check(!plain.includes('▣ /server/www/mallphp') && !plain.includes('▣ /home/amei/.dsh-tui'),
  'no project group headers — the list is flat');
check(!plain.includes('← 选择目录') && !plain.includes('← choose directory'), 'rail switch hint gone');
check(!plain.includes('查看会话') && !plain.includes('view sessions'), 'workspace drill-in page unreachable');
check(plain.includes('全部工作目录') || plain.includes('all working directories'), 'scope row still reports "all working directories"');
check(!plain.includes('← 工作目录'), 'list hint no longer advertises the rail');
check(!plain.includes('右键菜单'), 'list hint no longer advertises the right-click menu');
check(plain.includes('固定') || plain.includes('pin'), 'list hint still advertises pin (stock feature kept)');
check(!plain.includes('RUN hidden subagent'), 'sub-agent runs stay folded by default');
check(plain.includes('Enter') && (plain.includes('恢复') || plain.includes('resume')), 'list hint renders');

report(failures === 0 ? '\nPASS: resume shows every project in one flat list.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
