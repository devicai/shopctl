# Worked examples

Full vertical slices for common command shapes. Examples are in Rust with clap for concreteness; the same shapes translate directly to cobra (Go), commander (Node), and click (Python).

The intent is to show the whole shape: parsing → business call → output formatting → error mapping → non-TTY behaviour. Don't lift these verbatim — adapt them to your domain. The point is the structure, not the specifics.

## 1. `list` with all three output modes

```rust
#[derive(clap::Args)]
pub struct ListArgs {
    #[command(flatten)]
    pub output: OutputArgs,

    /// Filter by status
    #[arg(long)]
    pub status: Option<WorkerStatus>,

    /// Maximum number of results
    #[arg(long, default_value = "50")]
    pub limit: usize,
}

pub async fn run(args: ListArgs, ctx: &Ctx) -> Result<(), CliError> {
    let workers = ctx.api.workers().list(args.status, args.limit).await?;

    match args.output.mode() {
        OutputMode::Json => {
            println!("{}", serde_json::to_string_pretty(&workers)?);
        }
        OutputMode::Plain => {
            for w in &workers {
                println!("{}\t{}\t{}\t{}", w.id, w.name, w.status, w.updated_at);
            }
        }
        OutputMode::Human => {
            if workers.is_empty() {
                eprintln!("No workers found.");
                return Ok(());
            }
            print_table(&workers, &[
                column("ID", |w: &Worker| w.id.clone()),
                column("NAME", |w| w.name.clone()),
                column("STATUS", |w| w.status.to_string()),
                column("UPDATED", |w| humantime(w.updated_at)),
            ]);
        }
    }
    Ok(())
}
```

Key points:
- The three modes are dispatched on one enum, not three different command implementations.
- Empty results in human mode print to **stderr**, return success. The exit code communicates "command worked, nothing to show" — not failure.
- In plain mode, the loop prints raw tab-separated rows with no header. Scripts can `cut -f1` directly.
- In JSON mode, the entire result is one pretty-printed array. Adding `--ndjson` for streaming is a small extension if needed.
- `humantime` is only used in human mode — JSON and plain emit ISO 8601.

## 2. `get` for a single resource

```rust
pub async fn run(id: String, args: OutputArgs, ctx: &Ctx) -> Result<(), CliError> {
    let worker = ctx.api.workers().get(&id).await
        .map_err(|e| match e.status() {
            Some(404) => CliError::WorkerNotFound {
                id: id.clone(),
                hint: Some("Run `mytool workers list` to see available workers.".into()),
            },
            _ => CliError::from(e),
        })?;

    match args.mode() {
        OutputMode::Json => println!("{}", serde_json::to_string_pretty(&worker)?),
        OutputMode::Plain => println!("{}\t{}\t{}", worker.id, worker.name, worker.status),
        OutputMode::Human => print_worker_detail(&worker),
    }
    Ok(())
}
```

Key points:
- A single-item `get` returns an object in JSON, not an array of one.
- 404 is translated to a domain-specific error with a hint that points at the discovery command.
- Human mode might use a key:value detail layout rather than a single row — that's a UX choice for the command, not a rule.

## 3. `create` from inline flags or stdin

```rust
#[derive(clap::Args)]
pub struct CreateArgs {
    /// Worker name
    #[arg(long, required_unless_present = "from_file")]
    pub name: Option<String>,

    /// Read full worker spec from a file (use `-` for stdin)
    #[arg(long, conflicts_with = "name")]
    pub from_file: Option<String>,

    #[command(flatten)]
    pub output: OutputArgs,
}

pub async fn run(args: CreateArgs, ctx: &Ctx) -> Result<(), CliError> {
    let spec: WorkerSpec = if let Some(path) = args.from_file {
        let content = if path == "-" {
            let mut buf = String::new();
            std::io::stdin().read_to_string(&mut buf)?;
            buf
        } else {
            std::fs::read_to_string(&path)?
        };
        serde_json::from_str(&content)?
    } else {
        WorkerSpec {
            name: args.name.unwrap(),
            ..Default::default()
        }
    };

    // Validate using the same schema the app uses
    spec.validate().map_err(|e| CliError::Validation {
        field: e.field,
        message: e.message,
        hint: Some(format!("See `mytool workers create --help` for valid values.")),
    })?;

    let worker = ctx.api.workers().create(spec).await?;
    eprintln!("✔ Created worker {}", worker.id);

    match args.output.mode() {
        OutputMode::Json => println!("{}", serde_json::to_string_pretty(&worker)?),
        OutputMode::Plain => println!("{}", worker.id),
        OutputMode::Human => {} // already printed confirmation to stderr
    }
    Ok(())
}
```

Key points:
- Two input styles: high-level flags for the common case, full-spec file (or stdin via `-`) for the power case. Mutually exclusive at parse time.
- Validation runs **before** the API call, using the same schema the app does. Fast feedback, no wasted round-trips.
- The success confirmation goes to stderr. In `--plain` mode, stdout is just the new resource ID — perfect for `ID=$(mytool workers create --name foo --plain)`.
- In JSON mode, the full created resource is on stdout; the confirmation stays on stderr.

## 4. `delete` with confirmation

```rust
#[derive(clap::Args)]
pub struct DeleteArgs {
    pub id: String,

    /// Skip the confirmation prompt
    #[arg(long, short = 'y')]
    pub yes: bool,
}

pub async fn run(args: DeleteArgs, ctx: &Ctx) -> Result<(), CliError> {
    let worker = ctx.api.workers().get(&args.id).await?;

    if !args.yes {
        if !std::io::stdin().is_terminal() || !std::io::stderr().is_terminal() {
            return Err(CliError::ConfirmationRequired {
                hint: Some("Pass `--yes` to skip the prompt in non-interactive environments.".into()),
            });
        }

        let confirmed = dialoguer::Confirm::with_theme(&dialoguer::theme::ColorfulTheme::default())
            .with_prompt(format!("Delete worker `{}` ({})?", worker.id, worker.name))
            .default(false)
            .interact()?;

        if !confirmed {
            eprintln!("Aborted.");
            return Ok(());
        }
    }

    ctx.api.workers().delete(&args.id).await?;
    eprintln!("✔ Deleted worker {}", worker.id);
    Ok(())
}
```

Key points:
- Confirmation defaults to `false` — pressing Enter doesn't destroy anything.
- Non-TTY without `--yes` is an **error**, not a silent prompt-skip. The user/agent should know exactly why nothing happened.
- We fetch the worker first to confirm it exists and show its name in the prompt. The error case (404) gets the standard "did you mean?" treatment.
- Both confirmation and success messages go to stderr.

## 5. Paginated `list`

```rust
#[derive(clap::Args)]
pub struct ListArgs {
    #[command(flatten)]
    pub output: OutputArgs,

    /// Maximum number of results (default: all)
    #[arg(long)]
    pub limit: Option<usize>,

    /// Pagination cursor (for resuming a previous list)
    #[arg(long)]
    pub cursor: Option<String>,
}

pub async fn run(args: ListArgs, ctx: &Ctx) -> Result<(), CliError> {
    let mut cursor = args.cursor;
    let mut all = Vec::new();
    let cap = args.limit.unwrap_or(usize::MAX);

    while all.len() < cap {
        let page = ctx.api.workers().list_page(cursor.as_deref(), 100).await?;
        all.extend(page.items);
        match page.next_cursor {
            Some(c) if all.len() < cap => cursor = Some(c),
            _ => break,
        }
    }

    all.truncate(cap);
    render(&all, args.output.mode());
    Ok(())
}
```

Key points:
- Default: fetch everything. Users don't have to know pagination exists.
- `--limit` caps the result count; `--cursor` lets advanced users resume.
- The page size (100) is an implementation detail — never exposed as a flag.
- For very large result sets, switch to streaming output (`--ndjson`) and emit each item as it arrives rather than buffering.

## 6. `api` passthrough command

A useful escape hatch: let users call any API endpoint directly. Inspiration: `gh api` and `httpie`.

```rust
#[derive(clap::Args)]
pub struct ApiArgs {
    /// Path to call (e.g. `/v1/workers/abc`)
    #[arg(value_name = "PATH", add = ArgValueCompleter::new(complete_api_path))]
    pub path: String,

    /// HTTP method
    #[arg(short = 'X', long, default_value = "GET",
          add = ArgValueCompleter::new(complete_method))]
    pub method: String,

    /// Header in `Name:Value` format (repeatable)
    #[arg(short = 'H', long)]
    pub header: Vec<String>,

    /// Field in `name=value` (string) or `name:=value` (JSON) format
    #[arg(value_name = "FIELDS")]
    pub fields: Vec<String>,
}

pub async fn run(args: ApiArgs, ctx: &Ctx) -> Result<(), CliError> {
    let body = build_body(&args.fields)?;
    let headers = parse_headers(&args.header)?;
    let resp = ctx.api.raw_request(&args.method, &args.path, headers, body).await?;
    println!("{}", serde_json::to_string_pretty(&resp.body)?);
    Ok(())
}
```

Key points:
- Path and method get dynamic completions from the OpenAPI spec.
- Inline input syntax (`field=value`, `field:=jsonvalue`, `Header:Value`) borrowed from httpie — it's compact and readable.
- This command is the safety valve for everything the CLI doesn't yet wrap. Always include it.

## 7. A `login` command that degrades gracefully

```rust
pub async fn run(ctx: &Ctx) -> Result<(), CliError> {
    if !std::io::stdin().is_terminal() || !std::io::stderr().is_terminal() {
        return Err(CliError::auth_with_hint(
            "Cannot open browser for login in a non-interactive environment.",
            "Set MYTOOL_API_TOKEN and MYTOOL_WORKSPACE_ID for non-interactive auth.",
        ));
    }

    let device_code = ctx.api.device_code().await?;
    eprintln!("Open this URL to authorize:\n  {}", device_code.verification_url);
    eprintln!("Code: {}", device_code.user_code);

    let token = ctx.api.poll_device_token(&device_code.device_code).await?;
    ctx.config.save_token(&token)?;
    eprintln!("✔ Logged in as {}", token.user.email);
    Ok(())
}
```

Key points:
- Fails fast and clear in non-TTY environments. No spinner waiting for a user that isn't there.
- All messaging on stderr. There's no data to put on stdout.
- The URL and code are printed plainly so the user can copy them — no QR code rendering that breaks under `NO_COLOR` or in dumb terminals.
- If the API supports both OAuth and token-based auth, the env vars are the non-interactive path. Don't add a `--token` flag — passing secrets on the command line leaks them into shell history.

## 8. A "config" command family for inspecting effective config

Users (and agents) need a way to see what the CLI is actually using:

```
mytool config get             # print all resolved config as JSON
mytool config get api-url     # print one value
mytool config set api-url ... # write to user config file
mytool config unset api-url
mytool config path            # print path to user config file
```

Key points:
- `get` with no argument dumps everything (resolved per the precedence chain). With one argument, prints just that value.
- `set` writes only to the user config file — never silently modifies env vars or local project files.
- `path` is useful for `vim $(mytool config path)`.
- `unset` is aliased to `rm`.

This becomes essential during debugging — "why is the CLI hitting staging?" answered by `mytool config get api-url` showing the resolved value and where it came from.
