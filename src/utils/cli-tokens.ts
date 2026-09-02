export function splitFlagToken(token: string): [string, string | undefined] {
  const separatorIndex = token.indexOf("=");
  if (separatorIndex === -1) {
    return [token, undefined];
  }

  return [token.slice(0, separatorIndex), token.slice(separatorIndex + 1)];
}
