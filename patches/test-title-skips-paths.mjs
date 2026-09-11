#!/usr/bin/env node
// test-title-skips-paths.mjs — behaviour check for customization F4
// ("a filesystem address never becomes a /resume title").
//
//   node ~/.dsh-tui/patches/test-title-skips-paths.mjs
//
// Builds throwaway zstd-framed session logs in a temp dir and digests them with
// the SHIPPED module, so the checks run against what is installed while writing
// nothing outside the temp dir. Asserts:
//
//   * an opening message that is a bare path is stepped over — the first real
//     sentence in the log becomes the prompt-sourced title;
//   * when the opening never yields a title (address-only, or a head window
//     that missed the prompt), the most RECENT real prompt stands in before
//     the directory basename — Claude Code's `lastPrompt` level, normalized to
//     one line and clipped at 200 characters;
//   * an address-only opening still counts as a conversation (`hasPrompt`
//     true) while its title falls back to the directory basename: a session
//     whose first message was a path must never be offered as an empty session
//     for the destructive clean-up action;
//   * a sentence that merely MENTIONS a path is still a title;
//   * date-like text and CJK slash words are not mistaken for paths;
//   * the progressive recovery scan (recoverSessionTitle) applies the same
//     rule, and still reports `hasPrompt` for an address-only log.

import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
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
const boot = () => ({ type: 'session/header', time: 1, data: { id: 'synthetic' } });
const user = text => ({
  type: 'user/message',
  time: 2,
  data: { source: { kind: 'user' }, content: [{ type: 'text', text }] },
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
  // 1. A path opening is skipped; the first real sentence names the session.
  const pathThenSentence = log([boot(), user('/home/amei/app/src/views/Setting.vue'), user('把互转方向改一下')]);
  let got = digestOf(pathThenSentence);
  check(got.text === '把互转方向改一下' && got.source === 'prompt',
    `path opening skipped, sentence wins (got ${JSON.stringify(got)})`);
  check(got.hasPrompt === true, 'path opening still counts as a prompt');

  // 2. Address-only opening: no title candidate left, but NOT an empty session.
  const addressOnly = log([boot(), user('@src/views/Setting.vue')]);
  got = digestOf(addressOnly);
  check(got.source === 'fallback' && got.text === basename(CWD),
    `address-only log falls back to the directory basename (got ${JSON.stringify(got)})`);
  check(got.hasPrompt === true,
    'address-only log is NOT reported as an empty session');

  // 3. No human input at all still reads as empty.
  const noPrompt = log([boot()]);
  got = digestOf(noPrompt);
  check(got.hasPrompt === false, 'a log with no human input stays empty');
  check(got.source === 'fallback' && got.text === basename(CWD), 'empty log keeps the basename title');

  // 4. Sentences that merely mention a path are titles, not addresses.
  for (const sentence of ['@src/views/Setting.vue 互转方向更改', '在admin_frontend中，@src/views/setting/Setting.vue 互转方向更改。']) {
    const mentioned = log([boot(), user(sentence)]);
    got = digestOf(mentioned);
    check(got.source === 'prompt' && got.text === sentence,
      `a sentence mentioning a path stays a title (${sentence.slice(0, 18)}…)`);
  }

  // 5. Prose-shaped strings that merely contain a slash are not paths.
  for (const prose of ['2024/09/11', '工作/生活']) {
    got = digestOf(log([boot(), user(prose)]));
    check(got.source === 'prompt' && got.text === prose, `"${prose}" is not mistaken for a path`);
  }

  // 6. The other address spellings, spaces included.
  for (const address of ['src/views/Setting.vue', 'src/views/Setting', '~/notes/todo.md', './draft.md', 'C:\\Users\\amei\\a.txt', '/Users/me/My Documents/note.txt']) {
    const only = log([boot(), user(address)]);
    got = digestOf(only);
    check(got.source === 'fallback' && got.hasPrompt === true,
      `address-only "${address}" is skipped, not empty`);
    const followed = log([boot(), user(address), user('整理一下这个文件')]);
    got = digestOf(followed);
    check(got.text === '整理一下这个文件' && got.source === 'prompt',
      `"${address}" is stepped over for the next sentence`);
  }

  // 7. The lastPrompt level: when the opening never yields a title, the newest
  //    real prompt stands in before the directory name. The head window covers
  //    only the first 64 KB, so an incompressible filler pushes the recent
  //    words into the tail window — exactly the path this level exists for.
  const filler = randomBytes(70_000).toString('base64');
  const big = (...extra) => log([
    boot(),
    user('/home/amei/app/src/views/Setting.vue'),
    { type: 'assistant/message', time: 3, data: { message: { content: [{ type: 'text', text: filler }] } } },
    ...extra,
  ]);
  let bigLog = big(user('把互转方向改成双向的'));
  check(statSync(bigLog).size > 64 * 1024, 'the fallback fixture really is bigger than the head window');
  got = digestOf(bigLog);
  check(got.text === '把互转方向改成双向的' && got.source === 'prompt',
    `a recent prompt outranks the directory name (got ${JSON.stringify(got)})`);

  bigLog = big(user('先看下这个文件\n再改样式'));
  got = digestOf(bigLog);
  check(got.text === '先看下这个文件 再改样式',
    `a multi-line recent prompt is folded to one line (got ${JSON.stringify(got)})`);

  bigLog = big(user(`${'x'.repeat(250)}结尾`));
  got = digestOf(bigLog);
  check(got.text?.length === 201 && got.text.endsWith('…'),
    `a long recent prompt is clipped at 200 characters (got ${got.text?.length} chars)`);

  bigLog = big();
  got = digestOf(bigLog);
  check(got.text === basename(CWD) && got.source === 'fallback' && got.hasPrompt === true,
    `an address-only big log still only reaches the basename (got ${JSON.stringify(got)})`);

  // 8. The progressive recovery scan applies the same rule.
  const bytes = statSync(pathThenSentence).size;
  let recovered = await digest.recoverSessionTitle(pathThenSentence, bytes);
  check(recovered.title?.text === '把互转方向改一下' && recovered.title?.source === 'prompt' && recovered.complete === true,
    `recoverSessionTitle skips the path opening (got ${JSON.stringify(recovered)})`);
  recovered = await digest.recoverSessionTitle(addressOnly, statSync(addressOnly).size);
  check(recovered.title === undefined && recovered.hasPrompt === true && recovered.complete === true,
    `recoverSessionTitle keeps hasPrompt for an address-only log (got ${JSON.stringify(recovered)})`);
  recovered = await digest.recoverSessionTitle(noPrompt, statSync(noPrompt).size);
  check(recovered.title === undefined && recovered.hasPrompt === false,
    'recoverSessionTitle still reports an empty log as empty');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures === 0) {
  report('PASS: an address is never a title, and never erases a conversation.');
  process.exit(0);
}
report(`${failures} check(s) failed.`);
process.exit(1);
