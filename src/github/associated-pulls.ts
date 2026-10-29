import { AssociatedPullRequest, CommitRecord, RepositoryRecord } from "../types";
import { mapLimit } from "../utils/async";

export interface AssociatedPullLookup {
  getAssociatedPullRequests(
    repository: RepositoryRecord,
    sha: string,
  ): Promise<AssociatedPullRequest[]>;
}

/**
 * Soft enrichment: never throws to the caller. Failed lookups leave the
 * commit unchanged and are logged when a logger callback is provided.
 */
export async function enrichAssociatedPullRequests(params: {
  commits: CommitRecord[];
  repositoryMap: Map<string, RepositoryRecord>;
  client: AssociatedPullLookup;
  concurrency: number;
  onError?: (repository: string, sha: string, error: unknown) => void;
}): Promise<CommitRecord[]> {
  return mapLimit(params.commits, params.concurrency, async (commit) => {
    const repository = params.repositoryMap.get(commit.repository);
    if (!repository) {
      return commit;
    }

    try {
      const associatedPullRequests = await params.client.getAssociatedPullRequests(
        repository,
        commit.sha,
      );
      if (associatedPullRequests.length === 0) {
        return commit;
      }
      return {
        ...commit,
        associatedPullRequests: associatedPullRequests.map(normalizePull),
      };
    } catch (error) {
      params.onError?.(commit.repository, commit.sha, error);
      return commit;
    }
  });
}

export function normalizePull(pull: AssociatedPullRequest): AssociatedPullRequest {
  return {
    number: pull.number,
    url: pull.url,
    title: pull.title,
    state: pull.state,
  };
}

export function mapGraphqlAssociatedPulls(nodes: unknown): AssociatedPullRequest[] {
  if (!Array.isArray(nodes)) {
    return [];
  }

  const pulls: AssociatedPullRequest[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") {
      continue;
    }
    const record = node as Record<string, unknown>;
    const number = record.number;
    const url = record.url;
    const title = record.title;
    const state = record.state;
    if (
      typeof number !== "number" ||
      typeof url !== "string" ||
      typeof title !== "string" ||
      typeof state !== "string"
    ) {
      continue;
    }
    pulls.push({ number, url, title, state });
  }

  return pulls.sort((left, right) => left.number - right.number);
}
