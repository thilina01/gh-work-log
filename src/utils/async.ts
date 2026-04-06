export async function mapLimit<T, TResult>(
  values: T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  if (limit < 1) {
    throw new Error("Concurrency limit must be at least 1.");
  }

  const results = new Array<TResult>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const current = nextIndex;
      if (current >= values.length) {
        return;
      }

      nextIndex += 1;
      results[current] = await mapper(values[current]!, current);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, values.length) },
    () => worker(),
  );

  await Promise.all(workers);
  return results;
}
