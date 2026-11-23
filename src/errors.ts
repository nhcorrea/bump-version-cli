export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "PARSE_ERROR"
  | "AMBIGUOUS"
  | "VERSION_CONFLICT"
  | "CHECK_MISMATCH"
  | "CONCURRENT_MODIFICATION"
  | "WRITE_ERROR"
  | "VERIFY_ERROR"
  | "ROLLBACK_ERROR";

export type ErrorDetails = Record<string, unknown>;

export class BumpVersionError extends Error {
  readonly code: ErrorCode;
  readonly path: string | undefined;
  readonly details: ErrorDetails | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    path?: string,
    cause?: unknown,
    details?: ErrorDetails,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "BumpVersionError";
    this.code = code;
    this.path = path;
    this.details = details;
  }
}

export function isBumpVersionError(error: unknown): error is BumpVersionError {
  return error instanceof BumpVersionError;
}

export function createError(
  code: ErrorCode,
  message: string,
  path: string,
  details?: ErrorDetails,
): BumpVersionError {
  return new BumpVersionError(code, message, path, undefined, details);
}
