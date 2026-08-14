import * as toml from "toml"

type ParseResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string }

export function parseToml(text: string): ParseResult {
  try {
    return { ok: true, value: toml.parse(text) as unknown }
  } catch (error: unknown) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
