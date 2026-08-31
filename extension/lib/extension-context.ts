const INVALIDATED_CONTEXT_PATTERN =
  /extension context invalidated/i;

const messageFor = (
  cause: unknown,
): string =>
  cause instanceof Error
    ? cause.message
    : typeof cause === 'string'
      ? cause
      : '';

export const isExtensionContextInvalidated = (
  cause: unknown,
): boolean =>
  INVALIDATED_CONTEXT_PATTERN.test(
    messageFor(cause),
  );
