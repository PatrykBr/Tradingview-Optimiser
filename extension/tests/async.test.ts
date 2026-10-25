import { describe, expect, it } from 'bun:test';
import { forEachSequential, withCleanup } from '../lib/async';

describe('shared async lifecycle', () => {
  it('waits for each chart operation before starting the next', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const running = forEachSequential([1, 2], async (value) => {
      events.push('start ' + value);
      if (value === 1) await first;
      events.push('finish ' + value);
    });
    await Promise.resolve();
    expect(events).toEqual(['start 1']);
    releaseFirst();
    await running;
    expect(events).toEqual(['start 1', 'finish 1', 'start 2', 'finish 2']);
  });

  it('stops scheduling chart operations after a failure', async () => {
    const visited: number[] = [];
    const failure = new Error('backtest failed');
    await expect(
      forEachSequential([1, 2, 3], async (value) => {
        visited.push(value);
        if (value === 2) throw failure;
      }),
    ).rejects.toBe(failure);
    expect(visited).toEqual([1, 2]);
  });

  it('waits for cleanup before returning a successful result', async () => {
    const events: string[] = [];
    const result = await withCleanup(
      async () => {
        events.push('operation');
        return 42;
      },
      async () => {
        events.push('cleanup');
      },
      'failed',
    );
    expect(result).toBe(42);
    expect(events).toEqual(['operation', 'cleanup']);
  });

  it('preserves the original failure when cleanup succeeds', async () => {
    const original = new Error('original failure');
    let cleaned = false;
    await expect(
      withCleanup(
        async () => {
          throw original;
        },
        async () => {
          cleaned = true;
        },
        'failed',
      ),
    ).rejects.toBe(original);
    expect(cleaned).toBe(true);
  });

  it('reports cleanup failure after a successful operation', async () => {
    const cleanup = new Error('cleanup failed');
    await expect(
      withCleanup(
        async () => 42,
        async () => {
          throw cleanup;
        },
        'failed',
      ),
    ).rejects.toBe(cleanup);
  });

  it('keeps both failure messages and retryability when cleanup also fails', async () => {
    await expect(
      withCleanup(
        async () => {
          throw new Error('backtest failed');
        },
        async () => {
          throw new Error('Extension context invalidated.');
        },
        'Research failed',
      ),
    ).rejects.toMatchObject({
      code: 'CLEANUP_FAILED',
      message:
        'Research failed: backtest failed. Cleanup/restoration also failed: Extension context invalidated.',
      retryable: true,
    });
  });
});
