export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function toAppError(error) {
  if (error instanceof AppError) return error;
  return new AppError(500, "internal_error", "予期しないエラーが発生しました");
}
