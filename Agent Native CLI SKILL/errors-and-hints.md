# Errors and hints

The goal: every predictable failure mode produces a message a user (or agent) can act on without reading docs. Take the model from `rustc` — a clear statement of what's wrong, followed by a concrete next step.

## The basic shape

```
error: <one-line statement of what went wrong>
  hint: <one-line statement of what to do about it>
```

In `--verbose` mode, append the source chain:

```
error: Failed to fetch tokens.
  hint: Check your network connection and try again.
  caused by: reqwest::Error { ... }
  caused by: hyper::Error(Connect, ConnectError(...))
```

The default output is intentionally short so it fits in one glance. The chain is for when the user needs to dig in.

## Modelling errors

Use a typed error enum so each variant can carry its own hint and exit code. The pattern is the same across languages — only the syntax changes.

### Rust (with `thiserror`)

```rust
#[derive(Debug, thiserror::Error)]
pub enum CliError {
    #[error("No auth token found for the current workspace.")]
    NoAuthToken { hint: Option<String> },

    #[error("Workspace `{name}` not found.")]
    WorkspaceNotFound { name: String, hint: Option<String> },

    #[error("API request failed: {source}")]
    Api {
        #[source]
        source: reqwest::Error,
        hint: Option<String>,
    },
}

impl CliError {
    pub fn exit_code(&self) -> i32 {
        match self {
            CliError::NoAuthToken { .. } => 4,
            CliError::WorkspaceNotFound { .. } => 1,
            CliError::Api { .. } => 5,
        }
    }

    pub fn hint(&self) -> Option<&str> {
        match self {
            CliError::NoAuthToken { hint } => hint.as_deref(),
            CliError::WorkspaceNotFound { hint, .. } => hint.as_deref(),
            CliError::Api { hint, .. } => hint.as_deref(),
        }
    }
}
```

### Go

```go
type CLIError struct {
    Msg      string
    Hint     string
    ExitCode int
    Cause    error
}

func (e *CLIError) Error() string { return e.Msg }
func (e *CLIError) Unwrap() error { return e.Cause }

func NoAuthToken() *CLIError {
    return &CLIError{
        Msg:      "No auth token found for the current workspace.",
        Hint:     "Run `mytool login` first, or set MYTOOL_API_TOKEN.",
        ExitCode: 4,
    }
}
```

### TypeScript

```ts
class CLIError extends Error {
  constructor(
    message: string,
    public hint?: string,
    public exitCode: number = 1,
    public cause?: unknown,
  ) {
    super(message);
  }
}
```

## Printing them

A single function in the CLI's main loop is responsible for turning errors into output. Everything else throws.

```rust
fn print_error(err: &CliError, verbose: bool) {
    eprintln!("error: {err}");
    if let Some(hint) = err.hint() {
        eprintln!("  hint: {hint}");
    }
    if verbose {
        let mut source = std::error::Error::source(err);
        while let Some(e) = source {
            eprintln!("  caused by: {e}");
            source = e.source();
        }
    }
}
```

Note: errors and hints go to **stderr**, never stdout. Stdout is reserved for data.

## What makes a good hint

A hint is useless unless it's specific. "Try again" is not a hint. "Set MYTOOL_API_TOKEN" is a hint.

Tests for a good hint:
- Does it name the exact env var, flag, or command the user should reach for?
- Could a script branch on it (look at the exit code) and recover automatically?
- Is it shorter than the error message? It usually should be.

### Examples

```
# Bad: vague
error: Authentication failed.
  hint: Please check your credentials.

# Good: actionable
error: API returned 401 for token tok-abc.
  hint: The token has expired. Run `mytool login` to refresh it.
```

```
# Bad: blames the user
error: Invalid input.
  hint: Read the docs.

# Good: pinpoints the bad field
error: Field `region` got value `eu-west-99`, expected one of: eu-west-1, eu-west-2, us-east-1.
  hint: Pass `--region eu-west-1` or set MYTOOL_REGION.
```

```
# Bad: leaks an internal type
error: serde_json::Error { line: 3, column: 12, kind: TrailingComma }
  hint: Fix it.

# Good: translates to the user's frame
error: Could not parse config file `~/.config/mytool/config.json`: trailing comma at line 3, column 12.
  hint: Remove the trailing comma, or run `mytool config reset` to regenerate.
```

## "Did you mean?" suggestions

When the user supplies an invalid value from a known set (a workspace name, a profile, a subcommand), offer the nearest match. Use Levenshtein distance with a small threshold (2–3 edits) — anything looser produces noise.

```
error: No workspace named `productn` found.
  hint: Did you mean `production`? Run `mytool workspaces list` to see all options.
```

For flag parsers that don't do this out of the box, wrap the parsed value in a custom validator:

```rust
fn validate_workspace(input: &str, known: &[String]) -> Result<String, CliError> {
    if known.iter().any(|w| w == input) {
        return Ok(input.to_string());
    }
    let suggestion = known.iter()
        .min_by_key(|w| levenshtein(w, input))
        .filter(|w| levenshtein(w, input) <= 2);
    Err(CliError::WorkspaceNotFound {
        name: input.to_string(),
        hint: suggestion.map(|s| format!("Did you mean `{s}`?")),
    })
}
```

## Error codes

Some CLIs (notably `cargo`, `tsc`, `rustc`) attach short codes to each error so users can google them and so docs can be indexed. This is worth doing if:

- The CLI has more than ~20 distinct error variants
- Errors involve domain concepts users may not understand on first read
- You have a place to host the corresponding docs

If you adopt codes, namespace them by category (`E0001`–`E0099` for auth, `E0100`–`E0199` for validation, etc.) and put the code in the first line of the error message:

```
error[E0042]: Workspace `productn` not found.
  hint: Did you mean `production`?
```

## Exit codes recap

Use these conventionally. Scripts and agents will branch on them.

| Code | Meaning | Example |
| --- | --- | --- |
| 0 | Success | Command completed |
| 1 | Internal / config error | Malformed config file, panic |
| 2 | Usage error | Unknown flag, missing required argument |
| 4 | Auth failure | Token expired, no credentials |
| 5 | API / network error | HTTP 5xx, connection refused, DNS failure |

Some CLIs reserve additional codes (124 for timeout, 130 for SIGINT). If your CLI has long-running operations, follow those conventions too.
