import { describe, expect, it } from 'vitest';
import { parseBackendIncomingMessage } from './protocol';

const MAX_BYTES = 1024 * 4;

describe('parseBackendIncomingMessage', () => {
  it('parses delete_ack payloads with required fields', () => {
    const parsed = parseBackendIncomingMessage(
      JSON.stringify({
        request_id: 'delete_1',
        type: 'delete_ack',
        deleted: 'study_family',
        target: 'my_family',
      }),
      MAX_BYTES,
    );

    expect(parsed).toEqual({
      request_id: 'delete_1',
      type: 'delete_ack',
      deleted: 'study_family',
      target: 'my_family',
    });
  });

  it('rejects malformed delete_ack payloads', () => {
    expect(() =>
      parseBackendIncomingMessage(
        JSON.stringify({
          request_id: 'delete_2',
          type: 'delete_ack',
          deleted: 'family',
          target: 'x',
        }),
        MAX_BYTES,
      ),
    ).toThrow('Invalid delete_ack payload');
  });

  it('keeps request_id optional for backend error messages', () => {
    const parsed = parseBackendIncomingMessage(
      JSON.stringify({
        type: 'error',
        message: 'backend unavailable',
      }),
      MAX_BYTES,
    );

    expect(parsed).toEqual({
      type: 'error',
      request_id: undefined,
      message: 'backend unavailable',
    });
  });
});
