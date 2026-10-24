export interface SerializedOptimiserError {
  code: string;
  message: string;
  retryable: boolean;
}

export class OptimiserError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = 'OptimiserError';
    this.code = code;
    this.retryable = retryable;
  }
}

const messageFor = (cause: unknown): string =>
  cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : String(cause);

export const toOptimiserError = (
  cause: unknown,
  fallbackCode = 'INTERNAL_ERROR',
  fallbackRetryable = false,
): OptimiserError => {
  if (cause instanceof OptimiserError) {
    return cause;
  }

  const message = messageFor(cause);

  // Browsers report extension replacement as an error message without a code.
  // Convert that message to a typed error here.
  if (/extension context invalidated/i.test(message)) {
    return new OptimiserError(
      'EXTENSION_CONTEXT_INVALIDATED',
      message || 'Extension context invalidated',
      true,
    );
  }

  return new OptimiserError(fallbackCode, message, fallbackRetryable);
};

export const serialiseOptimiserError = (
  cause: unknown,
  fallbackCode = 'INTERNAL_ERROR',
  fallbackRetryable = false,
): SerializedOptimiserError => {
  const error = toOptimiserError(cause, fallbackCode, fallbackRetryable);

  return {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
  };
};

export const isOptimiserErrorCode = (cause: unknown, ...codes: string[]): boolean =>
  cause instanceof OptimiserError && codes.includes(cause.code);

export const combineFailures = (
  primary: unknown,
  secondary: unknown,
  message: string,
): OptimiserError => {
  const primaryError = toOptimiserError(primary);
  const secondaryError = toOptimiserError(secondary);

  return new OptimiserError(
    'CLEANUP_FAILED',
    message +
      ': ' +
      primaryError.message +
      '. Cleanup/restoration also failed: ' +
      secondaryError.message,
    primaryError.retryable || secondaryError.retryable,
  );
};
