export function requiredString(value: unknown, key: string, context: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected "${key}" in ${context} to be a string.`);
  }

  return value;
}

function optionalField<T>(
  value: unknown,
  key: string,
  context: string,
  isValid: (value: unknown) => value is T,
  expectedDescription: string,
): T | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isValid(value)) {
    throw new Error(`Expected "${key}" in ${context} to be ${expectedDescription}.`);
  }

  return value;
}

export function optionalString(
  value: unknown,
  key: string,
  context: string,
): string | undefined {
  return optionalField(value, key, context, (v): v is string => typeof v === "string", "a string");
}

export function optionalStringArray(
  value: unknown,
  key: string,
  context: string,
): string[] | undefined {
  return optionalField(
    value,
    key,
    context,
    (v): v is string[] => Array.isArray(v) && v.every((entry) => typeof entry === "string"),
    "an array of strings",
  );
}

export function optionalBoolean(
  value: unknown,
  key: string,
  context: string,
): boolean | undefined {
  return optionalField(value, key, context, (v): v is boolean => typeof v === "boolean", "a boolean");
}
