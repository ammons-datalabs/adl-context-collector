export function resolveApiKey(value: string | null): string | null {
  if (!value) return null;
  if (value.startsWith("env:")) {
    const envVar = value.slice(4);
    const resolved = process.env[envVar];
    if (!resolved) {
      throw new Error(
        `Environment variable ${envVar} not set (referenced in config)`
      );
    }
    return resolved;
  }
  return value;
}
