import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DATA_DIR } from './utils/paths.js';
const HISTORY_DIR = DATA_DIR;
const HISTORY_FILE = join(HISTORY_DIR, 'history.jsonl');
const HISTORY_LOCK = `${HISTORY_FILE}.lock`;
const HISTORY_LIMIT = 200;
const LOCK_RETRY_LIMIT = 500;
const LOCK_RETRY_DELAY_MS = 5;
const STALE_LOCK_MS = 30_000;
async function removeStaleHistoryLock() {
    try {
        const ageMs = Date.now() - (await stat(HISTORY_LOCK)).mtimeMs;
        if (ageMs < STALE_LOCK_MS)
            return false;
        await rm(HISTORY_LOCK, { recursive: true, force: true });
        return true;
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT')
            return true;
        throw error;
    }
}
async function withHistoryLock(write) {
    // 0700: history.jsonl holds the user's raw inputs (incl. pasted secrets),
    // so the directory must not be group/world-readable. Mode applies to the
    // creation only; pre-existing dirs are left as-is (no migration chmod).
    await mkdir(HISTORY_DIR, { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < LOCK_RETRY_LIMIT; attempt += 1) {
        try {
            await mkdir(HISTORY_LOCK);
            try {
                await write();
            }
            finally {
                await rm(HISTORY_LOCK, { recursive: true, force: true });
            }
            return;
        }
        catch (error) {
            const code = error.code;
            if (code !== 'EEXIST')
                throw error;
            if (await removeStaleHistoryLock())
                continue;
            await delay(LOCK_RETRY_DELAY_MS + Math.floor(Math.random() * 5));
        }
    }
    throw new Error('history lock busy');
}
function parseRaw(raw) {
    const entries = [];
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        try {
            const parsed = JSON.parse(trimmed);
            if (typeof parsed.text === 'string' && parsed.text.length > 0) {
                // `cwd` arrives with entries written after directory scoping;
                // older lines carry none and stay available as a fallback pool.
                entries.push(typeof parsed.cwd === 'string' && parsed.cwd.length > 0
                    ? { text: parsed.text, ts: typeof parsed.ts === 'number' ? parsed.ts : 0, cwd: parsed.cwd }
                    : { text: parsed.text, ts: typeof parsed.ts === 'number' ? parsed.ts : 0 });
            }
        }
        catch {
            // Skip malformed lines; the file is best-effort.
        }
    }
    return entries;
}
function loadRaw() {
    if (!existsSync(HISTORY_FILE))
        return [];
    try {
        return parseRaw(readFileSync(HISTORY_FILE, 'utf8'));
    }
    catch {
        return [];
    }
}
async function loadRawAsync() {
    try {
        return parseRaw(await readFile(HISTORY_FILE, 'utf8'));
    }
    catch {
        return [];
    }
}
async function persistEntry(trimmed, cwd) {
    try {
        await withHistoryLock(async () => {
            const entries = await loadRawAsync();
            // Skip consecutive duplicates (repeated submits of the same
            // command only advance the existing entry's timestamp). The
            // directory has to match too: the same text submitted elsewhere is
            // a separate entry, and folding it into the previous one would
            // leave that entry tagged with the wrong directory.
            const last = entries[entries.length - 1];
            if (last && last.text === trimmed && last.cwd === cwd) {
                last.ts = Date.now();
            }
            else {
                entries.push(cwd ? { text: trimmed, ts: Date.now(), cwd } : { text: trimmed, ts: Date.now() });
            }
            const sliced = entries.slice(-HISTORY_LIMIT);
            // Atomic replace: a direct async overwrite exposes truncated bytes to
            // the synchronous loadHistory() mid-write (review finding). Same-dir
            // temp file + rename is atomic on POSIX and Windows alike; the temp
            // keeps mode 0600 — entries carry the full user input text.
            const tmpFile = `${HISTORY_FILE}.${process.pid}.tmp`;
            try {
                await writeFile(tmpFile, sliced.map(e => JSON.stringify(e)).join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
                await rename(tmpFile, HISTORY_FILE);
            }
            finally {
                // A failed rename would otherwise leave the user's raw input behind in
                // the temp file, which appendHistory's best-effort catch swallows.
                await rm(tmpFile, { force: true });
            }
        });
    }
    catch {
        // Best-effort persistence; history still works for the session.
    }
}
/**
 * Serializes local appends. The file lock only orders writers across
 * processes; without this chain two rapid submits can reach it in either
 * order and loadHistory() would show them reversed.
 */
let appendChain = Promise.resolve();
/**
 * Append an input to the persisted history, deduping the immediately
 * previous entry and capping the file at 200 entries.
 * @param text - Input to persist; blank inputs are ignored.
 * @param cwd - Directory the input was submitted in; tags the entry so reads
 * can scope to it. Entries appended without one stay untagged (legacy/global).
 * @returns Resolves once this entry is persisted; callers on the input path
 * intentionally discard it because persistence is best-effort.
 */
export function appendHistory(text, cwd) {
    const trimmed = text.trim();
    if (!trimmed)
        return Promise.resolve();
    const queued = appendChain.then(() => persistEntry(trimmed, cwd));
    // persistEntry never rejects, but keep the chain alive regardless so one
    // failure cannot stall every later append.
    appendChain = queued.catch(() => { });
    return queued;
}
/**
 * Read the persisted history, newest first, scoped to one working directory.
 *
 * Entries are tagged with the directory they were submitted in, and a scoped
 * read returns that directory's entries only — the same isolation the resume
 * browser has. Entries written before the tagging carry no directory: while the
 * requested directory has none of its own they are returned as a fallback, so a
 * directory that has not been used yet still offers a usable ↑/↓ instead of an
 * empty list. Once the directory has entries of its own the fallback pool drops
 * out, so another directory's commands can never leak in permanently.
 *
 * @param cwd - Directory to scope to; omit to read every entry unscoped.
 * @returns The matching entries in reverse-chronological order.
 */
export function loadHistory(cwd) {
    const entries = loadRaw().reverse();
    if (!cwd)
        return entries;
    const scoped = entries.filter(entry => entry.cwd === cwd);
    if (scoped.length > 0)
        return scoped;
    return entries.filter(entry => entry.cwd === undefined);
}
/**
 * Stable id for a history entry (keeps React keys distinct across identical texts).
 * @param entry - The history entry to hash.
 * @param index - Position in the currently rendered result list.
 * @returns A 12-char hex id derived from the entry text, timestamp, and index.
 */
export function historyEntryId(entry, index = 0) {
    return createHash('sha1').update(`${entry.text}\0${entry.ts}\0${index}`).digest('hex').slice(0, 12);
}
