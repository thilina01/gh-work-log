export interface GraphqlCommitResponse {
  repository: {
    ref: {
      target: {
        history: {
          nodes: Array<{
            oid: string;
            message: string;
            messageHeadline: string;
            authoredDate: string;
            committedDate: string | null;
            url: string;
            author: {
              email: string | null;
              user: { login: string | null } | null;
            } | null;
            parents: {
              totalCount: number;
              nodes: Array<{
                author: {
                  email: string | null;
                  user: { login: string | null } | null;
                } | null;
              }>;
            };
          }>;
          pageInfo: {
            hasNextPage: boolean;
            endCursor: string | null;
          };
        };
      } | null;
    } | null;
  } | null;
}

export type GraphqlCommitRef = NonNullable<
  NonNullable<GraphqlCommitResponse["repository"]>["ref"]
>;
export type GraphqlCommitTarget = NonNullable<GraphqlCommitRef["target"]>;

export function isAuthenticatedUserResponse(
  value: unknown,
): value is { login: string; node_id: string } {
  return isRecord(value) && isString(value.login) && isString(value.node_id);
}

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function isBranchArray(value: unknown): value is Array<{ name: string }> {
  return (
    Array.isArray(value) &&
    value.every((branch) => isRecord(branch) && isString(branch.name))
  );
}

export function isDiffStatsResponse(
  value: unknown,
): value is {
  stats?: { additions?: number; deletions?: number };
  files?: unknown[];
} {
  if (!isRecord(value)) {
    return false;
  }
  if (value.stats !== undefined) {
    if (!isRecord(value.stats)) {
      return false;
    }
    if (
      value.stats.additions !== undefined &&
      !isNumber(value.stats.additions)
    ) {
      return false;
    }
    if (
      value.stats.deletions !== undefined &&
      !isNumber(value.stats.deletions)
    ) {
      return false;
    }
  }
  return value.files === undefined || Array.isArray(value.files);
}

export function isAssociatedPullResponseArray(
  value: unknown,
): value is Array<{
  number: number;
  html_url: string;
  title: string;
  state: string;
}> {
  return (
    Array.isArray(value) &&
    value.every(
      (pull) =>
        isRecord(pull) &&
        isNumber(pull.number) &&
        isString(pull.html_url) &&
        isString(pull.title) &&
        isString(pull.state),
    )
  );
}

export function isGraphqlCommitResponse(value: unknown): value is GraphqlCommitResponse {
  if (!isRecord(value)) {
    return false;
  }
  const repository = value.repository;
  if (repository === null) {
    return true;
  }
  if (!isRecord(repository)) {
    return false;
  }
  const ref = repository.ref;
  if (ref === null) {
    return true;
  }
  if (!isRecord(ref)) {
    return false;
  }
  const target = ref.target;
  if (target === null) {
    return true;
  }
  if (!isRecord(target) || !isRecord(target.history)) {
    return false;
  }
  const history = target.history;
  if (!Array.isArray(history.nodes) || !isRecord(history.pageInfo)) {
    return false;
  }
  if (
    typeof history.pageInfo.hasNextPage !== "boolean" ||
    !isNullableString(history.pageInfo.endCursor)
  ) {
    return false;
  }
  return history.nodes.every((node) => {
    if (
      !isRecord(node) ||
      !isString(node.oid) ||
      !isString(node.message) ||
      !isString(node.messageHeadline) ||
      !isString(node.authoredDate) ||
      !isNullableString(node.committedDate) ||
      !isString(node.url) ||
      !isGraphqlAuthor(node.author) ||
      !isRecord(node.parents) ||
      !isNumber(node.parents.totalCount) ||
      !Array.isArray(node.parents.nodes)
    ) {
      return false;
    }
    return node.parents.nodes.every(
      (parent) => isRecord(parent) && isGraphqlAuthor(parent.author),
    );
  });
}

export function isGraphqlErrors(
  value: unknown,
): value is Array<{ message: string }> {
  return (
    Array.isArray(value) &&
    value.every((error) => isRecord(error) && isString(error.message))
  );
}

function isGraphqlAuthor(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  if (!isRecord(value) || !isNullableString(value.email)) {
    return false;
  }
  return (
    value.user === null ||
    (isRecord(value.user) && isNullableString(value.user.login))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
