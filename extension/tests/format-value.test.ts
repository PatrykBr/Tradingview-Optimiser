import { describe, expect, it } from 'bun:test';
import { formatValue } from '../lib/format-value';
import { toOptimiserError } from '../lib/errors';

describe('unknown value display', () => {
  it('preserves scalar values and serializes structured parameters', () => {
    expect(formatValue(false)).toBe('false');
    expect(formatValue(0)).toBe('0');
    expect(formatValue(null)).toBe('null');
    expect(formatValue(undefined)).toBe('undefined');
    expect(formatValue('text')).toBe('text');
    expect(formatValue({ period: 14, modes: ['fast', 'slow'] })).toBe(
      '{"period":14,"modes":["fast","slow"]}',
    );
    expect(formatValue({ count: 12n })).toBe('{"count":"12"}');
  });

  it('keeps diagnostics usable for cyclic objects and custom JSON serializers', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(formatValue(cyclic)).toBe('[Unserializable value]');
    expect(formatValue({ toJSON: () => undefined })).toBe('[Unserializable value]');
  });

  it('retains structured error details and native error messages', () => {
    expect(toOptimiserError({ reason: 'disconnected', attempt: 3 }).message).toBe(
      '{"reason":"disconnected","attempt":3}',
    );
    expect(toOptimiserError(new Error('original message')).message).toBe('original message');
  });
});
