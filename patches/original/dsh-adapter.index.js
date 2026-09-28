import Schema from '@deepseek-ai/schemastery';
import { DEFAULT_STATUS_BAR, normalizePageMargin } from '../tuiDisplayPrefs.js';
import { SHORTCUT_ACTIONS } from '../utils/keymap.js';
import { editableConfig } from './compat/settings.js';
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
export const Config = editableConfig(Schema.object({
    sessionId: Schema.string().required(false),
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
    minimal: Schema.boolean().default(false),
    activity: Schema.boolean().default(true),
    activityFrames: Schema.string().required(false),
    contextBar: Schema.boolean().default(true),
    fullscreen: Schema.boolean().default(true),
    terminalImages: Schema.boolean().default(true),
    lang: Schema.string().required(false),
    preset: Schema.string().required(false),
    diffLayout: Schema.union(['auto', 'split', 'unified']).default('auto'),
    thinkingFold: Schema.union(['preview', 'full']).default('preview'),
    toolBackground: Schema.union(['none', 'subtle', 'strong']).default('none'),
    scrollGutter: Schema.union(['timeline', 'scrollbar', 'hidden']).default('timeline'),
    // Preset names AND custom `NxM` specs must survive validation (a custom
    // spec is not a fixed union member); junk is normalized to `normal` by
    // the transform, so every parsed config carries a valid setting.
    pageMargin: Schema.transform(Schema.string().default('normal'), value => normalizePageMargin(value)),
    foldTerminalCommand: Schema.boolean().default(false),
    promptSessionLabel: Schema.boolean().default(false),
    expandEditor: Schema.boolean().default(true),
    smoothStreaming: Schema.boolean().default(true),
    mermaidDiagrams: Schema.boolean().default(true),
    statusBar: Schema.object({
        compact: Schema.boolean().default(DEFAULT_STATUS_BAR.compact),
        model: Schema.boolean().default(DEFAULT_STATUS_BAR.model),
        thinking: Schema.boolean().default(DEFAULT_STATUS_BAR.thinking),
        cwd: Schema.boolean().default(DEFAULT_STATUS_BAR.cwd),
        contextUsage: Schema.boolean().default(DEFAULT_STATUS_BAR.contextUsage),
        cache: Schema.boolean().default(DEFAULT_STATUS_BAR.cache),
        tokens: Schema.boolean().default(DEFAULT_STATUS_BAR.tokens),
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
    }).default({ ...DEFAULT_STATUS_BAR }),
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
}), [
    'diffLayout', 'thinkingFold', 'toolBackground', 'scrollGutter', 'pageMargin',
    'foldTerminalCommand', 'promptSessionLabel', 'expandEditor', 'smoothStreaming',
    'mermaidDiagrams', 'effortDefault', 'statusBar', 'whale', 'whaleIdle', 'minimal',
    'lang', 'fullscreen', 'terminalImages', 'shortcuts',
]);
/**
 * Start the interactive TUI front door, delegating to the JSX implementation
 * in `./plugin.tsx` (see its module doc for the full contract).
 * @param ctx - the plugin context.
 * @param config - the validated dsh-tui configuration.
 * @returns a promise settling when the Loader entry has scheduled its runtime.
 */
export async function apply(ctx, config) {
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
