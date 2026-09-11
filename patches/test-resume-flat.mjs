#!/usr/bin/env node
// test-resume-flat.mjs — behaviour check for customization F3
// ("resume / session browser lists every project's history in one flat list,
// with no workspace rail").
//
//   node ~/.dsh-tui/patches/test-resume-flat.mjs
//
// Renders the real SessionBrowser through the package's own ink runtime with a
// fake channel and fake streams (nothing is written, no TUI is started) and
// asserts what the terminal would show:
//
//   * every project's sessions are listed, from three different working dirs;
//   * no directory rail: no rail rows, no "← choose directory" hint, no
//     workspace drill-in page;
//   * no `▣ <path>` project group headers — one flat list;
//   * the scope row reads as "all projects";
//   * sub-agent runs stay folded by default;
//   * the list hint advertises the keys this fork keeps (and not pins/menu).

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
const { SessionBrowser } = await import(join(TUI, 'lib/types/screens/SessionBrowser.js'));
const React = requireFromTui('react');

const HOME = '/home/amei';
const CURRENT = '/home/amei/.dsh-tui';
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
/** The report goes to stderr so ink's own escapes never reach it. */
const report = line => process.stderr.write(`${line}\n`);
const check = (cond, msg) => {
  if (cond) report(`ok  : ${msg}`);
  else { report(`FAIL: ${msg}`); failures += 1; }
};

const seen = ['AAA', 'BBB', 'CCC'].filter(token => plain.includes(token));
check(seen.length === 3, `sessions from 3 working directories are all listed (${seen.join(',') || 'none'})`);
check((plain.match(/☆/g) ?? []).length === 3, `exactly three session rows (${(plain.match(/☆/g) ?? []).length})`);
check(!plain.includes('▣ /server/www/mallphp') && !plain.includes('▣ /home/amei/.dsh-tui'),
  'no project group headers — one flat list');
check(!plain.includes('← 选择目录') && !plain.includes('← choose directory'), 'no rail switch hint');
check(!plain.includes('查看会话') && !plain.includes('view sessions'), 'no workspace drill-in page');
check(plain.includes('全部项目') || plain.includes('all projects'), 'scope reads as "all projects"');
check(!plain.includes('← 工作目录'), 'list hint does not advertise a directory rail');
// This fork has no pins and no right-click menu (the whole-fork trade-off), so
// the hint must not advertise them; the keys it does keep are checked instead.
check(!plain.includes('固定') && !plain.includes('Ctrl+P'), 'list hint does not advertise the dropped pin key');
check(plain.includes('重命名') || plain.includes('rename'), 'list hint advertises rename');
check(!plain.includes('RUN hidden subagent'), 'sub-agent runs stay folded by default');
check(plain.includes('Enter') && (plain.includes('恢复') || plain.includes('resume')), 'list hint renders');

report(failures === 0 ? '\nPASS: resume lists every project flat, with no workspace rail.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
