/**
 * Data, derived state and actions for the unified session screen.
 *
 * The screen keeps only assembly and key routing; everything that answers "what
 * is on screen and what does an action do" lives here. That is what makes the
 * two panes presentational and the derivations reachable from a regression.
 *
 * Two ownership rules must not be duplicated anywhere else:
 * - the cursor is ONE fact; every index is derived from it, so movement,
 *   rendering and Enter can never disagree;
 * - occupancy is re-read from the ledger on this screen own pulse and never
 *   captured from the parent render.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { basename } from 'node:path';
import { formatSessionRef } from '../../agent/refs.js';
import { t } from '../../i18n.js';
import { normalizeWorkspaceCwd } from '../../sessions/view.js';
import { readSessionPins, sessionPinsDir, setSessionPinned } from '../../sessionPins.js';
import { readSessionOwners } from '../../sessionMounts.js';
import { resumeFailureText } from '../../sessions/resumeFailure.js';
import { RAIL_CHROME_ROWS, WORKSPACE_ROW_LINES, RAIL_MIN_TOTAL_COLUMNS, RAIL_WIDTH_MIN, RAIL_WIDTH_MAX, SESSION_ROW_LINES, SESSION_PANE_CHROME_ROWS, noticeLines, menuActionsFor, UNREGISTERED_RAIL_ID, message, samePath, sessionMatchesQuery } from './model.js';
const listingSnapshots = new WeakMap();
/**
 * The snapshot slot for one channel, created on first use.
 * @param channel - The screen's channel, which owns the rows.
 * @returns The channel's slot, empty when it has never listed.
 */
function snapshotSlot(channel) {
    let slot = listingSnapshots.get(channel);
    if (slot === undefined) {
        slot = { rows: undefined, requestGeneration: 0 };
        listingSnapshots.set(channel, slot);
    }
    return slot;
}
/**
 * Derive the whole screen model.
 * @param input - Channel, home, the opening/stop actions and the live lookup.
 * @returns Every value the screen renders from, plus the action callbacks.
 */
export function useSessionSupervisor(input) {
    const { channel, home, onOpenSession, onNewSession, onStopSession, liveStateOf, columns, rows } = input;
    /**
     * The bound backend: the screen lists ITS sessions. A DSH
     * channel (or a partial headless one without a snapshot) keeps today's
     * screen exactly; another backend has no workspace ledger (`/workspace` is
     * a DSH command), keeps its pins in its own file, and its rows are
     * renamed / deleted through its catalog.
     */
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime guard: headless hosts pass partial channels
    const backendId = channel.backendCapabilities?.backendId ?? 'dsh';
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime guard: headless hosts pass partial channels
    const workspaceLedger = channel.backendCapabilities?.commands.includes('workspace') ?? true;
    const dshBackend = backendId === 'dsh';
    const archiveSessions = channel.backendCapabilities?.deleteAction === 'archive';
    const pinsDir = sessionPinsDir(backendId);
    const [entries, setEntries] = useState([]);
    // Lazy so a non-empty snapshot from this channel's previous mount paints as
    // the first frame, including after restart; undefined alone means unknown.
    const [sessions, setSessions] = useState(() => {
        const slot = snapshotSlot(channel);
        // Recheck the provider's scope on every mount (including service replacement).
        if (typeof channel.cachedSessions === 'function') {
            try {
                slot.rows = channel.cachedSessions();
            }
            catch {
                slot.rows = undefined;
            }
        }
        return slot.rows ?? [];
    });
    const [loading, setLoading] = useState(() => {
        const snapshot = snapshotSlot(channel).rows;
        return snapshot === undefined;
    });
    const [refreshing, setRefreshing] = useState(true);
    const [notice, setNotice] = useState(undefined);
    /** Live status and occupancy are re-read on their own clock, not the listing's. */
    const [pulse, setPulse] = useState(0);
    const [query, setQuery] = useState('');
    /**
     * Cross-process occupancy, re-read on the SAME tick as the live state.
     *
     * This has to be read here, not captured by the host: the ledger is a file
     * another process writes, so a snapshot taken during the parent's render went
     * stale the moment it was taken and nothing re-took it — the parent does not
     * re-render on this screen's 2s pulse, so a foreign terminal that acquired or
     * released a session left the row red (and unclickable) until some unrelated
     * channel event happened to repaint. Reading behind a pulse-keyed ref keeps
     * it to one read per tick while the rows and the click guard always see the
     * current holder.
     */
    const occupancyRef = useRef(new Map());
    const occupancyPulseRef = useRef(-1);
    if (occupancyPulseRef.current !== pulse) {
        occupancyPulseRef.current = pulse;
        occupancyRef.current = readSessionOwners();
    }
    const holderOf = useCallback((sessionId) => {
        // The ledger keys a non-DSH session by its backend-qualified reference
        // (`claude:<id>`); DSH ids stay bare.
        const owner = occupancyRef.current.get(formatSessionRef({ backendId, sessionId }));
        return owner === undefined || owner.pid === process.pid ? undefined : owner.pid;
    }, [backendId]);
    /**
     * Sessions eligible for this screen, computed ONCE per listing so the rail's
     * per-workspace counts and the pane's rows always agree.
     *
     * Three things are hidden, and the third is the one that is easy to lose:
     * a delegated run (its own row belongs to the agent-run folding, not to a
     * workspace listing), a log holding no conversation, and the CURRENT
     * session's fork ANCESTORS. The last one matters because a `/resume` fork
     * records `parentSession` exactly like a delegated run does — listing the
     * chain makes one conversation look like several, with no way to tell which
     * row continues what the user is looking at.
     *
     * The current session itself stays listed (marked `current` by the live
     * state): this screen exists to show what the terminal hosts, and "the one
     * you are in" is the row the user is most likely looking for. Only the
     * ancestors go — they are the same conversation at an earlier point, which
     * the current row already represents. `buildView` hides the current id as
     * well because its list has no live-state column to mark it with.
     */
    const listedSessions = useMemo(() => {
        const byId = new Map(sessions.map(session => [session.id, session]));
        const ancestors = new Set();
        let cursor = byId.get(channel.agentId);
        while (cursor?.kind.kind === 'fork') {
            const parent = cursor.kind.parent;
            if (parent === undefined || ancestors.has(parent))
                break;
            ancestors.add(parent);
            cursor = byId.get(parent);
        }
        return sessions.filter(session => session.hasPrompt && session.kind.kind !== 'subagent' && !ancestors.has(session.id));
    }, [sessions, channel.agentId]);
    /**
     * The rail's rows: the durable registry, plus rows for sessions that live in
     * a directory the registry does not know (or while it cannot be read at all).
     *
     * The registry is the sidebar's own ledger, and it is genuinely OPTIONAL:
     * `createLocalWorkspaceRuntime()` supports compositions with no workspace
     * stack and returns an empty one, a registration can be removed while its
     * session logs stay on disk, and the service itself can reject. Sessions in
     * every one of those cases are still resumable — the persistence store, not
     * the registry, is what holds them — so an empty rail must not render "no
     * history" and leave them unreachable.
     *
     * Each unregistered directory gets its OWN row (titled by its basename), so
     * the rail keeps telling the user WHERE a session ran; when even the session
     * paths are unavailable they all land in one synthetic group. These rows live
     * only inside this screen and are never written back to the ledger.
     */
    const railEntries = useMemo(() => {
        const orphans = listedSessions.filter(session => !entries.some(entry => samePath(entry.path, session.cwd)));
        if (orphans.length === 0)
            return entries;
        const byCwd = new Map();
        for (const session of orphans) {
            const key = normalizeWorkspaceCwd(session.cwd);
            const existing = byCwd.get(key);
            if (existing === undefined)
                byCwd.set(key, { path: session.cwd, count: 1 });
            else
                existing.count += 1;
        }
        return [...entries, ...[...byCwd.entries()].map(([key, group]) => ({
                id: `${UNREGISTERED_RAIL_ID}:${key === '' ? 'unknown' : key}`,
                path: group.path === '' ? UNREGISTERED_RAIL_ID : group.path,
                title: basename(group.path) || t('supervisor-unregistered'),
                present: true,
                sessionCount: group.count,
                from: 'unregistered',
            }))];
    }, [entries, listedSessions]);
    const groupedEntries = useMemo(() => {
        const groups = new Map();
        for (const session of listedSessions) {
            const path = railEntries.find(entry => entry.from === 'registry' && samePath(entry.path, session.cwd))?.path
                ?? (session.cwd === '' ? UNREGISTERED_RAIL_ID : session.cwd);
            const bucket = groups.get(path);
            if (bucket === undefined)
                groups.set(path, [session]);
            else
                bucket.push(session);
        }
        return groups;
    }, [listedSessions, railEntries]);
    /** Session count for one rail row, from the same grouping the pane uses. */
    const countOf = useCallback((entry) => (groupedEntries.get(entry.path) ?? []).length, [groupedEntries]);
    const [railFocus, setRailFocus] = useState(0);
    /**
     * F3 fork: the pane shows THIS terminal's working directory, always.
     *
     * The stock screen derives this from the rail's selection (the terminal's
     * directory, else the first ledger record, unless the user picked a row by
     * hand). With the rail gone there is nothing to pick and nothing to fall
     * back to: the directory the terminal is in is the scope, and a directory
     * with no sessions shows an empty list rather than another project's.
     *
     * The entry is synthesized because the screen's call sites expect one
     * (`path` for `newSessionIn`, `title` for the headers). `path` takes the
     * registry's spelling of the directory when it is registered, so a new
     * session opens the same workspace record the rail would have offered.
     */
    const selected = useMemo(() => {
        const registered = railEntries.find(entry => entry.from === 'registry' && samePath(entry.path, channel.cwd))?.path;
        const path = registered ?? (channel.cwd === '' ? UNREGISTERED_RAIL_ID : channel.cwd);
        return {
            id: `cwd:${path}`,
            path,
            title: basename(channel.cwd) || t('supervisor-unregistered'),
            present: true,
            sessionCount: (groupedEntries.get(path) ?? []).length,
            from: 'cwd',
        };
    }, [railEntries, groupedEntries, channel.cwd]);
    /**
     * The session the cursor opens on: the most recently used one in THIS
     * directory, which is row 0 of the pane's own order only while no live
     * session sorts above it.
     *
     * F2 fork: derived from the same list the pane shows (`listedSessions` by
     * `samePath`) instead of the rail's grouping key. The rail key exists only
     * for directories the workspace ledger knows, and with the pane pinned to a
     * directory that may never have been registered, the lookup came back empty
     * — the cursor then fell to whatever row sorted first (an older session that
     * merely happened to be live), not to the session the user had just used.
     */
    const recentSessionId = useMemo(() => {
        const needle = query.trim().toLowerCase();
        let recent;
        for (const session of listedSessions) {
            if (!samePath(session.cwd, channel.cwd) || !sessionMatchesQuery(session, needle))
                continue;
            if (recent === undefined || session.updatedAt > recent.updatedAt)
                recent = session;
        }
        return recent?.id;
    }, [listedSessions, channel.cwd, query]);
    /**
     * The session column's cursor, as ONE fact.
     *
     * It used to be three: a `sessionFocus` index, a `sessionFocusRef` mirror and
     * a `focusSessionId`, with the render deriving the index from the id while
     * Enter read the ref. The filter and the live-state re-sort move rows, so the
     * ref went stale and Enter opened a row other than the one under `❯`. The id
     * (or the card) is stored here and the index is always DERIVED from it.
     */
    /**
     * The cursor of the session column, as ONE fact: the session id it is on, or
     * undefined for the new-session card.
     *
     * The screen used to keep an index, a ref mirror and an id beside each other,
     * with the render deriving an index from the id while Enter read the ref. The
     * filter and the live-state re-sort move rows, so the stored index kept
     * pointing at the offset it had held while `❯` was drawn from the id — Enter
     * then acted on a row the user had never selected. There is one fact now, and
     * {@link focusIndex} is derived from it for the render, for movement and for
     * Enter alike.
     */
    const [focusSessionId, setFocusSessionIdState] = useState(recentSessionId);
    const initialFocusPending = useRef(true);
    const setFocusSessionId = useCallback((id) => {
        initialFocusPending.current = false;
        setFocusSessionIdState(id);
    }, []);
    // Keep the workspace's default current until the user chooses a list row.
    React.useEffect(() => {
        if (!initialFocusPending.current)
            return;
        setFocusSessionIdState(recentSessionId);
    }, [recentSessionId]);
    /**
     * Which column owns the keyboard, and therefore which column draws the `❯`
     * cursor. Exactly one at a time: two cursors mean "where does Enter go?" has
     * no answer, and ←/→ is how this screen answers it.
     */
    const [activePane, setActivePane] = useState('list');
    const [pins, setPins] = useState(() => readSessionPins(pinsDir));
    /** A stored session being renamed / confirmed for deletion (non-DSH rows). */
    const [sessionRename, setSessionRename] = useState(undefined);
    const [confirmDelete, setConfirmDelete] = useState(undefined);
    const [menu, setMenu] = useState(undefined);
    const [rename, setRename] = useState(undefined);
    const [confirmRemove, setConfirmRemove] = useState(undefined);
    const railRef = useRef(railFocus);
    railRef.current = railFocus;
    const menuRef = useRef(menu);
    menuRef.current = menu;
    const queryRef = useRef(query);
    queryRef.current = query;
    const now = Date.now();
    /**
     * One cheap tick that re-derives live status and cross-process occupancy.
     *
     * Deliberately NOT a re-listing: the listing is the expensive part (a stat
     * per session and a revision-keyed digest), while status and occupancy are
     * two in-memory reads over data the process already holds. So the tick is
     * affordable at a rate that keeps `/resume` honest about a sibling
     * terminal — the user sees another TUI take or release a session while
     * looking at the screen, without this screen re-reading the session store.
     */
    React.useEffect(() => {
        const timer = setInterval(() => setPulse(value => value + 1), 2000);
        return () => clearInterval(timer);
    }, []);
    /**
     * Reload the ledger and the session listing together.
     *
     * One `listSessions()` pass feeds every workspace: re-reading the whole
     * store per workspace click would be both slower and inconsistent between
     * the two panes.
     *
     * The ledger read degrades to an EMPTY rail when the host does not expose it,
     * instead of failing the whole reload: `/bg` opens this screen, and a host
     * written before the workspace ledger existed (the older in-repo regressions
     * compose exactly that) would otherwise get "failed to read sessions" on
     * screen and lose the session listing with it. The session list is the half
     * this screen cannot work without, so it must survive a missing ledger.
     */
    const reload = useCallback(async () => {
        // Claim this reload's generation before the first await: everything below
        // only publishes while it is still the newest request, so a slower earlier
        // one that lands later cannot repaint the screen (or the snapshot) with
        // rows the newer listing has already corrected.
        const slot = snapshotSlot(channel);
        const generation = ++slot.requestGeneration;
        setRefreshing(true);
        // The two reads are independent, and the session listing is the half this
        // screen cannot work without: a registry that rejects (bare composition,
        // unmounted service, a provider throwing) must not take the history down
        // with it. So the listing is settled on its own, and a registry failure
        // degrades to the empty rail the cwd-derived fallback groups already cover.
        await Promise.all([
            (async () => {
                try {
                    const fresh = await channel.listSessions(enriched => {
                        if (slot.requestGeneration !== generation)
                            return;
                        slot.rows = slot.rows?.map(row => row.id === enriched.id ? enriched : row);
                        setSessions(current => current.map(row => row.id === enriched.id ? enriched : row));
                    }, partial => {
                        // Fresh workspace rows supersede cached metadata immediately;
                        // retain other cached workspaces until the full listing arrives.
                        if (slot.requestGeneration !== generation)
                            return;
                        setSessions(current => [...new Map([...current, ...partial].map(row => [row.id, row])).values()]
                            .sort((left, right) => right.updatedAt - left.updatedAt));
                        setLoading(false);
                    });
                    // Recorded only after success: a failed listing keeps the previous
                    // snapshot, and only the newest reload may write it.
                    if (slot.requestGeneration !== generation)
                        return;
                    slot.rows = fresh;
                    setSessions(fresh);
                    setNotice(current => (current?.tone === 'error' ? undefined : current));
                }
                catch (error) {
                    if (slot.requestGeneration !== generation)
                        return;
                    setNotice({ text: t('home-sessions-failed', { err: message(error) }), tone: 'error' });
                }
            })(),
            (async () => {
                try {
                    const registry = typeof channel.listWorkspaceRegistry === 'function' && workspaceLedger
                        ? await channel.listWorkspaceRegistry()
                        : [];
                    if (slot.requestGeneration !== generation)
                        return;
                    setEntries(registry.map(entry => ({ ...entry, from: 'registry' })));
                }
                catch {
                    // An unreadable registry is not an empty history: the sessions stay
                    // listed (and resumable) under the cwd-derived fallback groups.
                    if (slot.requestGeneration !== generation)
                        return;
                    setEntries([]);
                }
            })(),
        ]);
        if (slot.requestGeneration === generation) {
            setLoading(false);
            setRefreshing(false);
        }
    }, [channel, workspaceLedger, channel.cwd, channel.ready]);
    React.useEffect(() => {
        void reload();
    }, [reload]);
    React.useEffect(() => () => {
        snapshotSlot(channel).requestGeneration++;
    }, [channel]);
    // The cursor indexes the entry list directly (there is no `+` row in front of
    // it), so a shrinking ledger has to pull it back inside or the last row would
    // highlight nothing.
    React.useEffect(() => {
        setRailFocus(current => Math.min(current, Math.max(0, railEntries.length - 1)));
    }, [railEntries.length]);
    /**
     * Sessions whose recorded cwd is the selected workspace, minus the search
     * Sessions recorded in this terminal's directory, minus the search
     * filter. Live sessions in the directory sort above stopped ones, then by
     * recency: what this terminal is currently running is what the user is
     * most likely switching between.
     */
    const visibleSessions = useMemo(() => {
        const needle = query.trim().toLowerCase();
        void pulse;
        // F3 fork: rows are matched by DIRECTORY (`samePath`), not by the rail
        // group's exact key, so a session logged under a trailing slash or
        // another case still belongs to the directory the terminal is in.
        return listedSessions
            .filter(session => samePath(session.cwd, channel.cwd))
            .filter(session => sessionMatchesQuery(session, needle))
            .slice()
            .sort((left, right) => {
            const leftLive = liveStateOf(left.id)?.live === true ? 1 : 0;
            const rightLive = liveStateOf(right.id)?.live === true ? 1 : 0;
            return rightLive - leftLive || right.updatedAt - left.updatedAt;
        });
    }, [listedSessions, channel.cwd, query, liveStateOf, pulse]);
    /**
     * Cursor identity: rows reorder on every reload and filter, so the cursor
     * follows an ID rather than an index.
     *
     * F3 fork: the new-session row is gone (`Ctrl+N` still creates one), so row
     * 0 IS the first session and an empty list has no row to stand on.
     */
    const sessionIndex = useMemo(() => {
        if (focusSessionId === undefined)
            return 0;
        const byId = visibleSessions.findIndex(session => session.id === focusSessionId);
        // A focused session the filter removed must not leave the cursor on a
        // stale id: Enter acts on whatever the cursor stands on.
        return byId >= 0 ? byId : 0;
    }, [visibleSessions, focusSessionId]);
    /** Row 0 is the first session (F3 fork: no new-session card). */
    const sessionAt = useCallback((index) => visibleSessions[index], [visibleSessions]);
    /** Enter the session column without changing its selected row. */
    const activateList = useCallback(() => {
        setActivePane('list');
    }, []);
    /**
     * F3 fork: ← used to hand the keyboard to the workspace rail. There is no
     * rail any more, so the key is deliberately inert — the list keeps the
     * keyboard and `❯` never leaves the rows the user can act on.
     */
    const activateRail = useCallback(() => {
    }, []);
    const railWidth = columns >= RAIL_MIN_TOTAL_COLUMNS
        ? Math.min(RAIL_WIDTH_MAX, Math.max(RAIL_WIDTH_MIN, Math.floor(columns * 0.3)))
        : columns;
    /** F3 fork: the rail is never rendered; the list takes the whole width. */
    const railVisible = false;
    const sessionWidth = Math.max(20, columns - (railVisible ? railWidth + 1 : 0));
    const railListHeight = Math.max(1, rows - RAIL_CHROME_ROWS);
    /**
     * How many WHOLE workspaces the rail can show. `HomeWorkspaceRow` is always
     * {@link WORKSPACE_ROW_LINES} rows, so the row budget has to be divided by
     * that before it can be used as a window size; handing the row count to the
     * window math directly let the list render twice as many entries as fit and
     * clipped the focused one out of the viewport.
     */
    const railEntryCapacity = Math.max(1, Math.floor(railListHeight / WORKSPACE_ROW_LINES));
    /**
     * The notice wraps (a mount refusal carries the adapter's full error), and
     * every row it takes beyond its reserved one comes out of the list window —
     * otherwise the list would overflow and clip the focused row instead.
     */
    // Wrapped to the VISIBLE width: below 20 columns the pane keeps its 20-cell
    // floor and the renderer clips at the terminal edge, which would cut every
    // notice row short of the reason it carries.
    const noticeRows = noticeLines(notice?.text, Math.max(0, Math.min(sessionWidth, columns) - 3));
    const sessionListHeight = Math.max(SESSION_ROW_LINES, rows - SESSION_PANE_CHROME_ROWS - (noticeRows.length - 1));
    const report = useCallback((text, tone) => {
        setNotice({ text, tone });
    }, []);
    const persistPin = useCallback((id, pinned) => {
        const result = setSessionPinned(id, pinned, pinsDir);
        if (!result.ok) {
            report(t('resume-pin-save-failed'), 'error');
            return;
        }
        setPins(result.pins);
    }, [report, pinsDir]);
    /** Rename a stored session through the backend's catalog (non-DSH rows). */
    const renameSession = useCallback((sessionId, title) => {
        const next = title.trim();
        if (next === '') {
            report(t('home-rename-empty'), 'error');
            return;
        }
        void channel.renameSessionTo(sessionId, next)
            .then((ok) => {
            if (ok)
                return reload();
            report(t('rename-failed', { err: '' }), 'error');
            return undefined;
        })
            .catch(error => report(t('rename-failed', { err: message(error) }), 'error'));
    }, [channel, reload, report]);
    /**
     * Delete a stored session through the backend's catalog (non-DSH rows):
     * never the one this terminal is in, never one another terminal holds.
     */
    const deleteSession = useCallback((session) => {
        if (liveStateOf(session.id)?.current === true) {
            report(t(archiveSessions ? 'supervisor-archive-current' : 'supervisor-delete-current'), 'error');
            return;
        }
        const holder = holderOf(session.id);
        if (holder !== undefined) {
            report(t('supervisor-occupied', { pid: holder }), 'error');
            return;
        }
        void channel.deleteSession(session.id)
            .then((ok) => {
            if (!ok) {
                report(t(archiveSessions ? 'supervisor-archive-failed' : 'supervisor-delete-failed', { name: session.title.text }), 'error');
                return undefined;
            }
            report(t(archiveSessions ? 'supervisor-archived' : 'supervisor-deleted', { name: session.title.text }), 'info');
            return reload();
        })
            .catch(error => report(t(archiveSessions ? 'session-archive-failed' : 'session-delete-failed', { err: message(error) }), 'error'));
    }, [archiveSessions, channel, holderOf, liveStateOf, reload, report]);
    /**
     * F3 fork: the stock screen selects a rail row here. The pane is pinned to
     * this terminal's directory, so the call sites that remain (a rail click,
     * the workspace action menu) have no other scope to select; they only reset
     * the session cursor.
     */
    const selectEntry = useCallback(() => {
        setFocusSessionIdState(undefined);
    }, []);
    /**
     * Mount a session, refusing one another terminal holds.
     *
     * The occupancy test runs here as well as in the adapter: the adapter's is
     * the authority (it must hold for every caller), but checking first lets the
     * screen say WHICH terminal owns the session instead of reporting a generic
     * failure, and keeps a refused row from looking like a broken one.
     */
    const openSession = useCallback((session) => {
        const holder = holderOf(session.id);
        if (holder !== undefined) {
            report(t('supervisor-occupied', { pid: holder }), 'error');
            return;
        }
        setNotice(undefined);
        void onOpenSession(session.id)
            .then((result) => {
            // The reason is shown HERE, not in a channel notification: this
            // screen replaces the conversation, so the composer that draws
            // notifications is not mounted and a "see below" pointer led nowhere.
            // `cancelled` stays silent (the user or a rival switch asked for it).
            // A plain failure shows the bare error: "Could not enter" already says
            // resuming failed, and the rows it would repeat are the error's own.
            const reason = !result.ok && result.reason === 'failed' ? result.error : resumeFailureText(result);
            if (reason !== undefined)
                report(t('supervisor-open-failed', { name: session.title.text, reason }), 'error');
        })
            .catch(error => report(t('session-resume-failed', { err: message(error) }), 'error'));
    }, [holderOf, onOpenSession, report]);
    const newSessionIn = useCallback((entry) => {
        setNotice(undefined);
        void channel.resolveWorkspace(entry.path)
            .then((target) => {
            if (target === undefined) {
                report(t('workspace-open-invalid', { target: entry.path }), 'error');
                return undefined;
            }
            return onNewSession(target).then((ok) => {
                if (!ok)
                    report(t('new-session-failed', { err: '' }), 'error');
                return ok;
            });
        })
            .catch(error => report(t('new-session-failed', { err: message(error) }), 'error'));
    }, [channel, onNewSession, report]);
    const renameEntry = useCallback((path, title) => {
        const next = title.trim();
        if (next === '') {
            report(t('home-rename-empty'), 'error');
            return;
        }
        void channel.renameWorkspaceAt(path, next)
            .then((ok) => {
            if (ok)
                return reload();
            report(t('home-rename-failed', { err: '' }), 'error');
            return undefined;
        })
            .catch(error => report(t('home-rename-failed', { err: message(error) }), 'error'));
    }, [channel, reload, report]);
    const removeEntry = useCallback((path) => {
        void channel.removeWorkspace(path)
            .then((ok) => {
            if (ok) {
                report(t('supervisor-workspace-removed'), 'info');
                return reload();
            }
            report(t('workspace-remove-unknown', { target: path }), 'error');
            return undefined;
        })
            .catch(error => report(t('workspace-remove-failed', { err: message(error) }), 'error'));
    }, [channel, reload, report]);
    /** Stop a parked background session; the attached one is not stoppable. */
    const stopSession = useCallback((session) => {
        const state = liveStateOf(session.id);
        if (state?.current === true) {
            report(t('supervisor-stop-current'), 'error');
            return;
        }
        if (state?.live !== true)
            return;
        void onStopSession(session.id)
            .then((stopped) => {
            report(stopped ? t('supervisor-stopped', { name: session.title.text }) : t('supervisor-stop-failed'), stopped ? 'info' : 'error');
        })
            .catch((error) => report(t('supervisor-stop-failed') + ` · ${message(error)}`, 'error'));
    }, [liveStateOf, onStopSession, report]);
    const closeMenu = useCallback(() => {
        menuRef.current = undefined;
        setMenu(undefined);
    }, []);
    const activateMenu = useCallback((entry, item) => {
        closeMenu();
        const action = menuActionsFor(entry)[item];
        if (action === undefined)
            return;
        if (action === 'edit')
            selectEntry(entry);
        else if (action === 'new')
            newSessionIn(entry);
        // The fallback group is not a registration, so there is no ledger row to
        // rename or drop: those two actions would either fail or (worse) try to
        // mutate a record that does not exist.
        else if (entry.from === 'unregistered')
            return;
        else if (action === 'rename')
            setRename({ path: entry.path, draft: entry.title });
        else
            setConfirmRemove(entry.path);
    }, [closeMenu, newSessionIn, selectEntry]);
    const moveRail = useCallback((by) => {
        // The rail is the ledger (plus the unregistered fallback group), so every
        // row is a workspace and the cursor is an entry index over that list alone.
        const total = Math.max(1, railEntries.length);
        const next = (railRef.current + by + total) % total;
        railRef.current = next;
        setRailFocus(next);
        const entry = railEntries[next];
        if (entry !== undefined)
            selectEntry(entry);
    }, [railEntries, selectEntry]);
    const moveSession = useCallback((by) => {
        const total = visibleSessions.length;
        if (total === 0) {
            setFocusSessionId(undefined);
            return;
        }
        const next = Math.min(total - 1, Math.max(0, sessionIndex + by));
        const landed = sessionAt(next);
        setFocusSessionId(landed?.id);
    }, [visibleSessions, sessionAt, sessionIndex, setFocusSessionId]);
    /** The session under the cursor, or undefined while the list is empty. */
    const focusedSession = sessionAt(sessionIndex);
    return {
        dshBackend,
        archiveSessions,
        sessionRename,
        setSessionRename,
        confirmDelete,
        setConfirmDelete,
        renameSession,
        deleteSession,
        entries,
        sessions,
        loading,
        refreshing,
        notice,
        setNotice,
        query,
        setQuery,
        holderOf,
        listedSessions,
        railEntries,
        countOf,
        railFocus,
        setRailFocus,
        setFocusSessionId,
        activePane,
        pins,
        menu,
        setMenu,
        rename,
        setRename,
        confirmRemove,
        setConfirmRemove,
        railRef,
        menuRef,
        queryRef,
        now,
        reload,
        selected,
        visibleSessions,
        sessionIndex,
        sessionAt,
        activateList,
        activateRail,
        railWidth,
        railVisible,
        sessionWidth,
        railEntryCapacity,
        sessionListHeight,
        noticeRows,
        persistPin,
        selectEntry,
        openSession,
        newSessionIn,
        renameEntry,
        removeEntry,
        stopSession,
        closeMenu,
        activateMenu,
        moveRail,
        moveSession,
        focusedSession,
    };
}
