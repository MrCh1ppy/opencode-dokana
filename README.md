# opencode-dokana

opencode-dokana is an OpenCode plugin that centrally applies TOML-driven `model`, `variant`, `prompt`, and `permission` overrides to seven agents: `sergeant`, `oracle`, `explorer`, `low-worker`, `medium-worker`, `deep-worker`, and `frontend-worker`. It requires OpenCode `>= 1.18.18`.

## Architecture

```text
User <-> Sergeant
          |-- Oracle
          |-- Explorer
          |-- Low Worker
          |-- Medium Worker
          |-- Frontend Worker
          `-- Deep Worker (ask)
```

- **Sergeant** is the sole primary coordinator. It talks to the user, decides scope and strategy, gathers evidence, routes work directly to specialists, and reports the result.
- **Oracle** is a read-only advisor for difficult technical judgment.
- **Explorer** is a read-only evidence retriever.
- **General workers** implement authorized changes. `low-worker` handles simple, low-risk work, `medium-worker` handles non-trivial, non-architectural work, and `deep-worker` handles approved complex work.
- **Frontend Worker** owns user-facing visual, interaction, and responsive design and the frontend implementation that delivers it. Non-visual technical work in frontend code still goes to a general worker.

Sergeant selects the shortest reliable route rather than following a fixed pipeline. By default it may call `explorer`, `low-worker`, `medium-worker`, `frontend-worker`, and `oracle` directly; `deep-worker` requires approval through OpenCode's `ask` permission. Specialists cannot invoke other agents by default.

## Default agents

| Agent | Mode | Default model | Responsibility |
| --- | --- | --- | --- |
| `sergeant` | primary | `openai/gpt-5.6-sol` | User-facing coordinator and direct specialist router. `edit: allow`, `bash: allow`. |
| `oracle` | subagent | `code-mirror/gpt-5.6-sol` | Read-only technical advisor. |
| `explorer` | subagent | `opencode-go/deepseek-v4-flash` | Read-only codebase reconnaissance. |
| `low-worker` | subagent | `opencode-go/deepseek-v4-flash` | Simple, low-risk implementation. |
| `medium-worker` | subagent | `code-mirror/gpt-5.6-terra` | Non-architectural implementation and diagnosis. |
| `deep-worker` | subagent | `code-mirror/gpt-5.6-sol` | Explicitly approved complex implementation. |
| `frontend-worker` | subagent | `code-mirror/gpt-5.6-terra` | UI visual, interaction, and responsive design and implementation. |

The actual `model` and `variant` are chosen by `opencode-dokana.toml`; session-level `ctrl+t` can temporarily override them.

## Permissions

| Agent | Default permission summary |
| --- | --- |
| `sergeant` | `edit: allow`, `bash: allow`, `external_directory: ask`, repository tools allowed, `task.*: deny`, `task.explorer/low-worker/medium-worker/frontend-worker/oracle: allow`, `task.deep-worker: ask` |
| `oracle` | Read-only tools allowed; `edit`, `bash`, `task`, and `interrupt_session`: deny |
| `explorer` | Read-only tools and `bash`: allow; `task` and `interrupt_session`: deny |
| `low-worker`, `medium-worker`, `deep-worker`, `frontend-worker` | `edit`, `bash`, and `external_directory`: allow; `task` and `interrupt_session`: deny; only `customize-opencode` and `ponytail` skills allowed |

Workers execute source-file edits under the orchestration responsibility rules. Sergeant now holds the `edit` permission but should still delegate source changes to workers. This is not a hard read-only boundary for Sergeant or Explorer: both have `bash: allow`, so their prompts must not use Bash to mutate files. The default `ask` gate for Sergeant calling `deep-worker` is enforced by OpenCode's task permission, not merely by prompt text.

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

[agents.low-worker]
model="opencode-go/deepseek-v4-flash"
variant="high"

[agents.medium-worker]
model="code-mirror/gpt-5.6-terra"
variant="medium"

[agents.deep-worker]
model="code-mirror/gpt-5.6-sol"
variant="medium"

[agents.frontend-worker]
model="code-mirror/gpt-5.6-terra"
variant="medium"

[agents.sergeant.permission.task]
"*"="deny"
explorer="allow"
"low-worker"="allow"
"medium-worker"="allow"
"frontend-worker"="allow"
oracle="allow"
"deep-worker"="ask"
```

Priority is `ctrl+t` > TOML > agent frontmatter for `model` and `variant`; TOML prompt path > bundled `prompts/<id>.md` for prompts; and TOML > plugin defaults for permissions. A TOML permission object replaces agent-level permissions, while a `task` table merges by key with the plugin defaults. `skill` tables replace their default table completely.

`prompt` must name a `.md` file. Relative paths resolve from the TOML directory and `~/` is expanded. An unreadable or invalid prompt path falls back to the bundled prompt. Missing, invalid, or unparsable TOML falls back to bundled prompts and the default permission matrix; invalid `model`/`variant` pairs fall back to agent frontmatter.

Only the seven listed agent IDs are supported. Former `orchestrator` and `dispatcher` TOML entries are ignored with an unknown-agent warning; migrate their settings to `sergeant` and remove the old tables. Likewise, rename `low-fixer`, `medium-fixer`, and `deep-fixer` to `low-worker`, `medium-worker`, and `deep-worker` in TOML agent tables, task permission keys, and any separate OpenCode agent definitions. Remove obsolete agent stub files, keep `default_agent` set to `sergeant`, and preserve unrelated configuration. Restart OpenCode after updating the configuration.

## Validation

```bash
bun test
bunx tsc --noEmit
```

## License

MIT
