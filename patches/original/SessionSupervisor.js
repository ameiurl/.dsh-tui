import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, useTerminalSize } from '../ui.js';
import { t } from '../i18n.js';
import { Divider } from '../components/design-system/Divider.js';
import { HintLine } from '../components/design-system/HintLine.js';
import { SearchBox } from '../components/SearchBox.js';
import { PageInsetContext } from '../components/PageMargin.js';
import { HomeWorkspaceRow } from '../components/workspaces/HomeWorkspaceRow.js';
import { SessionListRow } from '../components/sessions/SessionListRow.js';
import { SpinnerGlyph } from '../components/Spinner/SpinnerGlyph.js';
import { ApprovalPanel } from '../components/approvals/ApprovalPanel.js';
import { useTerminalFocus } from '../ink/hooks/use-terminal-focus.js';
import { useDeclaredCursor, useNativeCursor } from '../ink/hooks/use-declared-cursor.js';
import { isPlainReturn, isMod } from '../utils/modifiers.js';
import { truncateWidth, wrapPathWidth } from '../sessions/format.js';
import { clearTooltip, useTooltip } from '../components/Tooltip.js';
import { useSessionSupervisor } from './sessionSupervisor/useSessionSupervisor.js';
import { DSH_TAB, useForeignSessions } from './sessionSupervisor/useForeignSessions.js';
import { ForeignSessionPanes } from './sessionSupervisor/ForeignSessionPanes.js';
import { SourceTabs, layoutSourceTabs, sourceTabsWidth } from '../components/sessions/SourceTabs.js';
import { stringWidth } from '../ink/stringWidth.js';
import { WORKSPACE_ROW_LINES, SESSION_ROW_LINES, MENU_WIDTH, MENU_LABEL_KEYS, menuActionsFor, UNREGISTERED_RAIL_ID, samePath, sessionMatchesQuery } from './sessionSupervisor/model.js';
export { sessionMatchesQuery };
/**
 * The unified session screen — `/resume`, `/agentview`, `/home` and the 🏠
 * button all land here.
 *
 * Those were three screens over one domain, which is why they kept needing
 * patches to agree with each other. This is the single surface: the workspace
 * rail on the left (the durable ledger a person manages — add, rename,
 * remove), the sessions of the selected workspace on the right, and every
 * session's LIVE state on its own row.
 *
 * The runtime it presents is a single model, and the screen is where that
 * model becomes visible:
 *
 * - This terminal hosts many sessions at once. A row that is `working` keeps
 *   working when you leave it — switching changes what you are looking at, it
 *   does not stop anything. The parked rows stay in the list with a live
 *   glyph, so "where did my other session go" has an answer on screen.
 * - A session held by another TUI terminal is shown as OCCUPIED (red, with the
 *   holder's pid) and cannot be entered. Two processes driving one
 *   append-only session log would interleave its events, so the screen refuses
 *   rather than races; the entry becomes available on its own once that
 *   process exits, because occupancy is proven by liveness rather than by a
 *   flag someone has to remember to clear.
 *
 * @param props - Channel, home directory, the opening/新 actions, and the live
 *   state + occupancy lookups the screen renders from.
 * @returns The screen, or null while the host has no channel to read.
 */
export function SessionSupervisor({ channel, home, onClose, onOpenSession, onNewSession, onStopSession, approval, onApprove, liveStateOf, }) {
    const { columns, rows } = useTerminalSize();
    const inset = React.useContext(PageInsetContext);
    const isTerminalFocused = useTerminalFocus();
    const { dshBackend, archiveSessions, sessionRename, setSessionRename, confirmDelete, setConfirmDelete, renameSession, deleteSession, entries, sessions, loading, refreshing, notice, setNotice, query, setQuery, holderOf, listedSessions, railEntries, countOf, railFocus, setRailFocus, setFocusSessionId, activePane, pins, menu, setMenu, rename, setRename, confirmRemove, setConfirmRemove, railRef, menuRef, queryRef, now, reload, selected, visibleSessions, sessionIndex, cardFocused, sessionAt, activateList, activateRail, railWidth, railVisible, sessionWidth, railEntryCapacity, sessionListHeight, noticeRows, persistPin, selectEntry, openSession, newSessionIn, renameEntry, removeEntry, stopSession, closeMenu, activateMenu, moveRail, moveSession, focusedSession, } = useSessionSupervisor({ channel, home, onOpenSession, onNewSession, onStopSession, liveStateOf, columns, rows });
    const menuEntry = menu === undefined ? undefined : railEntries.find(entry => samePath(entry.path, menu.path));
    const menuActions = menuEntry === undefined ? [] : menuActionsFor(menuEntry);
    /**
     * The source tab: this screen's own sessions ({@link DSH_TAB}) or another
     * coding agent's, by agent id. Every open starts on DSH — the screen is
     * where you manage your sessions first, and a foreign tab is a place you
     * visit.
     */
    const [tab, setTab] = useState(DSH_TAB);
    /** The `+N` dropdown of folded tabs, anchored where it was clicked. */
    const [tabMenu, setTabMenu] = useState(undefined);
    // Like ModelPicker, the native caret follows the region last touched.
    // The live filter keeps the rail/list's existing navigation and Enter target.
    const [filterFocused, setFilterFocused] = useState(false);
    const cursorActive = approval === null && menu === undefined && tabMenu === undefined
        && rename === undefined && confirmRemove === undefined && sessionRename === undefined && confirmDelete === undefined;
    const searchCursor = filterFocused || (!railVisible && activePane === 'rail');
    const nativeCursor = useNativeCursor();
    const newSessionCursorRef = useDeclaredCursor({
        line: 0, column: 0, active: tab === DSH_TAB && cursorActive && !searchCursor && cardFocused,
        visible: nativeCursor, hideOnIdle: true,
    });
    const focusRail = () => {
        setFilterFocused(false);
        activateRail();
    };
    const focusList = () => {
        setFilterFocused(false);
        activateList();
    };
    const tabMenuRef = useRef(tabMenu);
    tabMenuRef.current = tabMenu;
    /** The session-rename draft as the keyboard sees it (see the input handler). */
    const sessionRenameRef = useRef(sessionRename);
    sessionRenameRef.current = sessionRename;
    const foreign = useForeignSessions({ channel, tab, registry: entries, query, setNotice, onOpenSession });
    /**
     * Only sources with data get a tab, after DSH, in a fixed order: ranking
     * them by recency would mean stat-ing every conversation of every source
     * each time this screen opens.
     */
    const tabs = useMemo(() => {
        // Another backend's screen lists that backend's sessions: its one tab
        // names it (foreign imports are a DSH feature and never probed there).
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime guard: headless hosts pass partial channels
        if (!dshBackend)
            return [{ id: DSH_TAB, label: channel.backendCapabilities?.backendLabel ?? DSH_TAB }];
        if (foreign.sources.length === 0)
            return [];
        return [{ id: DSH_TAB, label: 'DSH' }, ...foreign.sources.map(source => ({ id: source.agentId, label: source.label }))];
    }, [foreign.sources, dshBackend, channel.backendCapabilities]);
    const activeSource = foreign.sources.find(source => source.agentId === tab);
    // A source that vanished on refresh takes its tab with it; land on DSH
    // rather than on a tab the strip no longer draws.
    React.useEffect(() => {
        if (tab !== DSH_TAB && activeSource === undefined)
            setTab(DSH_TAB);
    }, [tab, activeSource]);
    const closeTabMenu = useCallback(() => {
        tabMenuRef.current = undefined;
        setTabMenu(undefined);
    }, []);
    /** Switch source. The query and notice belong to the tab they were made on. */
    const switchTab = useCallback((id) => {
        closeMenu();
        closeTabMenu();
        setQuery('');
        setFilterFocused(false);
        setNotice(undefined);
        setTab(id);
    }, [closeMenu, closeTabMenu, setQuery, setNotice]);
    const cycleTab = useCallback((by) => {
        if (tabs.length < 2)
            return;
        const index = Math.max(0, tabs.findIndex(candidate => candidate.id === tab));
        switchTab(tabs[(index + by + tabs.length) % tabs.length].id);
    }, [tabs, tab, switchTab]);
    useInput((input, key) => {
        // Modal layers own the keyboard, in the same order they render.
        // The draft is read through a ref: keystrokes that arrive in one batch
        // (typing, then Enter) must commit everything typed, not the last render.
        const renaming = sessionRenameRef.current;
        if (renaming !== undefined) {
            const update = (next) => {
                sessionRenameRef.current = next;
                setSessionRename(next);
            };
            if (key.escape) {
                update(undefined);
                return;
            }
            if (isPlainReturn(key)) {
                update(undefined);
                renameSession(renaming.id, renaming.draft);
                return;
            }
            if (key.backspace || key.delete) {
                update({ ...renaming, draft: renaming.draft.slice(0, -1) });
                return;
            }
            if (!isMod(key) && !key.meta && input && !key.return) {
                const typed = input.replace(/[\r\n]+/gu, '');
                if (typed !== '')
                    update({ ...renaming, draft: renaming.draft + typed });
            }
            return;
        }
        if (confirmDelete !== undefined) {
            if (isPlainReturn(key)) {
                const target = listedSessions.find(candidate => candidate.id === confirmDelete);
                setConfirmDelete(undefined);
                if (target !== undefined)
                    deleteSession(target);
            }
            else if (key.escape) {
                setConfirmDelete(undefined);
            }
            return;
        }
        if (rename !== undefined) {
            if (key.escape) {
                setRename(undefined);
                return;
            }
            if (isPlainReturn(key)) {
                const current = rename;
                setRename(undefined);
                renameEntry(current.path, current.draft);
                return;
            }
            if (key.backspace || key.delete) {
                setRename(current => (current === undefined ? current : { ...current, draft: current.draft.slice(0, -1) }));
                return;
            }
            if (!isMod(key) && !key.meta && input && !key.return) {
                const typed = input.replace(/[\r\n]+/gu, '');
                if (typed !== '')
                    setRename(current => (current === undefined ? current : { ...current, draft: current.draft + typed }));
            }
            return;
        }
        if (confirmRemove !== undefined) {
            if (isPlainReturn(key)) {
                const path = confirmRemove;
                setConfirmRemove(undefined);
                removeEntry(path);
            }
            else if (key.escape) {
                setConfirmRemove(undefined);
            }
            return;
        }
        if (menuRef.current !== undefined) {
            const current = menuRef.current;
            const entry = railEntries.find(candidate => samePath(candidate.path, current.path));
            if (entry === undefined) {
                closeMenu();
                return;
            }
            const actionCount = menuActionsFor(entry).length;
            if (key.upArrow) {
                const next = { ...current, item: (current.item + actionCount - 1) % actionCount };
                menuRef.current = next;
                setMenu(next);
            }
            else if (key.downArrow) {
                const next = { ...current, item: (current.item + 1) % actionCount };
                menuRef.current = next;
                setMenu(next);
            }
            else if (isPlainReturn(key)) {
                activateMenu(entry, current.item);
            }
            else {
                closeMenu();
            }
            return;
        }
        if (tabMenuRef.current !== undefined) {
            const current = tabMenuRef.current;
            const count = Math.max(1, tabLayout.hidden.length);
            if (key.upArrow || key.downArrow) {
                const next = { ...current, item: (current.item + (key.upArrow ? count - 1 : 1)) % count };
                tabMenuRef.current = next;
                setTabMenu(next);
            }
            else if (isPlainReturn(key)) {
                const target = tabLayout.hidden[current.item];
                if (target !== undefined)
                    switchTab(target.id);
                else
                    closeTabMenu();
            }
            else {
                closeTabMenu();
            }
            return;
        }
        if (key.escape) {
            if (notice !== undefined) {
                setNotice(undefined);
                return;
            }
            if (queryRef.current.length > 0) {
                setFilterFocused(true);
                setQuery('');
                return;
            }
            onClose();
            return;
        }
        if (key.tab) {
            // Tab / Shift+Tab walk the source tabs. Shift+Tab used to open the
            // focused workspace's menu, which Enter on the rail already does, so
            // the route was given up to the tabs.
            cycleTab(key.shift ? -1 : 1);
            return;
        }
        if (key.leftArrow || key.rightArrow || key.upArrow || key.downArrow || key.wheelUp || key.wheelDown || key.pageUp || key.pageDown) {
            setFilterFocused(false);
        }
        if (tab !== DSH_TAB) {
            foreignKey(input, key);
            return;
        }
        // ←/→ choose the column. There is exactly one `❯` on screen because exactly
        // one column owns the keyboard, and this is what moves that ownership.
        if (key.leftArrow) {
            activateRail();
            return;
        }
        if (key.rightArrow) {
            activateList();
            return;
        }
        if (key.upArrow || key.wheelUp) {
            if (activePane === 'rail')
                moveRail(-1);
            else
                moveSession(-1);
            return;
        }
        if (key.downArrow || key.wheelDown) {
            if (activePane === 'rail')
                moveRail(1);
            else
                moveSession(1);
            return;
        }
        if (key.pageUp || key.pageDown) {
            if (activePane === 'list')
                moveSession(key.pageDown ? 1 : -1);
            else
                moveRail(key.pageDown ? 1 : -1);
            return;
        }
        // Typing moves the native caret into the live filter; arrows and Enter
        // still belong to the rail/list, so filtering adds no separate input mode.
        if (key.backspace || key.delete) {
            setFilterFocused(true);
            setQuery(text => text.slice(0, -1));
            return;
        }
        if (isMod(key) && input === 'n') {
            const entry = railEntries[railRef.current];
            if (entry !== undefined)
                newSessionIn(entry);
            return;
        }
        if (isMod(key) && input === 'l') {
            void reload();
            return;
        }
        if (isMod(key) && input === 'x') {
            if (focusedSession !== undefined)
                stopSession(focusedSession);
            return;
        }
        // Another backend's stored sessions are renamed / deleted through its
        // catalog (the DSH screen keeps its keys exactly as they were).
        if (!dshBackend && isMod(key) && input === 'r') {
            if (activePane === 'list' && focusedSession !== undefined) {
                const next = { id: focusedSession.id, draft: focusedSession.title.text };
                sessionRenameRef.current = next;
                setSessionRename(next);
            }
            return;
        }
        if (!dshBackend && isMod(key) && input === 'd') {
            if (activePane === 'list' && focusedSession !== undefined)
                setConfirmDelete(focusedSession.id);
            return;
        }
        if (isPlainReturn(key)) {
            // Enter means "the thing the active column is showing": its action menu
            // for a workspace, that session for the session list. Ctrl/Cmd+Enter keeps
            // the old "start a session in this workspace" shortcut from either column.
            // Row 0 of the list is the new-session card, so it starts a session
            // instead of opening one.
            if (activePane === 'list') {
                if (sessionIndex === 0) {
                    if (selected !== undefined)
                        newSessionIn(selected);
                    return;
                }
                // `sessionIndex` is derived from the SAME focus fact the render draws
                // `❯` from, so Enter can only ever open the row the user is looking at.
                const session = sessionAt(sessionIndex);
                if (session !== undefined)
                    openSession(session);
                return;
            }
            const entry = railEntries[railRef.current];
            if (entry === undefined)
                return;
            if (key.ctrl || key.meta) {
                newSessionIn(entry);
                return;
            }
            const next = { path: entry.path, ...keyboardMenuAnchor, item: 0 };
            menuRef.current = next;
            setMenu(next);
            return;
        }
        // Reached only when nothing above claimed the key: printable characters
        // refine the filter. Control bytes are dropped so a terminal reporting an
        // unknown key cannot type an invisible glyph into the query.
        if (!isMod(key) && !key.meta && !key.super && input && !key.return) {
            const typed = input.replace(/\p{Cc}/gu, '');
            if (typed.length > 0) {
                setFilterFocused(true);
                setQuery(text => text + typed);
            }
        }
    });
    const workingCount = listedSessions.filter(session => liveStateOf(session.id)?.status === 'working').length;
    /**
     * Keys on a source tab: the same pane model as DSH (←/→ pick the column,
     * ↑/↓ move, typing filters), with what a foreign source cannot do left out —
     * no workspace menu, no new session, no stop — and Ctrl+L rescanning the
     * source instead of re-listing.
     */
    function foreignKey(input, key) {
        if (key.leftArrow) {
            foreign.activateRail();
            return;
        }
        if (key.rightArrow) {
            foreign.activateList();
            return;
        }
        const by = key.upArrow || key.wheelUp || key.pageUp ? -1 : key.downArrow || key.wheelDown || key.pageDown ? 1 : 0;
        if (by !== 0) {
            if (foreign.pane === 'rail')
                foreign.moveRail(by);
            else
                foreign.moveList(by);
            return;
        }
        if (key.backspace || key.delete) {
            setFilterFocused(true);
            setQuery(text => text.slice(0, -1));
            return;
        }
        if (isMod(key) && input === 'l') {
            foreign.rescan();
            return;
        }
        if (isMod(key))
            return;
        if (isPlainReturn(key)) {
            // The rail has no menu here, so Enter on it steps into the list.
            if (foreign.pane === 'rail')
                foreign.activateList();
            else if (foreign.focusedRow !== undefined)
                foreign.openRow(foreign.focusedRow);
            return;
        }
        if (!key.meta && !key.super && input && !key.return) {
            const typed = input.replace(/\p{Cc}/gu, '');
            if (typed.length > 0) {
                setFilterFocused(true);
                setQuery(text => text + typed);
            }
        }
    }
    // Header: title, subtitle, and the source strip on the right. Width runs
    // out in a fixed order — the subtitle goes first, then trailing tabs fold
    // into `+N`; the active tab never folds.
    const titleText = ` ▣ ${t('supervisor-title')}`;
    const subtitleText = `  ${t('supervisor-subtitle')}`;
    /** One column between title and strip, one after the strip. */
    const HEADER_GAPS = 2;
    const fullStrip = tabs.length === 0 ? 0 : sourceTabsWidth(tabs, 0, DSH_TAB);
    const showSubtitle = tabs.length === 0
        || stringWidth(titleText) + stringWidth(subtitleText) + HEADER_GAPS + fullStrip <= columns;
    const tabBudget = columns - stringWidth(titleText) - (showSubtitle ? stringWidth(subtitleText) : 0) - HEADER_GAPS;
    const tabLayout = layoutSourceTabs(tabs, tab, tabBudget);
    const tabMenuWidth = Math.max(12, ...tabLayout.hidden.map(hidden => stringWidth(hidden.label) + 6));
    const withTabHint = (text) => (tabs.length < 2 ? text : `${text} · ${t('supervisor-hint-tabs')}`);
    const listHint = dshBackend ? t('supervisor-hint-list') : t(archiveSessions ? 'supervisor-hint-list-archive' : 'supervisor-hint-list-backend');
    const railHint = rename !== undefined
        ? t('home-hint-rename')
        : confirmRemove !== undefined
            ? t('home-hint-confirm-remove')
            : menu !== undefined
                ? t('home-hint-menu')
                : activePane === 'rail'
                    ? withTabHint(t('home-hint-list'))
                    : withTabHint(listHint);
    /** Content-local anchor for a keyboard-opened menu (screen coords minus inset). */
    const keyboardMenuAnchor = { col: inset.x + 2, row: inset.y + 3 };
    const filtered = query.trim().length > 0;
    // Keep the selected directory in one place for DSH and external sources.
    // Wrap instead of animating a marquee; unusually long paths remain in the tooltip.
    const selectedPath = tab === DSH_TAB
        ? selected?.path === UNREGISTERED_RAIL_ID ? undefined : selected?.path
        : foreign.selected?.path || undefined;
    const pathWidth = Math.max(1, columns - 2);
    const wrappedPath = selectedPath === undefined ? [] : wrapPathWidth(selectedPath, pathWidth);
    const maxPathRows = Math.max(1, Math.min(4, Math.floor(rows / 4)));
    const pathClipped = wrappedPath.length > maxPathRows;
    const pathLines = wrappedPath.slice(0, maxPathRows);
    if (pathClipped)
        pathLines[pathLines.length - 1] = truncateWidth(`${pathLines[pathLines.length - 1]}…`, pathWidth);
    const pathTooltip = useTooltip(() => pathClipped ? selectedPath ?? '' : '');
    // A keyboard selection change leaves the pointer still, so close the previous path's tooltip.
    useEffect(() => { clearTooltip(); }, [selectedPath]);
    const pathRows = pathLines.length;
    const visibleRailCapacity = Math.max(1, railEntryCapacity - Math.ceil(pathRows / WORKSPACE_ROW_LINES));
    const railWindowTopIndex = railWindowTop(railFocus, railEntries.length, visibleRailCapacity);
    const visibleRailRows = railEntries.slice(railWindowTopIndex, railWindowTopIndex + visibleRailCapacity);
    // The new-session card is row 0; reserve its space and the path bar before
    // deriving the visible session window, so the focused row never gets clipped.
    const capacity = Math.max(1, Math.floor((sessionListHeight - pathRows) / SESSION_ROW_LINES));
    const sessionCapacity = Math.max(1, capacity - 1);
    let sessionTop = Math.min(Math.max(0, sessionIndex - 1 - sessionCapacity + 1), Math.max(0, visibleSessions.length - sessionCapacity));
    if (sessionIndex - 1 < sessionTop)
        sessionTop = Math.max(0, sessionIndex - 1);
    const visibleSessionRows = visibleSessions.slice(sessionTop, sessionTop + sessionCapacity);
    const liveCount = listedSessions.filter(session => liveStateOf(session.id)?.live === true).length;
    return (_jsxs(Box, { flexDirection: "column", width: columns, height: rows, onClick: menu !== undefined ? closeMenu : tabMenu !== undefined ? closeTabMenu : undefined, children: [_jsxs(Box, { height: 1, flexShrink: 0, overflow: "hidden", children: [_jsxs(Box, { flexGrow: 1, flexShrink: 1, overflow: "hidden", children: [_jsx(Text, { color: "remember", bold: true, children: titleText }), showSubtitle && _jsx(Text, { dimColor: true, children: subtitleText })] }), tabs.length > 0 && (_jsx(Box, { flexShrink: 0, marginRight: 1, children: _jsx(SourceTabs, { layout: tabLayout, active: tab, leadId: DSH_TAB, onSelect: switchTab, onOverflow: (event) => {
                                closeMenu();
                                const next = { col: event.col, row: event.row, item: 0 };
                                tabMenuRef.current = next;
                                setTabMenu(next);
                            } }) }))] }), _jsx(Divider, { bleed: true }), pathRows > 0 && (_jsx(Box, { flexDirection: "column", flexShrink: 0, paddingX: 1, ...pathTooltip, children: pathLines.map((line, index) => _jsx(Text, { dimColor: true, children: line }, index)) })), tab !== DSH_TAB && (_jsx(ForeignSessionPanes, { model: foreign, sourceLabel: activeSource?.label ?? tab, home: home, now: now, query: query, notice: notice, railVisible: railVisible, railWidth: railWidth, railEntryCapacity: visibleRailCapacity, sessionWidth: sessionWidth, rows: rows - pathRows, isTerminalFocused: isTerminalFocused, filterFocused: filterFocused, cursorActive: cursorActive, onFilterFocus: setFilterFocused })), tab === DSH_TAB && (_jsxs(Box, { flexDirection: "row", flexGrow: 1, flexShrink: 1, overflow: "hidden", children: [railVisible && (_jsxs("ink-box", { style: { flexDirection: 'column', width: railWidth, height: '100%', flexShrink: 0, overflow: 'hidden' }, onClick: focusRail, onMouseEnter: focusRail, onWheel: (event) => {
                            setFilterFocused(false);
                            moveRail(event.deltaY >= 0 ? 1 : -1);
                        }, children: [_jsx(Box, { height: 1, flexShrink: 0, overflow: "hidden", paddingX: 1, children: _jsx(Text, { dimColor: true, children: truncateWidth(railEntries.length === entries.length
                                        ? t('home-section-workspaces', { n: entries.length })
                                        : t('supervisor-workspace-groups', { registered: entries.length, history: railEntries.length - entries.length }), railWidth - 2) }) }), !loading && railEntries.length === 0 && (_jsx(Box, { paddingX: 1, children: _jsx(Text, { dimColor: true, italic: true, wrap: "truncate-end", children: truncateWidth(t('home-no-workspaces'), railWidth - 2) }) })), visibleRailRows.map((entry) => {
                                const absolute = railEntries.indexOf(entry);
                                return (_jsx(HomeWorkspaceRow, { title: entry.title, path: entry.path, home: home, sessionCount: countOf(entry), historyOnly: entry.from === 'unregistered', present: entry.present, selected: selected !== undefined && selected.id === entry.id, focused: activePane === 'rail' && railFocus === absolute, declareCursor: cursorActive && !searchCursor, width: railWidth, onSelect: (event) => {
                                        event.stopImmediatePropagation();
                                        setFilterFocused(false);
                                        railRef.current = absolute;
                                        setRailFocus(absolute);
                                        selectEntry(entry);
                                    }, onMenu: (event) => {
                                        event.stopImmediatePropagation();
                                        railRef.current = absolute;
                                        setRailFocus(absolute);
                                        const next = { path: entry.path, col: event.col, row: event.row, item: 0 };
                                        menuRef.current = next;
                                        setMenu(next);
                                    } }, entry.id));
                            }), _jsx(Box, { flexGrow: 1 }), _jsx(Box, { flexShrink: 0, paddingX: 1, children: _jsx(Text, { dimColor: true, italic: true, children: _jsx(HintLine, { text: railHint }) }) })] })), railVisible && (_jsx(Box, { width: 1, flexShrink: 0, flexDirection: "column", children: _jsx(Text, { dimColor: true, children: '│' }) })), _jsxs(Box, { flexDirection: "column", width: sessionWidth, height: "100%", flexShrink: 0, overflow: "hidden", onClick: focusList, onMouseEnter: focusList, children: [_jsx(Box, { height: 1, flexShrink: 0, overflow: "hidden", children: _jsxs(Box, { flexShrink: 1, overflow: "hidden", children: [_jsx(Text, { color: "remember", bold: true, children: truncateWidth(` ${t('home-sessions-title', { name: selected?.title ?? t('supervisor-title') })}`, Math.max(4, sessionWidth - 3)) }), _jsx(Text, { dimColor: true, children: `  ${truncateWidth((railVisible
                                                ? t('supervisor-counts', { working: workingCount, live: liveCount, total: visibleSessions.length })
                                                : String(visibleSessions.length)) + (refreshing ? ` · ${t('home-sessions-refreshing')}` : ''), Math.max(4, sessionWidth - 3))}` })] }) }), _jsx(Box, { height: 1, flexShrink: 0, paddingX: 1, onClick: event => {
                                    event.stopImmediatePropagation();
                                    activateList();
                                    setFilterFocused(true);
                                }, onMouseEnter: event => {
                                    event.stopImmediatePropagation();
                                    if (activePane !== 'list')
                                        activateList();
                                    setFilterFocused(true);
                                }, children: _jsx(SearchBox, { query: query, isFocused: activePane === 'list' || searchCursor, declareCursor: cursorActive && searchCursor, isTerminalFocused: isTerminalFocused, placeholder: truncateWidth(t('supervisor-filter-placeholder'), Math.max(8, sessionWidth - 6)), prefix: "/", borderless: true, width: Math.max(8, sessionWidth - 2) }) }), _jsxs(Box, { flexDirection: "column", flexShrink: 0, onMouseEnter: () => setFilterFocused(false), onClick: (event) => {
                                    event.stopImmediatePropagation();
                                    if (selected !== undefined)
                                        newSessionIn(selected);
                                }, children: [_jsxs(Box, { ref: newSessionCursorRef, height: 1, flexShrink: 0, overflow: "hidden", children: [_jsx(Text, { color: cardFocused ? 'success' : 'subtle', children: cardFocused ? '❯ ' : '  ' }), _jsx(Text, { color: cardFocused ? 'success' : undefined, bold: cardFocused, children: t('supervisor-new-session') })] }), _jsx(Box, { height: 1, flexShrink: 0, overflow: "hidden", children: _jsx(Text, { dimColor: true, children: `  ${truncateWidth(t('supervisor-new-session-hint', { name: selected?.title ?? t('supervisor-title') }), Math.max(8, sessionWidth - 3))}` }) })] }), _jsxs("ink-box", { style: { flexDirection: 'column', flexGrow: 1, flexShrink: 1, overflow: 'hidden' }, onMouseEnter: () => setFilterFocused(false), onWheel: (event) => {
                                    setFilterFocused(false);
                                    moveSession(event.deltaY >= 0 ? 1 : -1);
                                }, children: [loading && _jsx(Text, { dimColor: true, italic: true, children: ` ${truncateWidth(t('home-sessions-loading'), sessionWidth - 2)}` }), !loading && visibleSessions.length === 0 && (_jsx(Text, { dimColor: true, italic: true, children: ` ${truncateWidth(filtered ? t('supervisor-no-matches') : t('home-no-sessions'), sessionWidth - 2)}` })), visibleSessionRows.map((session, index) => {
                                        const state = liveStateOf(session.id);
                                        const holder = holderOf(session.id);
                                        return (_jsx(SessionListRow, { session: session, width: sessionWidth, depth: 0, focused: activePane === 'list' && sessionTop + index + 1 === sessionIndex, declareCursor: cursorActive && !searchCursor, pinned: pins.has(session.id), now: now, liveStatus: state?.live === true ? state.status : undefined, current: state?.current === true, occupiedPid: holder, onClick: (event) => {
                                                event.stopImmediatePropagation();
                                                setFocusSessionId(session.id);
                                                openSession(session);
                                            }, onTogglePin: () => {
                                                setFilterFocused(false);
                                                setFocusSessionId(session.id);
                                                persistPin(session.id, !pins.has(session.id));
                                            }, onContextMenu: (event) => {
                                                setFocusSessionId(session.id);
                                                const entry = selected;
                                                if (entry === undefined)
                                                    return;
                                                const next = { path: entry.path, col: event.col, row: event.row, item: 0 };
                                                menuRef.current = next;
                                                setMenu(next);
                                            } }, session.id));
                                    })] }), _jsx(Box, { flexShrink: 0, flexDirection: "column", height: noticeRows.length, overflow: "hidden", children: noticeRows.map((line, index) => (_jsx(Text, { color: notice?.tone === 'error' ? 'error' : 'success', children: ` ${line}` }, index))) }), _jsx(Box, { flexShrink: 0, children: _jsx(Text, { dimColor: true, italic: true, children: _jsx(HintLine, { text: sessionRename !== undefined ? t('supervisor-hint-session-rename') : filtered ? t('supervisor-hint-filter') : withTabHint(listHint) }) }) })] })] })), sessionRename !== undefined && (_jsx(Box, { height: 1, flexShrink: 0, children: _jsx(SearchBox, { query: sessionRename.draft, isFocused: true, isTerminalFocused: isTerminalFocused, placeholder: t('home-rename-placeholder'), prefix: "\u270E", borderless: true, width: "100%" }) })), confirmDelete !== undefined && (_jsx(Box, { flexShrink: 0, paddingX: 1, children: _jsx(Text, { color: "error", children: truncateWidth(` ${t(archiveSessions ? 'supervisor-archive-confirm' : 'supervisor-delete-confirm', { name: listedSessions.find(candidate => candidate.id === confirmDelete)?.title.text ?? confirmDelete })}`, columns - 3) }) })), rename !== undefined && (_jsx(Box, { height: 1, flexShrink: 0, children: _jsx(SearchBox, { query: rename.draft, isFocused: true, isTerminalFocused: isTerminalFocused, placeholder: t('home-rename-placeholder'), prefix: "\u270E", borderless: true, width: "100%" }) })), confirmRemove !== undefined && (_jsx(Box, { flexShrink: 0, paddingX: 1, onClick: () => {
                    const path = confirmRemove;
                    setConfirmRemove(undefined);
                    removeEntry(path);
                }, children: _jsx(Text, { color: "error", children: truncateWidth(` ${t('home-remove-title', { name: railEntries.find(entry => samePath(entry.path, confirmRemove))?.title ?? confirmRemove })} · ${t('home-remove-detail')}`, columns - 3) }) })), menu !== undefined && menuEntry !== undefined && (_jsx(Box, { position: "absolute", left: Math.max(0, Math.min(menu.col - inset.x + 1, Math.max(0, columns - MENU_WIDTH))), top: Math.max(0, Math.min(menu.row - inset.y + 1, Math.max(0, rows - (menuActions.length + 2)))), width: MENU_WIDTH, height: menuActions.length + 2, flexDirection: "column", flexShrink: 0, borderStyle: "round", borderColor: "permission", backgroundColor: "toolCardBackground", children: menuActions.map((action, index) => (_jsx(Box, { height: 1, flexShrink: 0, backgroundColor: index === menu.item ? 'userMessageBackgroundHover' : undefined, onMouseEnter: () => setMenu(current => (current === undefined ? current : { ...current, item: index })), onClick: (event) => {
                        event.stopImmediatePropagation();
                        const entry = railEntries.find(candidate => samePath(candidate.path, menu.path));
                        if (entry !== undefined)
                            activateMenu(entry, index);
                    }, children: _jsx(Text, { color: action === 'remove' ? 'error' : undefined, children: ` ${index === menu.item ? '❯' : ' '} ${t(MENU_LABEL_KEYS[action])}` }) }, action))) })), tabMenu !== undefined && tabLayout.hidden.length > 0 && (_jsx(Box, { position: "absolute", left: Math.max(0, Math.min(tabMenu.col - inset.x - tabMenuWidth + 2, Math.max(0, columns - tabMenuWidth))), top: Math.max(0, Math.min(tabMenu.row - inset.y + 1, Math.max(0, rows - tabLayout.hidden.length - 2))), width: tabMenuWidth, height: tabLayout.hidden.length + 2, flexDirection: "column", flexShrink: 0, borderStyle: "round", borderColor: "permission", backgroundColor: "toolCardBackground", children: tabLayout.hidden.map((hidden, index) => (_jsx(Box, { height: 1, flexShrink: 0, backgroundColor: index === tabMenu.item ? 'userMessageBackgroundHover' : undefined, onMouseEnter: () => setTabMenu(current => (current === undefined ? current : { ...current, item: index })), onClick: (event) => {
                        event.stopImmediatePropagation();
                        switchTab(hidden.id);
                    }, children: _jsx(Text, { children: truncateWidth(` ${index === tabMenu.item ? '❯' : ' '} ${hidden.label}`, tabMenuWidth - 2) }) }, hidden.id))) })), approval !== null && (_jsx(Box, { flexShrink: 0, flexDirection: "column", position: "absolute", bottom: 1, left: 0, width: columns, children: _jsx(ApprovalPanel, { approval: approval, background: approval.agentId !== channel.agentId, onDecide: onApprove }) }))] }));
}
/**
 * Scroll anchor for the rail: the first entry index to show.
 *
 * A pure helper (exported for the headless regression) because the rail's
 * window has to hold the focused row without re-shuffling under a stationary
 * cursor — the same anchoring rule the session list uses.
 *
 * `focus` is a plain entry index: the rail's rows ARE the ledger, so the cursor
 * and the selection are one position and the window math takes that position
 * directly. It used to be offset by the `+` row that led the rail, which is
 * gone — a workspace joins the ledger by being a terminal's launch directory.
 *
 * `capacity` is a count of ENTRIES, not of terminal rows. It used to be handed
 * the row count, which is wrong for this list in a way that hides the cursor:
 * each entry is {@link WORKSPACE_ROW_LINES} rows tall, so treating rows as
 * entries made the window believe it could show twice as many workspaces as it
 * can, and the focused entry was simply clipped away by `overflow="hidden"`
 * while the user navigated it blind.
 */
export function railWindowTop(focus, entryCount, capacity) {
    const entries = Math.max(1, capacity);
    if (focus < 0)
        return 0;
    let top = Math.max(0, focus - entries + 1);
    if (focus < top)
        top = focus;
    if (focus >= top + entries)
        top = focus - entries + 1;
    return Math.min(top, Math.max(0, entryCount - entries));
}
/** Re-exported so a regression can drive the spinner without importing ink. */
export { SpinnerGlyph };
