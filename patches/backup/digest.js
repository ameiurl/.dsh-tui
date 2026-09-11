/**
 * What a bounded read can learn about a session log.
 *
 * Two windows, one at each end, and never anything in between:
 *
 * - The HEAD normally holds the session envelope, boot policy events, and the
 *   opening prompt. Measured across a real corpus, the first user prompt lands
 *   within 8,107 bytes of the start (524 in its `agent/inbox/spliced` form),
 *   so a 64 KB window is the cheap path. A larger modern context prefix can
 *   exceed it; listSummaries detects that inconclusive fallback and invokes the
 *   progressive opening scan below instead of caching a cwd basename forever.
 * - The TAIL holds whatever was appended most recently: the current title
 *   (titles are re-emitted, and the last one wins), the model of the last
 *   request, and the last exchanges for the preview.
 *
 * Titles carry their own provenance, so this module does not have to guess.
 * A title written by a provider records `source.kind: 'provider'`; the TUI's
 * own rename paths append `{ title }` with no source at all. That difference
 * is the evidence behind {@link SessionTitle.source}, which is why the picker
 * can dim a fallback and explain a name instead of merely displaying one.
 *
 * A filesystem address is never allowed to BECOME a title (see
 * {@link isFileAddress}): a path pasted as the opening message is stepped over,
 * the scan keeps looking for the first real words, and the directory basename
 * stays the last resort. The order mirrors Claude Code's title chain — its
 * custom/AI title, then a recent prompt, then the first prompt, then a last
 * resort of its own — minus the model call, because a provider-written title
 * already arrives here as a `session/title` event.
 *
 * @module @deepseek-harness-tui/dsh-tui/sessions/digest
 */
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { basename } from 'node:path';
import { scheduler } from 'node:timers/promises';
import { decodeFrame, decodeFrames, decodeTail, readWindow, resyncFrames, walkFrames } from './frames.js';
/** Head window budget. Eight times the measured worst-case prompt offset. */
export const HEAD_WINDOW_BYTES = 64 * 1024;
/** Head frame ceiling — a cost bound independent of how the bytes compress. */
export const HEAD_MAX_FRAMES = 128;
/** Tail window budget. Wider than the head: trailing frames carry payloads. */
export const TAIL_WINDOW_BYTES = 128 * 1024;
/** Compressed bytes read per progressive title-scan page. */
const TITLE_SCAN_PAGE_BYTES = 128 * 1024;
/** Largest compressed frame the fallback scanner will materialize. */
const TITLE_SCAN_MAX_FRAME_BYTES = 16 * 1024 * 1024;
/** Prefix suffix hashed to verify append-only growth across revisions. */
const TITLE_ANCHOR_BYTES = 256;
/** Longest preview excerpt kept per message, in characters. */
const PREVIEW_CHARS = 400;
/** Longest recent-prompt title kept, in characters — the width Claude Code's
 *  own last-prompt fallback normalizes to before its ellipsis. */
const LAST_PROMPT_TITLE_CHARS = 200;
/** The first text block of a message `content` payload. */
function textOfContent(content) {
    if (typeof content === 'string')
        return content.trim() || undefined;
    if (!Array.isArray(content))
        return undefined;
    for (const block of content) {
        if (block === null || typeof block !== 'object')
            continue;
        const record = block;
        if (record['type'] !== 'text')
            continue;
        const value = record['text'];
        if (typeof value === 'string' && value.trim().length > 0)
            return value.trim();
    }
    return undefined;
}
/**
 * Whether a message's `source` marks it as typed by the person at the
 * keyboard. Plugin injections, instruction snapshots, skill catalogues and
 * sub-agent reports all arrive as user-role messages too, and counting them
 * would report a conversation where none happened.
 */
function isHumanSource(source) {
    if (source === undefined || source === null)
        return true;
    if (typeof source !== 'object')
        return false;
    return source['kind'] === 'user';
}
/** The human prompt carried by one log line, in either of its two forms. */
function humanPrompt(line) {
    const data = line['data'];
    if (data === null || typeof data !== 'object')
        return undefined;
    const record = data;
    if (line['type'] === 'user/message') {
        return isHumanSource(record['source']) ? textOfContent(record['content']) : undefined;
    }
    // The inbox splice precedes the durable user/message and reaches the log
    // several frames earlier, which is what keeps the head window small.
    if (line['type'] === 'agent/inbox/spliced') {
        const inserted = record['inserted'];
        if (!Array.isArray(inserted))
            return undefined;
        for (const message of inserted) {
            if (message === null || typeof message !== 'object')
                continue;
            const entry = message;
            if (entry['role'] !== 'user' || !isHumanSource(entry['source']))
                continue;
            const text = textOfContent(entry['content']);
            if (text !== undefined)
                return text;
        }
    }
    return undefined;
}
/**
 * Whether a title candidate is nothing but a filesystem address.
 *
 * A picker title answers "is this the conversation I mean". A path that was
 * pasted, dropped, or `@`-mentioned as the opening message answers nothing:
 * the same file shows up in every session that ever touched it, so the address
 * uses the row without naming anything. So an address is not a title
 * candidate — the scans below step over it and keep looking for the first
 * opening words that are words.
 *
 * Only a candidate that is an address END TO END is refused. A real sentence
 * that merely mentions a path (`@src/views/Setting.vue 互转方向更改`) is the
 * session speaking, which is exactly what a prompt-sourced title is for.
 *
 * An address is still EVIDENCE of a conversation when it is the only human
 * input, so callers track "a prompt was seen" separately from the title
 * candidate: emptiness stays a fact about the log, never about the wording.
 */
function isFileAddress(text) {
    const value = text.trim();
    if (value.length === 0)
        return false;
    // Anchored forms are addresses even when they contain spaces.
    if (/^(?:~[\\/]|\.{1,2}[\\/]|[\\/])/.test(value))
        return true;
    if (/^[A-Za-z]:[\\/]/.test(value))
        return true;
    if (/^@\S+$/.test(value))
        return true;
    // An unanchored relative path is an address only when it cannot be prose:
    // one token, carrying a letter (so `2024/09/11` stays a title) and either a
    // file extension or two levels of separators (`src/views/Setting`).
    if (/\s/.test(value) || !/\p{L}/u.test(value) || !/[\\/]/.test(value))
        return false;
    return /[\\/][^\\/]*\.\w{1,8}$/.test(value) || (value.match(/[\\/]/g) ?? []).length >= 2;
}
/**
 * A recent prompt rendered on one line, the way Claude Code normalizes its own
 * last-prompt fallback: newlines folded to spaces, trimmed, and clipped to
 * {@link LAST_PROMPT_TITLE_CHARS} with an ellipsis. A multi-line prompt would
 * otherwise wrap the picker row it is standing in for.
 */
function normalizeLastPrompt(text) {
    const folded = text.replaceAll('\n', ' ').trim();
    return folded.length > LAST_PROMPT_TITLE_CHARS
        ? `${folded.slice(0, LAST_PROMPT_TITLE_CHARS).trim()}…`
        : folded;
}
/**
 * The most recent human prompt that could stand in as a title, or undefined.
 *
 * This is the picker's last level before the working directory's basename, and
 * it exists for the same reason Claude Code keeps a `lastPrompt` in its title
 * chain: the words a person typed later in the session describe it better than
 * the name of the folder it happened to run in. Scanned backwards so the
 * newest eligible prompt wins; addresses are still refused (isFileAddress).
 */
function lastEligiblePrompt(lines) {
    for (let at = lines.length - 1; at >= 0; at -= 1) {
        const found = humanPrompt(lines[at]);
        if (found !== undefined && !isFileAddress(found))
            return normalizeLastPrompt(found);
    }
    return undefined;
}
/** A `session/title` payload, with the provenance that classifies it. */
function titleOf(line) {
    if (line['type'] !== 'session/title')
        return undefined;
    const data = line['data'];
    if (data === null || typeof data !== 'object')
        return undefined;
    const record = data;
    const text = record['title'];
    if (typeof text !== 'string' || text.trim().length === 0)
        return undefined;
    const source = record['source'];
    const byProvider = source !== null &&
        typeof source === 'object' &&
        source['kind'] === 'provider';
    return { text: text.trim(), source: byProvider ? 'auto' : 'renamed' };
}
/** The route recorded by a `request/context` event. */
function modelOf(line) {
    if (line['type'] !== 'request/context')
        return undefined;
    const data = line['data'];
    if (data === null || typeof data !== 'object')
        return undefined;
    const model = data['model'];
    return typeof model === 'string' && model.length > 0 ? model : undefined;
}
/** The label a delegated run was started under. */
function labelOf(line) {
    if (line['type'] !== 'subagent/descriptor')
        return undefined;
    const data = line['data'];
    if (data === null || typeof data !== 'object')
        return undefined;
    const label = data['label'];
    return typeof label === 'string' && label.trim().length > 0 ? label.trim() : undefined;
}
/** Epoch-ms of a log line, when it carries one. */
function timeOf(line) {
    const time = line['time'];
    return typeof time === 'number' && Number.isFinite(time) ? time : undefined;
}
/**
 * Read both windows of one session log.
 *
 * The title resolves through Claude Code's chain, deterministic levels only:
 * the last `session/title` event wins; else the first opening prompt that is
 * neither an address nor nothing; else the most recent such prompt; else the
 * working directory's basename. (Claude's first level is a model-written
 * title, which reaches dsh-tui as a provider `session/title` event, so the two
 * chains agree from the top.)
 *
 * @param path - Absolute artifact path.
 * @param cwd - Working directory, for the last-resort title.
 * @returns The digest. An unreadable log still yields a usable record: the
 *   title falls back to the directory basename and says so through its source.
 */
export function digestSession(path, cwd) {
    const head = readWindow(path, HEAD_WINDOW_BYTES);
    if (head === undefined) {
        return { title: undefined, hasPrompt: false, model: undefined, label: undefined };
    }
    const headLines = decodeFrames(head.buffer, walkFrames(head.buffer, 0, HEAD_MAX_FRAMES));
    let prompt;
    let sawPrompt = false;
    let headTitle;
    let label;
    for (const line of headLines) {
        const found = humanPrompt(line);
        if (found !== undefined) {
            sawPrompt = true;
            // An address is not a title candidate: keep scanning the window
            // for the first opening words that are (see isFileAddress).
            if (prompt === undefined && !isFileAddress(found))
                prompt = found;
        }
        headTitle ??= titleOf(line);
        label ??= labelOf(line);
    }
    // Absence of a prompt only means "empty" when the window actually saw the
    // whole log. A log too large for the window has a conversation in it by
    // construction, and erring toward listing it is the safe direction: hiding
    // a real session is a defect, showing a boot artifact is a nuisance. An
    // address-only opening counts here too — it is input, just not a title.
    const hasPrompt = sawPrompt || !head.whole;
    // A head window that already covered the whole log IS the tail.
    const tail = head.whole ? undefined : readWindow(path, TAIL_WINDOW_BYTES, true);
    const tailLines = tail === undefined ? headLines : decodeTail(tail);
    let tailTitle;
    let model;
    for (const line of tailLines) {
        const title = titleOf(line);
        if (title !== undefined)
            tailTitle = title;
        const route = modelOf(line);
        if (route !== undefined)
            model = route;
    }
    const resolved = tailTitle ??
        headTitle ??
        (prompt === undefined ? undefined : { text: prompt, source: 'prompt' });
    // The last level before the directory basename, borrowed from Claude
    // Code's chain: when the opening never yielded a title — an address-only
    // opening, or a head window that missed the prompt — the newest real words
    // in the log beat the folder's name. Paid for only when the levels above
    // came up empty, so an ordinary session reads no more of its log than
    // before.
    const recent = resolved === undefined ? lastEligiblePrompt(tailLines) : undefined;
    return {
        title: resolved ?? (recent === undefined
            ? { text: basename(cwd), source: 'fallback' }
            : { text: recent, source: 'prompt' }),
        hasPrompt,
        model,
        label,
        ...(!head.whole && tailTitle === undefined ? {} : { titleComplete: true }),
    };
}
/** Read exactly one stable range from an already-open snapshot. */
async function readRange(handle, start, length, signal) {
    const buffer = Buffer.allocUnsafe(length);
    let filled = 0;
    while (filled < length) {
        signal?.throwIfAborted();
        let bytesRead;
        try {
            const result = await handle.read(buffer, filled, length - filled, start + filled);
            bytesRead = result.bytesRead;
        }
        catch {
            signal?.throwIfAborted();
            return undefined;
        }
        if (bytesRead === 0)
            return undefined;
        filled += bytesRead;
    }
    return buffer;
}
/** A forward page beginning on a known frame boundary. */
async function forwardPage(handle, start, end, signal) {
    const remaining = end - start;
    let length = Math.min(TITLE_SCAN_PAGE_BYTES, remaining);
    while (length > 0) {
        const buffer = await readRange(handle, start, length, signal);
        if (buffer === undefined)
            return undefined;
        const frames = walkFrames(buffer);
        if (frames.length > 0)
            return { buffer, frames };
        if (length >= remaining || length >= TITLE_SCAN_MAX_FRAME_BYTES)
            return undefined;
        length = Math.min(remaining, TITLE_SCAN_MAX_FRAME_BYTES, length * 2);
    }
    return undefined;
}
/** A reverse page ending on a known frame boundary. */
async function reversePage(handle, end, signal) {
    let length = Math.min(TITLE_SCAN_PAGE_BYTES, end);
    while (length > 0) {
        const start = end - length;
        const buffer = await readRange(handle, start, length, signal);
        if (buffer === undefined)
            return undefined;
        const frames = start === 0 ? walkFrames(buffer) : resyncFrames(buffer);
        const last = frames[frames.length - 1];
        if (last !== undefined && last.end === buffer.length)
            return { start, buffer, frames };
        if (length >= end || length >= TITLE_SCAN_MAX_FRAME_BYTES)
            return undefined;
        length = Math.min(end, TITLE_SCAN_MAX_FRAME_BYTES, length * 2);
    }
    return undefined;
}
/** Scan newest-to-oldest; the first title encountered is last-write-wins. */
async function recoverLatestTitle(path, bytes, signal) {
    signal?.throwIfAborted();
    let handle;
    try {
        handle = await open(path, 'r');
    }
    catch {
        signal?.throwIfAborted();
        return { title: undefined, complete: false };
    }
    try {
        let end = bytes;
        while (end > 0) {
            signal?.throwIfAborted();
            const page = await reversePage(handle, end, signal);
            if (page === undefined)
                return { title: undefined, complete: false };
            for (let frameIndex = page.frames.length - 1; frameIndex >= 0; frameIndex--) {
                const frame = page.frames[frameIndex];
                const lines = decodeFrame(page.buffer, frame);
                if (lines === undefined)
                    return { title: undefined, complete: false };
                for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex--) {
                    const title = titleOf(lines[lineIndex]);
                    if (title !== undefined)
                        return { title, complete: true };
                }
            }
            const nextEnd = page.start + page.frames[0].start;
            if (nextEnd >= end)
                return { title: undefined, complete: false };
            end = nextEnd;
            await scheduler.yield();
        }
        return { title: undefined, complete: true };
    }
    finally {
        await handle.close().catch(() => { });
    }
}
/** Scan from a known frame boundary through an append-only suffix. */
export async function recoverAppendedTitle(path, start, end, signal) {
    signal?.throwIfAborted();
    let handle;
    try {
        handle = await open(path, 'r');
    }
    catch {
        signal?.throwIfAborted();
        return { title: undefined, complete: false };
    }
    let latest;
    try {
        let position = start;
        while (position < end) {
            signal?.throwIfAborted();
            const page = await forwardPage(handle, position, end, signal);
            if (page === undefined)
                return { title: latest, complete: false };
            for (const frame of page.frames) {
                const lines = decodeFrame(page.buffer, frame);
                if (lines === undefined)
                    return { title: latest, complete: false };
                for (const line of lines) {
                    latest = titleOf(line) ?? latest;
                }
            }
            const consumed = page.frames[page.frames.length - 1].end;
            if (consumed <= 0)
                return { title: latest, complete: false };
            position += consumed;
            await scheduler.yield();
        }
        return { title: latest, complete: true };
    }
    finally {
        await handle.close().catch(() => { });
    }
}
/**
 * Find the first human prompt after a complete reverse scan proved no title.
 *
 * The prompt returned is the first one that is not a filesystem address (see
 * isFileAddress) — an address-only opening is skipped, and the scan keeps
 * going. `hasPrompt` reports whether the log held ANY human prompt, so a
 * conversation that opened with nothing but a path is still a conversation.
 */
async function recoverFirstPrompt(path, bytes, signal) {
    signal?.throwIfAborted();
    let handle;
    try {
        handle = await open(path, 'r');
    }
    catch {
        signal?.throwIfAborted();
        return { prompt: undefined, hasPrompt: undefined, complete: false };
    }
    try {
        let position = 0;
        let sawPrompt = false;
        while (position < bytes) {
            signal?.throwIfAborted();
            const page = await forwardPage(handle, position, bytes, signal);
            if (page === undefined)
                return { prompt: undefined, hasPrompt: undefined, complete: false };
            for (const frame of page.frames) {
                const lines = decodeFrame(page.buffer, frame);
                if (lines === undefined)
                    return { prompt: undefined, hasPrompt: undefined, complete: false };
                for (const line of lines) {
                    const found = humanPrompt(line);
                    if (found === undefined)
                        continue;
                    sawPrompt = true;
                    if (isFileAddress(found))
                        continue;
                    return { prompt: found, hasPrompt: true, complete: true };
                }
            }
            const consumed = page.frames[page.frames.length - 1].end;
            if (consumed <= 0)
                return { prompt: undefined, hasPrompt: undefined, complete: false };
            position += consumed;
            await scheduler.yield();
        }
        return { prompt: undefined, hasPrompt: sawPrompt, complete: true };
    }
    finally {
        await handle.close().catch(() => { });
    }
}
/**
 * Recover the authoritative display title for one immutable file snapshot:
 * reverse scan for the LAST title, then (only when none exists) forward scan
 * for the FIRST human prompt. Both directions page on verified frame boundaries.
 */
export async function recoverSessionTitle(path, bytes, signal) {
    const latest = await recoverLatestTitle(path, bytes, signal);
    if (latest.title !== undefined || !latest.complete)
        return latest;
    const opening = await recoverFirstPrompt(path, bytes, signal);
    return {
        title: opening.prompt === undefined ? undefined : { text: opening.prompt, source: 'prompt' },
        complete: opening.complete,
        ...(opening.complete ? { hasPrompt: opening.hasPrompt === true } : {}),
    };
}
/** Hash the previous EOF neighborhood before carrying title evidence forward. */
export async function sessionTitleAnchor(path, bytes, signal) {
    signal?.throwIfAborted();
    let handle;
    try {
        handle = await open(path, 'r');
    }
    catch {
        signal?.throwIfAborted();
        return undefined;
    }
    try {
        const length = Math.min(TITLE_ANCHOR_BYTES, bytes);
        const buffer = length === 0 ? Buffer.alloc(0) : await readRange(handle, bytes - length, length, signal);
        if (buffer === undefined)
            return undefined;
        return createHash('sha256').update(buffer).digest('hex');
    }
    finally {
        await handle.close().catch(() => { });
    }
}
/**
 * The last exchanges of a session, for the browser's preview pane.
 *
 * Bounded like everything else here: the preview shows the end of the
 * conversation because that is what the tail window holds, and because the end
 * is what tells you whether this is the session you meant.
 *
 * @param path - Absolute artifact path.
 * @param limit - How many entries to keep, newest last.
 * @returns Entries in log order.
 */
export function previewSession(path, limit) {
    const window = readWindow(path, TAIL_WINDOW_BYTES, true);
    if (window === undefined)
        return [];
    const lines = decodeTail(window);
    const entries = [];
    for (const line of lines) {
        const data = line['data'];
        if (data === null || typeof data !== 'object')
            continue;
        const record = data;
        if (line['type'] === 'user/message') {
            if (!isHumanSource(record['source']))
                continue;
            const text = textOfContent(record['content']);
            if (text !== undefined)
                entries.push({ role: 'user', text: text.slice(0, PREVIEW_CHARS), at: timeOf(line) });
            continue;
        }
        if (line['type'] === 'assistant/message') {
            const message = record['message'];
            if (message === null || typeof message !== 'object')
                continue;
            const text = textOfContent(message['content']);
            if (text !== undefined) {
                entries.push({ role: 'assistant', text: text.slice(0, PREVIEW_CHARS), at: timeOf(line) });
            }
        }
    }
    return entries.slice(-limit);
}
