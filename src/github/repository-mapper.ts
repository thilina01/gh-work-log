import { RepositoryRecord } from "../types";
import { optionalBoolean, optionalString, requiredString } from "../utils/validation";

export function mapRepository(value: unknown): RepositoryRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected repository payload to be an object.");
  }

  const record = value as Record<string, unknown>;
  const context = "repository payload";

  const fullName = requiredString(record.full_name, "full_name", context);
  const name = requiredString(record.name, "name", context);
  const owner = record.owner;
  if (owner !== undefined && owner !== null && (typeof owner !== "object" || Array.isArray(owner))) {
    throw new Error(`Expected "owner" in ${context} to be an object.`);
  }
  const ownerLogin =
    (owner && typeof owner === "object"
      ? optionalString((owner as Record<string, unknown>).login, "owner.login", context)
      : undefined) ?? fullName.split("/")[0] ?? "";

  return {
    fullName,
    ownerLogin,
    name,
    visibility: optionalString(record.visibility, "visibility", context) ?? "unknown",
    defaultBranch: optionalString(record.default_branch, "default_branch", context) ?? null,
    isArchived: Boolean(optionalBoolean(record.archived, "archived", context)),
    isFork: Boolean(optionalBoolean(record.fork, "fork", context)),
    isDisabled: Boolean(optionalBoolean(record.disabled, "disabled", context)),
    isPrivate: Boolean(optionalBoolean(record.private, "private", context)),
    htmlUrl: optionalString(record.html_url, "html_url", context) ?? `https://github.com/${fullName}`,
  };
}
