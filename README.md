# opencode-dokana

opencode-dokana is an OpenCode plugin that centrally applies TOML-driven `model`, `variant`, `prompt`, and `permission` overrides to six agents: `sergeant`, `oracle`, `explorer`, `low-fixer`, `medium-fixer`, and `deep-fixer`. It requires OpenCode `>= 1.18.18`.

## Architecture

```text
User <-> Sergeant
          |-- Oracle
          |-- Explorer
          |-- Low Fixer
          |-- Medium Fixer
          `-- Deep Fixer (ask)
```

- **Sergeant** is the sole primary coordinator. It talks to the user, decides scope and strategy, gathers evidence, routes work directly to specialists, and reports the result.
- **Oracle** is a read-only advisor for difficult technical judgment.
- **Explorer** is a read-only evidence retriever.
- **Fixers** implement authorized changes. `low-fixer` handles simple bounded work, `medium-fixer` handles non-trivial local work, and `deep-fixer` handles explicitly approved complex work.

Sergeant selects the shortest reliable route rather than following a fixed pipeline. It may call `explorer`, `low-fixer`, `medium-fixer`, and `oracle`; `deep-fixer` is an OpenCode `ask` permission and requires approval. Specialists cannot invoke other agents.

## Default agents

| Agent | Mode | Default model | Responsibility |
| --- | --- | --- | --- |
| `sergeant` | primary | `openai/gpt-5.6-sol` | User-facing coordinator and direct specialist router. `edit: deny`, `bash: allow`. |
| `oracle` | subagent | `code-mirror/gpt-5.6-sol` | Read-only technical advisor. |
| `explorer` | subagent | `opencode-go/deepseek-v4-flash` | Read-only codebase reconnaissance. |
| `low-fixer` | subagent | `opencode-go/deepseek-v4-flash` | Simple, low-risk implementation. |
| `medium-fixer` | subagent | `code-mirror/gpt-5.6-terra` | Non-trivial local implementation and diagnosis. |
| `deep-fixer` | subagent | `code-mirror/gpt-5.6-sol` | Explicitly approved complex implementation. |

The actual `model` and `variant` are chosen by `opencode-dokana.toml`; session-level `ctrl+t` can temporarily override them.

## Permissions

| Agent | Default permission summary |
| --- | --- |
| `sergeant` | `edit: deny`, `bash: allow`, `external_directory: ask`, repository tools allowed, `task.*: deny`, `task.explorer/low-fixer/medium-fixer/oracle: allow`, `task.deep-fixer: ask` |
| `oracle` | Read-only tools allowed; `edit`, `bash`, `task`, and `interrupt_session`: deny |
| `explorer` | Read-only tools and `bash`: allow; `task` and `interrupt_session`: deny |
| `low-fixer`, `medium-fixer`, `deep-fixer` | `edit`, `bash`, and `external_directory`: allow; `task` and `interrupt_session`: deny |

Fixers are the only agents allowed to edit source files by the orchestration responsibility rules. This is not a hard read-only boundary for Sergeant or Explorer: both have `bash: allow`, so their prompts must not use Bash to mutate files. The `ask` gate for Sergeant calling `deep-fixer` is enforced by OpenCode's task permission, not merely by prompt text.

## Interrupting descendant tasks

`interrupt_session({ task_id: string, reason?: string })` requests asynchronous cancellation of a descendant task. The target must not be the current session and its `parentID` chain must reach the caller. The tool verifies that chain with v1 `client.session.get`, then calls v1 `client.session.abort`. Success means the cancellation request was accepted; it does not confirm the task has stopped. By default, only Sergeant has `interrupt_session: allow`; every other supported agent is denied.

The SDK client uses the plugin server URL and its configured authentication. When `OPENCODE_SERVER_PASSWORD` is set, OpenCode supplies HTTP Basic authentication with `OPENCODE_SERVER_USERNAME` (default `opencode`).

## Installation

Add the package or local path to the `plugin` array in `opencode.json`:

```json
{
  "plugin": ["@mrch1ppy/opencode-dokana"]
}
```

For a local clone, run `bun install` once to install runtime dependencies before OpenCode loads the plugin.

## Configuration

At startup the plugin reads `~/.config/opencode/opencode-dokana.toml`; if that file is absent, it uses the repository `opencode-dokana.default.toml`. These files are not deep-merged.

```toml
[agents.sergeant]
model="openai/gpt-5.6-sol"
variant="high"

[agents.oracle]
model="code-mirror/gpt-5.6-sol"
variant="xhigh"

[agents.explorer]
model="opencode-go/deepseek-v4-flash"
variant="high"

[agents.low-fixer]
model="opencode-go/deepseek-v4-flash"
variant="high"

[agents.medium-fixer]
model="code-mirror/gpt-5.6-terra"
variant="medium"

[agents.deep-fixer]
model="code-mirror/gpt-5.6-sol"
variant="medium"

[agents.sergeant.permission.task]
"*"="deny"
explorer="allow"
"medium-fixer"="allow"
"deep-fixer"="ask"
```

Priority is `ctrl+t` > TOML > agent frontmatter for `model` and `variant`; TOML prompt path > bundled `prompts/<id>.md` for prompts; and TOML > plugin defaults for permissions. A TOML permission object replaces agent-level permissions, while a `task` table merges by key with the plugin defaults. `skill` tables replace their default table completely.

`prompt` must name a `.md` file. Relative paths resolve from the TOML directory and `~/` is expanded. An unreadable or invalid prompt path falls back to the bundled prompt. Missing, invalid, or unparsable TOML falls back to bundled prompts and the default permission matrix; invalid `model`/`variant` pairs fall back to agent frontmatter.

Only the six listed agent IDs are supported. Former `orchestrator` and `dispatcher` TOML entries are ignored with an unknown-agent warning; migrate their settings to `sergeant` and remove the old tables. Also delete the old agent stub files, set `default_agent` to `sergeant`, and preserve all unrelated `opencode.json` configuration when migrating.

## Validation

```bash
bun test
bunx tsc --noEmit
```

## License

MIT
