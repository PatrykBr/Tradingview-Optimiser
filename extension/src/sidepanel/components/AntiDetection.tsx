import { useOptimizationStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import PanelCardHeader from './PanelCardHeader';
import { parseIntegerOr } from '../utils/number';

const ANTI_DETECTION_ENABLED_ID = 'anti-detection-enabled';
const ANTI_DETECTION_MIN_DELAY_ID = 'anti-detection-min-delay';
const ANTI_DETECTION_MAX_DELAY_ID = 'anti-detection-max-delay';

export default function AntiDetection() {
  const { antiDetection, setAntiDetection } = useOptimizationStore(
    useShallow((s) => ({
      antiDetection: s.antiDetection,
      setAntiDetection: s.setAntiDetection,
    })),
  );

  return (
    <div className="panel-card overflow-hidden">
      <PanelCardHeader
        title="Anti-Detection"
        icon={
          <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
            />
          </svg>
        }
        right={
          <label htmlFor={ANTI_DETECTION_ENABLED_ID} className="relative inline-flex cursor-pointer items-center">
            <span className="sr-only">Enable anti-detection</span>
            <input
              id={ANTI_DETECTION_ENABLED_ID}
              type="checkbox"
              checked={antiDetection.enabled}
              onChange={(e) => setAntiDetection({ ...antiDetection, enabled: e.target.checked })}
              className="sr-only peer"
            />
            <div aria-hidden="true" className="ui-toggle-track" />
          </label>
        }
      />

      {antiDetection.enabled && (
        <div className="panel-card-body panel-stack">
          <div className="panel-field">
            <div className="flex items-center justify-between">
              <label htmlFor={ANTI_DETECTION_MIN_DELAY_ID} className="ui-field-label">
                Min Delay
              </label>
              <span className="rounded-md border border-border/50 bg-bg-tertiary/75 px-2 py-0.5 text-[12px] font-mono text-text-secondary">
                {antiDetection.minDelay}ms
              </span>
            </div>
            <input
              id={ANTI_DETECTION_MIN_DELAY_ID}
              type="range"
              min={100}
              max={5000}
              step={100}
              value={antiDetection.minDelay}
              onChange={(e) => {
                const nextMinDelay = parseIntegerOr(e.target.value, antiDetection.minDelay);
                setAntiDetection({
                  ...antiDetection,
                  minDelay: nextMinDelay,
                  maxDelay: Math.max(nextMinDelay, antiDetection.maxDelay),
                });
              }}
              className="w-full"
            />
            <div className="flex justify-between">
              <span className="text-[10px] text-text-muted">100ms</span>
              <span className="text-[10px] text-text-muted">5000ms</span>
            </div>
          </div>

          <div className="panel-field panel-divider">
            <div className="flex items-center justify-between">
              <label htmlFor={ANTI_DETECTION_MAX_DELAY_ID} className="ui-field-label">
                Max Delay
              </label>
              <span className="rounded-md border border-border/50 bg-bg-tertiary/75 px-2 py-0.5 text-[12px] font-mono text-text-secondary">
                {antiDetection.maxDelay}ms
              </span>
            </div>
            <input
              id={ANTI_DETECTION_MAX_DELAY_ID}
              type="range"
              min={100}
              max={10000}
              step={100}
              value={antiDetection.maxDelay}
              onChange={(e) => {
                const nextMaxDelay = parseIntegerOr(e.target.value, antiDetection.maxDelay);
                setAntiDetection({
                  ...antiDetection,
                  maxDelay: nextMaxDelay,
                  minDelay: Math.min(antiDetection.minDelay, nextMaxDelay),
                });
              }}
              className="w-full"
            />
            <div className="flex justify-between">
              <span className="text-[10px] text-text-muted">100ms</span>
              <span className="text-[10px] text-text-muted">10000ms</span>
            </div>
          </div>

          <p className="ui-note">
            Random delays between actions to mimic human behavior and avoid detection.
          </p>
        </div>
      )}
    </div>
  );
}
