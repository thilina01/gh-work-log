/**
 * GraphQL documents and response mappers for work tracking. Mappers check
 * every field they read and throw `WorkTrackingPayloadError` for a malformed
 * response, so bad data is reported rather than silently defaulted.
 */

import { FieldValue, GhBoardItem, GhIssue, GhPullRequest, WorkPullRequestReview } from "./types";
import { issueKey } from "./text";

export class WorkTrackingPayloadError extends Error {}

export const ISSUE_FIELDS_FRAGMENT = `
fragment WorkIssueFields on Issue {
  number title url state stateReason createdAt closedAt body
  repository { nameWithOwner }
  issueType { name }
  labels(first: 50) { nodes { name } }
  assignees(first: 20) { nodes { login } }
  milestone { title }
  parent { number repository { nameWithOwner } }
  issueFieldValues(first: 20) {
    nodes {
      __typename
      ... on IssueFieldSingleSelectValue { value field { ...WorkIssueFieldName } }
      ... on IssueFieldTextValue { value field { ...WorkIssueFieldName } }
      ... on IssueFieldNumberValue { value field { ...WorkIssueFieldName } }
      ... on IssueFieldDateValue { value field { ...WorkIssueFieldName } }
      ... on IssueFieldMultiSelectValue { value field { ...WorkIssueFieldName } }
    }
  }
  closedByPullRequestsReferences(first: 20, includeClosedPrs: true) {
    nodes { number repository { nameWithOwner } mergeCommit { oid } }
  }
}
fragment WorkIssueFieldName on IssueFields {
  ... on IssueFieldDate { name }
  ... on IssueFieldMultiSelect { name }
  ... on IssueFieldNumber { name }
  ... on IssueFieldSingleSelect { name }
  ... on IssueFieldText { name }
}`;

export const PULL_REQUEST_FIELDS_FRAGMENT = `
fragment WorkPullRequestFields on PullRequest {
  number title url state isDraft createdAt mergedAt closedAt body
  repository { nameWithOwner }
  headRefName baseRefName
  author { login }
  mergedBy { login }
  mergeCommit { oid }
  additions deletions changedFiles
  commits { totalCount }
  labels(first: 50) { nodes { name } }
  reviews(first: 100) { nodes { author { login } state submittedAt } }
  closingIssuesReferences(first: 20) { nodes { number repository { nameWithOwner } } }
}`;

export function buildBoardQuery(ownerType: "organization" | "user"): string {
  return `
query WorkBoard($owner: String!, $number: Int!, $after: String) {
  owner: ${ownerType}(login: $owner) {
    projectV2(number: $number) {
      title
      url
      items(first: 50, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          fieldValues(first: 50) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
              ... on ProjectV2ItemFieldIterationValue { title field { ... on ProjectV2FieldCommon { name } } }
            }
          }
          content { __typename ... on Issue { ...WorkIssueFields } }
        }
      }
    }
  }
}
${ISSUE_FIELDS_FRAGMENT}`;
}

/** Builds one query with an aliased lookup per issue: `i0`, `i1`, ... */
export function buildIssuesBatchQuery(keys: Array<{ repository: string; number: number }>): string {
  const lookups = keys.map((key, index) => {
    const [owner, name] = key.repository.split("/");
    return `i${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { issue(number: ${key.number}) { ...WorkIssueFields } }`;
  });
  return `query WorkIssues {\n${lookups.join("\n")}\n}\n${ISSUE_FIELDS_FRAGMENT}`;
}

/** Builds one query with an aliased lookup per pull request: `p0`, `p1`, ... */
export function buildPullRequestsBatchQuery(keys: Array<{ repository: string; number: number }>): string {
  const lookups = keys.map((key, index) => {
    const [owner, name] = key.repository.split("/");
    return `p${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequest(number: ${key.number}) { ...WorkPullRequestFields } }`;
  });
  return `query WorkPullRequests {\n${lookups.join("\n")}\n}\n${PULL_REQUEST_FIELDS_FRAGMENT}`;
}

/** Builds one query with an aliased associated-pull-request lookup per commit: `c0`, `c1`, ... */
export function buildCommitPullRequestsBatchQuery(commits: Array<{ repository: string; sha: string }>): string {
  const lookups = commits.map((commit, index) => {
    const [owner, name] = commit.repository.split("/");
    return `c${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { object(oid: ${JSON.stringify(commit.sha)}) { ... on Commit { associatedPullRequests(first: 10) { nodes { ...WorkPullRequestFields } } } } }`;
  });
  return `query WorkCommitPullRequests {\n${lookups.join("\n")}\n}\n${PULL_REQUEST_FIELDS_FRAGMENT}`;
}

export function mapBoardPage(data: unknown): {
  title: string;
  url: string;
  items: GhBoardItem[];
  hasNextPage: boolean;
  endCursor: string | null;
} {
  const owner = record(data, "board").owner;
  if (owner === null || owner === undefined) {
    throw new WorkTrackingPayloadError("The project owner was not found.");
  }
  const project = record(owner, "board.owner").projectV2;
  if (project === null || project === undefined) {
    throw new WorkTrackingPayloadError("The project was not found or is not accessible.");
  }
  const projectRecord = record(project, "projectV2");
  const items = record(projectRecord.items, "projectV2.items");
  const pageInfo = record(items.pageInfo, "projectV2.items.pageInfo");

  const mapped: GhBoardItem[] = [];
  for (const [index, node] of array(items.nodes, "projectV2.items.nodes").entries()) {
    const item = record(node, `items[${index}]`);
    const content = item.content;
    if (!content || typeof content !== "object" || (content as Record<string, unknown>).__typename !== "Issue") {
      continue;
    }
    const issue = mapIssue(content, `items[${index}].content`);
    const values = record(item.fieldValues, `items[${index}].fieldValues`);
    let status: string | null = null;
    const fields: Record<string, FieldValue> = {};
    for (const valueNode of array(values.nodes, `items[${index}].fieldValues.nodes`)) {
      const value = record(valueNode, `items[${index}].fieldValues.nodes[]`);
      const fieldName = readFieldName(value.field);
      const fieldValue = readProjectFieldValue(value);
      if (fieldName === null || fieldValue === null || fieldName === "Title") {
        continue;
      }
      if (fieldName === "Status") {
        status = String(fieldValue);
      } else {
        fields[fieldName] = fieldValue;
      }
    }
    mapped.push({ issue, status, fields });
  }

  return {
    title: string(projectRecord.title, "projectV2.title"),
    url: string(projectRecord.url, "projectV2.url"),
    items: mapped,
    hasNextPage: boolean(pageInfo.hasNextPage, "pageInfo.hasNextPage"),
    endCursor: nullableString(pageInfo.endCursor, "pageInfo.endCursor"),
  };
}

export function mapIssue(value: unknown, path: string): GhIssue {
  const issue = record(value, path);
  const repository = string(record(issue.repository, `${path}.repository`).nameWithOwner, `${path}.repository.nameWithOwner`);
  const number = numberValue(issue.number, `${path}.number`);
  const parent = issue.parent === null || issue.parent === undefined ? null : record(issue.parent, `${path}.parent`);
  const issueFields: Record<string, FieldValue> = {};
  for (const node of connectionNodes(issue.issueFieldValues, `${path}.issueFieldValues`)) {
    const fieldValue = record(node, `${path}.issueFieldValues[]`);
    const name = readFieldName(fieldValue.field);
    const raw = fieldValue.value;
    if (name !== null && (typeof raw === "string" || typeof raw === "number")) {
      issueFields[name] = raw;
    }
  }

  return {
    key: issueKey(repository, number),
    repository,
    number,
    title: string(issue.title, `${path}.title`),
    url: string(issue.url, `${path}.url`),
    state: string(issue.state, `${path}.state`),
    stateReason: nullableString(issue.stateReason ?? null, `${path}.stateReason`),
    createdAt: string(issue.createdAt, `${path}.createdAt`),
    closedAt: nullableString(issue.closedAt ?? null, `${path}.closedAt`),
    body: string(issue.body ?? "", `${path}.body`),
    issueType: issue.issueType ? string(record(issue.issueType, `${path}.issueType`).name, `${path}.issueType.name`) : null,
    labels: names(issue.labels, `${path}.labels`, "name"),
    assignees: names(issue.assignees, `${path}.assignees`, "login"),
    milestone: issue.milestone ? string(record(issue.milestone, `${path}.milestone`).title, `${path}.milestone.title`) : null,
    parentKey: parent
      ? issueKey(
          string(record(parent.repository, `${path}.parent.repository`).nameWithOwner, `${path}.parent.repository.nameWithOwner`),
          numberValue(parent.number, `${path}.parent.number`),
        )
      : null,
    issueFields,
    closingPullRequests: connectionNodes(issue.closedByPullRequestsReferences, `${path}.closedByPullRequestsReferences`).map(
      (node, index) => {
        const pull = record(node, `${path}.closedByPullRequestsReferences[${index}]`);
        const pullRepository = string(record(pull.repository, `${path}.closedBy.repository`).nameWithOwner, `${path}.closedBy.repository.nameWithOwner`);
        const mergeCommit = pull.mergeCommit ? record(pull.mergeCommit, `${path}.closedBy.mergeCommit`) : null;
        return {
          key: issueKey(pullRepository, numberValue(pull.number, `${path}.closedBy.number`)),
          repository: pullRepository,
          mergeCommitSha: mergeCommit ? string(mergeCommit.oid, `${path}.closedBy.mergeCommit.oid`) : null,
        };
      },
    ),
  };
}

export function mapPullRequest(value: unknown, path: string): GhPullRequest {
  const pull = record(value, path);
  const repository = string(record(pull.repository, `${path}.repository`).nameWithOwner, `${path}.repository.nameWithOwner`);
  const number = numberValue(pull.number, `${path}.number`);
  const reviews: WorkPullRequestReview[] = connectionNodes(pull.reviews, `${path}.reviews`).map((node, index) => {
    const review = record(node, `${path}.reviews[${index}]`);
    return {
      author: review.author ? nullableString(record(review.author, `${path}.reviews[${index}].author`).login ?? null, `${path}.reviews[${index}].author.login`) : null,
      state: string(review.state, `${path}.reviews[${index}].state`),
      submittedAt: nullableString(review.submittedAt ?? null, `${path}.reviews[${index}].submittedAt`),
    };
  });

  return {
    key: issueKey(repository, number),
    repository,
    number,
    title: string(pull.title, `${path}.title`),
    url: string(pull.url, `${path}.url`),
    state: string(pull.state, `${path}.state`),
    isDraft: boolean(pull.isDraft, `${path}.isDraft`),
    createdAt: string(pull.createdAt, `${path}.createdAt`),
    mergedAt: nullableString(pull.mergedAt ?? null, `${path}.mergedAt`),
    closedAt: nullableString(pull.closedAt ?? null, `${path}.closedAt`),
    body: string(pull.body ?? "", `${path}.body`),
    author: pull.author ? nullableString(record(pull.author, `${path}.author`).login ?? null, `${path}.author.login`) : null,
    mergedBy: pull.mergedBy ? nullableString(record(pull.mergedBy, `${path}.mergedBy`).login ?? null, `${path}.mergedBy.login`) : null,
    headRefName: string(pull.headRefName, `${path}.headRefName`),
    baseRefName: string(pull.baseRefName, `${path}.baseRefName`),
    mergeCommitSha: pull.mergeCommit ? string(record(pull.mergeCommit, `${path}.mergeCommit`).oid, `${path}.mergeCommit.oid`) : null,
    additions: numberValue(pull.additions, `${path}.additions`),
    deletions: numberValue(pull.deletions, `${path}.deletions`),
    changedFiles: numberValue(pull.changedFiles, `${path}.changedFiles`),
    commitCount: numberValue(record(pull.commits, `${path}.commits`).totalCount, `${path}.commits.totalCount`),
    labels: names(pull.labels, `${path}.labels`, "name"),
    reviews,
    closingIssues: connectionNodes(pull.closingIssuesReferences, `${path}.closingIssuesReferences`).map((node, index) => {
      const issue = record(node, `${path}.closingIssuesReferences[${index}]`);
      return issueKey(
        string(record(issue.repository, `${path}.closingIssuesReferences[${index}].repository`).nameWithOwner, `${path}.closingIssuesReferences.repository.nameWithOwner`),
        numberValue(issue.number, `${path}.closingIssuesReferences[${index}].number`),
      );
    }),
  };
}

/** Reads `alias -> repository -> <field>` from a batched response; null when missing. */
export function readAliased(data: Record<string, unknown>, alias: string, field: string): unknown {
  const repository = data[alias];
  if (!repository || typeof repository !== "object") {
    return null;
  }
  return (repository as Record<string, unknown>)[field] ?? null;
}

function readFieldName(field: unknown): string | null {
  if (!field || typeof field !== "object") {
    return null;
  }
  const name = (field as Record<string, unknown>).name;
  return typeof name === "string" ? name : null;
}

function readProjectFieldValue(value: Record<string, unknown>): FieldValue | null {
  for (const key of ["name", "text", "number", "date", "title"]) {
    const raw = value[key];
    if (typeof raw === "string" || (typeof raw === "number" && Number.isFinite(raw))) {
      return raw;
    }
  }
  return null;
}

function names(value: unknown, path: string, key: "name" | "login"): string[] {
  return connectionNodes(value, path)
    .map((node) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : null))
    .filter((entry): entry is string => typeof entry === "string")
    .sort((left, right) => left.localeCompare(right));
}

function connectionNodes(value: unknown, path: string): unknown[] {
  if (value === null || value === undefined) {
    return [];
  }
  return array(record(value, path).nodes, `${path}.nodes`).filter((node) => node !== null);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkTrackingPayloadError(`Expected ${path} to be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new WorkTrackingPayloadError(`Expected ${path} to be an array.`);
  }
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new WorkTrackingPayloadError(`Expected ${path} to be a string.`);
  }
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : string(value, path);
}

function numberValue(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WorkTrackingPayloadError(`Expected ${path} to be a number.`);
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new WorkTrackingPayloadError(`Expected ${path} to be a boolean.`);
  }
  return value;
}
