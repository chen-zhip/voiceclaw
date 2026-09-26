## Context

See `proposal.md`. `DesktopHostContributionRuntime` already accepts a `loadEnabled()` callback and enforces unique package/contribution identity; `ipc-handlers.ts` passes `async () => []`. Phase 0 discovery and manifest validation exist on the Relay side (`relay-server/src/plugin-kernel/package-discovery.ts`) but have no Desktop equivalent, and the archived Kernel design states the intended split: Desktop loads local entries, Relay receives and revalidates only a secret-free Manifest projection.

The Codex package already declares `provider-integration` with entry `codex-provider.ts` and exports `createCodexContribution({ activeHostId, configuration, boundary, clientVersion })`. Its process boundary has only ever been implemented inside a test file.

## Goals / Non-Goals

**Goals:** make the shipped local stack load and register a real Provider Contribution; make the packaged voice/harness settings reachable by the bundled Relay; keep the loading seam testable without launching Electron or Codex.

**Non-Goals:** a general third-party plugin runtime, package signing or isolation, hot reload, an external-Relay Host bootstrap, and any change to Provider-visible or Relay-visible contracts.

## Decisions

### Desktop performs its own Phase 0 discovery

The loader scans configured roots for `<root>/<directory>/voiceclaw.plugin.json`, rejects packages that fail `parsePluginManifest`, rejects entries that are missing or escape the package root, and keeps the accepted manifest in memory. It reuses `@voiceclaw/contracts` only — no Relay source import — so the Desktop side stays independently deployable and the Relay keeps revalidating the projection it receives.

### Loading happens through an inspectable seam

`createDesktopHostContributionLoader({ pluginRoots, importModule, createProviderContext })` returns the `loadEnabled()` callback the Contribution runtime already expects. Discovery, entry selection, and registration mapping are therefore testable with fixture package directories and a stub `importModule`, and the Electron wiring stays a thin adapter over it.

### The entry contract is one named factory

A `provider-integration` entry MUST export `createProviderContribution(context)`, returning the existing `DesktopHostContribution` shape. The loader supplies the package manifest, the contribution declaration, the Active Host identity, the binding's Native Provider Configuration, and a Provider process boundary. The Codex entry re-exports this factory so the package is loadable without inventing a second protocol; the existing `createCodexContribution` stays as the implementation the factory calls.

### TypeScript entries load through the repository's existing dev toolchain

In dev the default `importModule` registers `tsx` before importing a `.ts` entry (the same tool the Desktop already uses to run Relay source); packaged builds import plain ESM. The seam keeps that decision out of the loader's behavior tests.

### Bundled Relay environment gains an explicit, minimal allow-list

`FORWARDED_KEYS` gains only the settings a Provider package needs: the `GPT_SOVITS_*` group and the Harness plugin selection (`VOICECLAW_SHIPPED_PLUGIN_ROOTS`, `VOICECLAW_HARNESS_PACKAGE_ID`, `VOICECLAW_HARNESS_CONTRIBUTION_ID`, `VOICECLAW_VERSION`). Provider credentials keep their current path through the Desktop settings store; nothing else is forwarded.

### Failure stays visible and non-fatal

A rejected package, a missing entry, or a failing factory is reported as a degraded Host registration (or a logged rejection) instead of aborting Desktop startup, and the Accepted Contribution is only registered once its factory resolved.

## Risks / Trade-offs

- [A bad package can break Desktop startup] → Loading is per-package best-effort, failures are logged and skipped, and the runtime still enforces unique identity.
- [TS entry loading depends on `tsx`] → Confined to the default `importModule`; packaged builds use ESM entries, and tests inject the importer.
- [A production Codex boundary can spawn processes with the user's environment] → The boundary keeps the existing ownership rules: the Host starts and terminates only processes it started, and passes an explicit environment rather than a caller-supplied one.
- [Forwarding more environment could widen secret exposure to the Relay child] → Only non-secret local settings and the plugin selection are added; credentials keep their existing path, and the Relay still receives no Native Provider Configuration.

## Migration Plan

1. Land the loader with fixture-package tests; the empty-list wiring stays until the loader is green.
2. Add the production Provider boundary and the Codex entry factory, then switch `ipc-handlers.ts` to the loader with roots from the environment.
3. Extend the Relay forwarding list and verify the bundled Relay receives the new settings.
4. Roll back by clearing the plugin roots environment: the loader then registers nothing and the stack behaves as it does today.

## Open Questions

- Whether the Desktop Host should later re-read plugin roots at runtime (hot reload) is deferrable; this change reads them at startup.
