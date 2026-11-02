# Implementation Plan: Display Unlinked Commit Author Names

**Date**: 2026-11-02 | **Spec**: Derived from the user-approved enhancement and the October organization-report evaluation; no separate feature-spec artifact exists.

## Summary

Show the Git author name for a commit when GitHub does not associate it with a user login. Prefer linked GitHub identities, clearly label fallback names as unverified commit metadata, and show `Unknown` if neither is available. Fetch the name in the existing GraphQL history request only for organization reports; do not add per-commit lookups or expose author emails. Preserve the existing contributor aggregation by verified login so unverified names are not treated as distinct accounts.

## Technical Context

**Language/Version**: TypeScript, Node.js 22.21.1
**Primary Dependencies**: Existing GitHub GraphQL client, report validator, HTML visualizer, Vitest
**Storage**: JSON reports and embedded standalone HTML dashboard
**Testing**: Vitest unit/integration tests; ESLint; TypeScript typecheck; build and generated-browser-client parity
**Target Platform**: Node.js CLI and standalone browser dashboard
**Performance Goals**: No additional GitHub requests; include the name in the existing history query
**Constraints**:
- Do not infer a GitHub login from a Git author name or email.
- Organization reports must continue omitting raw author emails.
- Email-like strings in Git author names must not be copied into organization reports.
- Existing 1.2.0 and 1.3.0 reports remain loadable.
- Do not treat unlinked commit names as verified contributor identities.

## Constitution Check

No repository `constitution.md` was found. The plan follows the established implementation constraints visible in the codebase: validate external response shapes, preserve existing report compatibility, keep generated browser JavaScript synchronized with its TypeScript source, and cover behavior with focused tests. No new dependency or API endpoint is proposed.

## Applied Guidelines

No matching migration or transformation guidelines apply to this TypeScript feature.

## Implementation Steps

### Phase 1: Foundational Data and Report Contract

#### Step 2.1: Capture Git author names in organization scan responses
- **Requirements**: REQ-001, REQ-004
- **Description**: Extend GraphQL author selection and response validation to capture the commit's Git author name in the existing organization-history request. Carry it as nullable `authorName` through `CommitObservation` and `CommitRecord`. Only request/store it for organization reports, do not add lookup requests, keep email fields omitted, and suppress names containing email addresses before report serialization.

- [x] T001 [Plan:2.1] Add nullable `authorName` to commit types and map the organization-only GraphQL author name through response validation and scan observations in `src/types.ts`, `src/github/client.ts`, and `src/github/response-schemas.ts`.

#### Step 2.2: Version and validate the report field compatibly
- **Requirements**: REQ-002, REQ-004, REQ-005
- **Description**: Emit schema version `1.4.0` for newly generated reports. Preserve schema `1.2.0` and `1.3.0` loading. Validate `authorName` as a nullable string when present and require the new field only for organization reports using schema `1.4.0`.

- [x] T002 [Plan:2.2] Preserve `authorName` in organization commit records, emit schema `1.4.0`, and validate the new field while retaining `1.2.0` and `1.3.0` compatibility in `src/aggregation.ts` and `src/report-validation.ts`.

### Phase 2: User Story 1 — Identify Unlinked Authors in Commit Views

**Story**: As a report reader, I want to see the author name recorded in a commit when GitHub has not linked it to a login, while being able to distinguish that name from a verified GitHub identity.

#### Step 3.1: Render a provenance-aware author label consistently
- **Requirements**: REQ-002, REQ-003
- **Description**: In the commit table, show a linked login when available; otherwise show the Git author name with an explicit unverified/commit-name indicator; otherwise show `Unknown`. Preserve the existing merge-author behavior. Apply the same identity label to author filtering, sorting, and CSV export, and escape all author-provided text before rendering.

- [x] T003 [US1] [Plan:3.1] Display linked logins or clearly labeled unverified commit names, use `Unknown` only when both are absent, and keep author filtering, sorting, CSV export, and escaping consistent in `src/visualizer/browser-client.ts` and `src/visualizer/sections.ts`.

#### Step 3.2: Preserve verified-only contributor aggregation
- **Requirements**: REQ-003, REQ-004
- **Description**: Keep `statistics.contributors` grouped by linked GitHub login, including the existing `null`/Unknown bucket for unlinked commits. Do not group or count unverified names as user accounts. Clarify this distinction in contributor/author UI copy where needed.

- [x] T004 [US1] [Plan:3.2] Preserve contributor grouping by linked login and clarify that unlinked commit names are not verified accounts in `src/aggregation.ts` and `src/visualizer/sections.ts`.

### Phase 3: Compatibility, Documentation, and Verification

#### Step 4.1: Document the fallback and validate report behavior
- **Requirements**: REQ-001, REQ-002, REQ-003, REQ-004, REQ-005
- **Description**: Update the README's JSON schema and organization-report documentation. Add or update tests for GraphQL selection and response validation, aggregation and email omission, schema compatibility, author display/filter/export, escaping, and generated browser-client parity. Regenerate `src/visualizer/browser-client.js`; run the focused/full test suite, lint, typecheck, and build.

- [x] T005 [Plan:4.1] Add regression coverage for author-name capture, schema compatibility, privacy, display provenance, filters, sorting, and CSV output in `tests/unit/client.test.ts`, `tests/unit/aggregation.test.ts`, `tests/unit/visualizer.test.ts`, and `tests/integration/app.test.ts`.
- [x] T006 [Plan:4.1] Document the organization-report fallback and schema `1.4.0` in `README.md`, regenerate `src/visualizer/browser-client.js`, and run the test suite, lint, typecheck, build, and `git diff --check`.
## Project Structure

```text
src/
  types.ts                         # Commit author-name field
  github/client.ts                 # Existing GraphQL history selection and mapping
  github/response-schemas.ts       # GraphQL response validation
  aggregation.ts                   # Commit report mapping and schema version
  report-validation.ts             # 1.4.0 plus legacy report compatibility
  visualizer/browser-client.ts     # Author label, filtering, and CSV behavior
  visualizer/browser-client.js     # Generated browser client
  visualizer/sections.ts           # Author column label/copy if needed
tests/
  unit/client.test.ts
  unit/aggregation.test.ts
  unit/visualizer.test.ts
  integration/app.test.ts
README.md
```

## Testing Strategy

- **App type**: CLI generating JSON plus a standalone HTML dashboard.
- **Critical user journeys**:
  1. An organization report displays a linked login as the verified identity.
  2. An unlinked author with a Git author name displays that name with unverified provenance.
  3. A commit without either identity displays `Unknown`.
  4. Search/filter and CSV export use the same visible author identity.
  5. Existing 1.2.0 and 1.3.0 reports continue to render.
- **Validation**: Vitest unit/integration tests, generated-client parity, ESLint, TypeScript typecheck, and production build. No external service or browser infrastructure is required for automated tests; GitHub requests are mocked.
- **Acceptance criteria**: No additional GitHub API calls; no raw author email or email-like commit author name in organization report output; no unverified name presented as a verified login or contributor account; legacy reports remain accepted; all validation commands pass.

## Requirement Mapping

| REQ ID | Description | Plan Items | Implementation Evidence |
|--------|-------------|------------|------------------------|
| REQ-001 | Capture Git author name without additional API calls | 2.1, 4.1 | `src/github/client.ts`, `src/github/response-schemas.ts`, `src/types.ts`, client tests |
| REQ-002 | Display fallback names as unverified and use Unknown only when no name is available | 2.2, 3.1, 4.1 | `src/aggregation.ts`, `src/report-validation.ts`, `src/visualizer/browser-client.ts`, visualizer tests |
| REQ-003 | Keep author filtering, sorting, export, and contributor summaries consistent without treating names as accounts | 3.1, 3.2, 4.1 | `src/visualizer/browser-client.ts`, `src/visualizer/sections.ts`, `src/aggregation.ts`, visualizer and aggregation tests |
| REQ-004 | Preserve organization-report privacy and avoid identity inference | 2.1, 2.2, 3.2, 4.1 | `src/github/client.ts`, `src/aggregation.ts`, `src/report-validation.ts`, privacy assertions |
| REQ-005 | Keep previously generated report schemas loadable | 2.2, 4.1 | `src/report-validation.ts`, legacy-report validation tests |
