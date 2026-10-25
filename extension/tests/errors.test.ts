import { describe, expect, it } from 'bun:test';

import { toOptimiserError } from '../lib/errors';

describe('extension errors', () => {
  it('detects Chrome invalidated-context errors', () => {
    expect(toOptimiserError(new Error('Extension context invalidated.'))).toMatchObject({
      code: 'EXTENSION_CONTEXT_INVALIDATED',
      retryable: true,
    });

    expect(toOptimiserError('Uncaught Error: Extension context invalidated.')).toMatchObject({
      code: 'EXTENSION_CONTEXT_INVALIDATED',
      retryable: true,
    });
  });

  it('does not classify unrelated extension errors as invalidation', () => {
    expect(toOptimiserError(new Error('Backend is not connected'))).not.toMatchObject({
      code: 'EXTENSION_CONTEXT_INVALIDATED',
    });

    expect(toOptimiserError(undefined)).not.toMatchObject({
      code: 'EXTENSION_CONTEXT_INVALIDATED',
    });
  });
});
