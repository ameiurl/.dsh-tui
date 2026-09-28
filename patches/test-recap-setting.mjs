#!/usr/bin/env node
// test-recap-setting.mjs — behaviour check for customization F5
// ("`recapOnOpen` is a real, writable setting again").
//
//   node ~/.dsh-tui/patches/test-recap-setting.mjs
//
// dsh-tui 0.11.1 kept the `/settings` → "Auto recap on open" row and the read
// that consumes it (`channel.ts`: `ns.value.recapOnOpen !== false`) but dropped
// the key from the adapter's Config schema. Saving the row then failed with
// `Config field "recapOnOpen" is not volatile`, and the read could never see
// `false`, so auto-recap was stuck ON. The patch declares the field and marks it
// volatile; this drives the REAL schema from the installed package (no TUI, no
// writes) and asserts what the settings service depends on:
//
//   * the key exists and is volatile — that is exactly what `write()` validates;
//   * its default is true (unset keeps auto-recap on, as the row documents);
//   * `{ recapOnOpen: false }` survives parsing, which is what channel.ts reads
//     (volatile fields resolve to a live ref; `plainConfig`/`configValues` call
//     `.get()` on it, so the test does the same);
//   * the settings row and the read are still in place (the field is only
//     meaningful together with them).

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PATCH_DIR = dirname(fileURLToPath(import.meta.url));
const HOME_DIR = dirname(dirname(PATCH_DIR));
const TUI = process.env.DSH_TUI_PKG
  ?? join(HOME_DIR, '.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui');

let failures = 0;
/** The report goes to stderr so it is never mistaken for program output. */
const report = line => process.stderr.write(`${line}\n`);
const check = (cond, msg) => {
  if (cond) report(`ok  : ${msg}`);
  else { report(`FAIL: ${msg}`); failures += 1; }
};

const { Config } = await import(join(TUI, 'lib/types/dsh-adapter/index.js'));

const field = Config.dict?.recapOnOpen;
check(field !== undefined, 'the Config schema declares recapOnOpen');
check(field?.meta?.volatile === true,
  'the field is volatile — otherwise the settings write path refuses it');
check(field?.meta?.default === true, 'its default is true (unset keeps auto-recap on)');

/** Volatile fields resolve to a live ref; the settings service unwraps it. */
const valueOf = field => (typeof field?.get === 'function' ? field.get() : field);
const resolved = Config({});
check(valueOf(resolved.recapOnOpen) === true, 'an unset config resolves to recap on');
const off = Config({ recapOnOpen: false });
check(valueOf(off.recapOnOpen) === false,
  'an explicit false survives parsing — this is the value channel.ts reads');

// The field only means something next to the row that edits it and the read
// that consumes it; a future upstream move must fail here, not silently.
const plugin = readFileSync(join(TUI, 'lib/types/dsh-adapter/plugin.js'), 'utf8');
check(plugin.includes("path: ['recapOnOpen']"), 'the /settings row still exists');
const channel = readFileSync(join(TUI, 'lib/types/dsh-adapter/channel.js'), 'utf8');
check(channel.includes('ns?.value?.recapOnOpen !== false'),
  'the auto-recap read still consumes the setting');

report(failures === 0
  ? '\nPASS: recapOnOpen is a declared, volatile, persisted TUI setting again.'
  : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
