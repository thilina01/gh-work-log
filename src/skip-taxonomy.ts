import { SkipCategory } from "./types";

const FILTER_SKIP_REASONS = new Set([
  "not_in_included_orgs",
  "not_in_included_repositories",
  "excluded_org",
  "excluded_repository",
  "owned_only_mismatch",
]);

const OPERATIONAL_SKIP_REASONS = new Set([
  "disabled_repository",
  "missing_default_branch",
  "empty_repository",
]);

/**
 * Maps a skip reason string to a packaging category.
 * Unknown reasons default to operational so they remain visible in
 * management/agent profiles.
 */
export function classifySkipReason(reason: string): SkipCategory {
  if (FILTER_SKIP_REASONS.has(reason)) {
    return "filter";
  }

  if (OPERATIONAL_SKIP_REASONS.has(reason)) {
    return "operational";
  }

  return "operational";
}
