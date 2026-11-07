#!/usr/bin/env node
// test-tool-card-copy.mjs — behaviour check for F6's second half: code lifted
// out of a TOOL CARD must copy without the card's indent column.
//
//   node ~/.dsh-tui/patches/test-tool-card-copy.mjs
//
// A tool card draws its body behind a three-cell gutter (`⎿ `/spaces). That
// column is chrome, not code: when it is selectable, the TUI's own drag-copy
// hands every line a three-space indent — and, because a soft-wrapped source
// line continues on the next screen row, it also injects three spaces at the
// break. The fix marks the gutter `NoSelect`, so the copy path skips it.
//
// This renders the REAL AssistantToolUseMessage (a Bash card with a line long
// enough to wrap) through the package's own ink runtime with fake streams,
// then runs the REAL selection extractor over the frame buffer:
//
//   * the gutter is still DRAWN (the `⎿` marker is visible);
//   * its cells carry the noSelect bit;
//   * the copied text is the source: no `⎿`, no leading indent on any line;
//   * a wrapped line joins back without the gutter's three spaces;
//   * all three source lines survive.

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
const { AssistantToolUseMessage } = await import(join(TUI, 'lib/types/components/messages/AssistantToolUseMessage.js'));
const instances = (await import(join(TUI, 'lib/types/ink/instances.js'))).default;
const { cellAt } = await import(join(TUI, 'lib/types/ink/screen.js'));
const { createSelectionState, getSelectedText } = await import(join(TUI, 'lib/types/ink/selection.js'));
const React = requireFromTui('react');

let failures = 0;
const report = line => process.stderr.write(`${line}\n`);
const check = (cond, msg) => {
  if (cond) report(`ok  : ${msg}`);
  else { report(`FAIL: ${msg}`); failures += 1; }
};

class FakeStdin extends EventEmitter {
  constructor() {
    super();
    this.isTTY = true;
    this.buffer = null;
  }
  setRawMode() {} setEncoding() {} resume() {} pause() {}
  read() { const data = this.buffer; this.buffer = null; return data; }
  push(text) { this.buffer = Buffer.from(text, 'utf8'); this.emit('readable'); }
  write() { return true; }
}
const sink = () => ({
  isTTY: true, columns: 60, rows: 30,
  write: () => true,
  on: () => {}, off: () => {}, removeListener: () => {}, once: () => {}, addListener: () => {},
  cork: () => {}, uncork: () => {},
});

const OUTPUT = '<?php\n$x = "' + 'a'.repeat(90) + '";\n$y = 2;\n';
const capture = { ...sink(), write: () => true };
const realStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = () => true;
const app = renderSync(
  React.createElement(AssistantToolUseMessage, {
    tool: {
      name: 'Bash',
      startedAt: Date.now() - 5000,
      resultView: { card: 'terminal', title: 'php -r ...', cwd: '/tmp', output: OUTPUT, exitCode: 0 },
    },
    verbose: false,
    diffLayout: 'auto',
  }),
  // patchConsole:false — ink otherwise captures process.stderr while mounted,
  // which would swallow every `report` line the checks write.
  { stdout: capture, stdin: new FakeStdin(), stderr: sink(), patchConsole: false },
);
await new Promise(resolve => setTimeout(resolve, 150));
const screen = instances.get(capture)?.frontFrame?.screen;
check(screen !== undefined, 'the Bash card renders on a readable screen buffer');

if (screen !== undefined) {
  const rowText = row => {
    let line = '';
    for (let col = 0; col < screen.width; col++) line += cellAt(screen, col, row)?.char ?? '';
    return line;
  };
  // Locate the card body: the first line is ` ⎿ <?php`, the last is `   $y = 2;`.
  let first = -1;
  let last = -1;
  let gutterRow = -1;
  for (let row = 0; row < screen.height; row++) {
    const line = rowText(row);
    if (line.includes('<?php') && first < 0) { first = row; gutterRow = row; }
    if (line.includes('$y = 2;')) last = row;
  }
  check(first >= 0 && last > first, 'the card body is on screen');

  if (first >= 0 && last > first) {
    check(rowText(gutterRow).includes('⎿'), 'the `⎿` gutter is still drawn');
    let marked = true;
    for (let row = first; row <= last; row++) {
      for (let col = 0; col < 3; col++) {
        if (screen.noSelect[row * screen.width + col] !== 1) marked = false;
      }
    }
    check(marked, 'the three gutter cells of every body row are NoSelect');

    const selection = createSelectionState();
    selection.anchor = { col: 0, row: first };
    selection.focus = { col: screen.width - 1, row: last };
    const copied = getSelectedText(selection, screen);
    check(copied.startsWith('<?php'), 'the copy starts at the code, not at the gutter');
    check(!copied.includes('⎿'), 'the gutter marker is not in the copy');
    check(!/^ +/m.test(copied), 'no copied line starts with the card indent');
    check(!copied.includes('   '), 'a wrapped line joins back without the indent spaces');
    check(copied.trimEnd().split('\n').length === 3, 'all three source lines survive');
  }
}

app.unmount?.();
await new Promise(resolve => setTimeout(resolve, 30));
process.stdout.write = realStdoutWrite;

if (failures > 0) {
  report(`\n${failures} failure(s)`);
  process.exit(1);
}
report('\nall tool-card copy assertions passed');
