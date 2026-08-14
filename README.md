# OpenCode Dokana

OpenCode Dokana is an OpenCode plugin that applies TOML-driven `model`, `variant`, and `prompt` overrides to the seven supported agents.

## Mounting

Mount the plugin from `./plugins/opencode-dokana`, or install it as the npm package `@cortexkit/opencode-dokana`.

## Configuration

Create `opencode-dokana.toml` in the OpenCode configuration directory:

```toml
[agents.dispatcher]
model="deepseek/deepseek-v4-flash"
variant="max"
```

For `model` and `variant`, priority is session `ctrl+t` > TOML > frontmatter fallback. For `prompt`, priority is TOML path > built-in default.
