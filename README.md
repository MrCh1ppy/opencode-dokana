# OpenCode Dokana

OpenCode Dokana is an OpenCode plugin that applies TOML-driven `model`, `variant`, and `prompt` overrides to the seven supported agents.

> Requires OpenCode `>= 1.18.18`. This package is a TypeScript source distribution intended for the OpenCode Bun plugin loader, not a general-purpose Node.js package.

## Installation

Add the plugin to the `plugin` array in your `opencode.json`:

```json
{
  "plugin": ["@mrch1ppy/opencode-dokana"]
}
```

## Configuration

Create `opencode-dokana.toml` in the OpenCode configuration directory (`~/.config/opencode/opencode-dokana.toml`):

```toml
[agents.dispatcher]
model="deepseek/deepseek-v4-flash"
variant="max"
```

For `model` and `variant`, priority is session `ctrl+t` > TOML > frontmatter fallback. For `prompt`, priority is TOML path > built-in default.

Prompts referenced by a TOML `prompt` path must be `.md` files; they are resolved relative to the TOML directory and support `~/` expansion. When no TOML prompt is given, the bundled default at `prompts/<agent-id>.md` is used.
