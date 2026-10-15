import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  isExtensionContextInvalidated,
} from '../lib/extension-context';

describe('extension context recovery', () => {
  it('detects Chrome invalidated-context errors', () => {
    expect(
      isExtensionContextInvalidated(
        new Error('Extension context invalidated.'),
      ),
    ).toBe(true);

    expect(
      isExtensionContextInvalidated(
        'Uncaught Error: Extension context invalidated.',
      ),
    ).toBe(true);
  });

  it('does not classify unrelated extension errors as invalidation', () => {
    expect(
      isExtensionContextInvalidated(
        new Error('Backend is not connected'),
      ),
    ).toBe(false);

    expect(
      isExtensionContextInvalidated(undefined),
    ).toBe(false);
  });
});
