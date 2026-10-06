/** Shared error-coding helpers used by both the Convex and local-server backends. */

/** Builds an Error carrying a machine-readable `.data.code`, as errorCodeOf() expects. */
export function codedError(code: string): Error & { data?: unknown } {
  const error = new Error(code) as Error & { data?: unknown };
  error.data = { code };
  return error;
}

/** Rejects with `onTimeoutCode` if `promise` does not settle within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeoutCode: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(codedError(onTimeoutCode)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Extracts a coded reason from a thrown value: a `.code` string, or the first
 * match of `pattern` inside `.message`, falling back to `fallback`.
 */
export function extractErrorCode(error: unknown, pattern: RegExp, fallback: string): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[A-Z_]+$/.test(code)) return code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  const match = message.match(pattern);
  return match ? match[0] : fallback;
}
