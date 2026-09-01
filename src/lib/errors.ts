export type BumpVersionErrorCode =
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

export class BumpVersionError extends Error {
  readonly code: BumpVersionErrorCode;
  readonly path: string;
  readonly cause?: unknown;
  readonly details?: Record<string, unknown>;

  constructor(
    code: BumpVersionErrorCode,
    message: string,
    path: string,
    cause?: unknown,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "BumpVersionError";
    this.code = code;
    this.path = path;
    this.cause = cause;
    this.details = details;
  }
}

export function isBumpVersionError(error: unknown): error is BumpVersionError {
  return error instanceof BumpVersionError;
}
