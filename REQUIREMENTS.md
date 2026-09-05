# OpenCode Dokana Requirements

## Purpose and Scope

OpenCode Dokana centrally configures the `model`, `variant`, `prompt`, and `permission` of exactly six agents: `sergeant`, `explorer`, `low-fixer`, `medium-fixer`, `deep-fixer`, and `oracle`. The plugin reads overrides from `~/.config/opencode/opencode-dokana.toml`.

## Behavior

The plugin registers one `config` hook and the `interrupt_session` custom tool. At startup, the config hook loads the configuration through this pipeline: read TOML, parse, validate, plan, resolve and read prompts, apply, then notify. Each agent receives a newly constructed effective permission object from the plugin default matrix and its TOML permission fragment. The permission object replaces every existing agent-level permission source, including frontmatter and `opencode.json`; all other agent fields are preserved. The plan is complete before application begins, so there is no half-applied state.

## Priority

For `model` and `variant`, the priority is session-level `ctrl+t` selection, then TOML, then the `.md` agent frontmatter fallback. For `prompt`, a TOML prompt path takes priority over the bundled plugin default at `prompts/<id>.md`. For `permission`, TOML overrides plugin defaults, and the effective object replaces all agent-level sources.

## TOML Schema

The root configuration uses an `agents` table. `model` and `variant` are validated as an atomic pair only when either field is present. `model` must be non-empty, contain `/`, and have non-empty text on both sides; `variant` must be non-empty and has no enum restriction. `prompt` is optional, must be a `.md` path, is resolved relative to the TOML directory, and supports `~/`; inline prompt content is not supported. Permission fields use the native OpenCode object shape under `[agents.<id>.permission]`. Flat permission keys are passed through unchanged. `task` may be a scalar (`task = "deny"`) or a table (`[agents.<id>.permission.task]`), with table keys merged individually. Unknown permission keys and permission values are passed through unchanged; OpenCode performs enum/schema validation at startup. Unknown agent IDs and unknown top-level keys retain the existing ignored-with-warning behavior.

`interrupt_session` is a Dokana custom permission key. Its default is `allow` for `sergeant` and `deny` for every other supported agent; TOML may override it with `allow`, `ask`, or `deny`. The tool requires `task_id`, permits only a target whose `parentID` chain reaches the current session, and rejects the current session itself. It validates the chain with v1 `client.session.get({ path: { id } })`, then calls `client.session.abort({ path: { id: task_id } })`; it does not enumerate sessions or use the v2 interrupt API. Abort applies to the target BackgroundJob and recursive cancellation semantics, is asynchronous, and a successful response only means cancellation was requested, not that stopping was confirmed. The independent TUI Esc path is not changed. The v1 client uses the plugin server URL and directory. When `OPENCODE_SERVER_PASSWORD` is present, it sends HTTP Basic authentication with `OPENCODE_SERVER_USERNAME` or the default username `opencode`.

## Error Handling

File-level errors, including a missing TOML file, TOML syntax error, or missing `agents` table, prevent TOML overrides from applying for that startup while plugin default permissions and bundled default prompts still load. Unknown agent entries are ignored. Invalid `model` or `variant` causes those two fields to atomically fall back to `.md` defaults; permission-only TOML does not produce model/variant warnings. Permission values are never enum-validated by the plugin. An invalid or unreadable `prompt` falls back to the bundled default prompt. A missing bundled default prompt does not crash startup. Detailed events are recorded through `appLog` and summarized in a toast. Startup reports an override inventory with `default`, `toml-override`, or `not-applied` sources and issue summaries.

## Acceptance Highlights

Stage 6 acceptance covers the baseline, priority, error-path, boundary, and quality checks. It verifies the six default permission matrices, TOML permission overrides, task merge ordering and scalar replacement, unknown permission passthrough, model/variant/prompt/permission error isolation, all six baseline overrides, prompt fallback behavior, source inventory reporting, config-hook and tool registration, preservation of unrelated agent fields, supported paths, strict TypeScript quality, and `bun` and `tsc` gates.

## Constraints

Source uses strict TypeScript, has no `any`, no silent catches, and no unused exports. Runtime dependencies are `toml`, `@opencode-ai/sdk`, and `zod`; `@opencode-ai/plugin` remains a development dependency for plugin types. Source code is English; user-visible wording may be Chinese. The target OpenCode version is `1.18.18`.
