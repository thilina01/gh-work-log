import { describe, expect, it } from "vitest";
import { createSemaphore } from "../../src/utils/async";

describe("createSemaphore", () => {
  it("limits simultaneous operations", async () => {
    const semaphore = createSemaphore(2);
    let active = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 5 }, () =>
        semaphore.run(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 2));
          active -= 1;
        }),
      ),
    );

    expect(peak).toBe(2);
  });

  it("releases capacity after a rejected operation", async () => {
    const semaphore = createSemaphore(1);
    const results = await Promise.allSettled([
      semaphore.run(async () => {
        throw new Error("expected");
      }),
      semaphore.run(async () => "completed"),
    ]);

    expect(results).toEqual([
      { status: "rejected", reason: new Error("expected") },
      { status: "fulfilled", value: "completed" },
    ]);
  });

  it("rejects invalid limits", () => {
    expect(() => createSemaphore(0)).toThrow("Concurrency limit must be a positive integer.");
    expect(() => createSemaphore(1.5)).toThrow("Concurrency limit must be a positive integer.");
  });
});
