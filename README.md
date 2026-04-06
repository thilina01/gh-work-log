# gh-work-log

`gh-work-log` is a Node/TypeScript CLI that uses the current authenticated GitHub CLI session to discover repositories, collect commits for a target author across a date range, export deterministic JSON, and generate a standalone HTML dashboard for exploration.

## Documentation

This README is the single source of truth for the current implementation: behavior, features, CLI usage, output shape, dashboard capabilities, and operational notes.

## Feature Overview

- Authenticates through the existing `gh` session
- Discovers personal, organization, and collaborator-access repositories available to the authenticated user
- Scans default branches by default
- Optionally scans non-default branches with configurable branch matching
- Attributes commits by GitHub login plus optional email aliases
- Deduplicates commits by `repository + sha`
- Optionally enriches commits with diff stats
- Optionally classifies commit messages
- Optionally flags WIP commits heuristically
- Writes deterministic JSON output with metadata, statistics, failures, and normalized commit data
- Generates a standalone HTML dashboard from the JSON output

## Runtime And Tooling

- Node `22.21.1` via [.nvmrc](.nvmrc)
- GitHub CLI `gh` must already be installed and authenticated
- TypeScript build output is emitted to `dist/`

## GitHub CLI Setup

This tool depends on a working GitHub CLI session. Before running scans, make sure `gh` is installed and authenticated.

Install `gh`:

- macOS: `brew install gh`
- Ubuntu/Debian: follow the GitHub CLI package instructions or install from the official package repository
- Windows: `winget install GitHub.cli`

Check that `gh` is available:

```bash
gh --version
```

Authenticate with GitHub:

```bash
gh auth login -h github.com
```

Verify the current session:

```bash
gh auth status
gh api /user
```

If authentication is broken or expired:

```bash
gh auth logout -h github.com -u <your-login>
gh auth login -h github.com
```

What the tool expects from `gh`:

- `gh auth status` succeeds
- `gh api /user` returns the authenticated account
- the account has access to the repositories you want to scan

If `gh auth status` reports an invalid token, the scan will fail before repository discovery starts.

## Install And Build

```bash
nvm use
npm install
npm run build
```

Useful development commands:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run visualize -- --input ./tmp/report.json --output ./tmp/report.html
```

Local defaults:

- If `.gh-work-log.local.json` exists in the repo root, it is loaded automatically
- This file is ignored by git and is meant for personal defaults such as excluded orgs, excluded repos, email aliases, and branch patterns
- CLI flags still take precedence for single-value fields such as `--author`
- For repeatable list filters such as `--exclude-org` and `--exclude-repo`, values from the local file and the CLI are combined, then normalized and deduplicated

## CLI Usage

Basic example:

```bash
node dist/cli.js \
  --since 2026-03-01 \
  --until 2026-04-01 \
  --output ./tmp/report.json
```

Feature-branch scan example:

```bash
node dist/cli.js \
  --since 2026-03-01 \
  --until 2026-04-01 \
  --output ./tmp/report.json \
  --scan-feature-branches \
  --branch-pattern glob:feature/* \
  --branch-pattern prefix:release/
```

Enriched scan example:

```bash
node dist/cli.js \
  --since 2026-03-01 \
  --until 2026-04-01 \
  --output ./tmp/report.json \
  --scan-feature-branches \
  --detect-wip \
  --include-diff-stats \
  --classify-messages
```

Filter examples:

```bash
node dist/cli.js \
  --since 2026-03-01 \
  --until 2026-04-01 \
  --output ./tmp/report.json \
  --exclude-org OTR-LANKA
```

```bash
node dist/cli.js \
  --since 2026-03-01 \
  --until 2026-04-01 \
  --output ./tmp/report.json \
  --exclude-repo thilina01/spring-seed
```

## CLI Reference

Required flags:

- `--since`: inclusive authored-date lower bound
- `--until`: exclusive authored-date upper bound
- `--output`: JSON output path

Identity:

- `--author`: override target GitHub login; otherwise the authenticated login is used
- `--emails`: additional author email aliases; supports repeatable flags and comma-separated values

Repository filters:

- `--include-org`
- `--exclude-org`
- `--include-repo`
- `--exclude-repo`
- `--owned-only`

Branch scanning:

- `--scan-feature-branches`
- `--branch-pattern`

`--branch-pattern` supports:

- `glob:<pattern>`
- `prefix:<value>`
- `regex:<pattern>`

If the mode prefix is omitted, the value is treated as `glob:`.

Optional enrichments and execution flags:

- `--include-diff-stats`
- `--detect-wip`
- `--classify-messages`
- `--dry-run`
- `--verbose`
- `--help`

## Local Config File

The CLI can load a personal defaults file named `.gh-work-log.local.json` from the current working directory. This is useful when you always want to skip the same orgs or repositories without repeating those flags in every command.

Most users will not need to set `author` here, because the tool already defaults to the authenticated `gh` login. Keep `author` only if you intentionally want a persistent override.

Supported keys:

- `author`
- `emails`
- `includeOrgs`
- `excludeOrgs`
- `includeRepos`
- `excludeRepos`
- `branchPatterns`
- `ownedOnly`
- `scanFeatureBranches`
- `includeDiffStats`
- `detectWip`
- `classifyMessages`
- `verbose`

Not supported in the local config file:

- `since`
- `until`
- `output`
- `dryRun`
- `help`

Example:

```json
{
  "excludeOrgs": ["OTR-LANKA"],
  "excludeRepos": ["thilina01/spring-seed"],
  "emails": ["me@example.com"],
  "branchPatterns": ["glob:feature/*"],
  "scanFeatureBranches": true,
  "detectWip": true
}
```

There is also a tracked example file at [.gh-work-log.local.example.json](.gh-work-log.local.example.json).

## Scan Semantics

Authentication flow:

1. Verify `gh` is installed
2. Verify the current `gh` session is authenticated
3. Resolve the authenticated GitHub login
4. Resolve the effective target author

Time semantics:

- `since` is inclusive
- `until` is exclusive
- filtering is based on authored timestamp, not committed timestamp
- date-only inputs are normalized to UTC day boundaries

Repository discovery:

- Repositories are discovered through explicit GitHub API queries available to the authenticated identity
- Include filters are applied first
- Exclude filters are applied second
- Disabled, empty, or metadata-broken repositories are skipped with reasons

Branch handling:

- Default-branch scanning is always the baseline path
- Feature branches are scanned only when `--scan-feature-branches` is enabled
- Matching branches are determined by the configured branch patterns

Attribution:

- A commit matches when the author login matches the target login, or the author email matches one of the configured email aliases

Deduplication:

- Final commit records are deduplicated by `repository + sha`
- When a commit is seen on multiple branches, the canonical branch is the default branch if observed there; otherwise the first matching feature branch in deterministic order

WIP detection:

- WIP is heuristic
- When enabled, a commit is marked WIP when its canonical branch is non-default and it was not observed on the default branch

## GitHub API Usage

The tool uses `gh api` subprocesses for all GitHub access.

REST endpoints:

- `GET /user`
- `GET /users/{login}` when `--author` overrides the authenticated login
- `GET /user/repos?visibility=all&affiliation=owner,collaborator,organization_member&sort=full_name&direction=asc&per_page=100&page=N`
- `GET /repos/{owner}/{repo}/branches?per_page=100&page=N`
- `GET /repos/{owner}/{repo}/commits/{sha}` when diff stats are enabled

GraphQL:

- `repository.ref(qualifiedName: ...).target.history(first: 100, after: $after, since: $since, until: $until, author: $author)`

The GraphQL history query is run once for the target GitHub user id and once more for configured email aliases when email matching is enabled. Results are unioned client-side and then range-filtered again by authored date to preserve the inclusive/exclusive contract.

## JSON Output

Every report includes these top-level sections:

- `metadata`
- `statistics`
- `failures`
- `data`

High-level metadata includes:

- schema version
- generated timestamp
- authenticated user
- target author
- normalized `since` and `until`
- scan mode and feature flags

Statistics includes:

- global summary
- discovery summary
- skipped repositories
- per-repository summary
- time-series summary
- optional code-level summary when diff stats are enabled
- optional message-category summary when classification is enabled

Failure records include:

- repository
- stage
- error type
- optional status code
- message
- retry count

Commit records include:

- repository
- canonical branch
- scan branch
- optional observed branches
- SHA
- message
- authored and committed timestamps
- URL
- source mode
- WIP flag and optional WIP reason
- optional diff stats
- optional message category

Deterministic ordering:

- commit records are sorted by `authoredDateTime`, then `repository`, then `sha`
- repository summaries are sorted by repository name
- time-series output is sorted ascending by period

## HTML Dashboard

Generate a standalone HTML report from a JSON export:

```bash
npm run visualize -- --input ./tmp/report.json --output ./tmp/report.html
```

The generated dashboard currently includes:

- `Overview` tab for high-level run totals
- `Activity` tab with larger full-width day, week, and month charts
- `Repositories` tab with repository ranking and per-repository summary
- `Issues` tab with skipped repository and failure details
- `All Commits` tab backed by the full commit dataset

The `All Commits` tab supports:

- full-width table rendering
- repository, branch, WIP, and free-text filters
- show/hide column controls
- sorting on `Authored` and `Repository`
- clickable SHA links that open the commit on GitHub

Dashboard UX features:

- light and dark theme toggle
- theme selection persisted in browser `localStorage`
- client-side tab switching, sorting, and filtering
- fully standalone HTML with no server dependency

## Development Notes

Project entry points:

- CLI entry: [src/cli.ts](src/cli.ts)
- Scan orchestration: [src/app.ts](src/app.ts)
- GitHub transport: [src/github/client.ts](src/github/client.ts)
- HTML visualizer entry: [src/visualize.ts](src/visualize.ts)
- HTML renderer: [src/visualizer/render.ts](src/visualizer/render.ts)

Test coverage:

- unit tests for config normalization, aggregation, pattern matching, and HTML rendering
- integration tests for the app flow with a mocked GitHub client

Repository quality gates:

- ESLint for static linting
- Vitest for unit and integration tests
- GitHub Actions CI running `typecheck`, `lint`, `test`, and `build`

## Notes And Constraints

- Output files may contain private repository names, URLs, and commit metadata; handle them as sensitive artifacts
- The viewer is generated from JSON and must be regenerated when the JSON changes
- WIP detection is heuristic and may not match every workflow perfectly
- The current implementation relies on `gh` authentication; PAT support is not implemented
