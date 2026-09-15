export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function asSafeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError("Unexpected server error", "INTERNAL_ERROR", 500);
}
