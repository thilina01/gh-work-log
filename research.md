# Research: Unlinked Commit Author Fallback

## Decision

Use the Git commit author name from GitHub's existing GraphQL commit-history response as a display-only fallback when a linked GitHub login is unavailable. Label it as an unverified commit name. Do not add a per-commit REST/GraphQL lookup, infer an account from the name or email, or expose author emails in organization reports. Suppress author-name values that contain an email address.

## Evidence

The attached October 2026 organization report contained 1,520 commits. Of those, 346 (22.8%) lacked a linked login. Checking all 346 commit objects showed:

- 0/346 had an associated GitHub user login.
- 346/346 had a Git author name.
- 115/346 Git author names contained `[bot]`.

This result is exact for that report's unresolved commits, not a forecast for future reports. Git author names are commit metadata and are not proof of account ownership.

## Rationale

The API association lookup did not resolve any of the checked identities, while every checked commit provided a Git author name. Capturing the name in the existing scan query addresses the displayed dash without extra API calls. Explicit provenance prevents an unlinked name from being mistaken for a verified GitHub account.

Because commit names are user-controlled metadata and can themselves contain email addresses, generated organization reports discard email-like author-name strings rather than relying only on omission of the GraphQL email field.

## Alternatives Considered

- **Per-commit REST lookup for a linked account**: rejected; the checked unresolved commits had no linked account in GitHub's commit object.
- **Show only `Unknown`**: safe, but omits useful commit metadata that was present in every checked case.
- **Infer or display a login from author name/email**: rejected because the name is not verified and organization reports intentionally omit email.
