import { FailureRecord } from "../types";
import { GitHubApiError } from "../github/api-error";
import { toErrorMessage } from "../utils/errors";

export function toFailure(
  error: unknown,
  repository: string,
  stage: string,
): FailureRecord {
  if (error instanceof GitHubApiError) {
    return error.toFailure(repository, stage);
  }

  return {
    repository,
    stage,
    errorType: "unexpected_error",
    message: toErrorMessage(error),
    retryCount: 0,
  };
}
