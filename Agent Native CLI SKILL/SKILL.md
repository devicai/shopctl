---
name: agent-native-cli
description: Design and implement command-line interfaces that are first-class citizens for both humans in terminals and programs invoking them as subprocesses (shell scripts, CI pipelines, AI agents). Use this skill whenever the user asks to create, scaffold, refactor, or extend a CLI, command-line tool, or developer tooling binary — including subcommands, flags, output formatting, shell completions, error handling, or auth flows. Also trigger when wrapping an existing API or SaaS product in a CLI, when designing a CLI on top of an internal codebase, or any time the deliverable is a command-line entry point that other humans or agents will invoke. Apply even if the user only says "make a CLI for X" without further detail — this skill defines what "good" looks like.
---

# Agent-Native CLI Design

A CLI built well for humans is built well for agents, and vice versa. Both audiences benefit from the same things: predictable command structure, structured output, non-interactive fallbacks, meaningful exit codes, and progressive disclosure of complexity. Design for both from the start.

This skill encodes the design principles for building such CLIs and gives you a workflow for grounding the implementation in whatever source material you have access to: API documentation, the source code of the application behind the CLI, OpenAPI specs, or existing internal SDKs.

## When to use this skill

Use it whenever the deliverable is a command-line tool — whether you're creating one from scratch, refactoring an existing one, or adding new commands to one that already exists. The principles apply regardless of implementation language (Rust, Go, Node, Python, etc.), though some details below assume a typed language with a flag parser like clap, cobra, commander, or click.

## Workflow

Follow these steps in order. Do not skip the grounding step — most of the value of this skill comes from inheriting validation, workflows, and business logic from the existing system rather than re-inventing them in the CLI.

### Step 1: Ground in the source material

Before writing any commands, gather context from whatever the user has provided or pointed you at:

1. **API documentation** (OpenAPI/Swagger spec, REST docs, GraphQL schema). Extract the resource names — these become your **nouns**. Extract the operations — these become your **verbs**. Extract enums, validation rules, required vs optional fields — these become flag types, value parsers, and validation.

2. **Source code of the application behind the CLI**. This is where the business logic lives. Look for:
   - Validation functions and schemas (Zod, Pydantic, Joi, ajv, custom validators). Reuse them or mirror their constraints in the CLI's argument parsing so the CLI fails fast with the same errors the API would return.
   - Common workflows that span multiple endpoints (e.g. "create resource, poll until ready, fetch result"). These deserve to become single CLI commands rather than forcing the user to chain three API calls.
   - Domain constants (status enums, role names, plan tiers). Generate `ValueEnum`-style types from them where the language supports it.
   - Auth flows. Mirror the same token shapes, scopes, and refresh logic the rest of the system uses.

3. **Existing SDKs or internal client libraries**. If there's already a typed client, the CLI should usually be a thin shell over it rather than reimplementing HTTP calls. The SDK already encodes retries, pagination, and error mapping.

If any of this material is missing, ask the user where to find it before proceeding. Do not invent endpoint names, validation rules, or enums.

### Step 2: Sketch the command tree

Lay out the full `<noun> <verb>` tree before writing code. A short markdown table or tree is enough:

```
mytool
├── workers
│   ├── list (ls)
│   ├── get <id>
│   ├── deploy
│   └── delete (rm) <id>
├── files
│   ├── list (ls)
│   ├── create
│   └── get <id>
└── auth
    ├── login
    └── logout
```

Confirm the tree with the user before implementing it. Cheap to revise on paper, expensive once code exists.

### Step 3: Implement command by command

For each command, follow the design rules below. Implement one full vertical slice (parsing, business call, output formatting, error mapping, completions) before moving to the next command — this surfaces missing infrastructure early.

### Step 4: Add cross-cutting concerns last

Shell completions, `--verbose` error chains, `NO_COLOR` handling, and config file loading are easier to retrofit once the command shape is stable. Do them after the commands work.

---

## Core design rules

These are non-negotiable. They are what make the CLI usable by both humans and agents.

### Noun-verb command structure

Commands follow `<noun> <verb>`: resource first, action second. Use plural nouns unless it reads poorly.

```
# Good
mytool workers list
mytool workers delete <id> --yes
mytool files get <id>

# Bad
mytool list-workers
mytool create-worker my-worker
mytool worker list          # singular — prefer plural
```

Provide short UNIX-style aliases drawn from coreutils — `ls`, `rm`, `cp`, `mv`, `cat` — rather than inventing new shorthands. A user who knows UNIX should be able to guess them. Make aliases visible in `--help` so they're discoverable.

| Canonical | Alias |
| --- | --- |
| `list` | `ls` |
| `delete` / `remove` | `rm` |
| `copy` | `cp` |
| `move` / `rename` | `mv` |
| `show` / `view` | `cat` |

### Be utilitarian, not cute

No emoji, no jokes, no anthropomorphizing. The CLI is a tool. Messages are terse, factual, and end with a concrete next step.

```
# Good
error: No workspace selected.
  hint: Run `mytool login` first, or set MYTOOL_WORKSPACE_ID.

# Bad
Oops! 😅 Looks like you forgot to log in! Try `mytool login` to get started!
```

### Always handle non-TTY

Every interactive feature must check for a terminal and degrade gracefully when one isn't available. This is the single most important rule for agent-friendliness — an agent invoking the CLI as a subprocess will never see a prompt and will hang or fail silently if the CLI tries to prompt anyway.

For every interactive prompt, provide a non-interactive equivalent:

| Interactive | Non-interactive equivalent |
| --- | --- |
| Browser-based login | `MYTOOL_API_TOKEN` env var |
| Workspace / org picker | `MYTOOL_WORKSPACE_ID` env var or `--workspace` flag |
| Confirmation prompt | `--yes` / `-y` flag |
| Multi-select menu | Repeated `--item` flags or a `--from-file` input |

Check both stdin and stderr (not stdout — stdout carries data and may be redirected to a file even when the terminal is interactive):

```rust
if !std::io::stdin().is_terminal() || !std::io::stderr().is_terminal() {
    return Err(CliError::auth_with_hint(
        "Cannot open browser for login in a non-interactive environment.",
        "Set MYTOOL_API_TOKEN and MYTOOL_WORKSPACE_ID for non-interactive auth.",
    ));
}
```

### Separate data from messaging

**All structured data goes to stdout. Everything else goes to stderr.** This is what makes `mytool workers list --json | jq '.[].id'` work without filtering out status lines.

Send to stderr: success confirmations, progress bars, spinners, prompts, errors, hints, warnings, empty-state notices, and informational logs. Suppress spinners entirely when stderr is not a TTY.

### Human, plain, and JSON output

Every command that returns structured data should support three modes. Default to human.

| Flag | Format | Audience |
| --- | --- | --- |
| *(none)* | Aligned columns with headers | Humans in terminal |
| `--plain` | Tab-separated, no headers | Shell scripts (`cut`, `awk`) |
| `--json` | JSON | Programs, agents, `jq` |

Declare `--json` and `--plain` as mutually exclusive at parse time so the parser produces a clear error rather than silently picking one.

For the human format, compute column widths dynamically from the data. For empty results, print an empty-state notice to stderr and produce no output on stdout — except in `--plain` mode, where the output should simply be empty so callers can rely on line count.

### Progressive disclosure

Don't overwhelm the user — make depth discoverable. This is doubly important for agents, where every token of unused help text costs context.

- **`-h`** shows short help: the argument list and one-line descriptions only.
- **`--help`** shows long help: appends environment variable tables, examples, and usage notes.
- **Hidden commands** (`debug`, `nuke`, internal-only): hide from `--help` but keep them functional. Document them in a separate `HIDDEN.md`.
- **Verbose errors are opt-in.** Default error output is `error:` + `hint:`. Pass `--verbose` to see the full source chain (`caused by:` lines).

### Configuration precedence

Resolve config in this order, with each layer falling through to the next if unset (treat empty strings as unset):

1. **Command-line flag** (`--env prod`)
2. **Environment variable** (`MYTOOL_ENV=prod`)
3. **Local project file** (`./mytool.json`)
4. **User config file** (`~/.config/mytool/config.json`)
5. **Built-in default**

This order is conventional — users coming from `git`, `kubectl`, `gh`, `aws`, and similar tools will expect it. Deviating from it is a usability bug.

### Errors are structured and actionable

Take inspiration from rustc: every error should pair a clear message with a concrete next step. You can't annotate source spans like the compiler can, but you can always provide a hint.

Model errors with a typed enum (Rust: `thiserror`; Go: typed errors with `errors.Is`; TS: discriminated unions). Attach an optional `hint` to variants where a concrete fix can be suggested.

```
error: No auth token found for the current workspace.
  hint: Run `mytool login` first, or set MYTOOL_API_TOKEN.
```

Use meaningful exit codes so scripts and agents can branch on failure mode:

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Internal / config |
| 2 | Usage error (parser-level) |
| 4 | Auth failure |
| 5 | API / network error |

For richer error patterns (typo suggestions, "did you mean?", error code references), see `references/errors-and-hints.md`.

### Confirmations default to no

Destructive operations (`delete`, `revoke`, `purge`, `reset`) require confirmation. Default the prompt to `false` so pressing Enter without reading doesn't destroy data. Provide `--yes` / `-y` to skip the prompt for non-interactive use.

Idempotent operations (`apply`, `upsert`, `ensure`) generally don't need confirmation — they're safe to re-run.

### Shell completions

Cover everything you can, including values not known at build time. Use **dynamic** (runtime) completions over static ones so the binary resolves candidates at completion time from live or cached data.

Examples of what to complete dynamically:
- Resource IDs (worker IDs, file IDs) — fetched from the API or a local cache
- File paths
- HTTP methods and API endpoint paths (from an OpenAPI spec, cached locally)
- Profile / workspace names from the config file

Two rules for completers:
1. **Fast.** They run in the shell's critical path. Cache aggressively; set a tight network timeout (~2s) so a slow connection doesn't hang the shell.
2. **Side-effect-free.** Never mutate state, never prompt, never log. A completer that writes to a file is a bug.

See `references/completions.md` for implementation patterns.

### Respect NO_COLOR and TTY detection

Use a styling library that respects `NO_COLOR` and TTY detection automatically (`anstream`/`anstyle` in Rust, `lipgloss` in Go, `chalk` with `supportsColor` in Node). Never hard-code ANSI escape sequences in runtime output. Help text constants printed by your flag parser are usually fine — they're rendered by the parser's own TTY-aware printer.

---

## Inheriting from source material

This is where the CLI becomes more than a generic wrapper. Pull as much logic as possible from the existing system rather than restating it in the CLI.

### From an OpenAPI spec or API docs

- **Resources → nouns.** Each top-level resource becomes a noun. Map endpoint groupings to noun groupings.
- **Operations → verbs.** GET-list → `list`, GET-one → `get`, POST → `create`, PATCH/PUT → `update`, DELETE → `delete`.
- **Enums → typed flag values.** Generate enum types so the parser rejects invalid values with a "did you mean?" before any HTTP call.
- **Required fields → required flags.** Optional fields → optional flags with the same defaults as the API.
- **Validation rules (min/max, regex, format) → input validation.** Fail fast at the CLI layer with a clear message rather than forwarding garbage to the API.
- **Endpoint descriptions → command descriptions.** The one-liner in the OpenAPI `summary` field is usually a good short description; the `description` field is usually good long help.

### From the application source code

Open the source and look specifically for:

1. **Validation modules.** Zod schemas, Pydantic models, custom validators. Either import them directly (if the CLI shares a language with the app) or mirror them. The CLI failing with the same validation message as the API is a feature.

2. **Service-layer functions that compose multiple steps.** If the app has a `deployWorker()` function that uploads the bundle, creates the deployment, polls until ready, and returns the URL — that's a single CLI command (`mytool workers deploy`), not three.

3. **Domain enums.** Status values, plan tiers, region codes. Generate flag value enums from them so the CLI stays in sync when the app changes.

4. **Auth and credential storage.** Use the same token format, the same refresh logic, the same keychain integration. If the app supports OAuth + service accounts, the CLI should too — with `login` covering the OAuth flow and a token env var covering the service-account case.

5. **Pagination patterns.** If the API uses cursor-based pagination, the CLI's `list` commands should handle paging transparently by default and expose `--limit` / `--cursor` for power use.

6. **Error taxonomies.** If the app distinguishes "not found" from "permission denied" from "rate limited", the CLI's exit codes and error messages should preserve that distinction.

### When the CLI and the app share a language

Prefer importing over re-implementing. A CLI that lives in the same monorepo as the app and shares its validation schemas, types, and service functions will drift far less than one that re-implements them.

### When they don't share a language

Generate. From an OpenAPI spec: generate a typed client and use it. From a Protobuf/gRPC schema: generate stubs. Manual translation is a maintenance burden and a source of subtle bugs.

---

## Output format details

For implementation patterns for the three output modes (column alignment, JSON streaming, plain TSV), see `references/output-modes.md`.

## Worked examples

For full worked examples of common command shapes — `list` with all three output modes, `create` from stdin, `delete` with confirmation, paginated `list`, an `api` passthrough command — see `references/examples.md`.

---

## Anti-patterns to avoid

A short list of things that look reasonable but break agent use:

- **Interactive prompts with no flag equivalent.** Every prompt needs a flag.
- **Color codes hard-coded in data output.** Breaks piping and `NO_COLOR`.
- **Sending data to stderr or status to stdout.** Breaks `| jq`.
- **Verb-first command names** (`create-worker` instead of `workers create`). Doesn't scale, harder to discover.
- **Single output format.** If only `--json` exists, humans suffer; if only human format exists, agents do.
- **Silent failure on missing config.** Always surface what's missing and how to set it.
- **Confirmation prompts defaulting to yes.** Pressing Enter should be safe.
- **Errors without hints.** Every error you can predict, you can hint.
- **Reimplementing validation that already exists in the app.** Drift is inevitable.
- **`--debug` as the only way to see what went wrong.** Use `--verbose` for the source chain; reserve `--debug` for log-level control if you need it.

## Inspirations

Worth studying directly when designing a new CLI:

- **`gh` (GitHub):** noun-verb at scale, `--json` + `--jq`, non-TTY-aware auth.
- **`kubectl`:** `<resource> <verb>` for dozens of types, consistent `-o` output flags.
- **`cargo` / `rustc`:** the gold standard for error messages with hints and source spans.
- **`gh auth token`:** dedicated command for emitting credentials for other tools to consume.
- **`jq`:** a reminder that good CLI tools compose. Your `--json` output exists so other tools can be `jq`-shaped.
- **`ripgrep`:** good defaults are a feature. Users shouldn't need flags to get a good experience.
- **`httpie`:** treats humans and machines as equal citizens; inline input syntax (`field=value`, `field:=json`, `Header:Value`) for low-friction request construction.
