# OpenCode Dokana Requirements

## Purpose and Scope

OpenCode Dokana centrally configures the `model`, `variant`, and `prompt` of exactly seven agents: `orchestrator`, `dispatcher`, `explorer`, `low-fixer`, `medium-fixer`, `deep-fixer`, and `oracle`. The first release reads overrides from `~/.config/opencode/opencode-dokana.toml`. Failover is out of scope for this release and is reserved for a future version.

## Behavior

The plugin registers exactly one `config` hook. At startup, that hook loads the configuration through this pipeline: read TOML, parse, validate, plan, resolve and read prompts, apply, then notify. Application shallow-merges only `model`, `variant`, and `prompt`; no other agent fields are changed. The plan is complete before application begins, so there is no half-applied state.

## Priority

For `model` and `variant`, the priority is session-level `ctrl+t` selection, then TOML, then the `.md` agent frontmatter fallback. For `prompt`, a TOML prompt path takes priority over the bundled plugin default at `prompts/<id>.md`.

## TOML Schema

The root configuration uses an `agents` table. Each `agents.<id>.model` is required and must be non-empty, contain `/`, and have non-empty text on both sides of the slash. Each `variant` is required, non-empty, and passed through without an enum restriction. `prompt` is optional, must be a `.md` path, is resolved relative to the TOML directory, and supports `~/`; inline prompt content is not supported. Unknown agent IDs and unknown top-level keys are ignored.

## Error Handling

File-level errors, including a missing TOML file, TOML syntax error, or missing `agents` table, prevent overrides from applying for that startup while bundled default prompts still load. Unknown agent entries are ignored. Invalid `model` or `variant` causes those two fields to atomically fall back to `.md` defaults; an invalid or unreadable `prompt` falls back to the bundled default prompt. A missing bundled default prompt does not crash startup. Detailed events are recorded through `appLog` and summarized in a toast. Startup reports an override inventory with `default`, `toml-override`, or `not-applied` sources.

## Acceptance Highlights

Stage 5 acceptance covers the 28 baseline, priority, error-path, boundary, and quality checks. It verifies all seven baseline TOML overrides, session-level selection precedence, TOML and frontmatter fallbacks, TOML prompt overrides and bundled prompt migration, missing and malformed TOML handling, missing `agents`, unknown keys and agents, invalid model, variant, and prompt fields, unreadable prompt paths, missing bundled prompts, atomic field behavior, no partial application, source inventory reporting, one-hook registration, narrow three-field application, supported relative and home-expanded paths, strict TypeScript quality, `bun` and `tsc` gates, and a clean V3 Git baseline.

## Constraints

Source uses strict TypeScript, has no `any`, no silent catches, and no unused exports. The only permitted external dependency is `toml`. Source code is English; user-visible wording may be Chinese. The target OpenCode version is `1.18.18`.
