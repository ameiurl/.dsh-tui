#!/usr/bin/env node
// test-recap-setting.mjs — stock-contract guard for customization F5
// ("`recapOnOpen` is a real, writable setting").
//
//   node ~/.dsh-tui/patches/test-recap-setting.mjs
//
// History: dsh-tui 0.11.1 kept the `/settings` → "Auto recap on open" row and
// the read that consumes it (`channel.js`: `ns.value.recapOnOpen !== false`) but
// dropped the key from the adapter's Config schema. Saving the row then failed
// with `Config field "recapOnOpen" is not volatile`, and the read could never
// see `false`, so auto-recap was stuck ON. This file used to guard the patch
// that declared the field back.
//
// 0.11.2 fixed it upstream, its own way: `Config` declares
// `recapOnOpen: Schema.boolean()` — deliberately WITHOUT `.default()` (the
// volatile wrapper swallows defaults, and the read site already treats
// `undefined` as on) — and volatility now comes from `EDITABLE_CONFIG_KEYS`,
// which is derived from `SETTING_DEFINITIONS`, where `recapOnOpen` is listed.
// The patch was therefore RETIRED rather than re-ported (see CUSTOMIZATIONS.md
// §2, retired list); this test now pins the STOCK contract, so the next upgrade
// that drops the key or its volatility fails here instead of silently turning
// auto-recap back on.
//
// It drives the REAL schema from the installed package (no TUI, no writes) and
// asserts what the settings service depends on:
//
//   * the key exists and is volatile — that is exactly what `write()` validates;
//   * an explicit `{ recapOnOpen: false }` survives parsing, which is what the
//     read consumes (volatile fields resolve to a live ref; `configValues`
//     calls `.get()` on it, so the test does the same);
//   * an unset key does NOT read as `false`: `undefined` is upstream's "on"
//     (both a `.default(true)` and a bare boolean satisfy `!== false`);
//   * the settings row and the read are still in place (the field is only
//     meaningful together with them).

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

/** Volatile fields resolve to a live ref; the settings service unwraps it. */
const valueOf = field => (typeof field?.get === 'function' ? field.get() : field);
const resolved = Config({});
check(valueOf(resolved.recapOnOpen) !== false,
  'an unset config still reads as recap on (undefined, or a true default)');
const off = Config({ recapOnOpen: false });
check(valueOf(off.recapOnOpen) === false,
  'an explicit false survives parsing — this is the value channel.ts reads');

// The field only means something next to the row that edits it and the read
// that consumes it; a future upstream move must fail here, not silently.
// 0.11.2 spells the row `...settingField('recapOnOpen')`; both spellings mean
// `path: ['recapOnOpen']` at runtime, so accept either.
const plugin = readFileSync(join(TUI, 'lib/types/dsh-adapter/plugin.js'), 'utf8');
check(plugin.includes("settingField('recapOnOpen')") || plugin.includes("path: ['recapOnOpen']"),
  'the /settings row still exists');
const definitions = readFileSync(join(TUI, 'lib/types/settings/definitions.js'), 'utf8');
check(/^\s{4}'?recapOnOpen'?:/m.test(definitions),
  'SETTING_DEFINITIONS still lists recapOnOpen (the row metadata and EDITABLE_CONFIG_KEYS source)');
const channel = readFileSync(join(TUI, 'lib/types/dsh-adapter/channel.js'), 'utf8');
check(channel.includes('ns?.value?.recapOnOpen !== false'),
  'the auto-recap read still consumes the setting');

report(failures === 0
  ? '\nPASS: recapOnOpen is a declared, volatile, persisted TUI setting (stock upstream again).'
  : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
