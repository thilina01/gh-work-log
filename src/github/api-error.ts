import { FailureRecord } from "../types";

export class GitHubApiError extends Error {
  public constructor(
    message: string,
    public readonly errorType: string,
    public readonly statusCode: number | undefined,
    public readonly retryCount: number,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }

  public toFailure(repository: string, stage: string): FailureRecord {
    return {
      repository,
      stage,
      errorType: this.errorType,
      ...(this.statusCode !== undefined ? { statusCode: this.statusCode } : {}),
      message: this.message,
      retryCount: this.retryCount,
    };
  }
}
