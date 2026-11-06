#!/usr/bin/env node
// test-code-frame-plain.mjs — behaviour check for customization F6
// ("code fences draw no frame, so a terminal-level copy is the code alone").
//
//   node ~/.dsh-tui/patches/test-code-frame-plain.mjs
//
// Renders the REAL CodeBlockFrame through the package's own ink runtime with
// fake streams (no terminal, no TUI, no user data touched) and asserts what a
// terminal shows — and therefore what a mouse selection / tmux copy-mode
// would grab:
//
//   * the default style is `plain` (no store write, no config row);
//   * `plain` emits the source only: no `┌ │ └ ┐ ┘ ─` and no language label;
//   * the code starts at column 0 — the frame's rail column is gone, so a
//     copied block is not indented by two decorative columns;
//   * `light` still draws its open rail with the language label on top;
//   * `full` still closes the box (all four corners, right wall, bottom edge);
//   * `/settings` offers Plain, and the Config schema accepts it.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PATCH_DIR = dirname(fileURLToPath(import.meta.url));
const HOME_DIR = dirname(dirname(PATCH_DIR));
const TUI = process.env.DSH_TUI_PKG
  ?? join(HOME_DIR, '.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui');

const requireFromTui = createRequire(join(TUI, 'package.json'));
const { renderSync } = await import(join(TUI, 'lib/types/ui.js'));
const { CodeBlockFrame } = await import(join(TUI, 'lib/types/components/CodeBlockFrame.js'));
const { applyCodeFrameStyle, getCodeFrameStyle, normalizeCodeFrameStyle } =
  await import(join(TUI, 'lib/types/tuiDisplayPrefs.js'));
const { SETTING_DEFINITIONS } = await import(join(TUI, 'lib/types/settings/definitions.js'));
const { Config } = await import(join(TUI, 'lib/types/dsh-adapter/index.js'));
const React = requireFromTui('react');

let failures = 0;
const report = line => process.stderr.write(`${line}\n`);
const check = (cond, msg) => {
  if (cond) report(`ok  : ${msg}`);
  else { report(`FAIL: ${msg}`); failures += 1; }
};

// The code the user would copy out of the block.
const CODE = '<?php echo "hi";\nreturn 1;\n';
const TOKEN = { type: 'code', lang: 'php', text: CODE };

/** Ink paints runs of spaces as cursor-forward (`ESC[nC`) when it can. Turn
 *  those back into spaces before stripping the rest, or every column assert
 *  reads a 44-character line as glued tokens. */
function plainText(raw) {
  return raw
    .replace(/\x1b\[(\d+)C/g, (_, n) => ' '.repeat(Number(n)))
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\r/g, '');
}

// Ink pokes process.stdout directly (alternate screen, mouse tracking); mute
// it so the assertions' report is the only thing this script emits.
const realStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = () => true;

let output = '';
const sink = () => ({
  isTTY: true,
  columns: 80,
  rows: 24,
  write: () => true,
  on: () => {}, off: () => {}, removeListener: () => {}, once: () => {}, addListener: () => {},
  cork: () => {}, uncork: () => {},
});
const stdin = {
  isTTY: true,
  setRawMode: () => {}, setEncoding: () => {}, resume: () => {}, pause: () => {},
  on: () => {}, off: () => {}, removeListener: () => {}, read: () => null,
};

/** Render one fence at 80 columns under the given frame style. */
async function renderWith(style) {
  applyCodeFrameStyle(style);
  output = '';
  const stdout = { ...sink(), write: chunk => { output += chunk; return true; } };
  const app = renderSync(
    React.createElement(CodeBlockFrame, { token: TOKEN, forceWidth: 79 }),
    { stdout, stdin, stderr: sink() },
  );
  await new Promise(resolve => setTimeout(resolve, 120));
  app.unmount?.();
  return plainText(output);
}

// ---- the setting -----------------------------------------------------------
applyCodeFrameStyle(undefined);
check(getCodeFrameStyle() === 'plain', 'default code-frame style is plain (unset value)');
check(normalizeCodeFrameStyle('plain') === 'plain', 'normalizer keeps plain');
check(normalizeCodeFrameStyle('light') === 'light', 'normalizer keeps light');
check(normalizeCodeFrameStyle('bogus') === 'plain', 'an unknown value falls back to plain');
check(
  SETTING_DEFINITIONS.codeFrameStyle.options.map(option => option.value).includes('plain'),
  '/settings offers the Plain option',
);
const resolved = Config({ codeFrameStyle: 'plain' }).codeFrameStyle;
check(
  (typeof resolved?.get === 'function' ? resolved.get() : resolved) === 'plain',
  'Config schema accepts codeFrameStyle: plain',
);

// ---- plain: the code alone -------------------------------------------------
const plain = await renderWith('plain');
check(plain.includes('<?php echo "hi";'), 'plain renders the source text');
check(plain.includes('return 1;'), 'plain renders every source line');
check(!/[┌│└┐┘─]/.test(plain), 'plain draws no frame glyph at all');
check(!/^php$/m.test(plain), 'plain shows no standalone language-label row');
const sourceLines = plain.split('\n').filter(line => line.trim() !== '');
check(
  sourceLines.every(line => /^[\w$<]/.test(line)),
  'plain keeps the code at column 0 (no rail/padding columns to copy)',
);
check(plain.trim().split('\n').length === 2, 'plain adds no header or blank rows');

// ---- light: the open rail is still available -------------------------------
const light = await renderWith('light');
check(/┌─ php/.test(light), 'light draws its corner and language label');
check(light.includes('│ '), 'light draws the left rail');
check(light.includes('<?php echo "hi";'), 'light still renders the source text');

// ---- full: the closed box is still available -------------------------------
const full = await renderWith('full');
check(full.includes('┌') && full.includes('┐'), 'full draws its top edge and right corner');
check(full.includes('└') && full.includes('┘'), 'full draws its bottom edge and corners');
check(full.includes('│'), 'full draws its side walls');
check(full.includes('php'), 'full keeps the language label');

process.stdout.write = realStdoutWrite;
if (failures > 0) {
  report(`\n${failures} failure(s)`);
  process.exit(1);
}
report('\nall F6 code-frame assertions passed');
