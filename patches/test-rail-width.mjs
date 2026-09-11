#!/usr/bin/env node
// test-rail-width.mjs — behaviour check for the lowered resume-rail threshold.
//
//   node ~/.dsh-tui/patches/test-rail-width.mjs
//
// Upstream renders the working-directory rail only from 120 columns; the patch
// drops that to 90 so the rail (which lists every other working directory) is
// present on ordinary terminals. This renders the real SessionBrowser through
// the package's own ink runtime at several widths and asserts:
//
//   * 150 / 118 / 100 / 92 columns → rail present, listing the other dirs;
//   * 88 columns                   → rail absent (narrow-terminal drill-in page
//                                    stays the path there), session list intact.
//
// Nothing is written and no TUI is started: channel and streams are fakes.

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

const CURRENT = '/home/amei/.dsh-tui';
const session = (id, text, cwd, updatedAt) => ({
  id,
  cwd,
  updatedAt,
  title: { text, source: 'auto', complete: true },
  kind: { kind: 'conversation' },
  hasPrompt: true,
  branch: 'master',
});
const sessions = [
  session('a', 'AAA current-dir session', CURRENT, 500),
  session('b', 'BBB mallphp session', '/server/www/mallphp', 400),
  session('c', 'CCC config session', '/home/amei/.config', 300),
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
const sink = () => ({
  isTTY: true,
  columns: 120,
  rows: 40,
  write: () => true,
  on: () => {}, off: () => {}, removeListener: () => {}, once: () => {}, addListener: () => {},
  cork: () => {}, uncork: () => {},
});

/** Render the browser at one width and return its escape-stripped text. */
async function renderAt(columns) {
  let output = '';
  const capture = { ...sink(), columns, write: chunk => { output += chunk; return true; } };
  const realStdoutWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true; // ink pokes stdout directly; keep our TTY clean
  try {
    const app = renderSync(
      React.createElement(SessionBrowser, {
        channel,
        home: '/home/amei',
        sameProject: (a, b) => a === b,
        onClose: () => {},
      }),
      { stdout: capture, stdin: new FakeStdin(), stderr: sink() },
    );
    await new Promise(r => setTimeout(r, 130));
    app.unmount();
    await new Promise(r => setTimeout(r, 25));
  } finally {
    process.stdout.write = realStdoutWrite;
  }
  return output
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\u001b[=>NOPc]/g, '')
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, '');
}

let failures = 0;
/** The report goes to stderr so ink's own escapes never reach it. */
const report = line => process.stderr.write(`${line}\n`);
const check = (cond, msg) => {
  if (cond) report(`ok  : ${msg}`);
  else { report(`FAIL: ${msg}`); failures += 1; }
};

for (const columns of [150, 118, 100, 92]) {
  const plain = await renderAt(columns);
  // The scope row's hint ("← 选择目录") exists at every width; what the rail adds
  // is the list of the OTHER working directories beside the session list.
  const otherDirs = plain.includes('mallphp') && plain.includes('.config');
  const currentRow = plain.includes('AAA');
  check(otherDirs, `${columns} cols: rail lists the other working directories`);
  check(currentRow, `${columns} cols: session list still rendered alongside the rail`);
}

const narrow = await renderAt(88);
check(!narrow.includes('mallphp') && !narrow.includes('.config'),
  '88 cols: rail stays hidden below the threshold (no other directories listed)');
check(narrow.includes('AAA'), '88 cols: session list unaffected');

report(failures === 0 ? '\nPASS: the resume rail shows on 90+ column terminals.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
