/**
 * What a bounded read can learn about a session log.
 *
 * Two windows, one at each end, and never anything in between:
 *
 * - The HEAD normally holds the session envelope, boot policy events, and the
 *   opening prompt. Measured across a real corpus, the first user prompt lands
 *   within 8,107 bytes of the start (524 in its `agent/inbox/spliced` form),
 *   so a 64 KB window is the cheap path. A larger modern context prefix can
 *   exceed it; listSummaries schedules the progressive opening scan below
 *   after returning the immediately usable session list.
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
 * @module @deepseek-harness-tui/dsh-tui/sessions/digest
 */
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { basename } from 'node:path';
import { scheduler } from 'node:timers/promises';
import { decodeFrame, decodeTail, readWindow, resyncFrames, walkFrames } from './frames.js';
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
/** Old EOF neighborhood hashed for the JSONL backend's append-only contract. */
const TITLE_ANCHOR_BYTES = 256;
/** Longest preview excerpt kept per message, in characters. */
const PREVIEW_CHARS = 400;
/** Longest prompt-derived title, matching Claude Code's own `lastPrompt` cap. */
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
/** A human message is conversation evidence even when it has no title text. */
function humanPrompt(line) {
    const data = line['data'];
    if (data === null || typeof data !== 'object')
        return undefined;
    const record = data;
    if (line['type'] === 'user/message') {
        return isHumanSource(record['source']) ? { text: textOfContent(record['content']) } : undefined;
    }
    // The inbox splice precedes the durable user/message and reaches the log
    // several frames earlier, which is what keeps the head window small.
    if (line['type'] === 'agent/inbox/spliced') {
        const inserted = record['inserted'];
        if (!Array.isArray(inserted))
            return undefined;
        let found = false;
        for (const message of inserted) {
            if (message === null || typeof message !== 'object')
                continue;
            const entry = message;
            if (entry['role'] !== 'user' || !isHumanSource(entry['source']))
                continue;
            found = true;
            const text = textOfContent(entry['content']);
            if (text !== undefined)
                return { text };
        }
        if (found)
            return { text: undefined };
    }
    return undefined;
}
/** Whether a prompt is nothing but a filesystem address — never a name.
 *
 * Only a candidate that is an address END TO END is refused. A real sentence
 * that merely mentions a path (`@src/views/Setting.vue 互转方向更改`) is the
 * session speaking, which is exactly what a prompt-sourced title is for.
 *
 * An address is still EVIDENCE of a conversation when it is the only human
 * input, so callers track "a prompt was seen" separately from the title
 * candidate: emptiness stays a fact about the log, never about the wording.
 * That separation is what keeps such a session out of the destructive
 * empty-session clean-up.
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
/** A prompt rendered on one line the way Claude Code normalizes its own
 *  `lastPrompt` fallback: newlines folded to spaces, trimmed, and clipped to
 *  {@link LAST_PROMPT_TITLE_CHARS} with an ellipsis. A multi-line prompt would
 *  otherwise wrap the picker row it is standing in for.
 *
 *  Named for the level it was introduced for, but both prompt levels go
 *  through it: the opening prompt is a title candidate too, and it reaches the
 *  picker with exactly the same width budget. */
function normalizeLastPrompt(text) {
    const folded = text.replaceAll('\n', ' ').trim();
    return folded.length > LAST_PROMPT_TITLE_CHARS
        ? `${folded.slice(0, LAST_PROMPT_TITLE_CHARS).trim()}…`
        : folded;
}
/** The most recent human prompt in a window that could name the session, or
 *  undefined. Addresses are stepped over (see {@link isFileAddress}), so "most
 *  recent" means the most recent one worth showing.
 *
 *  This is Claude Code's `lastPrompt` level: the words a person typed last
 *  describe the session at least as well as the ones it opened with, which is
 *  why its chain asks for the recent prompt before the first one. Scanned
 *  backwards so the newest eligible prompt wins at the cost of one line in the
 *  common case. */
function lastPromptOf(lines) {
    for (let at = lines.length - 1; at >= 0; at -= 1) {
        const found = humanPrompt(lines[at]);
        if (found?.text !== undefined && !isFileAddress(found.text))
            return normalizeLastPrompt(found.text);
    }
    return undefined;
}
/** A `session/title` payload, with the provenance that classifies it.
 *
 * Three provenances write this event, and only two of them NAME anything:
 *
 * - `provider` — a model wrote the title. The strongest name there is.
 * - `user`, or no source at all (the older rename shape) — a person decided
 *   this name, so it outranks anything derived from a prompt.
 * - `fallback` — dsh's deterministic placeholder: it is the FIRST human prompt,
 *   truncated to a word/byte cap and appended so a session is never nameless.
 *   That is a prompt wearing a title's clothes, so it is not a title candidate
 *   here (`strong: false`). Taking it would resurrect exactly the text the
 *   prompt levels below already normalize, clip and address-filter — and it
 *   would outrank a provider title written later, which is how a `/resume` row
 *   came to show a truncated file path (`@modules/client/…/A`) instead of a
 *   name, with every session that opened on the same file looking identical. */
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
    const kind = source !== null && typeof source === 'object' ? source['kind'] : undefined;
    return {
        text: text.trim(),
        source: kind === 'provider' ? 'auto' : 'renamed',
        strong: kind !== 'fallback',
    };
}
/** A title candidate in the shape callers may store: text and provenance only.
 *  `strong` is this module's own classification (see {@link titleOf}) and never
 *  leaves it — a cache entry must not carry a field no reader knows about. */
function asTitle(title) {
    return { text: title.text, source: title.source };
}
/** Request headers own the route; context events support historical logs. */
function modelOf(line) {
    const data = line['data'];
    if (data === null || typeof data !== 'object')
        return undefined;
    const record = data;
    let model;
    if (line['type'] === 'request/header') {
        const header = record['header'];
        model = header?.config?.model;
    }
    else if (line['type'] === 'request/context')
        model = record['model'];
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
 * @param path - Absolute artifact path.
 * @param cwd - Working directory, for the last-resort title.
 * @returns The digest. An unreadable log still yields a usable record: the
 *   title falls back to the directory basename and says so through its source.
 */
export function digestSession(path, cwd) {
    const head = readWindow(path, HEAD_WINDOW_BYTES);
    if (head === undefined) {
        return { title: undefined, hasPrompt: true, model: undefined, label: undefined };
    }
    const headFrames = walkFrames(head.buffer, 0, HEAD_MAX_FRAMES);
    const headLines = [];
    let completeHead = head.whole && headFrames.at(-1)?.end === head.buffer.length;
    for (const frame of headFrames) {
        const lines = decodeFrame(head.buffer, frame);
        if (lines === undefined)
            completeHead = false;
        else
            headLines.push(...lines);
    }
    completeHead &&= headLines[0]?.['type'] === 'session';
    let opening;
    let hasHumanMessage = false;
    let headTitle;
    let label;
    for (const line of headLines) {
        const human = humanPrompt(line);
        // Any human message at all — prose, a pasted path, or an image with no
        // text — is evidence that this log holds a conversation. Only `opening`
        // has to be able to NAME it, and an address cannot (isFileAddress): it
        // is input, just not a title.
        hasHumanMessage ||= human !== undefined;
        if (opening === undefined && human?.text !== undefined && !isFileAddress(human.text))
            opening = normalizeLastPrompt(human.text);
        const title = titleOf(line);
        if (title?.strong === true)
            headTitle ??= title;
        label ??= labelOf(line);
    }
    // The byte window, frame limit, decoding and parsing must ALL cover the
    // log before absence proves emptiness. Unknown is visible, never eligible
    // for destructive cleanup; title text is not required for image-only input.
    const hasPrompt = hasHumanMessage || !completeHead;
    // Only a completely decoded head can stand in for the tail.
    const tail = completeHead ? undefined : readWindow(path, TAIL_WINDOW_BYTES, true);
    const tailLines = tail === undefined ? headLines : decodeTail(tail);
    let tailTitle;
    let model;
    for (const line of tailLines) {
        const title = titleOf(line);
        if (title?.strong === true)
            tailTitle = title;
        const route = modelOf(line);
        if (route !== undefined)
            model = route;
    }
    const titled = tailTitle ?? headTitle;
    // Claude Code's chain asks for the recent prompt BEFORE the opening one, and
    // only once no name was written at all — so the backwards scan is never paid
    // for by a session that already has one. Both prompt levels refuse
    // addresses; when neither has anything to offer, the directory name is still
    // a name, while a path never was one.
    const recent = titled === undefined ? lastPromptOf(tailLines) : undefined;
    const named = recent ?? opening;
    return {
        title: titled === undefined
            ? (named === undefined ? { text: basename(cwd), source: 'fallback' } : { text: named, source: 'prompt' })
            : asTitle(titled),
        hasPrompt,
        model,
        modelComplete: model !== undefined || completeHead,
        label,
        // A completely decoded head saw every event there is. Otherwise the tail
        // must have produced the winning NAME: a tail holding only a placeholder
        // (or none at all) leaves an unseen middle event free to supersede the
        // prompt-derived name, which is what the deep scan is for.
        ...(completeHead || tailTitle !== undefined ? { titleComplete: true } : {}),
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
/** One newest-to-oldest pass; each wanted fact is last-write-wins and
 *  conclusive once found.
 *
 *  The same pass also records the most recent human prompt worth showing, for
 *  the caller that finds no title at all: the deep scan and the cheap
 *  head/tail read must name a session identically, so the backwards walk that
 *  is already running collects it. Addresses are stepped over
 *  ({@link isFileAddress}) and the text is normalized like Claude's
 *  `lastPrompt`. dsh's deterministic `fallback` placeholder is not a title
 *  ({@link titleOf}), so it never ends the walk. */
async function recoverLatestMetadata(path, bytes, want, signal) {
    signal?.throwIfAborted();
    let title;
    let model;
    let recent;
    let hasPrompt;
    let titleDone = !want.title;
    let modelDone = !want.model;
    // A walk that stopped early reports neither `recent` nor `hasPrompt`: they
    // are facts about the WHOLE log, and a torn frame proves nothing about the
    // part it hid.
    const partial = () => ({ title, titleComplete: titleDone, model, modelComplete: modelDone });
    const settled = () => ({
        title,
        titleComplete: true,
        model,
        modelComplete: modelDone || bytes > 0,
        recent,
        hasPrompt: hasPrompt === true,
    });
    let handle;
    try {
        handle = await open(path, 'r');
    }
    catch {
        signal?.throwIfAborted();
        return partial();
    }
    try {
        let end = bytes;
        while (end > 0 && !(titleDone && modelDone)) {
            signal?.throwIfAborted();
            const page = await reversePage(handle, end, signal);
            if (page === undefined)
                return partial();
            for (let frameIndex = page.frames.length - 1; frameIndex >= 0 && !(titleDone && modelDone); frameIndex--) {
                const lines = decodeFrame(page.buffer, page.frames[frameIndex]);
                if (lines === undefined)
                    return partial();
                for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex--) {
                    const line = lines[lineIndex];
                    if (!titleDone) {
                        const found = titleOf(line);
                        if (found?.strong === true) {
                            title = found;
                            titleDone = true;
                        }
                    }
                    if (want.title && recent === undefined) {
                        const human = humanPrompt(line);
                        if (human !== undefined) {
                            hasPrompt = true;
                            if (human.text !== undefined && !isFileAddress(human.text))
                                recent = normalizeLastPrompt(human.text);
                        }
                    }
                    if (!modelDone)
                        modelDone = (model = modelOf(line)) !== undefined;
                }
                // Proving no route needs the session header; title absence never did.
                if (!modelDone && page.start === 0 && frameIndex === 0 && lines[0]?.['type'] !== 'session') {
                    titleDone = true;
                    return partial();
                }
            }
            const nextEnd = page.start + page.frames[0].start;
            if (nextEnd >= end)
                return partial();
            end = nextEnd;
            await scheduler.yield();
        }
        return settled();
    }
    finally {
        await handle.close().catch(() => { });
    }
}
/** Scan all newly appended frames from the previous EOF frame boundary. */
export async function digestAppendedSuffix(path, start, end, signal) {
    signal?.throwIfAborted();
    let handle;
    try {
        handle = await open(path, 'r');
    }
    catch {
        signal?.throwIfAborted();
        return { title: undefined, model: undefined, label: undefined, hasHumanPrompt: false, complete: false };
    }
    let title;
    let model;
    let label;
    let hasHumanPrompt = false;
    const result = (complete) => ({ title, model, label, hasHumanPrompt, complete });
    try {
        let position = start;
        while (position < end) {
            signal?.throwIfAborted();
            const page = await forwardPage(handle, position, end, signal);
            if (page === undefined)
                return result(false);
            for (const frame of page.frames) {
                const lines = decodeFrame(page.buffer, frame);
                if (lines === undefined)
                    return result(false);
                for (const line of lines) {
                    const found = titleOf(line);
                    if (found?.strong === true)
                        title = found;
                    model = modelOf(line) ?? model;
                    label = labelOf(line) ?? label;
                    hasHumanPrompt ||= humanPrompt(line) !== undefined;
                }
            }
            const consumed = page.frames[page.frames.length - 1].end;
            if (consumed <= 0)
                return result(false);
            position += consumed;
            await scheduler.yield();
        }
        return result(true);
    }
    finally {
        await handle.close().catch(() => { });
    }
}
/** Find the first human prompt after a complete reverse scan proved no title. */
async function recoverFirstPrompt(path, bytes, signal) {
    signal?.throwIfAborted();
    let handle;
    try {
        handle = await open(path, 'r');
    }
    catch {
        signal?.throwIfAborted();
        return { prompt: undefined, complete: false };
    }
    try {
        let position = 0;
        let hasPrompt = false;
        while (position < bytes) {
            signal?.throwIfAborted();
            const page = await forwardPage(handle, position, bytes, signal);
            if (page === undefined)
                return { prompt: undefined, complete: false };
            for (const frame of page.frames) {
                const lines = decodeFrame(page.buffer, frame);
                if (lines === undefined)
                    return { prompt: undefined, complete: false };
                if (position === 0 && frame.start === 0 && lines[0]?.['type'] !== 'session') {
                    return { prompt: undefined, complete: false };
                }
                for (const line of lines) {
                    const prompt = humanPrompt(line);
                    hasPrompt ||= prompt !== undefined;
                    // A path names no conversation: keep looking for a prompt
                    // that does, while the address still counts as evidence
                    // (hasPrompt above) so the session is not read as empty.
                    if (prompt?.text !== undefined && !isFileAddress(prompt.text))
                        return { prompt: prompt.text, complete: true, hasPrompt: true };
                }
            }
            const consumed = page.frames[page.frames.length - 1].end;
            if (consumed <= 0)
                return { prompt: undefined, complete: false };
            position += consumed;
            await scheduler.yield();
        }
        return { prompt: undefined, complete: bytes > 0, ...(bytes > 0 ? { hasPrompt } : {}) };
    }
    finally {
        await handle.close().catch(() => { });
    }
}
/** Fall back to a human prompt only after a complete scan proved no name was
 *  written: the same reverse walk's most recent eligible prompt first (Claude
 *  Code's `lastPrompt` level), then a forward scan for the first one. */
async function titleRecovery(latest, path, bytes, signal) {
    if (latest.title !== undefined || !latest.titleComplete)
        return { title: latest.title, complete: latest.titleComplete };
    if (latest.recent !== undefined) {
        return {
            title: { text: latest.recent, source: 'prompt' },
            complete: true,
            ...(latest.hasPrompt === undefined ? {} : { hasPrompt: latest.hasPrompt }),
        };
    }
    const opening = await recoverFirstPrompt(path, bytes, signal);
    return {
        title: opening.prompt === undefined ? undefined : { text: normalizeLastPrompt(opening.prompt), source: 'prompt' },
        complete: opening.complete,
        ...(opening.hasPrompt === undefined ? {} : { hasPrompt: opening.hasPrompt }),
    };
}
/**
 * Recover the requested display facts for one immutable file snapshot in a
 * single reverse pass: the LAST title and/or route, then (only when no title
 * exists) a forward scan for the FIRST human prompt. Pages stay on verified
 * frame boundaries.
 */
export async function recoverSessionMetadata(path, bytes, want, signal) {
    const latest = await recoverLatestMetadata(path, bytes, want, signal);
    return {
        ...(want.title ? { title: await titleRecovery(latest, path, bytes, signal) } : {}),
        ...(want.model ? { model: { model: latest.model, complete: latest.modelComplete } } : {}),
    };
}
/** Title-only recovery; see {@link recoverSessionMetadata}. */
export async function recoverSessionTitle(path, bytes, signal) {
    return titleRecovery(await recoverLatestMetadata(path, bytes, { title: true, model: false }, signal), path, bytes, signal);
}
/** Route-only recovery; absence is proven only by a complete scan reaching the session header. */
export async function recoverSessionModel(path, bytes, signal) {
    const latest = await recoverLatestMetadata(path, bytes, { title: false, model: true }, signal);
    return { model: latest.model, complete: latest.modelComplete };
}
/** Hash the previous EOF neighborhood; this detects replacement near the old tail. */
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
