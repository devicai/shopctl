# Shell completions

The goal: a user pressing `<TAB>` after `mytool workers delete ` sees a list of real worker IDs from their account, not nothing. This is one of the highest-leverage features for terminal usability and one of the most commonly skipped.

## Static vs dynamic

**Static completions** are generated ahead of time from the command tree itself — subcommand names, enum values, flag names. Every flag parser (clap, cobra, oclif, etc.) supports these out of the box. Set them up first; they're free.

**Dynamic completions** resolve values at completion time by running code in the binary. Use these for anything not knowable at build time: resource IDs, file paths the CLI cares about specifically, API endpoint paths from an OpenAPI spec, profile names from a config file.

## Generating static completions

### Rust (clap)

```rust
use clap::CommandFactory;
use clap_complete::{generate, Shell};

// In a hidden subcommand:
fn print_completions(shell: Shell) {
    let mut cmd = Cli::command();
    generate(shell, &mut cmd, "mytool", &mut std::io::stdout());
}
```

Users source the output: `mytool completions bash > /etc/bash_completion.d/mytool`.

### Go (cobra)

Cobra has built-in `__complete` and a `completion` subcommand. Just add:

```go
rootCmd.AddCommand(completionCmd)
```

### Node (oclif/commander)

Use `omelette` or write a small bash script that delegates to the binary with a hidden `--get-yargs-completions` flag.

## Dynamic completions

The pattern is the same regardless of framework: register a function that, given a current input prefix, returns candidates. The function runs every time the user presses TAB.

### Rust (clap with `clap_complete::ArgValueCompleter`)

```rust
use clap_complete::engine::{ArgValueCompleter, CompletionCandidate};

#[derive(clap::Parser)]
struct DeleteArgs {
    #[arg(value_name = "WORKER_ID", add = ArgValueCompleter::new(complete_worker_id))]
    id: String,
}

fn complete_worker_id(current: &std::ffi::OsStr) -> Vec<CompletionCandidate> {
    let prefix = current.to_string_lossy();
    load_cached_workers()
        .into_iter()
        .filter(|w| w.id.starts_with(prefix.as_ref()))
        .map(|w| CompletionCandidate::new(w.id).help(Some(w.name.into())))
        .collect()
}
```

The `help` field shows a brief description next to each candidate in zsh / fish — surface useful context like "running, 3 instances" or the resource's display name.

### Go (cobra)

```go
cmd.ValidArgsFunction = func(cmd *cobra.Command, args []string, toComplete string) ([]string, cobra.ShellCompDirective) {
    workers := loadCachedWorkers()
    var out []string
    for _, w := range workers {
        if strings.HasPrefix(w.ID, toComplete) {
            out = append(out, fmt.Sprintf("%s\t%s", w.ID, w.Name))
        }
    }
    return out, cobra.ShellCompDirectiveNoFileComp
}
```

## Two non-negotiable constraints

### 1. Fast

Completers run in the shell's critical path. The user is holding TAB and waiting. Hard rules:

- **Cache.** Keep a local cache of resource lists in the CLI's config directory. Refresh it lazily (when the user runs `list`, when the cache is older than N minutes, etc.) rather than at completion time.
- **Tight network timeout.** If you must hit the network, cap it at ~2s. A shell that hangs for 10s on TAB is unusable.
- **Cheap parsing.** Don't load 50MB of OpenAPI on every TAB. Pre-parse it into a smaller index on the side.

A reasonable cache lifetime is 5–15 minutes for things that change occasionally (workspaces, projects) and 1 minute for things that change often (running deployments, recent runs).

### 2. Side-effect-free

The completer must not:
- Mutate state (no writes to disk except updating the cache)
- Prompt for input (there's no terminal attached the way you'd expect)
- Log to stderr — completion frameworks may capture stderr and show it as candidate text
- Throw an error that kills the shell

If the cache is missing or stale and the network is down, return zero candidates. Don't error.

## Example: completing API endpoint paths from OpenAPI

This is one of the most useful applications — letting users tab-complete `mytool api <TAB>` against the live API surface.

```rust
fn complete_api_path(current: &OsStr) -> Vec<CompletionCandidate> {
    let prefix = current.to_string_lossy();
    let spec = load_openapi_index().unwrap_or_default(); // local cache, parsed once
    spec.paths()
        .filter(|p| p.path.starts_with(prefix.as_ref()))
        .map(|p| CompletionCandidate::new(&p.path).help(Some(p.summary.clone().into())))
        .collect()
}
```

The cache file is a slim index, not the raw spec — for OpenAPI specs this means parsing once into `Vec<{path, methods, summary}>` and serializing as a small JSON or MessagePack file in `~/.cache/mytool/openapi-index.json`.

## File path completion

If a flag takes a path (`--config`, `--from-file`), use the shell's built-in file completion rather than rolling your own. In clap that's the default for `PathBuf` types. In cobra it's `cobra.ShellCompDirectiveDefault`.

If the path should be filtered (e.g. only `.json` files), use the file extension filter rather than implementing path traversal yourself.

## Installing completions

Ship a `completions` subcommand that prints the relevant script to stdout. Users (or their package manager) put it where their shell expects:

```sh
mytool completions bash > ~/.local/share/bash-completion/completions/mytool
mytool completions zsh > "${fpath[1]}/_mytool"
mytool completions fish > ~/.config/fish/completions/mytool.fish
```

Document this in the long help of the `completions` command and in the project README. For Homebrew/winget/scoop packages, the completions are usually installed automatically.

## Testing completions

The frameworks let you invoke completion logic without a real shell. In clap:

```rust
#[test]
fn completes_worker_ids() {
    let cmd = Cli::command();
    let candidates = clap_complete::engine::complete(
        &mut cmd.clone(),
        vec!["mytool", "workers", "delete", "worker_a1"].into_iter().map(Into::into).collect(),
        3,
        None,
    ).unwrap();
    assert!(candidates.iter().any(|c| c.get_value() == "worker_a1b2c3d4"));
}
```

Test at least: the completer returns candidates when the cache has data, returns zero when it doesn't, and doesn't panic when the cache file is missing or corrupt.
