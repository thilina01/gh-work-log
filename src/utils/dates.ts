const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseSince(value: string): Date {
  if (DATE_ONLY_PATTERN.test(value)) {
    return new Date(`${value}T00:00:00.000Z`);
  }

  const date = new Date(value);
  assertValidDate(date, "since");
  return date;
}

export function parseUntil(value: string): Date {
  if (DATE_ONLY_PATTERN.test(value)) {
    const start = new Date(`${value}T00:00:00.000Z`);
    start.setUTCDate(start.getUTCDate() + 1);
    return start;
  }

  const date = new Date(value);
  assertValidDate(date, "until");
  return date;
}

export function toUtcIso(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  assertValidDate(date, "timestamp");
  return date.toISOString();
}

export function assertSinceBeforeUntil(since: Date, until: Date): void {
  if (since.getTime() >= until.getTime()) {
    throw new Error("`--since` must be earlier than `--until`.");
  }
}

export function isWithinRange(
  authoredDateTime: string,
  since: Date,
  until: Date,
): boolean {
  const value = new Date(authoredDateTime);
  assertValidDate(value, "authoredDateTime");
  return value.getTime() >= since.getTime() && value.getTime() < until.getTime();
}

export function dayKey(dateIso: string): string {
  return toUtcIso(dateIso).slice(0, 10);
}

export function monthKey(dateIso: string): string {
  return toUtcIso(dateIso).slice(0, 7);
}

export function weekStartIso(dateIso: string): string {
  const date = new Date(toUtcIso(dateIso));
  const day = date.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - offset);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

export function roundDurationSeconds(startMs: number, endMs: number): number {
  return Number(((endMs - startMs) / 1000).toFixed(3));
}

function assertValidDate(value: Date, label: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new Error(`Invalid ${label} timestamp.`);
  }
}
