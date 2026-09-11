# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — it points at one `CONTEXT.md` per context (workspace). Read each one relevant to the topic.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. Also check `<workspace>/docs/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Multi-context repo — the contexts are the Yarn workspaces:

```
/
├── CONTEXT-MAP.md                    ← points to one CONTEXT.md per workspace
├── docs/adr/                         ← system-wide decisions
├── mobile/
│   ├── CONTEXT.md
│   └── docs/adr/                     ← context-specific decisions
├── website/
│   ├── CONTEXT.md
│   └── docs/adr/
└── relay-server/ … (also desktop, docs, tracing-collector, tracing-ui)
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Form terms by semantic family

Before introducing or revising a term:

1. Search code, specs, `CONTEXT.md` files, and ADRs for its general word and qualified forms.
2. Separate domain uses from technical homonyms such as key bindings or native-library bindings.
3. Identify the semantic family represented by the general word. Reuse it only when the new concept has the same kind of invariant and lifecycle.
4. Put the specific object or activity before the shared family word. For example, `Workspace Binding` and `Memory Producer Binding` are both managed associations; `memory.production.pending` qualifies which activity is pending.
5. Define the full qualified term, its owning authority, and its distinguishing invariant. Add ambiguous alternatives to `_Avoid_` in the relevant glossary.

A shared word keeps one meaning across domain terms:

- **`… Binding`** is a managed association between identified domain objects. The qualifier states what is associated. A host assignment, native configuration, or execution attempt is a separate concept.
- **`… Pending`** is the accepted-but-not-started state of a named activity or request. The qualified entity or namespace supplies the subject, and a reason field explains the current cause. In a typed state machine, the short value `pending` is sufficient; cross-domain prose and events retain the qualifier, such as `Memory Production Pending` and `memory.production.pending`.

The terminology step is complete only when every new term either matches an existing semantic family or introduces a deliberately distinct one, and every resolved project-specific term is recorded once in the relevant `CONTEXT.md`.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
