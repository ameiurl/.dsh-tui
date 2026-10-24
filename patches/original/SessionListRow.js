import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Box, Text } from '../../ui.js';
import { t } from '../../i18n.js';
import { useTooltip } from '../Tooltip.js';
import { SpinnerGlyph } from '../Spinner/SpinnerGlyph.js';
import { useAnimationFrame } from '../../ink/hooks/use-animation-frame.js';
import { useTerminalFocus } from '../../ink/hooks/use-terminal-focus.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { useDeclaredCursor, useNativeCursor } from '../../ink/hooks/use-declared-cursor.js';
import { formatAbsolute, formatBytes, formatWhen, kindMark, titleColor, truncateWidth, } from '../../sessions/format.js';
/**
 * State presentation for a session this terminal is running: one glyph and one
 * theme colour per status, matching the session overview's own vocabulary so
 * the same session never looks like two different things on two screens.
 * `stopped` is the "not running here" spelling and draws dim.
 */
const LIVE_STATUS_GLYPH = {
    'needs-input': '✻',
    working: '✽',
    completed: '✓',
    failed: '✕',
    idle: '∙',
    stopped: '∙',
};
const LIVE_STATUS_COLOR = {
    'needs-input': 'warning',
    working: 'suggestion',
    completed: 'success',
    failed: 'error',
    idle: undefined,
    stopped: undefined,
};
/** Only a visible working glyph subscribes; the session list does not tick. */
function WorkingGlyph() {
    const focused = useTerminalFocus();
    const [ref, time] = useAnimationFrame(focused ? 120 : null);
    return (_jsx(Box, { ref: ref, children: _jsx(SpinnerGlyph, { frame: Math.floor(time / 120), time: time, messageColor: "suggestion", reducedMotion: false }) }));
}
/**
 * One session in the browser's list: a title line and a metadata line.
 *
 * Two lines rather than one because the two carry different jobs. The title
 * answers "is this the conversation I mean"; the metadata gives its age and
 * branch. Size and model are available in the title tooltip rather than taking
 * space in every row. Folding both lines into one makes the title compete with
 * facts nobody reads first, and on a narrow terminal the title is what loses.
 *
 * Widths are resolved here rather than delegated to flexbox: the row must
 * stay exactly two lines at every terminal width, and a row that wraps
 * destroys the alignment that lets the eye scan a list at all.
 */
export function SessionListRow({ session, width, depth, focused, declareCursor = false, pinned, now, onClick, onContextMenu, onTogglePin, liveStatus, current, occupiedPid, }) {
    const indent = depth * 2;
    const nativeCursor = useNativeCursor();
    const cursorRef = useDeclaredCursor({ line: 0, column: indent, active: focused && declareCursor, visible: nativeCursor, hideOnIdle: true });
    // Two cells for the focus marker, plus the indent for a nested run.
    const body = Math.max(8, width - 2 - indent);
    const mark = kindMark(session.kind);
    const [hovered, setHovered] = useState(false);
    const pinTooltip = useTooltip(t(pinned ? 'resume-menu-unpin' : 'resume-menu-pin'));
    // Title hover tooltip: the row truncates a long title mid-word; when it
    // does, the float leads with the full title. The absolute timestamp and
    // cwd ride along in every case — the facts line shows only relative time
    // and never the working directory, so that pair is always new information
    // for telling look-alike sessions apart.
    const titleText = session.label ?? session.title.text;
    /**
     * The state cell holds EXACTLY two columns on every row, occupied or not,
     * for the same reason the pin slot does: a column that appears only when a
     * session is busy would shift every title on screen each time one starts or
     * stops working.
     */
    const occupied = occupiedPid !== undefined;
    const stateGlyph = occupied ? '⊘' : LIVE_STATUS_GLYPH[liveStatus ?? 'stopped'];
    const stateColor = occupied
        ? 'error'
        : liveStatus === undefined
            ? undefined
            : LIVE_STATUS_COLOR[liveStatus];
    const occupiedText = occupied ? ` ${t('supervisor-occupied-badge', { pid: occupiedPid })}` : '';
    const currentText = current === true ? ` ${t('supervisor-current')}` : '';
    const titleBudget = body - 2 - (mark === undefined ? 0 : 2) - 2
        - stringWidth(occupiedText) - stringWidth(currentText);
    const shownTitle = truncateWidth(titleText, Math.max(4, titleBudget));
    const titleTooltip = useTooltip(() => {
        const parts = [];
        if (occupied)
            parts.push(t('session-mount-occupied-short', { pid: occupiedPid }));
        if (shownTitle !== titleText)
            parts.push(titleText);
        parts.push(formatAbsolute(session.updatedAt));
        if (session.cwd !== '')
            parts.push(session.cwd);
        const size = formatBytes(session.bytes);
        if (size !== undefined)
            parts.push(size);
        if (session.model !== undefined)
            parts.push(session.model);
        return parts.join('\n');
    });
    const facts = [formatWhen(session.updatedAt, now)];
    if (session.branch !== undefined)
        facts.push(session.branch);
    if (session.childCount > 0 && depth === 0) {
        facts.push(t('session-children', { n: session.childCount }));
    }
    return (_jsxs(Box, { flexDirection: "column", flexShrink: 0, onClick: onClick, onContextMenu: onContextMenu, onMouseEnter: onClick !== undefined || onContextMenu !== undefined ? () => setHovered(true) : undefined, onMouseLeave: onClick !== undefined || onContextMenu !== undefined ? () => setHovered(false) : undefined, 
        // Hover is the BLUE prompt — pointer feedback and nothing else. Selection
        // is green and never blue: a row the keyboard cursor is on must not look
        // like a row the mouse happens to be over, so the two never share a
        // background and a selected row keeps its own colour while hovered.
        backgroundColor: hovered && !focused ? 'userMessageBackgroundHover' : undefined, children: [_jsxs(Box, { ref: cursorRef, children: [_jsx(Text, { color: focused ? 'success' : 'subtle', children: `${' '.repeat(indent)}${focused ? '❯ ' : '  '}` }), _jsx(Box, { ...pinTooltip, onClick: onTogglePin === undefined ? undefined : (event) => {
                            // The star is a control on the row, not the row: a click here
                            // toggles the pin and must never fall through to resume.
                            event.stopImmediatePropagation();
                            onTogglePin();
                        }, children: _jsx(Text, { color: pinned ? 'remember' : undefined, dimColor: !pinned, children: pinned ? '★ ' : '☆ ' }) }), _jsx(Box, { children: liveStatus === 'working' && !occupied ? (_jsx(WorkingGlyph, {})) : (_jsx(Text, { color: stateColor, dimColor: liveStatus === undefined && !occupied, children: `${stateGlyph} ` })) }), mark !== undefined && _jsx(Text, { color: mark.color, children: `${mark.glyph} ` }), _jsx(Box, { ...titleTooltip, children: _jsx(Text, { color: occupied ? 'error' : titleColor(session.title.source, focused), bold: focused, children: shownTitle }) }), occupiedText !== '' && _jsx(Text, { color: "error", children: occupiedText }), currentText !== '' && _jsx(Text, { color: "success", children: currentText })] }), _jsx(Box, { children: _jsx(Text, { color: focused ? 'success' : undefined, dimColor: !focused, children: `${' '.repeat(indent + 2)}${truncateWidth(facts.join(' · '), body)}` }) })] }));
}
