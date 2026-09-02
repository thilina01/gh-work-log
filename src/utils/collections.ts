export function groupBy<T, K>(
  values: readonly T[],
  keySelector: (value: T) => K,
): Map<K, T[]> {
  const groups = new Map<K, T[]>();

  for (const value of values) {
    const key = keySelector(value);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(value);
    } else {
      groups.set(key, [value]);
    }
  }

  return groups;
}

const REPOSITORY_SHA_SEPARATOR = ":";

export function repositoryShaKey(repository: string, sha: string): string {
  return `${repository}${REPOSITORY_SHA_SEPARATOR}${sha}`;
}

export function parseRepositoryShaKey(key: string): { repository: string; sha: string } {
  const separatorIndex = key.lastIndexOf(REPOSITORY_SHA_SEPARATOR);
  if (separatorIndex === -1) {
    return { repository: "", sha: "" };
  }

  return {
    repository: key.slice(0, separatorIndex),
    sha: key.slice(separatorIndex + 1),
  };
}
