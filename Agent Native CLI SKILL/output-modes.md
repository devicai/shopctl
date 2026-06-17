# Output modes

Every command that returns structured data supports three modes. The contract:

| Flag | Format | Audience | Stable? |
| --- | --- | --- | --- |
| *(none)* | Aligned columns with headers | Humans | No — adjust for readability |
| `--plain` | Tab-separated, no headers | Shell scripts | Yes — treat as a public API |
| `--json` | JSON | Programs, agents | Yes — treat as a public API |

`--plain` and `--json` are mutually exclusive. The parser should reject `--json --plain` at parse time, before any work happens.

## Declaring the flags

### Rust (clap)

```rust
#[derive(clap::Args)]
pub struct OutputArgs {
    /// Output as JSON
    #[arg(long, conflicts_with = "plain", global = true)]
    pub json: bool,

    /// Output as tab-separated values with no headers
    #[arg(long, conflicts_with = "json", global = true)]
    pub plain: bool,
}

pub enum OutputMode { Human, Plain, Json }

impl OutputArgs {
    pub fn mode(&self) -> OutputMode {
        match (self.json, self.plain) {
            (true, _) => OutputMode::Json,
            (_, true) => OutputMode::Plain,
            _ => OutputMode::Human,
        }
    }
}
```

### Go (cobra)

```go
cmd.PersistentFlags().Bool("json", false, "Output as JSON")
cmd.PersistentFlags().Bool("plain", false, "Output as tab-separated values")
cmd.MarkFlagsMutuallyExclusive("json", "plain")
```

### TypeScript (commander)

```ts
program
  .option("--json", "Output as JSON")
  .option("--plain", "Output as tab-separated values")
  .hook("preAction", (cmd) => {
    const opts = cmd.opts();
    if (opts.json && opts.plain) {
      throw new Error("--json and --plain are mutually exclusive");
    }
  });
```

## Implementing each mode

A small render helper keeps commands clean:

```rust
pub fn render<T: Serialize>(items: &[T], mode: OutputMode, columns: &[Column<T>]) {
    match mode {
        OutputMode::Json => render_json(items),
        OutputMode::Plain => render_plain(items, columns),
        OutputMode::Human => {
            if items.is_empty() {
                eprintln!("No results.");
                return;
            }
            render_human(items, columns);
        }
    }
}
```

### Human mode

Aligned columns with headers. Compute widths from the data. For commands that return many rows, consider an upper width cap per column with truncation indicators (`…`).

```
ID                                    NAME        STATUS    UPDATED
worker_a1b2c3d4                       api-prod    running   2 minutes ago
worker_e5f6g7h8                       worker-cron stopped   3 days ago
```

Notes:
- Timestamps in human mode should be relative ("2 minutes ago"), absolute in `--json` and `--plain`. Humans want relative, machines want absolute.
- Sort by a sensible default (creation time descending is usually right).
- For empty results, print a notice to **stderr**, not stdout. Stdout stays empty so callers that pipe through `wc -l` still see 0.

### Plain mode

Tab-separated, no header, no decorations. This is what scripts will `cut` and `awk` on, so treat the column order and content as a public API — don't reorder or rename casually.

```
worker_a1b2c3d4	api-prod	running	2024-01-15T10:23:04Z
worker_e5f6g7h8	worker-cron	stopped	2024-01-12T08:11:30Z
```

Notes:
- No header row. Scripts that want headers can pass `--json` and use `jq`.
- ISO 8601 timestamps, not relative.
- If a field can contain a tab character, escape it (`\t`) or replace it with a space. Scripts splitting on `\t` will break otherwise.
- Empty results produce empty output (zero lines), not an empty-state notice.

### JSON mode

Pretty-printed JSON for interactive use, but also valid for piping into `jq`. Use a stable schema — once a field is in `--json` output, treat it as a public API.

```json
[
  {
    "id": "worker_a1b2c3d4",
    "name": "api-prod",
    "status": "running",
    "updated_at": "2024-01-15T10:23:04Z"
  },
  {
    "id": "worker_e5f6g7h8",
    "name": "worker-cron",
    "status": "stopped",
    "updated_at": "2024-01-12T08:11:30Z"
  }
]
```

Notes:
- Single-item `get` commands return an object, not an array of one. Don't wrap unnecessarily.
- Use `snake_case` or `camelCase` consistently — match whatever the underlying API uses.
- ISO 8601 timestamps with timezone.
- Empty results return `[]` (or `null` for single-item commands), not nothing. Scripts should be able to assume the output parses.
- Don't emit progress, status messages, or warnings inside the JSON. Those go to stderr.

## Streaming vs buffered JSON

For commands that return small bounded results, pretty-printed JSON is fine. For commands that return many items or stream over time, consider **NDJSON** (one JSON object per line) instead. Add a separate flag — `--ndjson` — so callers can opt in:

```
worker_a1b2c3d4 {"id":"worker_a1b2c3d4","name":"api-prod",...}
worker_e5f6g7h8 {"id":"worker_e5f6g7h8","name":"worker-cron",...}
```

NDJSON is better for streaming because consumers can process each line as it arrives without waiting for the full result. It's also what `jq` expects with `-c`.

## Numbers, booleans, and nulls

In `--plain` output, decide on representations and stick with them:
- Booleans: `true` / `false` (not `yes`/`no`, not `1`/`0`)
- Nulls: empty string (preserves column alignment for `cut`)
- Numbers: no thousands separators, ISO 8601 for times, no scientific notation

In `--json` output, use native types — don't stringify numbers or booleans.

## Per-command output customization

Some commands have natural extensions to the three-mode pattern:

- **`--columns`** to let users pick which columns to include in human/plain mode.
- **`-o jsonpath=...`** (kubectl-style) for extracting specific fields from JSON without `jq`. Worth adding if your users won't always have `jq` available.
- **`--template`** for arbitrary Go-template or Handlebars rendering.

Don't add these from the start — they're easy to retrofit and most users won't need them.
