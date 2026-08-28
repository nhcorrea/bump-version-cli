export type BumpVersionErrorCode =
  | "NOT_FOUND"
  | "PARSE_ERROR"
  | "AMBIGUOUS"
  | "WRITE_ERROR"
  | "VERIFY_ERROR";

export class BumpVersionError extends Error {
  readonly code: BumpVersionErrorCode;
  readonly path: string;
  readonly cause?: unknown;

  constructor(
    code: BumpVersionErrorCode,
    message: string,
    path: string,
    cause?: unknown
  ) {
    super(message);
    this.name = "BumpVersionError";
    this.code = code;
    this.path = path;
    this.cause = cause;
  }
}

export function isBumpVersionError(error: unknown): error is BumpVersionError {
  return error instanceof BumpVersionError;
}
