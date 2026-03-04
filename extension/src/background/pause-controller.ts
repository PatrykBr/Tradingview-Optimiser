export interface PauseController {
  isPaused: () => boolean;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  waitForResume: () => Promise<void>;
  reset: () => void;
}

export function createPauseController(): PauseController {
  let paused = false;
  let pendingResolve: (() => void) | null = null;
  let pendingReject: ((reason?: unknown) => void) | null = null;

  const clearPending = () => {
    pendingResolve = null;
    pendingReject = null;
  };

  return {
    isPaused: () => paused,
    pause: () => {
      paused = true;
    },
    resume: () => {
      if (!paused) return;
      paused = false;
      if (pendingResolve) {
        pendingResolve();
        clearPending();
      }
    },
    stop: () => {
      paused = false;
      if (pendingReject) {
        pendingReject(new Error('Optimization stopped'));
        clearPending();
      }
    },
    waitForResume: () => {
      if (!paused) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve, reject) => {
        pendingResolve = resolve;
        pendingReject = reject;
      });
    },
    reset: () => {
      paused = false;
      clearPending();
    },
  };
}
