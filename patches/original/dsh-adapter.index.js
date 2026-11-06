import Schema from '@deepseek-ai/schemastery';
import { parseBackendChoice } from './backend-registry.js';
import { parseBackendId } from '../kernelPrefs.js';
import { ALL_SIDE_PANELS, BTW_CONTEXT_BUDGET_DEFAULT, BTW_CONTEXT_TURNS_DEFAULT, DEFAULT_COMPANION_SKIN, DEFAULT_STATUS_BAR, normalizeBtwContextBudget, normalizeBtwContextTurns, normalizeCompanionSkin, normalizePageMargin, normalizeSidePanelPanels, normalizeSidePanelRatio } from '../tuiDisplayPrefs.js';
import { SHORTCUT_ACTIONS } from '../utils/keymap.js';
import { normalizeSplashFont } from '../components/splashFonts.js';
import { normalizeBrandSetting } from '../branding.js';
import { editableConfig } from './compat/settings.js';
import { EDITABLE_CONFIG_KEYS } from '../settings/definitions.js';
import { peekEntrySlot, takeEntryAttach } from './entry-slot.js';
export const name = 'dsh-tui';
// `tuiWorkspaces` must stay OUT of this code-level inject (issue #183): the
// dsh CLI resolves the bundle's cordis.patch.yml from the FIRST copy of this
// package found from its own install anchor (typically the global launcher),
// while the Loader imports the plugin module from the profile's copy. When
// the two copies skew, the patch may predate the dsh-tui-workspaces row — a
// hard inject here then deadlocks the whole tree at boot ("pending (waiting
// for service: tuiWorkspaces)"). The bundle patch keeps tuiWorkspaces in the
// row-level inject purely as an ordering guarantee when the row exists; when
// it does not, plugin.ts/channel.ts fall back to a local workspace runtime.
export const inject = ['agents'];
/** The complete two-stage parse: syntax, then registry membership (P0 D1).
 *  Empty, malformed or unregistered values mean "not configured". Unlike the
 *  syntax-only Config schema, this helper requires discovery to have run. */
export function normalizeBackendChoice(value) {
    return parseBackendChoice(value);
}
export const Config = editableConfig(Schema.object({
    sessionId: Schema.string().required(false),
    // A transform, not a union: the row reads `DSH_TUI_BACKEND`, and a stray
    // export (`Claude`, a typo) must not fail the whole boot — case and blanks
    // are normalized here and the id-shape gate drops junk. Cordis validates
    // before `apply` assembles installed backends: membership must wait until
    // after that discovery, or a third-party Config choice is erased.
    backend: Schema.transform(Schema.string(), value => parseBackendId(value)),
    // No schema defaults on the route: a `.default()` here would make an
    // unset key indistinguishable from an explicit cordis.yml choice and the
    // persisted `/model` preference could never win (issue #30). The defaults
    // live at the end of the fallback chain in modelRoute.ts instead.
    provider: Schema.string().required(false),
    model: Schema.string().required(false),
    cwd: Schema.string().required(false),
    workspace: Schema.string().required(false),
    effort: Schema.string().required(false),
    effortDefault: Schema.string().required(false),
    whale: Schema.boolean().default(true),
    whaleIdle: Schema.boolean().default(true),
    // The face registry grows with new releases, so this is a transform rather
    // than a union: any string parses and junk lands on `daily` at parse time
    // (a union would fail the whole boot on a stale id). The `/settings` field
    // offers exactly the registry's ids. The default is deliberately NOT a
    // `.default()` here — the volatile wrapper swallows it (same shape as
    // pageMargin, whose unset value also reads `undefined`), so `daily` comes
    // from `normalizeSplashFont` at every read site.
    splashFont: Schema.transform(Schema.string(), value => normalizeSplashFont(value)),
    // 同 splashFont 的 transform 而非 union：cordis.yml 保持决定权，`auto`
    // 的默认值由 `normalizeBrandSetting` 在每个读取点给出。
    brand: Schema.transform(Schema.string(), value => normalizeBrandSetting(value)),
    whaleGirl: Schema.boolean().default(false),
    minimal: Schema.boolean().default(false),
    activity: Schema.boolean().default(true),
    activityFrames: Schema.string().required(false),
    contextBar: Schema.boolean().default(true),
    fullscreen: Schema.boolean().default(true),
    terminalImages: Schema.boolean().default(true),
    // No `.default()` on purpose (same rule as recapOnOpen): an unset key must
    // stay distinguishable from an explicit `false`, and the boot reads
    // undefined as on (`config.launchpad !== false`).
    launchpad: Schema.boolean(),
    lang: Schema.string().required(false),
    preset: Schema.string().required(false),
    diffLayout: Schema.union(['auto', 'split', 'unified']).default('auto'),
    thinkingFold: Schema.union(['preview', 'full']).default('preview'),
    jobGroupFold: Schema.union(['auto', 'always', 'never']).default('auto'),
    toolBackground: Schema.union(['none', 'subtle', 'strong']).default('none'),
    scrollGutter: Schema.union(['timeline', 'scrollbar', 'hidden']).default('timeline'),
    // Preset names AND custom `NxM` specs must survive validation (a custom
    // spec is not a fixed union member); junk is normalized to `normal` by
    // the transform, so every parsed config carries a valid setting.
    pageMargin: Schema.transform(Schema.string().default('normal'), value => normalizePageMargin(value)),
    foldTerminalCommand: Schema.boolean().default(false),
    turnUsageRow: Schema.boolean().default(false),
    promptSessionLabel: Schema.boolean().default(false),
    expandEditor: Schema.boolean().default(true),
    smoothStreaming: Schema.boolean().default(true),
    taskNotifications: Schema.union(['off', 'unfocused', 'always']),
    notificationMethod: Schema.union(['auto', 'osc9', 'bel', 'windows']),
    mermaidDiagrams: Schema.boolean().default(true),
    codeFrameStyle: Schema.union(['light', 'full']),
    mathRendering: Schema.union(['auto', 'image', 'unicode', 'source']),
    mathImageScale: Schema.union(['auto', 'large', 'xlarge']),
    mathImageBacking: Schema.union(['transparent', 'terminal']),
    imageBacking: Schema.union(['transparent', 'terminal']),
    latexMath: Schema.boolean(),
    // No `.default()` on purpose (the volatile wrapper swallows it; same rule as
    // splashFont): an unset key must stay distinguishable from an explicit
    // `false`, and the read site already treats undefined as on
    // (`describe().value.recapOnOpen !== false`, see channel.ts).
    recapOnOpen: Schema.boolean(),
    statusBar: Schema.object({
        compact: Schema.boolean().default(DEFAULT_STATUS_BAR.compact),
        model: Schema.boolean().default(DEFAULT_STATUS_BAR.model),
        thinking: Schema.boolean().default(DEFAULT_STATUS_BAR.thinking),
        cwd: Schema.boolean().default(DEFAULT_STATUS_BAR.cwd),
        contextUsage: Schema.boolean().default(DEFAULT_STATUS_BAR.contextUsage),
        cache: Schema.boolean().default(DEFAULT_STATUS_BAR.cache),
        tokens: Schema.boolean().default(DEFAULT_STATUS_BAR.tokens),
        // Session cost estimate (≈¥) beside the token totals; StatusLine gates the
        // chip on it. The slot must be declared here: schemastery drops an
        // undeclared key on the way back in, so the /settings row would read
        // "(unset)" and every edit would silently revert.
        cost: Schema.boolean().default(DEFAULT_STATUS_BAR.cost),
        tps: Schema.boolean().default(DEFAULT_STATUS_BAR.tps),
        gitBranch: Schema.boolean().default(DEFAULT_STATUS_BAR.gitBranch),
        sessionTitle: Schema.boolean().default(DEFAULT_STATUS_BAR.sessionTitle),
        sessionId: Schema.boolean().default(DEFAULT_STATUS_BAR.sessionId),
        goal: Schema.boolean().default(DEFAULT_STATUS_BAR.goal),
        mode: Schema.boolean().default(DEFAULT_STATUS_BAR.mode),
        contextBar: Schema.boolean().default(DEFAULT_STATUS_BAR.contextBar),
        activity: Schema.boolean().default(DEFAULT_STATUS_BAR.activity),
        trajectory: Schema.boolean().default(DEFAULT_STATUS_BAR.trajectory),
        shortcutHint: Schema.boolean().default(DEFAULT_STATUS_BAR.shortcutHint),
        pluginFields: Schema.boolean().default(DEFAULT_STATUS_BAR.pluginFields),
        pluginFieldsOrder: Schema.string().default(DEFAULT_STATUS_BAR.pluginFieldsOrder),
    }).default({ ...DEFAULT_STATUS_BAR }),
    // Side-panel preferences, same shape as statusBar: every member carries a
    // default so an unset cordis.yml block and a partially hand-written one
    // both resolve, and the transforms keep junk (a string ratio, an id with
    // illegal characters) out of the live stores.
    sidePanel: Schema.object({
        splitEnabled: Schema.boolean().default(true),
        open: Schema.boolean().default(false),
        ratio: Schema.transform(Schema.number().default(0.68), value => normalizeSidePanelRatio(value)),
        panels: Schema.transform(Schema.string().default(ALL_SIDE_PANELS), value => normalizeSidePanelPanels(value)),
    }).default({ splitEnabled: true, open: false, ratio: 0.68, panels: ALL_SIDE_PANELS }),
    companion: Schema.object({
        skin: Schema.transform(Schema.string().default(DEFAULT_COMPANION_SKIN), value => normalizeCompanionSkin(value)),
    }).default({ skin: DEFAULT_COMPANION_SKIN }),
    // btw thread context: schema defaults + transforms (same shape as
    // sidePanel above) so an unset cordis.yml block and junk values both
    // resolve to the documented 4 turns / 24k chars before the stores see
    // them (the store normalize remains the second, identical gate).
    btw: Schema.object({
        contextTurns: Schema.transform(Schema.number().default(BTW_CONTEXT_TURNS_DEFAULT), value => normalizeBtwContextTurns(value)),
        contextBudget: Schema.transform(Schema.number().default(BTW_CONTEXT_BUDGET_DEFAULT), value => normalizeBtwContextBudget(value)),
    }).default({ contextTurns: BTW_CONTEXT_TURNS_DEFAULT, contextBudget: BTW_CONTEXT_BUDGET_DEFAULT }),
    // One optional combo string per customizable action (no defaults: unset
    // keeps the built-in binding; see Config.shortcuts).
    shortcuts: Schema.object(Object.fromEntries(SHORTCUT_ACTIONS.map(action => [action.id, Schema.string().required(false)]))).required(false),
    modes: Schema.array(Schema.object({
        id: Schema.string(),
        label: Schema.string().required(false),
        plan: Schema.boolean().required(false),
        sandbox: Schema.union(['read-only', 'workspace-write', 'danger-full-access']).required(false),
        approval: Schema.union(['ask', 'never']).required(false),
        permission: Schema.string().required(false),
    })).required(false),
    // Upstream auto-retry seeding (see upstream-retry.ts): on by default so
    // an upstream link drop retries like any other transient failure.
    upstreamRetry: Schema.boolean().default(true),
}), EDITABLE_CONFIG_KEYS);
/**
 * Start the interactive TUI front door, delegating to the JSX implementation
 * in `./plugin.tsx` (see its module doc for the full contract).
 * @param ctx - the plugin context.
 * @param config - the validated dsh-tui configuration.
 * @returns a promise settling when the Loader entry has scheduled its runtime.
 */
export async function apply(ctx, config) {
    // The entry already mounted the screen in this process (./entry-slot.ts):
    // the row only runs the DSH side and hands the session to that screen.
    const entrySlot = peekEntrySlot();
    if (entrySlot !== undefined) {
        entrySlot.rowSeen = true;
        attachToEntry(ctx, config);
        return;
    }
    // Upstream drift is NO LONGER spammed to stderr here: per-package
    // console.warn lines interleave with the TUI frame redraw and arrive
    // garbled (typewriter animation repaints over them). The merged,
    // natural-language notice now renders in the logo header under the
    // startup tip (LogoV2 ← upstreamDriftSummary); CI keeps the hard gate
    // via scripts/verify-upstream-contract.ts.
    const { apply: tuiApply, handleStartupError } = await import('./plugin.js');
    let disposed = false;
    ctx.effect(() => () => { disposed = true; });
    // Registry diagnostics can await the whole Loader. Do not make this Host
    // row await the runtime in return. Let Host providers settle before starting
    // a Cordis-owned child; the original row still owns volatile Config.
    const loader = ctx.get('loader');
    void (loader?.await() ?? ctx.fiber.await()).then(() => {
        if (disposed)
            return;
        return ctx.plugin({
            name: 'dsh-tui-runtime',
            apply: (runtimeCtx) => tuiApply(runtimeCtx, config, ctx),
        });
    }).catch(error => {
        if (!disposed)
            handleStartupError(ctx, error);
    });
}
/** The row under the entry's screen: the DSH side in its own runtime fiber
 *  once the Loader settled, never a second render; a recompose stays idle. */
function attachToEntry(ctx, config) {
    const attach = takeEntryAttach();
    if (attach === undefined) {
        ctx.logger.warn('dsh-tui: the entry\'s screen already holds a DSH session; this dsh-tui row stays idle');
        return;
    }
    let disposed = false;
    ctx.effect(() => () => { disposed = true; });
    const loader = ctx.get('loader');
    void (loader?.await() ?? ctx.fiber.await()).then(() => {
        if (disposed)
            return;
        return ctx.plugin({
            name: 'dsh-tui-runtime',
            apply: (runtimeCtx) => attach(runtimeCtx, config, ctx),
        });
    }).catch((error) => {
        ctx.logger.error(`dsh-tui: the DSH side failed to start under the entry's screen: ${error instanceof Error ? error.message : String(error)}`);
    });
}
// ── The Backend contribution family (B-2) ─────────────────────────────────────
// `alpha`, and deliberately narrow: the *declaration* shape, its validator, the
// admission verdict and the projection this package uses for its own manifests.
// A third-party author writes a declaration by hand against exactly this surface
// (scripts/verify-public-config-types.mjs compiles a real consumer file against
// the published declarations), and from here on it may only grow — removing any
// of it is a breaking change. What is NOT here: the registry, the loader and the
// picker. Those stay the host's; an installed bundle's declaration reaches them
// through the boot-time assembly (`backend-assembly.ts`, D-1) on top of the W-2
// admission chain (see docs/plugins.md).
export { BACKEND, BACKEND_CAPABILITY_NAMES, BACKEND_RESERVED_IDS, validateBackendSpec, } from '../adapter/spec/tui-contributions.js';
export { backendAdmission } from './backend-admission.js';
export { backendContributionOf } from './backend-contribution.js';
