# VoiceClaw contribution conventions

This file is a local working summary of the VoiceClaw contribution rules that are useful during routine development, testing, commits, and pull requests. It is not a replacement for the official documentation. If this summary differs from the official source, follow the official source.

Primary sources:

- [Contributing guide](https://docs.getvoiceclaw.com/contributing/)
- [Releasing and versioning](https://docs.getvoiceclaw.com/development/releasing/)
- [Official repository README](https://github.com/yagudaev/voiceclaw/blob/main/README.md#contributing)
- [PR-title validation workflow](https://github.com/yagudaev/voiceclaw/blob/main/.github/workflows/commitlint-pr-title.yml)

## Development environment

- Use Node.js 20 or newer and Yarn. Do not use npm for this repository. Install all workspace dependencies from the repository root with `yarn install`. [Source](https://docs.getvoiceclaw.com/contributing/#development-setup)
- macOS is required for Electron desktop and iOS development; Xcode is required for iOS builds. [Source](https://docs.getvoiceclaw.com/contributing/#prerequisites)
- The repository is a Yarn workspace monorepo. Run a workspace's own scripts from that workspace, or use the corresponding root script. [Source](https://docs.getvoiceclaw.com/contributing/#monorepo-structure)
- Common development entry points are `yarn dev`, `yarn dev:server`, `yarn dev:mobile`, and `yarn dev:desktop`. The relay server defaults to `http://localhost:8080`, with a WebSocket test page at `/test`. [Source](https://docs.getvoiceclaw.com/contributing/#running-everything)
- Keep credentials in the relevant `.env` file. For relay development, copy `relay-server/.env.example` to `relay-server/.env` and supply the required provider and relay keys. [Source](https://docs.getvoiceclaw.com/contributing/#relay-server)

## Branches and change scope

- Never push directly to `main`. Create a feature branch from `main`, using names such as `feature/<description>` or `fix/<description>`, and merge through a reviewed pull request. [Source](https://docs.getvoiceclaw.com/contributing/#branch-strategy)
- Keep each pull request focused on one feature or fix. [Source](https://github.com/yagudaev/voiceclaw/blob/main/README.md#contributing)
- A normal change flow is: branch from `main`, implement, test the affected protocol and clients, make a clear commit, push, and open a pull request against `main`. [Source](https://docs.getvoiceclaw.com/contributing/#making-changes)

## Code conventions

- Write new code in TypeScript. Omit semicolons in TypeScript and JavaScript. [Source](https://docs.getvoiceclaw.com/contributing/#code-style)
- Put the public interface and exports at the top of a file and helper functions at the bottom. [Source](https://docs.getvoiceclaw.com/contributing/#file-organization)
- Keep functions small and focused, and choose descriptive variable and function names. Add comments only where the logic is not obvious, particularly around protocol translation. [Source](https://docs.getvoiceclaw.com/contributing/#general-guidelines)
- Do not use emoji in source code or log messages. [Source](https://docs.getvoiceclaw.com/contributing/#general-guidelines)
- Name package scripts as `verb:app`, such as `dev:server` or `build:web`, rather than `app:verb`. [Source](https://docs.getvoiceclaw.com/contributing/#script-naming)

## Testing before commit

- Build, deploy, and test on a relevant device before committing. Also verify that existing behavior still works. [Source](https://docs.getvoiceclaw.com/contributing/#testing)
- For relay changes, run the relay server and exercise WebSocket behavior through `http://localhost:8080/test`. [Source](https://docs.getvoiceclaw.com/contributing/#relay-server)
- For mobile changes, test with Expo Go on a real iOS device or iOS simulator; the web target is not an accepted substitute. [Source](https://docs.getvoiceclaw.com/contributing/#testing)
- For desktop changes, run the app and verify the affected behavior, including audio capture, playback, and screen sharing where relevant. [Source](https://docs.getvoiceclaw.com/contributing/#testing)
- In addition to the required manual checks, run the affected workspace's available test, type-check, and build scripts. The current scripts are defined in each workspace's `package.json`; do not invent or substitute npm commands. [Source](https://github.com/yagudaev/voiceclaw/blob/main/package.json)

## Commits and pull requests

- Individual feature-branch commits only need clear messages; the repository intentionally does not lint them. The pull-request title is the release-significant message because pull requests are squash-merged. [Source](https://github.com/yagudaev/voiceclaw/blob/main/.github/workflows/commitlint-pr-title.yml)
- Format the PR title as a Conventional Commit. Allowed types are `feat`, `fix`, `perf`, `refactor`, `revert`, `docs`, `build`, `ci`, `test`, `style`, and `chore`. A scope is optional. The subject must start with a lowercase letter, for example `feat: add download page`. [Source](https://github.com/yagudaev/voiceclaw/blob/main/.github/workflows/commitlint-pr-title.yml)
- Use `!` after the type or a `BREAKING CHANGE:` footer for a breaking change. [Source](https://docs.getvoiceclaw.com/development/releasing/#conventional-commits-taxonomy)
- PR-title release effects are: `feat` produces a minor bump; `fix`, `perf`, `refactor`, `revert`, and `docs` produce a patch bump; `build`, `ci`, `test`, `style`, and `chore` do not produce a bump. [Source](https://docs.getvoiceclaw.com/development/releasing/#conventional-commits-taxonomy)
- Package scopes such as `feat(desktop): ...` are optional. Release automation determines affected packages from changed files, though a scope can clarify a multi-package change. [Source](https://docs.getvoiceclaw.com/development/releasing/#scoping-a-commit-to-a-package)
- Do not manually bump package versions or edit changelogs for an ordinary contribution. Release Please derives those changes from squash-merged PR titles. Contributors do not need local commitlint hooks, Changesets, or other release tooling. [Source](https://docs.getvoiceclaw.com/development/releasing/)

## Documentation diagrams

- Write architecture and flow diagrams as Mermaid fenced blocks in `.mdx` files. Preview them in Mermaid Live, then place the finalized source back in the page. Repository-level styling belongs in `docs/astro.config.mjs`; use per-diagram overrides only where needed. [Source](https://docs.getvoiceclaw.com/contributing/#authoring-diagrams)

## Pre-PR checklist

- The branch was created from `main` and is not a direct push to `main`.
- The PR contains one focused feature or fix.
- New code follows the TypeScript, semicolon, file-ordering, naming, comment, and logging rules above.
- Relevant automated scripts pass, and the affected relay/mobile/desktop behavior was tested in its required runtime.
- The PR targets `main`, has been prepared for review, and its title uses an allowed Conventional Commit type with a lowercase subject.
- Version files and changelogs were left to Release Please unless an official release override is intentionally being used.
