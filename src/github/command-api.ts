import {
  CommandRunner,
  GitHubRunnerResult,
  NormalizedConfig,
} from "../types";
import { Logger } from "../logger";
import { GitHubApiError } from "./api-error";
import { NodeCommandRunner } from "./command-runner";
import { isGraphqlErrors } from "./response-schemas";

const REST_API_VERSION = "2022-11-28";
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

export class GitHubCommandApi {
  public constructor(
    private readonly config: NormalizedConfig,
    private readonly logger: Logger,
    private readonly runner: CommandRunner = new NodeCommandRunner(),
  ) {}

  public async getJson<T>(
    pathArgs: string[],
    errorType: string,
    isExpected: (value: unknown) => value is T,
  ): Promise<T> {
    const result = await this.runGh(
      [
        "api",
        "--method",
        "GET",
        "-H",
        "Accept: application/vnd.github+json",
        "-H",
        `X-GitHub-Api-Version: ${REST_API_VERSION}`,
        ...pathArgs,
      ],
      errorType,
    );

    return expectPayload(parseJson(result.stdout, errorType), errorType, isExpected);
  }

  public async postGraphql<T>(
    query: string,
    variables: Record<string, unknown>,
    errorType: string,
    isExpected: (value: unknown) => value is T,
  ): Promise<T> {
    const payload = JSON.stringify({ query, variables });
    const result = await this.runGh(
      [
        "api",
        "graphql",
        "--method",
        "POST",
        "--input",
        "-",
        "-H",
        "Accept: application/vnd.github+json",
        "-H",
        `X-GitHub-Api-Version: ${REST_API_VERSION}`,
      ],
      errorType,
      payload,
    );
    const parsed = parseJson(result.stdout, errorType);
    if (!isRecord(parsed)) {
      throw invalidPayload(errorType);
    }

    if (parsed.errors !== undefined && !isGraphqlErrors(parsed.errors)) {
      throw invalidPayload(errorType);
    }
    if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      const firstError = parsed.errors[0];
      throw new GitHubApiError(
        firstError?.message ?? "GitHub GraphQL request failed.",
        errorType,
        undefined,
        0,
      );
    }

    if (!Object.hasOwn(parsed, "data")) {
      throw new GitHubApiError(
        "GitHub GraphQL response was missing data.",
        errorType,
        undefined,
        0,
      );
    }
    if (!isExpected(parsed.data)) {
      throw invalidPayload(errorType);
    }

    return parsed.data;
  }

  public async runGh(
    args: string[],
    errorType: string,
    input?: string,
  ): Promise<GitHubRunnerResult> {
    for (let attempt = 0; attempt <= this.config.retryPolicy.maxRetries; attempt += 1) {
      this.logger.debug(`Running gh ${args.join(" ")}`);
      const result = await this.runner.run(
        "gh",
        args,
        input !== undefined ? { input } : {},
      );

      if (result.exitCode === 0) {
        return result;
      }

      const statusCode = parseStatusCode(result.stderr);
      const shouldRetry =
        attempt < this.config.retryPolicy.maxRetries &&
        (statusCode !== undefined
          ? RETRYABLE_STATUS_CODES.has(statusCode)
          : /timed out|timeout|temporary|connection reset/i.test(result.stderr));

      if (!shouldRetry) {
        throw new GitHubApiError(
          cleanErrorMessage(result.stderr),
          errorType,
          statusCode,
          attempt,
        );
      }

      const resetTime = parseRateLimitReset(result.stderr);
      const waitMs =
        resetTime !== undefined
          ? Math.max(resetTime * 1000 - Date.now(), 0)
          : this.config.retryPolicy.backoffMs[attempt] ?? 0;

      this.logger.debug(
        `Retrying gh request after ${waitMs}ms because of ${cleanErrorMessage(result.stderr)}`,
      );
      await sleep(waitMs);
    }

    throw new GitHubApiError(
      "GitHub request failed after retries.",
      errorType,
      undefined,
      this.config.retryPolicy.maxRetries,
    );
  }
}

function parseJson(value: string, errorType: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new GitHubApiError(
      `Failed to parse JSON for ${errorType}.`,
      errorType,
      undefined,
      0,
    );
  }
}

function parseStatusCode(stderr: string): number | undefined {
  const match = stderr.match(/\b(?:HTTP\s+)?(4\d{2}|5\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

function parseRateLimitReset(stderr: string): number | undefined {
  const match = stderr.match(/x-ratelimit-reset:\s*(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

function cleanErrorMessage(stderr: string): string {
  return stderr.trim() || "GitHub command failed.";
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function expectPayload<T>(
  value: unknown,
  errorType: string,
  isExpected: (value: unknown) => value is T,
): T {
  if (!isExpected(value)) {
    throw invalidPayload(errorType);
  }
  return value;
}

function invalidPayload(errorType: string): GitHubApiError {
  return new GitHubApiError(
    `GitHub returned an invalid response for ${errorType}.`,
    errorType,
    undefined,
    0,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
