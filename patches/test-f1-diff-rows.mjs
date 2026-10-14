#!/usr/bin/env node
// test-f1-diff-rows.mjs — behaviour check for customization F1 in its
// "upstream numbers it, we decorate it" form:
//
//   node ~/.dsh-tui/patches/test-f1-diff-rows.mjs
//
// The chain under test is the real one, no fixtures of our own shape:
//
//   dsh-tool-fs / dsh-tool-str-replace-editor presentation hooks
//     → unified patch text  (`@@ -oldStart,oldLines +newStart,newLines @@`)
//     → the TUI's own parseFilePatch() numbers every line
//     → AssistantToolUseMessage.diffRows() lays out the card body
//
// Asserts (all headless — no terminal, no TUI, no user data touched):
//
//   * Edit/Write diffs now travel as `{path, patch}`; the old/new-texts shape
//     is still accepted by the tools' meta validators, so replayed sessions
//     keep rendering;
//   * the stock parser gives every row a real line number (old for a removed
//     line, new otherwise) and a `(+A -R)` diffstat header;
//   * a removed run followed by an equal-length added run pairs line-for-line
//     and carries word-level `segments`; unequal runs stay unsegmented;
//   * scattered hunks are separated by `⋯`, and multi-file cards get a path row;
//   * a file creation (`@@ -0,0 +1,N @@`, or the str_replace_editor `create`
//     call preview) numbers from 1 and stats `+N -0`.

import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PATCH_DIR = dirname(fileURLToPath(import.meta.url));
const HOME_DIR = dirname(dirname(PATCH_DIR));
const DSH = process.env.DSH_HOME ?? join(HOME_DIR, '.dsh');
const TUI = process.env.DSH_TUI_PKG
  ?? join(DSH, 'profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui');
const TOOLS = process.env.DSH_TOOLS_DIR ?? join(DSH, 'profiles/node_modules/@deepseek-ai');

let failures = 0;
const report = line => process.stderr.write(`${line}\n`);
const check = (cond, msg) => {
  if (cond) report(`ok  : ${msg}`);
  else { report(`FAIL: ${msg}`); failures += 1; }
};

/** A context just rich enough for either tool package to register its tools. */
function fakeCtx(captured) {
  return {
    tools: { register: (tool) => captured.push(tool), get: () => undefined },
    fs: { sandboxMode: undefined },
    systemPrompt: { section: () => {}, getSectionOrder: () => 0 },
    inject: () => {}, on: () => {}, emit: () => {}, get: () => undefined,
    waterfall: async (...args) => (typeof args[args.length - 1] === 'function' ? args[args.length - 1]() : undefined),
  };
}
const FS_CONFIG = { readLimit: 2000, readMaxLineLength: 2000, readMaxBytes: 262144, readStreamMinSize: 65536 };

/** Load a tool package and return its registered tools, by name. */
async function toolsOf(pkg) {
  const captured = [];
  const mod = await import(join(TOOLS, pkg, 'lib/index.js'));
  mod.apply(fakeCtx(captured), FS_CONFIG);
  return new Map(captured.map((tool) => [tool.name, tool]));
}

const fsTools = await toolsOf('dsh-tool-fs');
const editorTools = await toolsOf('dsh-tool-str-replace-editor');
const write = fsTools.get('write');
const edit = fsTools.get('edit');
const editor = editorTools.get('str_replace_editor');
check(write !== undefined && edit !== undefined && editor !== undefined,
  `both tool packages registered their tools (${[...fsTools.keys()].join(',')} / ${[...editorTools.keys()].join(',')})`);

const { diffRows, AssistantToolUseMessage } =
  await import(join(TUI, 'lib/types/components/messages/AssistantToolUseMessage.js'));
const { renderSync } = await import(join(TUI, 'lib/types/ui.js'));
const React = createRequire(join(TUI, 'package.json'))('react');

const gutters = rows => rows.filter(row => row.gutter !== undefined).map(row => row.gutter + row.text);
const statOf = rows => rows[0]?.text;

// ── an Edit: one update, two hunks, one paired line ─────────────────────────
const before = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'].join('\n');
const after = ['one', 'TWO', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'ELEVEN', 'twelve'].join('\n');
const editDiffs = edit.output.presentationMeta({ file_path: 'src/x.js' }, { before, after }).diffs;
check(editDiffs.length === 1 && typeof editDiffs[0].patch === 'string',
  'an edit carries one unified patch diff (not per-hunk old/new texts)');
check(editDiffs[0].patch.startsWith('@@ -'), 'and the patch is hunk text the stock parser reads');

const editRows = diffRows(editDiffs);
check(statOf(editRows) === '(+2 -2)', `the card body starts with the stock (+N -M) diffstat (${statOf(editRows)})`);
check(editRows.some(row => row.text === '⋯'), 'scattered hunks are separated by ⋯');
// Numbers are right-aligned to the file's largest number (12 → width 2 here),
// old for a removed line and new otherwise, then `marker ` — byte-identical to
// the stock gutter's spacing.
check(gutters(editRows).join(' ') === [
  ' 1   one', ' 2 - two', ' 2 + TWO', ' 3   three', ' 4   four', ' 5   five',
  ' 8   eight', ' 9   nine', '10   ten', '11 - eleven', '11 + ELEVEN', '12   twelve',
].join(' '),
  `every row is numbered from the parsed hunk starts (${gutters(editRows).join(' ')})`);

const pairedAdd = editRows.find(row => row.text === 'TWO');
const pairedDel = editRows.find(row => row.text === 'two');
check(pairedDel?.segments?.some(segment => segment.changed === true && segment.text === 'two') === true,
  'a paired removed line carries word segments marking the changed word');
check(pairedAdd?.segments?.some(segment => segment.changed === true && segment.text === 'TWO') === true,
  'its added counterpart marks the new word too');
check(editRows.every(row => row.text !== 'eleven' || row.segments !== undefined),
  'one-word changes stay paired regardless of position in the file');

// ── an unpaired run keeps its lines but gets no segments ────────────────────
const grew = edit.output.presentationMeta({ file_path: 'src/y.js' },
  { before: 'a\nb\n', after: 'a\nb\nc\nd\n' }).diffs;
const grewRows = diffRows(grew);
check(grewRows.some(row => row.text === 'c') && grewRows.some(row => row.text === 'd'),
  'an added run longer than its removed run lists both new lines');
check(grewRows.filter(row => row.tone === 'add').every(row => row.segments === undefined),
  'and leaves them unsegmented (nothing to pair against)');

// ── a Write update uses the same shape ─────────────────────────────────────
const writeDiffs = write.output.presentationMeta({ file_path: 'src/z.js' }, { operation: 'update', before, after }).diffs;
check(JSON.stringify(diffRows(writeDiffs)) === JSON.stringify(editRows),
  'Write (update) renders through the identical path as Edit');

// ── creating a file: numbered from 1, stat +N -0 ───────────────────────────
const createDiffs = write.output.presentationMeta({ file_path: 'src/new.js' },
  { operation: 'create', before: null, after: 'alpha\nbeta\n' }).diffs;
const createRows = diffRows(createDiffs);
check(statOf(createRows) === '(+2 -0)', `a created file stats +N -0 (${statOf(createRows)})`);
check(gutters(createRows).join(' ') === '1 + alpha 2 + beta',
  `and numbers its lines from 1 (${gutters(createRows).join(' ')})`);

const previewRows = diffRows(write.presentCall({ file_path: 'src/new.js', content: 'alpha\nbeta\n' }).diffs);
check(JSON.stringify(previewRows) === JSON.stringify(createRows),
  'the call-time preview of that file renders identically to its result');

// ── the editors ────────────────────────────────────────────────────────────
const editorMeta = editor.output.presentationMeta({ path: 'src/s.js', command: 'str_replace' },
  { before, after });
const editorRows = diffRows(editorMeta.diffs);
check(statOf(editorRows) === '(+2 -2)' && editorRows.some(row => row.gutter !== undefined),
  'str_replace_editor result hunks are numbered patch rows too');
const editorCreate = editor.presentCall({ command: 'create', path: 'src/e.js', file_text: 'p\nq\n' });
check(statOf(diffRows(editorCreate.diffs)) === '(+2 -0)',
  'str_replace_editor create previews number from 1');

// ── the tools' meta validators accept both shapes ──────────────────────────
const accepted = write.presentResult({ file_path: 'src/x.js', content: '' },
  { meta: { diffs: editDiffs } });
check(accepted?.diffs?.[0]?.patch === editDiffs[0].patch,
  'the write result validator accepts patch-shaped meta');
// `defineTool` validates the ARGS before presentResult runs, so a replay of an
// Edit needs the real argument shape — not just the meta.
const editArgs = { file_path: 'src/x.js', old_string: 'two', new_string: 'TWO' };
const editView = edit.presentResult(editArgs, { meta: { diffs: editDiffs }, message: 'ok' });
check(editView?.diffs?.[0]?.patch === editDiffs[0].patch,
  'an Edit result view carries the patch diff (replay path)');
const editPreview = edit.presentCall(editArgs);
check(editPreview?.diffs?.[0]?.patch === undefined && editPreview?.diffs?.[0]?.oldText === 'two',
  'while the call-time Edit preview stays old/new fragments (no real line numbers to show yet)');
const legacy = write.presentResult({ file_path: 'src/x.js', content: 'legacy body' },
  { meta: { diffs: [{ path: 'src/x.js', oldText: null, newText: 'legacy body' }] } });
check(legacy?.diffs?.[0]?.newText === 'legacy body',
  'and still accepts the old/new-texts shape (replayed sessions)');
const malformed = write.presentResult({ file_path: 'src/x.js', content: 'fallback body' },
  { meta: { diffs: [{ path: 'src/x.js' }] } });
check(malformed?.diffs?.[0]?.patch?.includes('+fallback body') === true,
  'while malformed meta falls back to a numbered patch of the written content');

// ── the real render path: the decorated JSX must not throw ─────────────────
// `diffRows` covers the layout; this covers the render — full-row bands,
// word segments and the caps are applied by the component itself.
class FakeStdin extends EventEmitter {
  constructor() {
    super();
    this.isTTY = true; this.buffer = null;
    this.setRawMode = () => {}; this.setEncoding = () => {};
    this.resume = () => {}; this.pause = () => {}; this.ref = () => {}; this.unref = () => {};
  }
  read() { const data = this.buffer; this.buffer = null; return data; }
  push(text) { this.buffer = Buffer.from(text, 'utf8'); this.emit('readable'); }
  write() { return true; }
}
const sinkStream = () => ({
  write: () => true, isTTY: false, on() {}, off() {}, once() {}, removeListener() {}, emit() {},
  columns: 120, rows: 40,
});
/** A frame as a terminal shows it: cursor-forward runs become the spaces ink
 *  never writes literally, then the style/OSC escapes come off. */
const unescapeFrame = raw => raw
  .replace(/\u001b\]([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g, '')
  .replace(/\u001b\[(\d*)C/g, (_, n) => ' '.repeat(Number(n || 1)))
  .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
  .replace(/\u001b[=>NOPc]/g, '')
  .replace(/[\u0000-\u0008\u000b-\u001f]/g, '');

const renderCard = async (diffs) => {
  let raw = '';
  const capture = {
    columns: 120, rows: 40, isTTY: true,
    write: (chunk) => { raw += chunk; return true; },
    on() {}, off() {}, once() {}, removeListener() {}, emit() {},
  };
  const realWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  const app = renderSync(
    React.createElement(AssistantToolUseMessage, {
      tool: { name: 'Edit', startedAt: Date.now() - 5, resultView: { card: 'diff', title: 'Edit src/x.js', diffs } },
      verbose: false,
      diffLayout: 'unified',
    }),
    { stdout: capture, stdin: new FakeStdin(), stderr: sinkStream() },
  );
  await new Promise(resolve => setTimeout(resolve, 120));
  app.unmount?.();
  await new Promise(resolve => setTimeout(resolve, 30));
  process.stdout.write = realWrite;
  return unescapeFrame(raw);
};

const editFrame = await renderCard(editDiffs);
check(editFrame.includes(' 2 - two') && editFrame.includes(' 2 + TWO'),
  'the rendered card shows numbered rows with the stock spacing');
check(editFrame.includes('(+2 -2)'), 'and the diffstat row');
check(!editFrame.includes('ctrl+o'),
  'a normal edit is never folded (no expand hint on screen)');

const editViewFrame = await renderCard(editView.diffs);
check(editViewFrame.includes(' 2 - two'),
  'the settled Edit card (the replay/result view) is numbered too');

const wideBefore = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n');
const wideAfter = wideBefore.replace('line 30', 'LINE THIRTY');
const wideFrame = await renderCard(edit.output.presentationMeta({ file_path: 'src/wide.js' },
  { before: wideBefore, after: wideAfter }).diffs);
check(!wideFrame.includes('ctrl+o') && wideFrame.includes('30 - line 30'),
  'a long edit renders every row too (unified bodies are uncapped)');

const many = Array.from({ length: 30 }, (_, i) => `content ${i + 1}`).join('\n');
const createFrame = await renderCard(write.output.presentationMeta({ file_path: 'src/big.js' },
  { operation: 'create', before: null, after: `${many}\n` }).diffs);
check(createFrame.includes('10 + content 10') && !createFrame.includes('11 + content 11'),
  'a created file previews the diffstat plus its first 10 lines');
check(createFrame.includes('ctrl+o'),
  'and folds the rest behind the expand hint');

// ── the TUI's own translation: what the transcript actually renders ────────
// The settled card comes from the TUI's `presentResultView` (the tool's
// presentResult over the host's meta), NOT from the host payload directly, so
// drive the real translator with the real tool objects.
const { createDshTranslator } = await import(join(TUI, 'lib/types/dsh-adapter/backend/translate.js'));
const byName = new Map([...fsTools, ...editorTools]);
const translator = createDshTranslator({
  tools: () => ({ get: (name) => byName.get(name) }),
  scope: () => undefined,
  attachments: {},
  cwd: () => '/tmp',
  sessionId: () => 'f1-test',
});
const callEvents = translator.translateEvent({
  type: 'tool/call', seq: 1, time: 0,
  data: { turn: 1, step: 1, callId: 'c1', name: 'edit', arguments: JSON.stringify(editArgs) },
});
const resultEvents = translator.translateEvent({
  type: 'tool/result', seq: 2, time: 0,
  data: {
    turn: 1, step: 1,
    message: { role: 'tool', source: { kind: 'tool', callId: 'c1' }, toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] },
    meta: { diffs: editDiffs },
  },
});
const translatedView = resultEvents.find(event => event.type === 'tool.result')?.presentation;
check(translatedView?.diffs?.[0]?.patch === editDiffs[0].patch,
  'the transcript translator settles the card on the PATCH view (the numbered one)');
check(callEvents[0]?.presentation?.diffs?.[0]?.patch === undefined,
  'while the in-flight call view stays fragments (no numbers until the result lands)');

// ── legacy payloads: the old host's shape, and every card already in a log ─
// `{oldText,newText,oldStart,newStart}` (one hunk per diff) has no patch text
// to parse, so the renderer line-diffs the two sides itself and numbers them
// from the hunk starts — that is what makes a pre-patch transcript show real
// line numbers once a post-patch TUI renders it.
const legacyDiffs = [{
  path: 'src/x.js',
  oldText: 'one\ntwo\nthree\nfour\nfive\n',
  newText: 'one\nTWO\nthree\nfour\nfive\n',
  oldStart: 11,
  newStart: 11,
}];
const legacyRows = diffRows(legacyDiffs);
check(legacyRows.some(row => row.gutter === '12 - ' && row.text === 'two'),
  'a legacy hunk payload renders a numbered removed row (12 - two)');
check(legacyRows.some(row => row.gutter === '12 + ' && row.text === 'TWO'
  && row.segments?.some(segment => segment.changed === true && segment.text === 'TWO')),
  'and its added counterpart, word segments included');
check(legacyRows.some(row => row.gutter === '13   ' && row.text === 'three'),
  'while context rows advance both sides (13   three)');
check(diffRows([{ path: 'src/x.js', oldText: 'a\n', newText: 'b\n' }])
  .every(row => row.gutter === undefined),
  'a payload with no hunk starts still falls back to unnumbered stock rows');

report(failures === 0
  ? '\nPASS: F1 diffs travel as patch text, stock numbers them, our layout decorates them.'
  : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
