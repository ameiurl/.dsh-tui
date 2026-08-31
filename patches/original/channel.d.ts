import { type Agent, type AgentHandle, type AgentStatus } from '@deepseek-ai/dsh-agent';
import type { LlmModelInfo, LlmProviderInfo } from '@deepseek-ai/dsh-llm';
import { type ContentBlock } from '@deepseek-ai/dsh-llm';
import { type RecapOutcome } from './recap.js';
import { type BalanceResult } from '../deepseekBalance.js';
import { type SessionEvent } from '@deepseek-ai/dsh-session';
import type { Context } from '@deepseek-ai/cordis';
import { type CommandCompletion, type LocalCommand } from '../commands.js';
import { type SessionTreeData } from './sessionTree.js';
import { type PreviewEntry, type SessionSummary } from './sessions/index.js';
import { type FileCandidate } from '../utils/fileSuggestions.js';
import type { OAuthProviderStatus, ProviderSetupHost } from './providerWizard.js';
import { type SessionModeSpec } from '../sessionModes.js';
import { type ScrollGutterMode, type StatusBarConfig, type ToolBackground } from '../tuiDisplayPrefs.js';
import { type SubagentState } from './subagents.js';
export type { SubagentState } from './subagents.js';
import { type BackgroundJobState, type BackgroundJobStatus } from './jobs.js';
import type { SpinnerMode } from '../components/Spinner/spinnerMode.js';
import { type ActivityState } from 'dsh-working-activity/status';
import { type TuiWorkspaceCommand, type TuiWorkspaceCommandResult, type TuiWorkspaceTarget } from './workspaces.js';
import { type TuiSettingsSection } from './settings-sections.js';
import type { SettingsHost } from './settingsEditor.js';
import { type TuiSceneDescriptor } from './scenes.js';
import type { TuiRewindMode } from './extension-events.js';
type ChannelImageBlock = Extract<ContentBlock, {
    type: 'image';
}>;
type ChannelImageMediaType = ChannelImageBlock['attachment']['mediaType'];
export interface StagedImageInput {
    data: Uint8Array;
    mediaType: ChannelImageMediaType;
    name?: string;
}
/** Tool-call card state, mirroring the Claude Code tool-use presentation. */
export interface ToolRow {
    readonly callId: string;
    readonly name: string;
    /** Raw JSON arguments as the model produced them (displayed truncated). */
    readonly argsText: string;
    /** Full arguments, shown when Ctrl+O verbose mode is on; dropped when the
     *  row is folded (session log retains it). */
    argsFull?: string;
    status: 'running' | 'ok' | 'error';
    resultText?: string;
    /** Full result text, shown when Ctrl+O verbose mode is on. */
    resultFull?: string;
    errorText?: string;
    /** Tool-owned render intent from dsh-tools `presentCall` (diff/terminal/
     *  generic). Drives the structured card body instead of the raw text. */
    callView?: ToolCallView;
    /** Tool-owned completed-state view from `presentResult` (applied diff
     *  hunks, terminal output, read content…). Wins over callView once set. */
    resultView?: ToolResultView;
    /** Wall-clock start of the call (live elapsed while running). */
    startedAt: number;
    /** Settled wall-clock duration, written by tool/result. */
    durationMs?: number;
}
/** One file change in a tool presentation (dsh-tools FileDiff). */
export interface ToolFileDiff {
    readonly path: string;
    /** Prior content, or null for a new file / no before-image. */
    readonly oldText: string | null;
    readonly newText: string;
}
/** Pending-call render intent (structural subset of dsh-tools ToolCallView). */
export type ToolCallView = {
    readonly card: 'generic';
    readonly title: string;
    readonly kind?: string;
} | {
    readonly card: 'terminal';
    readonly title: string;
    readonly description?: string;
    readonly cwd?: string;
} | {
    readonly card: 'diff';
    readonly title: string;
    readonly diffs: readonly ToolFileDiff[];
};
/** Completed-call render intent (structural subset of dsh-tools
 *  ToolResultView). `web` results and unknown shapes fall back to raw text. */
export type ToolResultView = {
    readonly card: 'generic';
    readonly title?: string;
    readonly content?: ReadonlyArray<{
        readonly type: string;
        readonly text?: string;
    }>;
} | {
    readonly card: 'terminal';
    readonly title?: string;
    readonly output?: string;
    readonly exitCode?: number;
    readonly signal?: string;
} | {
    readonly card: 'diff';
    readonly title?: string;
    readonly diffs: readonly ToolFileDiff[];
} | {
    readonly card: 'read';
    readonly title?: string;
    readonly path?: string;
    readonly content?: ReadonlyArray<{
        readonly type: string;
        readonly text?: string;
    }>;
} | {
    readonly card: 'search';
    readonly shape: 'matches';
    readonly title?: string;
    readonly files: ReadonlyArray<{
        readonly path: string;
        readonly matches: ReadonlyArray<{
            readonly lineNumber: number;
            readonly line: string;
        }>;
    }>;
    readonly truncated: boolean;
    readonly total: number;
} | {
    readonly card: 'search';
    readonly shape: 'paths';
    readonly title?: string;
    readonly paths: readonly string[];
    readonly truncated: boolean;
    readonly total: number;
};
/** Re-derives the presentation views foldRows dropped, threaded into
 *  foldBack (module-level, no ctx access) by the channel. */
export interface ToolViewPresenter {
    call(name: string, rawArgs: string): ToolCallView | undefined;
    result(name: string, rawArgs: string, data: SessionEvent<'tool/result'>['data']): ToolResultView | undefined;
}
/**
 * Subagent row: displays a subagent's lifecycle (started → running → completed/failed).
 * Derived from agent.task events and history events.
 */
export interface SubagentControl {
    interrupt(agentId: string): boolean;
}
/**
 * Background-job row control (`/jobs` panel): cancellation with the same
 * authority the owning agent itself would use (`job_kill`). Returns false
 * when the jobs service is absent or the job is unknown/foreign.
 */
export interface JobControl {
    kill(id: string): boolean;
}
export interface SubagentRow {
    agentId: string;
    runId?: string;
    description: string;
    provider?: string;
    model?: string;
    effort?: string;
    status: SubagentState['status'];
    startedAt: number;
    completedAt?: number;
    durationMs?: number;
    outputLines: string[];
    toolCalls: SubagentState['toolCalls'];
    tokens?: SubagentState['tokens'];
    summary?: string;
    stopReason?: string;
    error?: string;
}
/** One background job as a live transcript card (see `kind: 'job'`). */
export interface JobRow {
    id: string;
    kind: string;
    label: string;
    status: BackgroundJobStatus;
    detail?: string;
    startedAt: number;
    finishedAt?: number;
    /** Mirrored `job_output` tail feeding the card's three-line waterfall. */
    outputLines: readonly string[];
}
/**
 * One rendered transcript row. The DSH session log is the source of truth:
 * rows are derived from `session/event` records (and the initial
 * `agent.session.events` replay), never from optimistic local state.
 */
export interface ChatRow {
    id: number;
    kind: 'user' | 'assistant' | 'tool' | 'notice' | 'reasoning' | 'interrupt' | 'local' | 'local-output' | 'compact' | 'subagent' | 'job';
    /** Extra label for non-human user rows (e.g. `steering`). */
    label?: string;
    /** Actual execution location for `!command` rows. */
    executionTarget?: string;
    text: string;
    /** True while an assistant step is still streaming chunks. */
    streaming?: boolean;
    /** Present on `tool` rows; the card model. */
    tool?: ToolRow;
    /** Present on `subagent` rows; the subagent state snapshot. */
    subagent?: SubagentRow;
    /** Present on `job` rows; the background-job state snapshot. */
    job?: JobRow;
    /** Event wall-clock time (transcript-mode metadata, assistant rows). */
    time?: number;
    /** Present on `reasoning` rows once settled: thinking wall-clock duration. */
    durationMs?: number;
    /** Source session event seq — present on every log-derived row (rewind
     *  fork anchor on user rows; window-floor bookkeeping for the rest). */
    seq?: number;
    /** True when the row's full text was folded to keep the transcript window
     *  bounded (see MAX_ROWS); the session log still holds the full content
     *  and loadOlder() restores it. */
    folded?: boolean;
    /** True when loadOlder() restored this row from the log; restored rows are
     *  exempt from the next fold pass so a restore is not instantly undone. */
    restored?: boolean;
    /** True on rows created by LIVE event handling (not replay/resume/fold
     *  restore) — the smooth-streaming reveal animates freshly-arrived
     *  content only; replayed history must paint complete. Set once at
     *  creation; never mutated afterwards. */
    fresh?: boolean;
}
/** One 计费时段（高峰/空闲）的 token 累计。 */
export interface TokenBucket {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
}
/** Running token totals across the session's assistant messages. */
export interface TokenUsage {
    input: number;
    output: number;
    /** Prompt-cache hit tokens across the session (priced at the hit rate). */
    cacheRead: number;
    /** Prompt-cache write tokens across the session (priced with uncached input). */
    cacheWrite: number;
    /** Peak-hour tokens (billed at peak rates) — each usage lands in a bucket
     *  by its event time, so a session spanning both windows is priced per
     *  window instead of all at the current rate. */
    peak: TokenBucket;
    /** Off-peak-hour tokens (billed at idle rates). */
    idle: TokenBucket;
}
/** 全零 token 累计（新会话 / 复位用）。 */
export declare function emptyTokenUsage(): TokenUsage;
/** In-process working-line snapshot derived from the base session stream. */
export type ActivityStatus = ActivityState;
/** A transient status message shown above the prompt input. */
export interface NotificationItem {
    id: number;
    text: string;
    /** Theme color key; defaults to dim. */
    color?: 'error' | 'warning' | 'success';
    /** Auto-dismiss after this many ms (default 4000); 0 = sticky, removed
     *  only through the early-dismiss handle. */
    timeoutMs: number;
}
/**
 * Durable same-session goal projection surfaced on the channel (see
 * {@link Channel['goal']}). Mirrors the goal domain's `GoalSnapshot` +
 * replay counters; declared locally so the UI needs no dsh-goal dependency.
 */
export interface ChannelGoal {
    id: string;
    revision: number;
    objective: string;
    phase: 'active' | 'paused' | 'blocked' | 'complete';
    /** Total admitted goal-round cap. */
    maxGoalRounds: number;
    /** Highest admitted continuation round so far. */
    roundsStarted: number;
    /** Present exactly while `phase` is `blocked`. */
    blockedReason?: {
        code: string;
        message: string;
    };
}
/** The observable outcome of adopting a persisted session. */
export type ResumeResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly reason: 'working';
} | {
    readonly ok: false;
    readonly reason: 'unavailable';
} | {
    readonly ok: false;
    readonly reason: 'cancelled';
} | {
    readonly ok: false;
    readonly reason: 'failed';
    readonly error: string;
};
/** Secret-free credential metadata for configuration and status surfaces. */
export interface CredentialStatus {
    configured: boolean;
    source?: string;
    writable: boolean;
}
/** One entry of the latest todo-list snapshot (mirrors dsh-tool-todo's
 *  `TodoItem`; declared locally so the adapter needn't depend on that plugin). */
export interface TodoPanelItem {
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
}
/** One named prompt contribution with its model-visible text. */
export interface LoadedContextEntry {
    /** Provider-declared name (e.g. `harness:identity`, `deployment:persona`). */
    readonly name: string;
    /** The interpolated text the model receives for this entry. */
    readonly text: string;
}
/** One discovered workspace instruction file (AGENTS.md-family). */
export interface LoadedContextFile {
    /** Model-facing path (e.g. `./AGENTS.md`). */
    readonly displayPath: string;
}
/** One model-invocable skill from the skill registry. */
export interface LoadedContextSkill {
    readonly name: string;
    readonly description: string;
}
/** One skill in the live agent's catalog, for the `/skills` picker (issue #204). */
export interface SkillInfo {
    readonly name: string;
    readonly description: string;
    /** True when `/name` invokes it (it appears in the `/` menu, issue #86). */
    readonly userInvocable: boolean;
    /** Discovery source bucket (bundled / user-* / project-* / runtime / …). */
    readonly source: string;
}
/** One model-visible tool from the prompt assembly. */
export interface LoadedContextTool {
    readonly name: string;
    readonly description: string;
}
/**
 * Snapshot of everything a fresh conversation for the current agent will
 * load: the assembled system prompt (ordered sections, dynamic context,
 * tools), the workspace instruction files baseline discovery would inject,
 * and the skill catalog. Declared locally so screens and helpers consume a
 * self-contained contract instead of the dsh-system-prompt/dsh-skill types.
 */
export interface LoadedContext {
    /** Ordered system-prompt sections after strict variable interpolation. */
    readonly sections: readonly LoadedContextEntry[];
    /** Dynamic context contributions (runtime snapshot parts). */
    readonly contexts: readonly LoadedContextEntry[];
    /** Workspace instruction files (AGENTS.md-family) discovered for the cwd. */
    readonly files: readonly LoadedContextFile[];
    /** Model-invocable skills, when the skill registry is mounted. */
    readonly skills: readonly LoadedContextSkill[];
    /** Model-visible tools in assembly order. */
    readonly tools: readonly LoadedContextTool[];
}
/**
 * The public channel surface a screen renders: the full transcript and live
 * status snapshot (tokens, spinner, working activity, goals, todos, loaded
 * context) plus every action the TUI can take (submit, steer, cancel,
 * rewind, resume, model switching, …). Implementations mutate internal state
 * and bump `version` so subscribed screens re-render.
 */
export interface Channel {
    /** Monotonic version — bump on every mutation so screens can re-render. */
    readonly version: number;
    readonly rows: readonly ChatRow[];
    readonly status: AgentStatus | 'starting' | 'disposed';
    readonly sessionTitle: string;
    /** Per-session accent color name (`/color`), '' when unset — persisted via
     *  a `session/color` log event so it survives resume/rewind. Renders as
     *  the prompt-input border + session label chip accent (cc/sessionColors). */
    readonly sessionColor: string;
    readonly agentId: string;
    /** TUI-owned generation that changes on every live Agent rebind. */
    readonly agentBindingGeneration: number;
    /** `dsh-tui.recapOnOpen` (default on): auto-summarize the session tail
     *  into the dim AutoRecapRow when the session opens/resumes. Read live
     *  (settings service), so a `/settings` change applies on the next
     *  session switch; absent settings service → on. */
    readonly autoRecapOnOpen: boolean;
    /** Resolved model id (from the plugin config). */
    readonly model: string;
    /** Provider route of the live agent. */
    readonly provider: string;
    /** Raw cordis.yml `provider` key (undefined when unset) — the boot-time
     *  pin `/reload` must never override. */
    readonly configuredProvider: string | undefined;
    /** Raw cordis.yml `model` key (undefined when unset). */
    readonly configuredModel: string | undefined;
    /** Explicit cordis.yml `preset` (undefined = roster default wins) — `/reload`
     *  must not override a static deployment choice. */
    readonly configuredPreset: string | undefined;
    /** Explicit cordis.yml `activityFrames` (undefined = pref/default wins). */
    readonly configuredActivityFrames: string | undefined;
    /** Explicit cordis.yml `lang` (undefined = settings/lang.json wins). */
    readonly configuredLang: string | undefined;
    /** Running token totals across the session's assistant messages. */
    readonly tokens: TokenUsage;
    /** Working directory of the session. */
    readonly cwd: string;
    /** Human-facing cwd (remote POSIX path/URI instead of a host alias). */
    readonly displayCwd: string;
    /** Current git branch, when the cwd is inside a git worktree. */
    readonly gitBranch: string | undefined;
    /** True between turn/start and turn/end — drives the working spinner. */
    readonly working: boolean;
    /** True while a user-requested abort (Ctrl+C/Esc interrupt) has not yet
     *  converged — no turn/start or turn/end has retired the aborted turn.
     *  Chat uses it so a repeated Ctrl+C during a stuck abort force-exits. */
    readonly cancelPending: boolean;
    /** Which phase the spinner should present while working. */
    readonly spinnerMode: SpinnerMode;
    /** Chars streamed as text this turn (feeds the spinner token counter). */
    readonly responseChars: number;
    /** Number of tool calls still in flight this turn. */
    readonly activeToolCount: number;
    /** Wall-clock ms of turn/start (spinner elapsed timer). */
    readonly turnStart: number;
    /** Last user prompt text (sticky header + statusline). */
    readonly lastUserText: string;
    /** Transient notifications, newest last. */
    readonly notifications: readonly NotificationItem[];
    /** Adapter-advertised context capacity for the model route, when known. */
    readonly contextWindow: number | undefined;
    /** Reasoning effort of the latest request header, when the adapter sets one. */
    readonly reasoningEffort: string | undefined;
    /** The live route's reasoning-effort level ids, low → high (the last entry
     *  is the top tier). Consumed by top-tier-triggered UI (effort ignition). */
    readonly effortLevels: readonly string[] | undefined;
    /** Usage of the most recent request (context share + cache hits come from
     *  this, not the running totals — each request's input IS the context). */
    readonly lastUsage: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
    } | undefined;
    /** Output tokens per second of the current/last turn's response, when known. */
    readonly tps: number | undefined;
    /** Per-turn tps samples (sparkline history), oldest first. */
    readonly tpsSamples: readonly {
        tps: number;
        at: number;
    }[];
    /** Latest in-process working-activity snapshot. */
    readonly workingActivity: ActivityStatus | undefined;
    /** Working-activity indicator preset name (`claude`/`moon`/…/`random`). */
    readonly activityFrames: string | undefined;
    /** Edit/Write diff presentation preference (`auto`/`split`/`unified`). */
    readonly diffLayout: 'auto' | 'split' | 'unified';
    /** Thinking-block display (`preview` = 2-3 line live stream + fold per
     *  step; `full` = expanded until turn end). */
    readonly thinkingFold: 'preview' | 'full';
    /** Live tool-card background treatment. */
    readonly toolBackground: ToolBackground;
    /** What the fullscreen transcript's right gutter shows (settings
     *  `dsh-tui.scrollGutter`: turn timeline / proportional scrollbar /
     *  nothing). */
    readonly scrollGutter: ScrollGutterMode;
    /** Terminal-card header folding (settings `dsh-tui.foldTerminalCommand`):
     *  collapse a multi-line command title to its first line + count hint. */
    readonly foldTerminalCommand: boolean;
    /** Whether the session-name chip shows on the prompt top border's right
     *  side (settings `dsh-tui.promptSessionLabel`; off by default). */
    readonly promptSessionLabel: boolean;
    /** Whether the fullscreen draft editor is enabled (settings
     *  `dsh-tui.expandEditor`; on by default) — gates the ⛶ affordance and
     *  the expandEditor shortcut. */
    readonly expandEditor: boolean;
    /** Smooth streaming reveal (settings `dsh-tui.smoothStreaming`; on by
     *  default): live-arriving assistant text, expanded thinking, and tool
     *  call bodies paint through a ~30fps reveal instead of jumping per
     *  provider burst. */
    readonly smoothStreaming: boolean;
    /** Live status-footer visibility and compactness preferences. */
    readonly statusBar: Readonly<StatusBarConfig>;
    /** Whether the header's pixel whale art shows (settings `dsh-tui.whale`). */
    readonly whale: boolean;
    /** Minimal mode (settings `dsh-tui.minimal`): no header splash, no emoji
     *  glyphs, no decorative colors; code highlight and tool colors stay. */
    readonly minimal: boolean;
    /** Whether the in-process working-activity line is shown (config.activity). */
    readonly activityEnabled: boolean;
    /** Whether the segmented context bar row shows in the status footer
     *  (config.contextBar; the status/mode lines are unaffected). */
    readonly contextBarEnabled: boolean;
    /**
     * Current same-session goal projection, when a goal exists. Derived live
     * from the durable goal events in the session log — top-level
     * `goal/change` snapshots (every goal mutation appends one) plus the
     * goal-sourced continuation rounds that advance the counter — so this
     * snapshot tracks create/edit/pause/resume/complete/block/clear in real
     * time and replays correctly on resume/rewind.
     */
    readonly goal: ChannelGoal | undefined;
    /**
     * Latest todo-list snapshot (`todo/write` whole-list event, last write
     * wins). Log-only UI state, updated live and on replay.
     */
    readonly todos: readonly TodoPanelItem[];
    /**
     * Snapshot of the context a fresh conversation for this agent will load
     * (system prompt sections, dynamic context, workspace instructions, skill
     * catalog, tools), computed at boot and on every agent swap. `undefined`
     * while loading or when the snapshot could not be assembled — the startup
     * panel stays hidden until it lands.
     */
    readonly loadedContext: LoadedContext | undefined;
    /**
     * Messages submitted while the model was working and not yet claimed by a
     * turn (`steer` → next step boundary of the running turn, `followup` →
     * after the turn ends). Driven by agent inbox events.
     */
    readonly pending: readonly PendingMessage[];
    /**
     * Effective slash commands: built-in locals plus plugin-registered
     * commands (plan/goal/…) merged from the DSH command registry. The
     * registry is the source of truth for external names — a plugin shadows
     * nothing here; locals win on name collisions.
     */
    readonly commandList: readonly LocalCommand[];
    /** Context-aware slash completions, including plugin subcommands. */
    commandCompletions(input: string): readonly CommandCompletion[];
    /**
     * Run a plugin-registered slash command against the live agent (DSH
     * `dsh-commands` registry): logs `command/run`/`command/done` and returns
     * the handler's result text — `''` when the handler succeeded silently,
     * `undefined` when the registry has no such command (the caller falls
     * back to sending the line to the model).
     */
    runExternalCommand(name: string, rawInput: string): Promise<string | undefined>;
    /**
     * Plugin-registered full-screen scene currently replacing the conversation
     * (the `dsh-tui-scenes` runtime), if any. The chat screen renders its
     * component INSTEAD of the transcript — the same whole-terminal treatment
     * the trajectory scene gets — and hands it the keyboard; `undefined`
     * renders the conversation normally.
     */
    readonly pluginScene: TuiSceneDescriptor | undefined;
    /**
     * Open a registered plugin scene by id. Plugin command handlers usually
     * call the runtime directly (`ctx.tuiScenes.open`); this passthrough lets
     * host-side UI code do the same without touching cordis services.
     */
    openPluginScene(id: string): boolean;
    /** Close the open plugin scene, if any (a no-op otherwise). */
    closePluginScene(): void;
    /** 侧问（CC /btw）：无工具单轮 LLM 调用，复用当前会话上下文；结果不落 session log。 */
    sideQuestion(question: string, options?: {
        signal?: AbortSignal;
        onText?: (delta: string) => void;
    }): Promise<{
        answer: string | null;
        error?: string;
    }>;
    /** Estimated context segments by content type (pi-nano-context style bar). */
    readonly contextSegments: {
        system: number;
        prompt: number;
        assistant: number;
        thinking: number;
        tools: number;
    };
    /** Active subagents spawned by the current session. */
    readonly subagents: readonly SubagentState[];
    /** Native control operations; unavailable providers safely return false. */
    readonly subagentControl: SubagentControl;
    /**
     * Background jobs of the current session (`run_in_background` tool work),
     * live-tracked from the harness job registry. Empty when the composition
     * has no jobs service. Drives the `/jobs` panel, transcript job cards and
     * the status-line chip.
     */
    readonly backgroundJobs: readonly BackgroundJobState[];
    /** Cancellation of a background job with the owning agent's authority. */
    readonly jobControl: JobControl;
    subscribe: (listener: () => void) => () => void;
    /** Validate and persist a pasted image, returning its prompt placeholder. */
    stageImage(input: StagedImageInput): Promise<string>;
    submit(text: string): void;
    /**
     * Steer a message into the running turn (Codex/pi semantics): injected at
     * the next step boundary, the agent continues without aborting.
     */
    steer(text: string): void;
    /** Pull a pending message back out of the inbox (Alt+Up) for re-editing. */
    removePending(id: string): boolean;
    /** Abort the in-flight turn (`Ctrl+C` while working). While `cancelPending`
     *  stays true the abort has not converged; Chat force-exits on the next
     *  Ctrl+C press in that window. */
    cancel(): void;
    /** Abort the in-flight turn and process `texts` right away (Esc/Ctrl+Enter
     *  with queued input): each text is re-queued as a followup once the abort
     *  settles, so the new turn starts immediately. Returns the count queued. */
    interruptAndDeliver(texts: readonly string[]): number;
    /** Rewind the conversation to a past user message (CC's double-Esc rewind):
     *  forks the session through that message, swaps in a fresh agent, and
     *  returns the message text for re-editing — or `null` when unwritable.
     *  `mode` is the plugin-offered rewind mode the user picked (the
     *  tui/rewind-prompt seam), null for the plain conversation rewind. */
    rewindTo(row: ChatRow, mode?: string | null): Promise<string | null>;
    /**
     * The rewind decision prompt (tui/rewind-prompt event): asked when the
     * picker confirms a message, before the confirm pane renders. 'cancel'
     * vetoes the rewind (reason already toasted), `{ modes }` adds plugin
     * choices to the confirm pane, null means no opinion (plain confirm).
     */
    promptRewind(row: ChatRow): Promise<{
        modes: readonly TuiRewindMode[];
    } | 'cancel' | null>;
    /**
     * The session family tree for the /tree screen (pi's Session Tree): the
     * live session's whole lineage — ancestors, siblings, descendants —
     * stitched across fork sessions into one message-level tree. `null` (with
     * a notify) when session persistence is unavailable or the live session
     * swapped while the family loaded.
     */
    buildSessionTree(): Promise<SessionTreeData | null>;
    /**
     * Session-tree fork: `rewind` drops the picked user turn (its prompt comes
     * back as the returned text), `fork` keeps the picked entry. `seq` is the
     * tree entry's source event seq inside `sessionId`'s log; `sessionId` may
     * be any family member (adopting a dead branch forks IT at the picked
     * point). Null = refused (the channel notified why).
     */
    rewindToNode(sessionId: string, seq: number, mode?: 'rewind' | 'fork'): Promise<string | null>;
    /** `/fork`: fork the current session at its tip into a persisted copy the
     *  user enters via `/resume` — the live session keeps running untouched. */
    forkSession(): Promise<boolean>;
    /** Switch the live agent to a persisted session, replaying its history. */
    resumeTo(sessionId: string): Promise<ResumeResult>;
    /** Start a fresh conversation (`/new`): a brand-new agent + session, the
     *  transcript cleared, the resume marker forgotten. */
    newSession(): Promise<boolean>;
    /** Workspace targets contributed by the TUI and optional providers. */
    listWorkspaces(): Promise<readonly TuiWorkspaceTarget[]>;
    /** Resolve an absolute path, file URL, or provider URI. */
    resolveWorkspace(reference: string): Promise<TuiWorkspaceTarget | undefined>;
    /** Start a fresh session in the selected workspace. */
    switchWorkspace(target: TuiWorkspaceTarget): Promise<boolean>;
    /** Rename the current durable workspace. */
    renameWorkspace(title: string): Promise<boolean>;
    /** Provider-owned workspace subcommands. */
    workspaceCommands(): readonly Pick<TuiWorkspaceCommand, 'name' | 'aliases' | 'description'>[];
    runWorkspaceCommand(name: string, input: string): Promise<TuiWorkspaceCommandResult | undefined>;
    /** Switch the live model (`/model` picker): forks the conversation at its
     *  current end and continues it with a new agent routed to `provider`/`model`.
     *  The history replays unchanged; only the request route changes. */
    switchModel(provider: string, model: string): Promise<boolean>;
    /** The live route's effort levels + adapter default for the `/effort`
     *  slider; empty `efforts` after notifying when unsupported/unavailable. */
    listEfforts(): Promise<{
        efforts: readonly EffortOption[];
        defaultEffort: string | undefined;
    }>;
    /** Set one effort level by id (validated against the adapter list);
     *  false + a notify when the id is not offered. Persists like the old
     *  Shift+Tab cycle (~/.dsh-tui/effort.json). */
    setEffort(id: string): Promise<boolean>;
    /** The session mode currently in force (matched from the session log, or
     *  the last one Shift+Tab applied). */
    readonly mode: SessionModeSpec;
    /** Index of `mode` in the configured cycle; 0 is the unmarked base mode. */
    readonly modeIndex: number;
    /** Shift+Tab: advance to the next configured session mode. */
    cycleMode(): Promise<void>;
    /** Read the official permission preset roster and current identity. */
    permissionPresets(): PermissionPresetSnapshot;
    /** The preset the CURRENT session runs under (issue #8), resolved from its
     *  log at create/resume time; undefined when no roster is mounted. */
    readonly agentPreset: string | undefined;
    /** The roster's presets for the `/preset` picker (empty without a roster). */
    listPresets(): Promise<readonly PresetOption[]>;
    /** Switch the agent preset (`/preset`): a blank session swaps composition
     *  in place (official `recompose` + logged `agent-preset/selected`); a
     *  started session is locked, so the choice persists as the default for
     *  future sessions instead. False when the roster is absent, the id is
     *  unknown/broken, or a turn is running. */
    switchPreset(presetId: string): Promise<boolean>;
    /** Reset the visible transcript (`/clear`). */
    clear(): void;
    /**
     * Re-render rows older than the current in-memory window from the session
     * log (rows beyond {@link ChannelState.rows}' cap are folded away; this
     * restores them for review). Returns the number of rows restored, 0 when
     * the whole log is already materialized.
     */
    loadOlder(): number;
    /** Push a transient notification above the prompt input. Returns an
     *  early-dismiss handle (the auto-timeout still runs as the backstop). */
    notify(text: string, options?: {
        color?: NotificationItem['color'];
        timeoutMs?: number;
    }): () => void;
    /** Switch the working-activity indicator preset (`/activity`): validates
     *  the name, persists it to `~/.dsh-tui/working-activity.json`, and
     *  re-renders the indicator immediately; false when the name is unknown
     *  or the preference cannot be written. */
    setActivityFrames(name: string): boolean;
    /** Advertised models across every registered provider route (empty when the LLM service is absent). */
    listModels(): Promise<readonly LlmModelInfo[]>;
    /** Provider display identities for the same routes (picker group labels). */
    listProviders(): Promise<readonly LlmProviderInfo[]>;
    /** The live agent's full skill catalog for `/skills` (issue #204) — name,
     *  description, invocation flags and source bucket. Undefined on a failed
     *  or incomplete registry read (the picker shows an error); empty only
     *  when no registry is mounted or it genuinely holds nothing. */
    listSkills(): Promise<readonly SkillInfo[] | undefined>;
    /** Safe credential metadata for `/login`; undefined without the service. */
    describeCredential(ref: string): Promise<CredentialStatus | undefined>;
    /** DeepSeek official account balance for `/balance`: resolves
     *  `DEEPSEEK_API_KEY` through the credentials seam (env fallback) and
     *  queries the official balance endpoint. The key is used only for the
     *  request header — never logged, printed or persisted. */
    balanceInfo(): Promise<BalanceResult>;
    /** Runtime capabilities for the `/provider` wizard, over the settings /
     *  credentials / llm seams; undefined when the composition lacks them
     *  (bare cordis.yml start without the dsh-base services). */
    providerSetup(): ProviderSetupHost | undefined;
    /** OAuth sign-in states from a mounted dsh-auth-style plugin; undefined
     *  without the plugin, so `/login` renders exactly what it did before. */
    oauthProviderStatuses(): Promise<readonly OAuthProviderStatus[] | undefined>;
    /**
     * Runtime capabilities for the `/settings` screen, over the settings /
     * credentials seams; undefined when the composition lacks the settings
     * service (the screen then renders plugin sections as unavailable and
     * namespaces read-only).
     */
    settingsHost(): SettingsHost | undefined;
    /** Plugin-declared settings sections from the `tuiSettingsSections` seam
     *  (empty when the seam or every provider is absent). */
    settingsSections(): readonly TuiSettingsSection[];
    /** Subscribe to settings-section register/unregister events. */
    subscribeSettingsSections(listener: () => void): () => void;
    /** Structured `@` file completion, using the session's remote fs service. */
    listFileCandidates(query: string, options?: {
        signal?: AbortSignal;
        topK?: number;
    }): Promise<readonly FileCandidate[]>;
    /** Backward-compatible top-level/recursive listing. */
    listFiles(): Promise<readonly string[]>;
    /** Every session the persistence backend stores, classified and unfiltered
     *  — the browser (`/resume`) decides which of them a given view shows. */
    listSessions(): Promise<readonly SessionSummary[]>;
    /** Trailing exchanges of a persisted session, for the browser's preview. */
    previewSession(sessionId: string): Promise<readonly PreviewEntry[]>;
    /** Mark a session for `dsh-tui --resume` on the next launch. */
    setResumeTarget(sessionId: string): void;
    /** Rename the current session (CC's /rename): appends a `session/title`
     *  event, which the status line and the /resume picker both read. */
    renameSession(title: string): void;
    /** Set the current session's accent color (`/color <name>`): appends a
     *  `session/color` event; '' clears it back to the theme default. */
    setSessionColor(color: string): void;
    /** Generate a recap of the session's recent activity (`/recap`): one
     *  tool-less LLM call over the tail exchanges, returning a one-line
     *  summary plus an optional proposed title. The answer is pure UI state
     *  and never enters the session log. */
    recapRecent(options?: {
        signal?: AbortSignal;
        onText?: (delta: string) => void;
    }): Promise<RecapOutcome>;
    /** Delete a persisted session (`/resume` picker ctrl+d): removes its log
     *  directory, its last-used entry, and the resume marker when it points
     *  here. False for the live session or a missing/unwritable log. */
    deleteSession(sessionId: string): Promise<boolean>;
    /** Rename any persisted session (`/resume` picker ctrl+r): appends a
     *  `session/title` event to its log (live sessions go through the normal
     *  rename path). False when the log is absent or undecodable. */
    renameSessionTo(sessionId: string, title: string): Promise<boolean>;
    /** Manually compact the session history (CC's /compact); no-op notify when the leaf lacks a compaction service. */
    compact(): void;
    /** Render a multi-line local report in the transcript (`/status`,
     *  `/doctor`, …): a `local` row plus one `local-output` row per line. */
    pushLocal(title: string, lines: readonly string[]): void;
    /** MCP server/tool status for /mcp: one line per server, or setup guidance. */
    mcpStatus(): string[];
    /** Write the conversation transcript to `dsh-tui-export-<ts>.md` in the
     *  session cwd; returns the written path, or null on failure. */
    exportSession(): string | null;
    /** Create `AGENTS.md` in the session cwd (DSH workspace-context file);
     *  returns the path, `'exists'` when already present, or null on failure. */
    initWorkspace(): string | null;
    /** Environment diagnostics for `/doctor`. */
    doctorInfo(): string[];
    /** Plugin contract/grant/ledger diagnostics for `/plugins` (C-070 trust
     *  banner first line; `check <path>` runs validatePlugin + negotiate). */
    pluginsInfo(args: string): string[];
    /** Subagent rows for `/agents` (DSH subagent service; empty message when
     *  the service is absent). */
    listSubagents(): Promise<string[]>;
    /**
     * Dispose the host-registry entries this channel registered (skill slash
     * commands).
     *
     * `commandService.register` binds the registration to ITS own context, not
     * the caller's, so the entries outlive this channel unless released: after a
     * launcher recompose the stale registrations would still answer, but the
     * fresh channel would see the names taken and stop managing them, freezing
     * the menu. The plugin calls this from its teardown effect, where the real
     * cordis context lives.
     */
    releaseContributions(): void;
    /**
     * The live agent's session event log (immutable snapshot, replaced on
     * every append — dsh-session caches the frozen array) — the `/trace`
     * trajectory view's data source. Screens already re-render on `version`
     * bumps, so a view reading this per render follows live events in real
     * time; agent swaps (/resume /rewind /new) are reflected immediately.
     */
    traceEvents(): readonly SessionEvent[];
}
/** @internal */
/** One roster entry in the `/preset` picker (see {@link Channel.listPresets}). */
export interface PresetOption {
    id: string;
    name?: string;
    description?: string;
    /** Present when the roster marked this preset unloadable (shown verbatim). */
    broken?: string;
    isDefault: boolean;
}
export type PermissionPresetAvailability = 'runtime' | 'legacy' | 'unavailable';
export interface PermissionPresetOption {
    readonly value: string;
    readonly name: string;
    readonly description?: string;
}
export interface PermissionPresetCurrent {
    readonly value: string;
    readonly name: string;
    readonly description?: string;
    readonly kind: 'preset' | 'custom';
}
/**
 * Adapter-owned permission roster snapshot. `options` never contains the
 * official `custom` sentinel; it is represented only by `current`.
 */
export interface PermissionPresetSnapshot {
    readonly availability: PermissionPresetAvailability;
    readonly options: readonly PermissionPresetOption[];
    readonly current?: PermissionPresetCurrent;
}
/** @internal */
/** One user message submitted while the model was working, not yet claimed
 *  by a turn. `steer` lands at the next step boundary of the running turn;
 *  `followup` waits for the turn to end. */
export interface PendingMessage {
    id: string;
    text: string;
    placement: 'steer' | 'followup';
}
/**
 * Mutable channel state owned by {@link createChannel}: the screen's
 * reactive store. Screens subscribe and re-render on `version` bumps; the
 * fields mirror the public {@link Channel} contract, and the `@internal`
 * emit hooks belong to the implementation.
 */
/** One adapter-owned reasoning-effort level for the `/effort` slider. */
export interface EffortOption {
    id: string;
    name: string;
    description?: string;
}
export interface ChannelState {
    version: number;
    rows: ChatRow[];
    status: AgentStatus | 'starting' | 'disposed';
    sessionTitle: string;
    sessionColor: string;
    autoRecapOnOpen: boolean;
    agentId: string;
    /** TUI-owned generation that changes on every live Agent rebind. */
    agentBindingGeneration: number;
    model: string;
    provider: string;
    tokens: TokenUsage;
    cwd: string;
    displayCwd: string;
    gitBranch: string | undefined;
    working: boolean;
    /** Whether a requested abort is still converging (see the public Channel type). */
    cancelPending: boolean;
    spinnerMode: SpinnerMode;
    responseChars: number;
    activeToolCount: number;
    turnStart: number;
    lastUserText: string;
    notifications: NotificationItem[];
    /** Adapter-advertised context capacity for the model route, when known. */
    contextWindow: number | undefined;
    /** Reasoning effort of the latest request header, when the adapter sets one. */
    reasoningEffort: string | undefined;
    /** The live route's reasoning-effort level ids, low → high. */
    effortLevels: readonly string[] | undefined;
    /** Usage of the most recent request (context share + cache hits). */
    lastUsage: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
    } | undefined;
    /** Output tokens per second of the current/last turn's response, when known. */
    tps: number | undefined;
    /** Per-turn tps samples (sparkline history), oldest first. */
    tpsSamples: {
        tps: number;
        at: number;
    }[];
    /** Latest working-activity snapshot (see the public Channel type). */
    workingActivity: ActivityStatus | undefined;
    /** Working-activity indicator preset (see the public Channel type). */
    activityFrames: string | undefined;
    /** Raw cordis.yml pins `/reload` must respect (see the public Channel type). */
    configuredProvider: string | undefined;
    configuredModel: string | undefined;
    configuredPreset: string | undefined;
    configuredActivityFrames: string | undefined;
    configuredLang: string | undefined;
    /** Diff presentation preference (see the public Channel type). */
    diffLayout: 'auto' | 'split' | 'unified';
    /** Thinking-block display (see the public Channel type). */
    thinkingFold: 'preview' | 'full';
    /** Tool-card background treatment (see the public Channel type). */
    toolBackground: ToolBackground;
    /** Transcript gutter mode (see the public Channel type). */
    scrollGutter: ScrollGutterMode;
    /** Terminal-card header folding (see the public Channel type). */
    foldTerminalCommand: boolean;
    /** Session-name chip on the prompt border (see the public Channel type). */
    promptSessionLabel: boolean;
    /** Fullscreen draft editor gate (see the public Channel type). */
    expandEditor: boolean;
    /** Smooth streaming reveal (see the public Channel type). */
    smoothStreaming: boolean;
    /** Status-footer preferences (see the public Channel type). */
    statusBar: StatusBarConfig;
    /** Apply a diff-layout change (see the public Channel type). */
    setDiffLayout(layout: 'auto' | 'split' | 'unified'): void;
    /** Apply a thinking-display change (see the public Channel type). */
    setThinkingFold(mode: 'preview' | 'full'): void;
    /** Apply a tool-card background change. */
    setToolBackground(background: ToolBackground): void;
    /** Apply a transcript gutter mode change. */
    setScrollGutter(mode: ScrollGutterMode): void;
    /** Apply a terminal-card header folding change. */
    setFoldTerminalCommand(enabled: boolean): void;
    /** Apply a prompt session-name chip change. */
    setPromptSessionLabel(enabled: boolean): void;
    /** Apply a fullscreen-editor gate change. */
    setExpandEditor(enabled: boolean): void;
    /** Apply a smooth-streaming reveal change. */
    setSmoothStreaming(enabled: boolean): void;
    /** Apply status-footer preference changes. */
    setStatusBar(config: Partial<StatusBarConfig>): void;
    /** Whale header art switch (see the public Channel type). */
    whale: boolean;
    /** Apply a whale-visibility change (see the public Channel type). */
    setWhale(visible: boolean): void;
    minimal: boolean;
    /** Apply a minimal-mode change (see the public Channel type). */
    setMinimal(enabled: boolean): void;
    /** Working-activity display switch (see the public Channel type). */
    activityEnabled: boolean;
    /** Context bar row switch (see the public Channel type). */
    contextBarEnabled: boolean;
    /** Current same-session goal projection (see the public Channel type). */
    goal: ChannelGoal | undefined;
    /** Latest todo-list snapshot (see the public Channel type). */
    todos: TodoPanelItem[];
    /** Loaded-context snapshot (see the public Channel type). */
    loadedContext: LoadedContext | undefined;
    /** Messages submitted while working, awaiting their turn/step boundary.
     *  Driven by agent inbox events (inserted/claimed/discarded). */
    pending: PendingMessage[];
    /** 侧问（见 public Channel.sideQuestion）。 */
    sideQuestion(question: string, options?: {
        signal?: AbortSignal;
        onText?: (delta: string) => void;
    }): Promise<{
        answer: string | null;
        error?: string;
    }>;
    /** 会话 recap（见 public Channel.recapRecent）。 */
    recapRecent(options?: {
        signal?: AbortSignal;
        onText?: (delta: string) => void;
    }): Promise<RecapOutcome>;
    /** 会话强调色（见 public Channel.setSessionColor）。 */
    setSessionColor(color: string): void;
    /** Effective slash commands (see the public Channel type). */
    commandList: readonly LocalCommand[];
    /** Context-aware slash completions (see the public Channel type). */
    commandCompletions(input: string): readonly CommandCompletion[];
    /** Run a plugin-registered command (see the public Channel type). */
    runExternalCommand(name: string, rawInput: string): Promise<string | undefined>;
    /** Open plugin scene mirrored from the scenes runtime (see the public Channel type). */
    pluginScene: TuiSceneDescriptor | undefined;
    /** Open a plugin scene by id (see the public Channel type). */
    openPluginScene(id: string): boolean;
    /** Close the open plugin scene (see the public Channel type). */
    closePluginScene(): void;
    /** Estimated context segments by content type (pi-nano-context style bar). */
    contextSegments: {
        system: number;
        prompt: number;
        assistant: number;
        thinking: number;
        tools: number;
    };
    /** Active subagents roster (see the public Channel type). */
    subagents: readonly SubagentState[];
    subagentControl: SubagentControl;
    /** Background jobs of the current session (see the public Channel type). */
    backgroundJobs: readonly BackgroundJobState[];
    jobControl: JobControl;
    subscribe: (listener: () => void) => () => void;
    stageImage(input: StagedImageInput): Promise<string>;
    /** @internal event bump (the public `notify(text)` posts a notification). */
    emit(): void;
    /** @internal frame-aligned emit for high-frequency streaming deltas:
     *  version bumps synchronously but listeners fire at most once per 16ms
     *  window (trailing edge). */
    emitStream(): void;
    submit(text: string): void;
    steer(text: string): void;
    removePending(id: string): boolean;
    cancel(): void;
    /** @internal interrupt-and-deliver (see the public Channel type). */
    interruptAndDeliver(texts: readonly string[]): number;
    rewindTo(row: ChatRow, mode?: string | null): Promise<string | null>;
    /** @internal rewind decision prompt (see the public Channel.promptRewind). */
    promptRewind(row: ChatRow): Promise<{
        modes: readonly TuiRewindMode[];
    } | 'cancel' | null>;
    /** @internal session-tree assembly (see the public Channel.buildSessionTree). */
    buildSessionTree(): Promise<SessionTreeData | null>;
    /** @internal tree-entry rewind/fork (see the public Channel.rewindToNode). */
    rewindToNode(sessionId: string, seq: number, mode?: 'rewind' | 'fork'): Promise<string | null>;
    /** @internal tip fork (see the public Channel.forkSession). */
    forkSession(): Promise<boolean>;
    /** Switch the live agent to a persisted session, replaying its history. */
    resumeTo(sessionId: string): Promise<ResumeResult>;
    /** Start a fresh conversation (`/new`). */
    newSession(): Promise<boolean>;
    listWorkspaces(): Promise<readonly TuiWorkspaceTarget[]>;
    resolveWorkspace(uri: string): Promise<TuiWorkspaceTarget | undefined>;
    switchWorkspace(target: TuiWorkspaceTarget): Promise<boolean>;
    renameWorkspace(title: string): Promise<boolean>;
    workspaceCommands(): readonly Pick<TuiWorkspaceCommand, 'name' | 'aliases' | 'description'>[];
    runWorkspaceCommand(name: string, input: string): Promise<TuiWorkspaceCommandResult | undefined>;
    /** Switch the live model (`/model` picker). */
    switchModel(provider: string, model: string): Promise<boolean>;
    /** The route's effort levels for `/effort` (see the public Channel type). */
    listEfforts(): Promise<{
        efforts: readonly EffortOption[];
        defaultEffort: string | undefined;
    }>;
    /** Set one effort level by id (see the public Channel type). */
    setEffort(id: string): Promise<boolean>;
    /** The session mode currently in force (see the public Channel type). */
    mode: SessionModeSpec;
    /** Index of `mode` in the configured cycle (see the public Channel type). */
    modeIndex: number;
    /** Shift+Tab session-mode advance (see the public Channel type). */
    cycleMode(): Promise<void>;
    /** Read the official permission preset roster and current identity. */
    permissionPresets(): PermissionPresetSnapshot;
    /** The preset the current session runs under (see the public Channel type). */
    agentPreset: string | undefined;
    /** The roster's presets for the `/preset` picker (see the public Channel type). */
    listPresets(): Promise<readonly PresetOption[]>;
    /** Switch the agent preset (see the public Channel type). */
    switchPreset(presetId: string): Promise<boolean>;
    clear(): void;
    /** @internal older-row restoration (see the public Channel.loadOlder). */
    loadOlder(): number;
    notify(text: string, options?: {
        color?: NotificationItem['color'];
        timeoutMs?: number;
    }): () => void;
    /** Switch the working-activity indicator preset (see the public Channel). */
    setActivityFrames(name: string): boolean;
    listModels(): Promise<readonly LlmModelInfo[]>;
    /** Provider display identities (see the public Channel type). */
    listProviders(): Promise<readonly LlmProviderInfo[]>;
    /** The live agent's skill catalog for `/skills` (see the public Channel type). */
    listSkills(): Promise<readonly SkillInfo[] | undefined>;
    /** Safe credential metadata for `/login` (see the public Channel type). */
    describeCredential(ref: string): Promise<CredentialStatus | undefined>;
    /** DeepSeek official balance for `/balance` (see the public Channel type). */
    balanceInfo(): Promise<BalanceResult>;
    /** `/provider` wizard capabilities (see the public Channel type). */
    providerSetup(): ProviderSetupHost | undefined;
    /** OAuth sign-in states (see the public Channel type). */
    oauthProviderStatuses(): Promise<readonly OAuthProviderStatus[] | undefined>;
    /** `/settings` screen capabilities (see the public Channel type). */
    settingsHost(): SettingsHost | undefined;
    /** Plugin-declared settings sections (see the public Channel type). */
    settingsSections(): readonly TuiSettingsSection[];
    /** Subscribe to settings-section register/unregister events. */
    subscribeSettingsSections(listener: () => void): () => void;
    listFileCandidates(query: string, options?: {
        signal?: AbortSignal;
        topK?: number;
    }): Promise<readonly FileCandidate[]>;
    listFiles(): Promise<readonly string[]>;
    listSessions(): Promise<readonly SessionSummary[]>;
    /** Trailing exchanges of a persisted session (see the public Channel type). */
    previewSession(sessionId: string): Promise<readonly PreviewEntry[]>;
    setResumeTarget(sessionId: string): void;
    /** Rename the current session (see the public Channel type). */
    renameSession(title: string): void;
    /** Delete a persisted session (see the public Channel type). */
    deleteSession(sessionId: string): Promise<boolean>;
    /** Rename any persisted session (see the public Channel type). */
    renameSessionTo(sessionId: string, title: string): Promise<boolean>;
    /** Manually compact the session history (CC's /compact). */
    compact(): void;
    /** Multi-line local report (`/status`, `/doctor`, …). */
    pushLocal(title: string, lines: readonly string[]): void;
    /** MCP server/tool status for /mcp: one line per server, or setup guidance. */
    mcpStatus(): string[];
    /** Export the transcript to a markdown file (CC's /export). */
    exportSession(): string | null;
    /** Create `AGENTS.md` in the session cwd (CC's /init). */
    initWorkspace(): string | null;
    /** Environment diagnostics (CC's /doctor). */
    doctorInfo(): string[];
    /** Plugin diagnostics (/plugins); see the public Channel type. */
    pluginsInfo(args: string): string[];
    /** Subagent rows (CC's /agents). */
    listSubagents(): Promise<string[]>;
    /** See {@link Channel.releaseContributions}. */
    releaseContributions(): void;
    /** Live session event log (see the public Channel type, `/trace`). */
    traceEvents(): readonly SessionEvent[];
}
/**
 * Create the live channel state for one agent session: replay the durable
 * transcript, subscribe to the agent's events, and expose every TUI action.
 * @internal
 * @param ctx - The plugin context; optional services are resolved via ctx.get.
 * @param initialAgent - The agent whose session the channel renders; rewinds,
 *   resumes, and model switches replace it.
 * @param options - Boot options: model route, cwd, provider, and the
 *   reasoning-effort / working-activity / agent-handle preferences.
 * @returns The live channel state, subscribed and ready to render.
 */
export declare function createChannel(ctx: Context, initialAgent: Agent, options: {
    model: string;
    cwd: string;
    provider: string;
    /** Configured reasoning effort: applied to the agent's requests when the
     *  live route offers it (silently ignored otherwise), and shown from
     *  startup until the first request/header event reports the adapter's
     *  live value. */
    effort?: string;
    /** Derive the working line from base session events; default on. */
    activity?: boolean;
    /** Indicator preset for the working-activity line (`claude`/`moon`/
     *  `comet`/`dots`/… or `random`); default `claude`. */
    activityFrames?: string;
    /** Edit/Write diff presentation; default `auto` (side-by-side ≥110
     *  columns, unified below). */
    diffLayout?: 'auto' | 'split' | 'unified';
    /** Thinking-block display; default `preview` (2-3 line live preview,
     *  fold per step) — `full` keeps thinking expanded until turn end. */
    thinkingFold?: 'preview' | 'full';
    /** Tool-card background treatment; default `none`. */
    toolBackground?: ToolBackground;
    /** Transcript gutter mode; default `timeline` (settings `dsh-tui.scrollGutter`). */
    scrollGutter?: ScrollGutterMode;
    /** Terminal-card header folding; default off (settings
     *  `dsh-tui.foldTerminalCommand`). */
    foldTerminalCommand?: boolean;
    /** Session-name chip on the prompt top border; default off (settings
     *  `dsh-tui.promptSessionLabel`). */
    promptSessionLabel?: boolean;
    /** Fullscreen draft editor entry points; default on (settings
     *  `dsh-tui.expandEditor`). */
    expandEditor?: boolean;
    /** Smooth streaming reveal; default on (settings
     *  `dsh-tui.smoothStreaming`). */
    smoothStreaming?: boolean;
    /** Status-footer field visibility and compactness. */
    statusBar?: Partial<StatusBarConfig>;
    /** Show the header's pixel whale art; default on. */
    whale?: boolean;
    /** Minimal mode; default off (settings `dsh-tui.minimal`). */
    minimal?: boolean;
    /** Show the segmented context bar row in the status footer; default on
     *  (cordis.yml `contextBar: false` hides it, issue #29). */
    contextBar?: boolean;
    /** cordis.yml's static preset choice (`preset` key): wins over the
     *  persisted `/preset` preference for NEW sessions this channel starts. */
    configuredPreset?: string;
    /** cordis.yml's static route (`provider`/`model` keys), undefined when
     *  unset: wins over the persisted `/model` preference for NEW sessions
     *  only when BOTH halves are pinned (atomic rule, issue #67), and is the
     *  only route a resume overrides the target's own record with. */
    configuredProvider?: string;
    configuredModel?: string;
    /** cordis.yml's raw `lang` key, undefined when unset: `/reload` consults
     *  it so a static deployment choice is never overridden by lang.json. */
    configuredLang?: string;
    /** cordis.yml's raw `activityFrames` key, undefined when unset: the
     *  static choice `/reload` must not override. */
    configuredActivityFrames?: string;
    /** The preset the initial agent's session runs under (from resolveAgent). */
    agentPreset?: string;
    /** Shift+Tab session-mode cycle from cordis.yml `modes`; undefined →
     *  the built-in default/plan/full cycle (sessionModes.ts). */
    modes?: readonly SessionModeSpec[];
    /** Handle of the initial agent; disposed when a rewind replaces it. */
    handle?: AgentHandle;
}): ChannelState;
/**
 * `/resume` project filter (issue #96): exact cwd match, PLUS sessions
 * recorded in a subdirectory — pre-upgrade launches recorded the launch
 * subdirectory as the header cwd, and with the cwd default now resolving to
 * the git worktree root an exact match would hide those sessions forever.
 * They belong to the same workspace, so they stay listed. Comparison follows
 * the platform's filesystem semantics (case-insensitive on Windows — a
 * pre-upgrade header may record `C:\Repo` where the current launch resolves
 * `c:\repo`). `caseInsensitive` is a parameter (not a platform read) so the
 * verifier can exercise both modes on any host. Exported for
 * scripts/verify-session-cwd.mjs.
 *
 * Boundary rule (issue #153): container directories are nobody's workspace.
 * $HOME and the Windows root forms — plain drive roots (`C:`), UNC share
 * roots (`//server/share`), and extended-length roots (`//?/C:`,
 * `//?/UNC/server/share`) — are ancestors of unrelated projects, so the
 * descendant rules below would list every session on the machine from `~`
 * (and every session on the drive/share from those roots). At these
 * boundaries, in either direction, only an exact match passes.
 */
export declare function sessionCwdMatches(stateCwd: string, headerCwd: string, caseInsensitive?: boolean): boolean;
/** The fs-service surface `@`-mention expansion consumes (dsh-fs-local). */
export interface MentionFs {
    resolve(path: string): Promise<{
        displayPath: string;
    }>;
    stat(target: {
        displayPath: string;
    }): Promise<{
        type: 'file' | 'directory' | 'other';
    } | undefined>;
    readText(target: {
        displayPath: string;
    }): Promise<string>;
    readBytes?(target: {
        displayPath: string;
    }, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>;
    listDir(target: {
        displayPath: string;
    }): Promise<Array<{
        name: string;
        type: 'file' | 'directory' | 'other';
    }>>;
}
type MentionImageBlock = ChannelImageBlock;
type MentionImageMediaType = ChannelImageMediaType;
/** Attachment subset used to turn an image path into a durable user block. */
export interface MentionAttachments {
    readonly imageLimits: {
        readonly maxImageBytes: number;
        readonly maxImagesPerMessage: number;
        readonly maxMessageImageBytes: number;
        readonly mediaTypes: readonly MentionImageMediaType[];
    };
    saveImage(input: {
        data: Uint8Array;
        mediaType: MentionImageMediaType;
        name?: string;
    }): Promise<MentionImageBlock['attachment']>;
}
export interface MentionExpansion {
    /** Model-facing blocks: the typed text first, one block per attachment. */
    blocks: ContentBlock[];
    /** Paths that resolved and were attached (for the confirmation notice). */
    attached: string[];
    /** Mention tokens that failed to resolve (kept literal, warned about). */
    missing: string[];
}
/**
 * Expand a submitted text's `@` mentions (issue #15) into model-facing
 * attachment blocks: supported image files become durable image blocks,
 * other files contribute capped text, and directories contribute a shallow
 * listing. Reads always go through the active fs service, so provider-owned
 * workspaces keep their routing semantics. The typed text stays first and
 * verbatim. Best-effort failures degrade to `missing`, never a failed send.
 */
export declare function expandMentions(fs: MentionFs | undefined, cwd: string, text: string, attachments?: MentionAttachments, stagedImages?: ReadonlyMap<string, MentionImageBlock['attachment']>): Promise<MentionExpansion>;
//# sourceMappingURL=channel.d.ts.map