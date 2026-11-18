class BumpVersionError extends Error {
  constructor(code, message, path, cause, details) {
    super(message, { cause });
    this.name = "BumpVersionError";
    this.code = code;
    this.path = path;
    this.details = details;
  }
}
module.exports = {
  BumpVersionError,
  isBumpVersionError: (error) => error instanceof BumpVersionError,
};
