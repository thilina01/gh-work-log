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

export interface AsyncSemaphore {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

export function createSemaphore(limit: number): AsyncSemaphore {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Concurrency limit must be a positive integer.");
  }

  let active = 0;
  const waiting: Array<() => void> = [];

  return {
    async run<T>(operation: () => Promise<T>): Promise<T> {
      if (active >= limit) {
        await new Promise<void>((resolve) => waiting.push(resolve));
      } else {
        active += 1;
      }

      try {
        return await operation();
      } finally {
        const next = waiting.shift();
        if (next) {
          next();
        } else {
          active -= 1;
        }
      }
    },
  };
}
