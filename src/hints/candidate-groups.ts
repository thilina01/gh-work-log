import { CandidateGroupHint, CommitRecord } from "../types";

const ISSUE_KEY_PATTERN = /(?:^|[^\w])(?:#|task\/)(\d+)\b/i;
const CHORE_CATEGORIES = new Set(["chore", "other"]);

/**
 * Non-authoritative triage hints for agent reports only.
 * Every listed SHA must already exist in the commit set.
 */
export function buildCandidateGroupHints(commits: CommitRecord[]): CandidateGroupHint[] {
  if (commits.length === 0) {
    return [];
  }

  const byKey = new Map<string, CommitRecord[]>();

  for (const commit of commits) {
    for (const key of deriveGroupKeys(commit)) {
      const existing = byKey.get(key) ?? [];
      existing.push(commit);
      byKey.set(key, existing);
    }
  }

  const groups: CandidateGroupHint[] = [];
  const seenMemberSets = new Set<string>();

  for (const [key, members] of [...byKey.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const uniqueMembers = uniqueBySha(members);
    if (uniqueMembers.length < 2) {
      continue;
    }

    if (isChoreOnlyGroup(uniqueMembers)) {
      continue;
    }

    const memberKey = uniqueMembers
      .map((commit) => `${commit.repository}@${commit.sha}`)
      .sort((left, right) => left.localeCompare(right))
      .join("|");
    if (seenMemberSets.has(memberKey)) {
      continue;
    }
    seenMemberSets.add(memberKey);

    groups.push({
      kind: "hint",
      id: `hint:${key}:${hashMemberKey(memberKey)}`,
      reason: describeReason(key),
      commits: uniqueMembers
        .map((commit) => ({
          repository: commit.repository,
          sha: commit.sha,
        }))
        .sort((left, right) => {
          const byRepo = left.repository.localeCompare(right.repository);
          if (byRepo !== 0) {
            return byRepo;
          }
          return left.sha.localeCompare(right.sha);
        }),
    });
  }

  return groups.sort((left, right) => left.id.localeCompare(right.id));
}

function deriveGroupKeys(commit: CommitRecord): string[] {
  const keys = new Set<string>();
  const issueFromMessage = ISSUE_KEY_PATTERN.exec(commit.message)?.[1];
  const issueFromBranch = ISSUE_KEY_PATTERN.exec(commit.scanBranch)?.[1]
    ?? ISSUE_KEY_PATTERN.exec(commit.branch)?.[1];
  const issue = issueFromMessage ?? issueFromBranch;
  if (issue) {
    keys.add(`issue:${issue}`);
  }

  const day = commit.authoredDateTime.slice(0, 10);
  const stem = repositoryStem(commit.repository);
  if (stem) {
    keys.add(`day-stem:${day}:${stem}`);
  }

  return [...keys];
}

function repositoryStem(fullName: string): string | null {
  const name = fullName.split("/")[1];
  if (!name) {
    return null;
  }
  return name
    .replace(/-api$/i, "")
    .replace(/-client$/i, "")
    .replace(/-frontend$/i, "")
    .replace(/-backend$/i, "")
    .toLowerCase();
}

function uniqueBySha(commits: CommitRecord[]): CommitRecord[] {
  const seen = new Set<string>();
  const result: CommitRecord[] = [];
  for (const commit of commits) {
    const key = `${commit.repository}@${commit.sha}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(commit);
  }
  return result;
}

function isChoreOnlyGroup(commits: CommitRecord[]): boolean {
  if (commits.some((commit) => commit.messageCategory === undefined)) {
    return false;
  }
  return commits.every(
    (commit) =>
      commit.messageCategory !== undefined &&
      CHORE_CATEGORIES.has(commit.messageCategory),
  );
}

function describeReason(key: string): string {
  if (key.startsWith("issue:")) {
    return `Shared issue/task key ${key.slice("issue:".length)}`;
  }
  if (key.startsWith("day-stem:")) {
    const parts = key.split(":");
    return `Same-day related repositories for stem "${parts[2] ?? ""}" on ${parts[1] ?? ""}`;
  }
  return key;
}

function hashMemberKey(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
