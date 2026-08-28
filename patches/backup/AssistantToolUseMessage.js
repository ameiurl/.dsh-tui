import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import * as JsDiff from 'diff';
import { extname } from 'node:path';
import { Box, Text, useTerminalSize } from '../../ui.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { useAnimationFrame } from '../../ink/hooks/use-animation-frame.js';
import { ToolUseLoader } from '../ToolUseLoader.js';
import { SplitDiffView } from '../SplitDiffView.js';
import { SyntaxText } from '../SyntaxText.js';
import { formatDuration } from '../../cc/format.js';
/** Tool display names: DSH emits lowercase tool ids (`bash`); Claude Code
 *  shows capitalized names (`Bash`). Map the common ones, fall back to the
 *  id with its first letter uppercased. */
function displayName(name) {
    const KNOWN = {
        bash: 'Bash',
        powershell: 'PowerShell',
        read: 'Read',
        glob: 'Glob',
        grep: 'Grep',
        write: 'Write',
        edit: 'Edit',
        todo_write: 'TodoWrite',
        subagent: 'Task',
        web_search: 'WebSearch',
    };
    const mapped = KNOWN[name];
    if (mapped)
        return mapped;
    if (name.length === 0)
        return name;
    return name[0].toUpperCase() + name.slice(1);
}
function parseJsonArgs(args) {
    try {
        return JSON.parse(args);
    }
    catch {
        return undefined;
    }
}
function jsonArgsLanguage(args) {
    return parseJsonArgs(args) === undefined ? undefined : 'json';
}
function filePathFromTool(tool, view) {
    if (view !== undefined && 'path' in view && typeof view.path === 'string')
        return view.path;
    const parsed = parseJsonArgs(tool.argsFull ?? tool.argsText);
    if (parsed !== null && typeof parsed === 'object') {
        const record = parsed;
        for (const key of ['file_path', 'path'])
            if (typeof record[key] === 'string')
                return record[key];
    }
    return undefined;
}
function languageFromPath(path) {
    const language = path === undefined ? undefined : extname(path).slice(1).toLowerCase();
    return language === '' ? undefined : language;
}
/** CC's collapsed text body keeps 3 lines (renderTruncatedContent). */
const TEXT_BODY_MAX_LINES = 3;
/** Diff bodies are never folded: the full change is always shown (user
 *  preference — no hidden lines, no "+N lines" elision). Infinity keeps both
 *  the unified cap and SplitDiffView's maxRows uncapped. */
const DIFF_BODY_MAX_LINES = Infinity;
/** Minimum terminal width for the two-pane diff: below this the panes
 *  would squeeze under ~50 columns each and the unified view reads better. */
const SPLIT_DIFF_MIN_COLS = 110;
const GUTTER_FIRST = ' ⎿ ';
const GUTTER_REST = '   ';
const add = (text) => ({ text, tone: 'add' });
const del = (text) => ({ text, tone: 'del' });
const dim = (text) => ({ text, tone: 'dim' });
const plain = (text) => ({ text, tone: 'plain' });
/** Tool-name color by category (mist-blue accents): read/search tools keep
 *  the brand blue, file-mutating tools get the warm gold accent, exec /
 *  terminal tools get mist cyan. Exported for the subagent card, which
 *  mirrors the transcript tool-card name styling. */
const TOOL_NAME_MUTATE = new Set(['edit', 'write', 'multiedit', 'notebookedit']);
const TOOL_NAME_EXEC = new Set(['bash', 'bashpersistent', 'sh', 'shell', 'terminal']);
export function toolNameColor(raw) {
    const n = raw.toLowerCase();
    if (TOOL_NAME_MUTATE.has(n))
        return 'toolNameMutate';
    if (TOOL_NAME_EXEC.has(n))
        return 'toolNameExec';
    return 'claude';
}
/** One side's text → display lines (upstream contentLines rule: empty text
 *  is zero lines; a single trailing newline is a terminator, not a line;
 *  interior blanks survive). */
function sideLines(text) {
    if (text === '')
        return [];
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '')
        lines.pop();
    return lines;
}
/** Strip the shared leading whitespace before word-diffing: otherwise the
 *  whole indent reads as one changed blob (SplitDiffView's trick). */
function wordSegments(oldLine, newLine) {
    const oldIndent = /^\s*/.exec(oldLine)?.[0] ?? '';
    const newIndent = /^\s*/.exec(newLine)?.[0] ?? '';
    const sharedIndent = oldIndent === newIndent ? oldIndent : '';
    const parts = JsDiff.diffWords(oldLine.slice(sharedIndent.length), newLine.slice(sharedIndent.length));
    const oldSegments = sharedIndent === '' ? [] : [{ text: sharedIndent, changed: false }];
    const newSegments = sharedIndent === '' ? [] : [{ text: sharedIndent, changed: false }];
    for (const part of parts) {
        if (part.added)
            newSegments.push({ text: part.value, changed: true });
        else if (part.removed)
            oldSegments.push({ text: part.value, changed: true });
        else {
            oldSegments.push({ text: part.value, changed: false });
            newSegments.push({ text: part.value, changed: false });
        }
    }
    return { old: oldSegments, new: newSegments };
}
/**
 * Align one hunk's old/new sides into context/del/add rows via line diffs
 * (the same walk SplitDiffView uses). Equal-length removed→added blocks pair
 * line-for-line as modifications and carry word-level `segments` so changed
 * words get the Claude Code green/red bold treatment. `oldStart`/`newStart`
 * are 1-based when the payload carries them (dsh-tool-fs / str_replace_editor
 * result hunks); otherwise the counters are relative and the caller must not
 * show numbers.
 */
function alignedDiffRows(oldText, newText, oldStart, newStart) {
    const rows = [];
    const parts = JsDiff.diffLines(oldText ?? '', newText);
    let o = oldStart;
    let n = newStart;
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const lines = part.value.replace(/\n$/, '').split('\n');
        if (!part.added && !part.removed) {
            for (const line of lines)
                rows.push({ kind: 'context', oldNo: o++, newNo: n++, text: line });
        }
        else if (part.removed) {
            const addedPart = parts[i + 1]?.added === true ? parts[i + 1] : undefined;
            const addedLines = addedPart === undefined ? [] : addedPart.value.replace(/\n$/, '').split('\n');
            if (addedPart !== undefined && lines.length === addedLines.length) {
                for (let k = 0; k < lines.length; k++) {
                    const pair = wordSegments(lines[k], addedLines[k]);
                    rows.push({ kind: 'del', oldNo: o++, newNo: undefined, text: lines[k], segments: pair.old });
                    rows.push({ kind: 'add', oldNo: undefined, newNo: n++, text: addedLines[k], segments: pair.new });
                }
                i++;
            }
            else {
                for (const line of lines)
                    rows.push({ kind: 'del', oldNo: o++, newNo: undefined, text: line });
            }
        }
        else {
            for (const line of lines)
                rows.push({ kind: 'add', oldNo: undefined, newNo: n++, text: line });
        }
    }
    return rows;
}
/** Render word-diff segments: on ADDED rows the changed parts get a light
 *  green background (`diffAddedWord`, #90EE90) with dark ink so the light
 *  band stays readable, and no bold; REMOVED rows stay unstyled — only the
 *  line band and `-` marker carry the deletion. An explicit `color`/`bold`
 *  on the segment wins (diffstat rows). */
function segmentNodes(segments, tone) {
    return segments.map((segment, index) => {
        const changed = segment.changed === true;
        const highlight = changed && tone === 'add';
        const background = highlight ? 'diffAddedWord' : undefined;
        const color = segment.color;
        const bold = segment.bold ?? false;
        return _jsx(Text, { color: color, backgroundColor: background, bold: bold, children: segment.text }, `seg-${index}`);
    });
}
/** Line-body color by tone (unified diff marker/content). */
function toneColorOf(tone) {
    return tone === 'add'
        ? 'diffAddedWord'
        : tone === 'del'
            ? 'diffRemovedWord'
            : tone === 'error'
                ? 'error'
                : tone === 'hint'
                    ? 'subtle'
                    : tone === 'path'
                        ? 'ide'
                        : undefined;
}
/** Diff row background: Claude Code paints the whole row band (number, marker
 *  and content) and keeps the content in default text. The mist-blue theme's
 *  `*Dimmed` keys hold the Claude Code diffAdded/diffRemoved line colors. */
function diffRowBackground(tone) {
    return tone === 'add'
        ? 'diffAddedDimmed'
        : tone === 'del'
            ? 'diffRemovedDimmed'
            : undefined;
}
/**
 * Diff hunks → display rows, Claude Code unified style: with line numbers in
 * the payload, every row gets a right-aligned number gutter (`digits + 3`
 * wide, exactly like Claude Code) plus a `+`/`-`/space marker, and context
 * lines are included; without numbers (call-time raw diffs, older sessions)
 * rows fall back to plain `+`/`-` markers but still align shared context
 * lines instead of double-listing them. The header already carries the path
 * for the common single-hunk case; with several hunks a path row separates
 * files and `⋯` separates scattered hunks of one file (upstream DiffBlock).
 */
function diffLines(diffs) {
    const out = [];
    let prevPath;
    for (const diff of diffs) {
        if (diffs.length > 1) {
            if (diff.path !== prevPath)
                out.push({ text: diff.path, tone: 'path' });
            else
                out.push(dim('⋯'));
        }
        prevPath = diff.path;
        const numbered = typeof diff.oldStart === 'number' && typeof diff.newStart === 'number';
        const rows = alignedDiffRows(diff.oldText, diff.newText, diff.oldStart ?? 1, diff.newStart ?? 1);
        // Claude Code change-count summary (`+N -M`, green/red bold) above the
        // hunk body — the same line CC prints under the file header.
        const adds = rows.filter(row => row.kind === 'add').length;
        const dels = rows.filter(row => row.kind === 'del').length;
        if (adds > 0 || dels > 0) {
            const stat = [];
            if (adds > 0)
                stat.push({ text: `+${adds}${dels > 0 ? ' ' : ''}`, color: 'diffAddedWord', bold: true });
            if (dels > 0)
                stat.push({ text: `-${dels}`, color: 'diffRemovedWord', bold: true });
            out.push({
                text: `${adds > 0 ? `+${adds}` : ''}${adds > 0 && dels > 0 ? ' ' : ''}${dels > 0 ? `-${dels}` : ''}`,
                tone: 'diffstat',
                segments: stat,
            });
        }
        if (numbered) {
            const last = rows.reduce((max, row) => Math.max(max, row.oldNo ?? 0, row.newNo ?? 0), 1);
            const width = String(last).length + 3;
            for (const row of rows) {
                const marker = row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' ';
                const no = row.kind === 'add' ? row.newNo : row.oldNo;
                out.push({
                    text: row.text,
                    tone: row.kind === 'add' ? 'add' : row.kind === 'del' ? 'del' : 'plain',
                    gutter: `${String(no).padStart(width)} ${marker}`,
                    ...(row.segments !== undefined ? { segments: row.segments } : {}),
                });
            }
        }
        else {
            for (const row of rows) {
                if (row.kind === 'add')
                    out.push({ text: `+ ${row.text}`, tone: 'add', ...(row.segments !== undefined ? { segments: [{ text: '+ ', changed: false }, ...row.segments] } : {}) });
                else if (row.kind === 'del')
                    out.push({ text: `- ${row.text}`, tone: 'del', ...(row.segments !== undefined ? { segments: [{ text: '- ', changed: false }, ...row.segments] } : {}) });
                else
                    out.push(plain(`  ${row.text}`));
            }
        }
    }
    return out;
}
/** Join the text blocks of a view's content payload (read/generic cards). */
function contentLines(content) {
    const text = (content ?? []).map(block => (block.type === 'text' ? block.text ?? '' : '')).join('').trimEnd();
    if (text === '')
        return [];
    return text.split('\n').map(plain);
}
/** Per-card body lines; unknown/absent shapes yield [] so the caller falls
 *  back to the raw result text. */
function viewLines(view) {
    switch (view.card) {
        case 'diff':
            return diffLines(view.diffs);
        case 'terminal': {
            // The call-side terminal card has no output yet; only presentResult's
            // does. `in` narrows the call/result union without extra types.
            const out = (('output' in view ? view.output : undefined) ?? '').trimEnd();
            const lines = out === '' ? [] : out.split('\n').map(plain);
            if ('exitCode' in view && view.exitCode !== undefined && view.exitCode !== 0) {
                lines.push({ text: `Exit code ${view.exitCode}`, tone: 'error' });
            }
            if ('signal' in view && view.signal !== undefined) {
                lines.push({ text: `Killed by signal ${view.signal}`, tone: 'error' });
            }
            return lines;
        }
        case 'read':
            return contentLines('content' in view ? view.content : undefined);
        case 'generic':
            return contentLines('content' in view ? view.content : undefined);
        case 'search': {
            if (view.shape === 'paths') {
                const lines = view.paths.map(plain);
                if (view.truncated)
                    lines.push(dim(`… (${view.total} total)`));
                return lines;
            }
            const lines = [];
            for (const file of view.files) {
                lines.push(plain(file.path));
                for (const match of file.matches) {
                    lines.push(plain(`${match.lineNumber}: ${match.line}`));
                }
            }
            if (view.truncated)
                lines.push(dim(`… (${view.total} total)`));
            return lines;
        }
        default:
            return [];
    }
}
/** Collapsed bodies fold past the card's line budget; verbose (Ctrl+O) is
 *  always uncapped. Mirrors wrapText's "one extra line is shown directly". */
function capLines(lines, max, verbose) {
    if (verbose || lines.length <= max)
        return lines;
    if (lines.length - max === 1)
        return lines;
    return [
        ...lines.slice(0, max),
        dim(`… +${lines.length - max} lines (ctrl+o to expand)`),
    ];
}
/** Header title from the presentation view: terminal cards keep the
 *  `Name(command)` shape; everything else renders the tool's own title
 *  (`Edit /path`, `Read /path (1 - 100)`) with the first word bold. The
 *  result view's title replaces the call view's only when present — a
 *  settled terminal card carries output but no title of its own. */
/** Header args display budget: the parenthesized summary is a pointer, not
 * the payload — full args live in the verbose/expanded body. A streaming
 * tool call's args can grow to hundreds of KB, and wrapping that in the
 * header Text every frame was the dominant long-output stall (string-width
 * via wrap-ansi, 60%+ of CPU in profiles). */
const HEADER_ARGS_BUDGET = 480;
function clipHeaderArgs(args) {
    if (args.length <= HEADER_ARGS_BUDGET)
        return args;
    return `${args.slice(0, HEADER_ARGS_BUDGET)}…`;
}
function HeaderTitle({ name, title, isTerminal, displayArgs, argsLanguage, nameColor }) {
    if (title === undefined) {
        return (_jsxs(_Fragment, { children: [_jsx(Box, { flexShrink: 0, children: _jsx(Text, { bold: true, color: nameColor, wrap: "truncate-end", children: name }) }), displayArgs !== '' && (_jsxs(Box, { flexWrap: "nowrap", children: [_jsx(Text, { children: "(" }), _jsx(SyntaxText, { text: clipHeaderArgs(displayArgs), sourceText: displayArgs, language: argsLanguage }), _jsx(Text, { children: ")" })] }))] }));
    }
    if (isTerminal) {
        return (_jsxs(_Fragment, { children: [_jsx(Box, { flexShrink: 0, children: _jsx(Text, { bold: true, color: nameColor, wrap: "truncate-end", children: name }) }), _jsx(Box, { flexWrap: "nowrap", children: _jsxs(Text, { children: ["(", title, ")"] }) })] }));
    }
    const trimmed = title.trim();
    if (trimmed === '') {
        return (_jsx(Box, { flexShrink: 0, children: _jsx(Text, { bold: true, color: nameColor, wrap: "truncate-end", children: name }) }));
    }
    const space = trimmed.indexOf(' ');
    const head = space === -1 ? trimmed : trimmed.slice(0, space);
    const tail = space === -1 ? '' : trimmed.slice(space);
    return (_jsx(Box, { flexWrap: "nowrap", children: _jsxs(Text, { bold: true, color: nameColor, wrap: "truncate-end", children: [head, _jsx(Text, { bold: false, color: "text", children: tail })] }) }));
}
/**
 * Tool-call card: `● Edit /path` header with a blinking status dot, then the
 * structured body under a `  ⎿  ` gutter — diff hunks in red/green, terminal
 * output, read content — instead of the raw result dump (mirroring Claude Code's `AssistantToolUseMessage.tsx` + the dsh-tools presentation views the
 * channel captures per call).
 */
export function AssistantToolUseMessage({ tool, addMargin, verbose, isSelected = false, isExpanded = false, onClick, footnote, diffLayout = 'auto', toolBackground = 'none', }) {
    const isRunning = tool.status === 'running';
    const isError = tool.status === 'error';
    const displayArgs = verbose ? tool.argsFull ?? tool.argsText : tool.argsText;
    const result = tool.resultFull ?? tool.resultText;
    const name = displayName(tool.name);
    const minWidth = stringWidth(name) + 2;
    // The settled view carries the applied diff / actual output; while running,
    // the call view already shows the pending change (CC's pending Edit diff).
    const view = tool.resultView ?? tool.callView;
    const filePath = filePathFromTool(tool, view);
    const syntaxLanguage = view?.card === 'read' || view?.card === 'generic' || view === undefined
        ? languageFromPath(filePath)
        : undefined;
    // presentResult may omit a title (terminal results carry output, not a
    // command) — then the call view's title stands.
    const headerTitle = tool.resultView?.title ?? tool.callView?.title;
    const headerIsTerminal = view?.card === 'terminal';
    // Live elapsed clock while the call runs (CC's bash elapsed timer): the
    // 1s tick re-renders the card; elapsed derives from wall-clock refs.
    const [viewportRef] = useAnimationFrame(isRunning ? 1000 : null);
    const elapsedMs = isRunning
        ? tool.startedAt !== undefined
            ? Date.now() - tool.startedAt
            : undefined
        : tool.durationMs;
    const elapsedText = elapsedMs !== undefined ? ` · ${formatDuration(elapsedMs)}` : '';
    // Body lines: the structured view first, raw result text as the fallback
    // (tools without a presenter, or a folded row awaiting loadOlder).
    // Wide terminals render diffs as a two-pane side-by-side instead: one
    // source line per terminal row (truncate) keeps the panes row-aligned,
    // which the flat add/del line model cannot express.
    const { columns } = useTerminalSize();
    const useSplitDiff = !isError && view?.card === 'diff' &&
        (diffLayout === 'split' || (diffLayout !== 'unified' && columns >= SPLIT_DIFF_MIN_COLS));
    let body = [];
    if (isError) {
        if (tool.errorText)
            body = [{ text: tool.errorText, tone: 'error' }];
    }
    else if (!useSplitDiff) {
        if (view !== undefined)
            body = viewLines(view);
        if (body.length === 0 && result) {
            body = result.trimEnd().split('\n').map(plain);
        }
        if (isRunning && body.length === 0) {
            body = [dim(`Running… (${formatDuration(Math.max(0, Date.now() - (tool.startedAt ?? Date.now())))})`)];
        }
    }
    const cap = view?.card === 'diff' ? DIFF_BODY_MAX_LINES : TEXT_BODY_MAX_LINES;
    const bodySource = body.map(line => line.text).join('\n');
    const argsLanguage = jsonArgsLanguage(displayArgs);
    // The footnote rides OUTSIDE the cap: it is a pointer, not content, and a
    // long error body must not be the reason it disappears.
    const lines = capLines(body, cap, verbose);
    const rendered = footnote === undefined ? lines : [...lines, { text: footnote, tone: 'hint' }];
    // Nested split-diff context panes must also yield to interaction highlights.
    // `none` leaves them transparent so the selected/expanded root shows through.
    const ordinaryToolBackground = isSelected || isExpanded ? 'none' : toolBackground;
    const ordinaryBackground = ordinaryToolBackground === 'subtle'
        ? 'toolCardBackgroundDim'
        : ordinaryToolBackground === 'strong'
            ? 'toolCardBackground'
            : undefined;
    return (_jsx(Box, { ref: viewportRef, flexDirection: "row", justifyContent: "space-between", marginTop: addMargin ? 1 : 0, width: "100%", onClick: onClick, 
        // Only selection paints a highlight; the configured treatment applies
        // to an ordinary card. Diff line tints stay - they are content, not chrome.
        // No hover tint: the card stays visually quiet until clicked (user
        // feedback — row-hover color changes read as noise in the transcript).
        backgroundColor: isSelected ? 'messageActionsBackground' : ordinaryBackground, children: _jsxs(Box, { flexDirection: "column", flexGrow: 1, children: [_jsxs(Box, { flexDirection: "row", flexWrap: "nowrap", minWidth: minWidth, children: [_jsx(ToolUseLoader, { shouldAnimate: isRunning, isUnresolved: isRunning, isError: isError, toolName: tool.name }), _jsx(HeaderTitle, { name: name, title: headerTitle, isTerminal: headerIsTerminal, displayArgs: displayArgs, argsLanguage: argsLanguage, nameColor: toolNameColor(tool.name) }), !isRunning && (_jsx(Box, { flexWrap: "nowrap", children: _jsx(Text, { dimColor: true, children: elapsedText }) }))] }), useSplitDiff && view?.card === 'diff' ? (_jsxs(Box, { flexDirection: "row", children: [_jsx(Box, { width: 3, flexShrink: 0, children: _jsx(Text, { dimColor: true, children: GUTTER_FIRST }) }), _jsx(SplitDiffView, { diffs: view.diffs, width: columns - 4, maxRows: DIFF_BODY_MAX_LINES, verbose: verbose, toolBackground: ordinaryToolBackground })] })) : (rendered.map((line, index) => (_jsxs(Box, { flexDirection: "row", children: [_jsx(Box, { width: 3, flexShrink: 0, children: _jsx(Text, { color: line.tone === 'add'
                                    ? 'diffAddedWord'
                                    : line.tone === 'del'
                                        ? 'diffRemovedWord'
                                        : line.tone === 'path'
                                            ? 'ide'
                                            : undefined, dimColor: line.tone !== 'add' && line.tone !== 'del' && line.tone !== 'path', children: index === 0 ? GUTTER_FIRST : GUTTER_REST }) }), _jsx(Box, { flexGrow: 1, backgroundColor: diffRowBackground(line.tone), children: line.gutter !== undefined ? (_jsxs(_Fragment, { children: [_jsx(Text, { children: line.gutter }), _jsx(Text, { wrap: "wrap", children: line.segments !== undefined ? segmentNodes(line.segments, line.tone) : (line.text === '' ? ' ' : line.text) })] })) : (_jsx(Text, { color: line.tone === 'add' || line.tone === 'del' ? undefined : toneColorOf(line.tone), dimColor: line.tone === 'dim', wrap: "wrap", children: line.segments !== undefined ? segmentNodes(line.segments, line.tone) : line.tone === 'plain' && syntaxLanguage !== undefined ? (_jsx(SyntaxText, { text: line.text, sourceText: bodySource, lineIndex: index, language: syntaxLanguage })) : (line.text === '' ? ' ' : line.text) }) ) }) ] }, index)))), useSplitDiff && footnote !== undefined && (_jsxs(Box, { flexDirection: "row", children: [_jsx(Box, { width: 3, flexShrink: 0, children: _jsx(Text, { dimColor: true, children: GUTTER_REST }) }), _jsx(Text, { color: "subtle", children: footnote })] }))] }) }));
}
