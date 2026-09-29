import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useCallback, useMemo, useRef, useState } from 'react';
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
import { useAnimationFrame } from '../ink/hooks/use-animation-frame.js';
import { isPlainReturn, isMod } from '../utils/modifiers.js';
import { truncateWidth } from '../sessions/format.js';
import { useSessionSupervisor } from './sessionSupervisor/useSessionSupervisor.js';
import { DSH_TAB, useForeignSessions } from './sessionSupervisor/useForeignSessions.js';
import { ForeignSessionPanes } from './sessionSupervisor/ForeignSessionPanes.js';
import { SourceTabs, layoutSourceTabs, sourceTabsWidth } from '../components/sessions/SourceTabs.js';
import { stringWidth } from '../ink/stringWidth.js';
import { SESSION_ROW_LINES, MENU_ACTIONS, MENU_WIDTH, MENU_HEIGHT, MENU_LABEL_KEYS, samePath, sessionMatchesQuery } from './sessionSupervisor/model.js';
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
    const { entries, sessions, loading, refreshing, notice, setNotice, query, setQuery, holderOf, listedSessions, railEntries, countOf, railFocus, setRailFocus, setFocusSessionId, activePane, pins, menu, setMenu, rename, setRename, confirmRemove, setConfirmRemove, railRef, menuRef, queryRef, now, reload, selected, visibleSessions, sessionIndex, cardFocused, sessionAt, activateList, activateRail, railWidth, railVisible, sessionWidth, railEntryCapacity, sessionListHeight, noticeRows, persistPin, selectEntry, openSession, newSessionIn, renameEntry, removeEntry, stopSession, closeMenu, activateMenu, moveRail, moveSession, focusedSession, } = useSessionSupervisor({ channel, home, onOpenSession, onNewSession, onStopSession, liveStateOf, columns, rows });
    /**
     * The source tab: this screen's own sessions ({@link DSH_TAB}) or another
     * coding agent's, by agent id. Every open starts on DSH — the screen is
     * where you manage your sessions first, and a foreign tab is a place you
     * visit.
     */
    const [tab, setTab] = useState(DSH_TAB);
    /** The `+N` dropdown of folded tabs, anchored where it was clicked. */
    const [tabMenu, setTabMenu] = useState(undefined);
    const tabMenuRef = useRef(tabMenu);
    tabMenuRef.current = tabMenu;
    const foreign = useForeignSessions({ channel, tab, registry: entries, query, setNotice, onOpenSession });
    /**
     * Only sources with data get a tab, after DSH, in a fixed order: ranking
     * them by recency would mean stat-ing every conversation of every source
     * each time this screen opens.
     */
    const tabs = useMemo(() => {
        if (foreign.sources.length === 0)
            return [];
        return [{ id: DSH_TAB, label: 'DSH' }, ...foreign.sources.map(source => ({ id: source.agentId, label: source.label }))];
    }, [foreign.sources]);
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
            if (key.upArrow) {
                const current = menuRef.current;
                const next = { ...current, item: (current.item + MENU_ACTIONS.length - 1) % MENU_ACTIONS.length };
                menuRef.current = next;
                setMenu(next);
            }
            else if (key.downArrow) {
                const current = menuRef.current;
                const next = { ...current, item: (current.item + 1) % MENU_ACTIONS.length };
                menuRef.current = next;
                setMenu(next);
            }
            else if (isPlainReturn(key)) {
                const current = menuRef.current;
                const entry = railEntries.find(candidate => samePath(candidate.path, current.path));
                if (entry !== undefined)
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
        // The filter is a LIVE query, not a mode you enter: this screen has no
        // second cursor for a text seat, and the rail/list already own the arrows
        // (a seat would have to relearn them). So printable input goes straight to
        // the query — without this branch the box rendered, focused, and could never
        // be typed into.
        if (key.backspace || key.delete) {
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
            if (typed.length > 0)
                setQuery(text => text + typed);
        }
    });
    // Working rows animate their glyph. The shared clock only runs while at
    // least one row is working, so an idle screen costs no extra ticks.
    const workingCount = listedSessions.filter(session => liveStateOf(session.id)?.status === 'working').length;
    const [, spinnerTime] = useAnimationFrame(workingCount > 0 ? 120 : null);
    const spinnerFrame = Math.floor(spinnerTime / 120);
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
            if (typed.length > 0)
                setQuery(text => text + typed);
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
    const withTabHint = (text) => (tabs.length === 0 ? text : `${text} · ${t('supervisor-hint-tabs')}`);
    const railHint = rename !== undefined
        ? t('home-hint-rename')
        : confirmRemove !== undefined
            ? t('home-hint-confirm-remove')
            : menu !== undefined
                ? t('home-hint-menu')
                : activePane === 'rail'
                    ? withTabHint(t('home-hint-list'))
                    : withTabHint(t('supervisor-hint-list'));
    const railWindowTopIndex = railWindowTop(railFocus, railEntries.length, railEntryCapacity);
    const visibleRailRows = railEntries.slice(railWindowTopIndex, railWindowTopIndex + railEntryCapacity);
    /** Content-local anchor for a keyboard-opened menu (screen coords minus inset). */
    const keyboardMenuAnchor = { col: inset.x + 2, row: inset.y + 3 };
    const filtered = query.trim().length > 0;
    // Scroll window over the session rows, keeping the focused row visible
    // without re-shuffling the list under a stationary cursor.
    //
    // The new-session card is a permanent row above this window, so the window is
    // one card shorter and the cursor is expressed in the FULL list's space (card =
    // 0): without that offset the window kept its old height and the cursor could
    // land on a row that never made it on screen — a `❯` on an invisible row.
    const capacity = Math.max(1, Math.floor(sessionListHeight / SESSION_ROW_LINES));
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
                            } }) }))] }), _jsx(Divider, { bleed: true }), tab !== DSH_TAB && (_jsx(ForeignSessionPanes, { model: foreign, sourceLabel: activeSource?.label ?? tab, home: home, now: now, query: query, notice: notice, railVisible: railVisible, railWidth: railWidth, railEntryCapacity: railEntryCapacity, sessionWidth: sessionWidth, rows: rows, isTerminalFocused: isTerminalFocused })), tab === DSH_TAB && (_jsxs(Box, { flexDirection: "row", flexGrow: 1, flexShrink: 1, overflow: "hidden", children: [railVisible && (_jsxs("ink-box", { style: { flexDirection: 'column', width: railWidth, height: '100%', flexShrink: 0, overflow: 'hidden' }, onClick: activateRail, onMouseEnter: activateRail, onWheel: (event) => {
                            moveRail(event.deltaY >= 0 ? 1 : -1);
                        }, children: [_jsx(Box, { height: 1, flexShrink: 0, overflow: "hidden", paddingX: 1, children: _jsx(Text, { dimColor: true, children: truncateWidth(t('home-section-workspaces', { n: railEntries.length }), railWidth - 2) }) }), !loading && railEntries.length === 0 && (_jsx(Box, { paddingX: 1, children: _jsx(Text, { dimColor: true, italic: true, wrap: "truncate-end", children: truncateWidth(t('home-no-workspaces'), railWidth - 2) }) })), visibleRailRows.map((entry) => {
                                const absolute = railEntries.indexOf(entry);
                                return (_jsx(HomeWorkspaceRow, { title: entry.title, path: entry.path, home: home, sessionCount: countOf(entry), present: entry.present, selected: selected !== undefined && selected.id === entry.id, focused: activePane === 'rail' && railFocus === absolute, width: railWidth, onSelect: (event) => {
                                        event.stopImmediatePropagation();
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
                            }), _jsx(Box, { flexGrow: 1 }), _jsx(Box, { flexShrink: 0, paddingX: 1, children: _jsx(Text, { dimColor: true, italic: true, children: _jsx(HintLine, { text: railHint }) }) })] })), railVisible && (_jsx(Box, { width: 1, flexShrink: 0, flexDirection: "column", children: _jsx(Text, { dimColor: true, children: '│' }) })), _jsxs(Box, { flexDirection: "column", width: sessionWidth, height: "100%", flexShrink: 0, overflow: "hidden", onClick: activateList, onMouseEnter: activateList, children: [_jsx(Box, { height: 1, flexShrink: 0, overflow: "hidden", children: _jsxs(Box, { flexShrink: 1, overflow: "hidden", children: [_jsx(Text, { color: "remember", bold: true, children: truncateWidth(` ${t('home-sessions-title', { name: selected?.title ?? t('supervisor-title') })}`, Math.max(4, sessionWidth - 3)) }), _jsx(Text, { dimColor: true, children: `  ${truncateWidth(t('supervisor-counts', { working: workingCount, live: liveCount, total: visibleSessions.length }) + (refreshing ? ` · ${t('home-sessions-refreshing')}` : ''), Math.max(4, sessionWidth - 3))}` })] }) }), _jsx(Box, { height: 1, flexShrink: 0, paddingX: 1, children: _jsx(SearchBox, { query: query, isFocused: activePane === 'list', isTerminalFocused: isTerminalFocused, placeholder: truncateWidth(t('supervisor-filter-placeholder'), Math.max(8, sessionWidth - 6)), prefix: "/", borderless: true, width: Math.max(8, sessionWidth - 2) }) }), _jsxs(Box, { flexDirection: "column", flexShrink: 0, onClick: (event) => {
                                    event.stopImmediatePropagation();
                                    if (selected !== undefined)
                                        newSessionIn(selected);
                                }, children: [_jsxs(Box, { height: 1, flexShrink: 0, overflow: "hidden", children: [_jsx(Text, { color: cardFocused ? 'success' : 'subtle', children: cardFocused ? '❯ ' : '  ' }), _jsx(Text, { color: cardFocused ? 'success' : undefined, bold: cardFocused, children: t('supervisor-new-session') })] }), _jsx(Box, { height: 1, flexShrink: 0, overflow: "hidden", children: _jsx(Text, { dimColor: true, children: `  ${truncateWidth(t('supervisor-new-session-hint', { name: selected?.title ?? t('supervisor-title') }), Math.max(8, sessionWidth - 3))}` }) })] }), _jsxs("ink-box", { style: { flexDirection: 'column', flexGrow: 1, flexShrink: 1, overflow: 'hidden' }, onWheel: (event) => {
                                    moveSession(event.deltaY >= 0 ? 1 : -1);
                                }, children: [loading && _jsx(Text, { dimColor: true, italic: true, children: ` ${truncateWidth(t('home-sessions-loading'), sessionWidth - 2)}` }), !loading && visibleSessions.length === 0 && (_jsx(Text, { dimColor: true, italic: true, children: ` ${truncateWidth(filtered ? t('supervisor-no-matches') : t('home-no-sessions'), sessionWidth - 2)}` })), visibleSessionRows.map((session, index) => {
                                        const state = liveStateOf(session.id);
                                        const holder = holderOf(session.id);
                                        return (_jsx(SessionListRow, { session: session, width: sessionWidth, depth: 0, focused: activePane === 'list' && sessionTop + index + 1 === sessionIndex, pinned: pins.has(session.id), now: now, liveStatus: state?.live === true ? state.status : undefined, current: state?.current === true, occupiedPid: holder, spinner: { frame: spinnerFrame, time: spinnerTime }, onClick: (event) => {
                                                event.stopImmediatePropagation();
                                                setFocusSessionId(session.id);
                                                openSession(session);
                                            }, onTogglePin: () => {
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
                                    })] }), _jsx(Box, { flexShrink: 0, flexDirection: "column", height: noticeRows.length, overflow: "hidden", children: noticeRows.map((line, index) => (_jsx(Text, { color: notice?.tone === 'error' ? 'error' : 'success', children: ` ${line}` }, index))) }), _jsx(Box, { flexShrink: 0, children: _jsx(Text, { dimColor: true, italic: true, children: _jsx(HintLine, { text: filtered ? t('supervisor-hint-filter') : withTabHint(t('supervisor-hint-list')) }) }) })] })] })), rename !== undefined && (_jsx(Box, { height: 1, flexShrink: 0, children: _jsx(SearchBox, { query: rename.draft, isFocused: true, isTerminalFocused: isTerminalFocused, placeholder: t('home-rename-placeholder'), prefix: "\u270E", borderless: true, width: "100%" }) })), confirmRemove !== undefined && (_jsx(Box, { flexShrink: 0, paddingX: 1, onClick: () => {
                    const path = confirmRemove;
                    setConfirmRemove(undefined);
                    removeEntry(path);
                }, children: _jsx(Text, { color: "error", children: truncateWidth(` ${t('home-remove-title', { name: railEntries.find(entry => samePath(entry.path, confirmRemove))?.title ?? confirmRemove })} · ${t('home-remove-detail')}`, columns - 3) }) })), menu !== undefined && (_jsx(Box, { position: "absolute", left: Math.max(0, Math.min(menu.col - inset.x + 1, Math.max(0, columns - MENU_WIDTH))), top: Math.max(0, Math.min(menu.row - inset.y + 1, Math.max(0, rows - MENU_HEIGHT))), width: MENU_WIDTH, height: MENU_HEIGHT, flexDirection: "column", flexShrink: 0, borderStyle: "round", borderColor: "permission", backgroundColor: "toolCardBackground", children: MENU_ACTIONS.map((action, index) => (_jsx(Box, { height: 1, flexShrink: 0, backgroundColor: index === menu.item ? 'userMessageBackgroundHover' : undefined, onMouseEnter: () => setMenu(current => (current === undefined ? current : { ...current, item: index })), onClick: (event) => {
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
