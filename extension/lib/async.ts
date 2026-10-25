import { combineFailures } from './errors';

/** Operations sharing a TradingView chart must finish before the next one starts. */
export const forEachSequential = <T>(
  values: Iterable<T>,
  visit: (value: T, index: number) => Promise<void>,
): Promise<void> =>
  Array.from(values).reduce<Promise<void>>(
    (previous, value, index) => previous.then(() => visit(value, index)),
    Promise.resolve(),
  );

/** Always clean up, preserving both failures when the operation and cleanup fail. */
export const withCleanup = async <T>(
  operation: () => Promise<T>,
  cleanup: () => Promise<void>,
  failureMessage: string,
): Promise<T> => {
  let outcome: { ok: true; value: T } | { ok: false; cause: unknown };
  try {
    outcome = { ok: true, value: await operation() };
  } catch (cause) {
    outcome = { ok: false, cause };
  }

  try {
    await cleanup();
  } catch (cause) {
    if (!outcome.ok) throw combineFailures(outcome.cause, cause, failureMessage);
    throw cause;
  }

  if (!outcome.ok) throw outcome.cause;
  return outcome.value;
};
