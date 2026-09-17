#!/usr/bin/env node
// test-resume-title-chain.mjs — behaviour check for customization F4
// ("a /resume row is named the way Claude Code names a session, and a
// filesystem address never becomes that name").
//
//   node ~/.dsh-tui/patches/test-resume-title-chain.mjs
//
// Builds throwaway zstd-framed session logs in a temp dir and digests them with
// the SHIPPED module, so the checks run against what is installed while writing
// nothing outside the temp dir. Asserts Claude Code's display chain, in its own
// order, with the address filter applied to both prompt levels:
//
//   * a `session/title` event wins, and its provenance still classifies it
//     (provider → auto, TUI-written → renamed);
//   * otherwise the MOST RECENT human prompt names the row, and only then the
//     opening prompt (`lastPrompt` before `firstPrompt`);
//   * that recent prompt is normalized the way Claude normalizes its own
//     `lastPrompt`: newlines folded to spaces, trimmed, clipped at 200
//     characters with an ellipsis;
//   * a prompt that is nothing but a filesystem address is stepped over at
//     BOTH levels — the scan keeps looking, and a real sentence that merely
//     mentions a path is still a title;
//   * an address-only opening still counts as a conversation (`hasPrompt`
//     true) while the row falls back to the working directory's basename: such
//     a session must never be offered to the destructive empty-session
//     clean-up;
//   * a log with no human input at all stays empty.

import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zstdCompressSync } from 'node:zlib';

const PATCH_DIR = dirname(fileURLToPath(import.meta.url));
const HOME_DIR = dirname(dirname(PATCH_DIR));
const TUI = process.env.DSH_TUI_PKG
  ?? join(HOME_DIR, '.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui');

const digest = await import(pathToFileURL(
  join(TUI, 'lib/types/dsh-adapter/sessions/digest.js'),
).href);

let failures = 0;
/** The report goes to stderr so it is never mistaken for program output. */
const report = line => process.stderr.write(`${line}\n`);
const check = (cond, msg) => {
  if (cond) report(`ok  : ${msg}`);
  else { report(`FAIL: ${msg}`); failures += 1; }
};

/** One log line, compressed on its own so the file is a chain of frames. */
const frame = value => zstdCompressSync(Buffer.from(`${JSON.stringify(value)}\n`, 'utf8'));
// A real log opens with a flat `session` line (no `data` wrapper), and 0.10.2
// added a first-line check before it calls a log completely read: a fixture
// that opens with anything else would silently report `complete: false` and
// `hasPrompt: true`, hiding empty sessions from the cheap path.
const boot = () => ({ type: 'session', version: 0, id: 'synthetic', createdAt: 1, cwd: CWD });
const user = text => ({
  type: 'user/message',
  time: 2,
  data: { source: { kind: 'user' }, content: [{ type: 'text', text }] },
});
const title = (text, provider = false) => ({
  type: 'session/title',
  time: 3,
  data: provider ? { title: text, source: { kind: 'provider' } } : { title: text },
});

const dir = mkdtempSync(join(tmpdir(), 'dsh-title-'));
let seq = 0;
/** Write one synthetic session log and return its path. */
const log = lines => {
  const path = join(dir, `session-${seq += 1}.log`);
  writeFileSync(path, Buffer.concat(lines.map(frame)));
  return path;
};

const CWD = '/home/amei/proj';
/** The title digestSession derives for a log, as `text|source|hasPrompt`. */
const digestOf = path => {
  const result = digest.digestSession(path, CWD);
  return { text: result.title?.text, source: result.title?.source, hasPrompt: result.hasPrompt };
};

try {
  // 1. A title event outranks every prompt, and keeps its provenance.
  let got = digestOf(log([boot(), user('把互转方向改一下'), title('Fix login button on mobile', true)]));
  check(got.text === 'Fix login button on mobile' && got.source === 'auto',
    `a provider title wins and stays "auto" (got ${JSON.stringify(got)})`);
  got = digestOf(log([boot(), user('把互转方向改一下'), title('改互转方向')]));
  check(got.text === '改互转方向' && got.source === 'renamed',
    `a TUI-written title wins and stays "renamed" (got ${JSON.stringify(got)})`);

  // 2. With no title event, Claude's order puts the RECENT prompt first.
  got = digestOf(log([boot(), user('把互转方向改一下'), user('再帮我把测试补上')]));
  check(got.text === '再帮我把测试补上' && got.source === 'prompt',
    `the most recent prompt names the row (got ${JSON.stringify(got)})`);

  // 3. …normalized the way Claude normalizes its own lastPrompt.
  got = digestOf(log([boot(), user('第一句'), user('先看下这个文件\n再改样式')]));
  check(got.text === '先看下这个文件 再改样式',
    `a multi-line prompt is folded to one line (got ${JSON.stringify(got)})`);
  got = digestOf(log([boot(), user('第一句'), user(`${'x'.repeat(250)}结尾`)]));
  check(got.text?.length === 201 && got.text.endsWith('…'),
    `a long recent prompt is clipped at 200 characters (got ${got.text?.length} chars)`);

  // 4. An address is stepped over at BOTH prompt levels: the recent level
  //    keeps looking backwards, the opening level keeps looking forwards.
  got = digestOf(log([boot(), user('/home/amei/app/src/views/Setting.vue'), user('把互转方向改一下')]));
  check(got.text === '把互转方向改一下' && got.source === 'prompt',
    `an address opening is skipped for the next real sentence (got ${JSON.stringify(got)})`);
  got = digestOf(log([boot(), user('把互转方向改一下'), user('@src/views/Setting.vue')]));
  check(got.text === '把互转方向改一下' && got.source === 'prompt',
    `a recent address is skipped for the earlier real sentence (got ${JSON.stringify(got)})`);

  // 5. The address spellings, with prose-shaped near-misses left alone.
  const addresses = ['src/views/Setting.vue', 'src/views/Setting', '~/notes/todo.md', './draft.md',
    'C:\\Users\\amei\\a.txt', '/Users/me/My Documents/note.txt', '@src/views/Setting.vue'];
  for (const address of addresses) {
    got = digestOf(log([boot(), user(address)]));
    check(got.text === basename(CWD) && got.source === 'fallback' && got.hasPrompt === true,
      `address-only "${address}" falls back to the basename, still a conversation`);
    got = digestOf(log([boot(), user(address), user('整理一下这个文件')]));
    check(got.text === '整理一下这个文件' && got.source === 'prompt',
      `"${address}" is stepped over for the next sentence`);
  }
  for (const prose of ['@src/views/Setting.vue 互转方向更改',
    '在admin_frontend中，@src/views/setting/Setting.vue 互转方向更改。', '2024/09/11', '工作/生活']) {
    got = digestOf(log([boot(), user(prose)]));
    check(got.text === prose && got.source === 'prompt',
      `"${prose.slice(0, 22)}…" is prose, not an address, and stays a title`);
  }

  // 6. No human input at all: empty, and named by the working directory.
  got = digestOf(log([boot()]));
  check(got.hasPrompt === false && got.source === 'fallback' && got.text === basename(CWD),
    `an input-less log stays empty and falls back to the basename (got ${JSON.stringify(got)})`);

  // 7. The head window covers only the first 64 KB, so a big log has to find
  //    the recent prompt through the tail window — the path this level exists
  //    for. An incompressible filler keeps the log bigger than the window.
  const filler = randomBytes(70_000).toString('base64');
  const bigLog = log([
    boot(),
    user('/home/amei/app/src/views/Setting.vue'),
    { type: 'assistant/message', time: 3, data: { message: { content: [{ type: 'text', text: filler }] } } },
    user('最后说的这句话'),
  ]);
  check(statSync(bigLog).size > 64 * 1024, 'the big-log fixture really is bigger than the head window');
  got = digestOf(bigLog);
  check(got.text === '最后说的这句话' && got.source === 'prompt',
    `a big log takes its name from the tail window (got ${JSON.stringify(got)})`);

  // 8. The progressive recovery scan applies the same rule and keeps the same
  //    honest emptiness signal.
  let recovered = await digest.recoverSessionTitle(bigLog, statSync(bigLog).size);
  check(recovered.title?.text === '最后说的这句话' && recovered.title?.source === 'prompt' && recovered.complete === true,
    `recoverSessionTitle skips the address opening (got ${JSON.stringify(recovered)})`);
  const addressOnly = log([boot(), user('@src/views/Setting.vue')]);
  recovered = await digest.recoverSessionTitle(addressOnly, statSync(addressOnly).size);
  check(recovered.title === undefined && recovered.hasPrompt === true && recovered.complete === true,
    `recoverSessionTitle keeps hasPrompt for an address-only log (got ${JSON.stringify(recovered)})`);
  const emptyLog = log([boot()]);
  recovered = await digest.recoverSessionTitle(emptyLog, statSync(emptyLog).size);
  check(recovered.title === undefined && recovered.hasPrompt === false,
    'recoverSessionTitle still reports an input-less log as empty');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures === 0) {
  report('PASS: /resume names a session the way Claude Code does, and never with an address.');
  process.exit(0);
}
report(`${failures} check(s) failed.`);
process.exit(1);
