import { errorMessage, OptimiserError } from '../errors';
import type { DeepBacktestResult, TradingViewMetrics } from './types';

const normaliseText = (value: string): string => value.replaceAll(/\s+/g, ' ').trim();

const parseUiNumber = (value: string, preferPercent = false): number | undefined => {
  const matches = value.match(/[−-]?\d[\d\s,.]*(?:\.\d+)?%?/g);
  if (!matches) return undefined;

  const candidates = matches
    .map((raw) => {
      const percent = raw.includes('%');
      const cleaned = raw.replaceAll('−', '-').replaceAll('%', '').replaceAll(/\s/g, '');

      let normalised = cleaned;
      if (cleaned.includes(',') && cleaned.includes('.')) {
        normalised = cleaned.replaceAll(',', '');
      } else if (cleaned.includes(',') && !cleaned.includes('.')) {
        const parts = cleaned.split(',');
        normalised =
          parts.at(-1)?.length === 3 ? cleaned.replaceAll(',', '') : cleaned.replace(',', '.');
      }

      const numeric = Number(normalised);
      return Number.isFinite(numeric) ? { numeric, percent } : null;
    })
    .filter(
      (
        candidate,
      ): candidate is {
        numeric: number;
        percent: boolean;
      } => candidate !== null,
    );

  const preferred = preferPercent
    ? candidates.find((candidate) => candidate.percent)
    : (candidates.find((candidate) => !candidate.percent) ?? candidates[0]);

  return preferred?.numeric;
};

const findClickableByText = (pattern: RegExp): HTMLElement | null => {
  const candidates = document.querySelectorAll<HTMLElement>(
    'button, [role="button"], [role="tab"]',
  );

  for (const candidate of candidates) {
    if (candidate.offsetParent === null) continue;

    const text = normaliseText(candidate.textContent ?? candidate.getAttribute('aria-label') ?? '');
    if (pattern.test(text)) return candidate;
  }

  return null;
};

interface VisibleMetricSpec {
  key: string;
  labels: RegExp[];
  preferPercent?: boolean;
}

const VISIBLE_METRIC_SPECS: VisibleMetricSpec[] = [
  {
    key: 'profitFactor',
    labels: [/^profit factor$/i],
  },
  {
    key: 'totalTrades',
    labels: [/^total trades$/i],
  },
  {
    key: 'percentProfitable',
    labels: [/^profitable trades$/i, /^percent profitable$/i],
    preferPercent: true,
  },
  {
    key: 'netProfitPercent',
    labels: [/^total p&l$/i, /^net profit$/i],
    preferPercent: true,
  },
  {
    key: 'maxDrawdownPercent',
    labels: [/^max equity drawdown$/i, /^max(?:imum)? drawdown$/i],
    preferPercent: true,
  },
  {
    key: 'sharpeRatio',
    labels: [/^sharpe ratio$/i],
  },
  {
    key: 'sortinoRatio',
    labels: [/^sortino ratio$/i],
  },
];

const cachedMetricLabels = new Map<string, HTMLElement>();

const readMetricFromLabel = (element: HTMLElement, spec: VisibleMetricSpec): number | undefined => {
  if (!element.isConnected || element.offsetParent === null) {
    cachedMetricLabels.delete(spec.key);
    return undefined;
  }

  let container: HTMLElement | null = element;
  for (let depth = 0; depth < 4 && container; depth += 1) {
    const text = normaliseText(container.textContent ?? '');
    const withoutLabel = spec.labels.reduce(
      (current, pattern) => current.replace(pattern, ' '),
      text,
    );
    const value = parseUiNumber(withoutLabel, spec.preferPercent ?? false);
    if (value !== undefined) return value;
    container = container.parentElement;
  }

  return undefined;
};

const matchVisibleMetric = (
  element: HTMLElement,
  ownText: string,
  unresolved: Map<string, VisibleMetricSpec>,
) => {
  for (const spec of unresolved.values()) {
    if (!spec.labels.some((pattern) => pattern.test(ownText))) {
      continue;
    }

    const value = readMetricFromLabel(element, spec);
    if (value === undefined) continue;

    return { spec, value };
  }
  return null;
};

const collectUncachedMetrics = (
  metrics: TradingViewMetrics,
  unresolved: Map<string, VisibleMetricSpec>,
): void => {
  const elements = document.querySelectorAll<HTMLElement>('span, div, td, th');

  for (const element of elements) {
    if (unresolved.size === 0) break;
    if (element.offsetParent === null) continue;

    const ownText = normaliseText(element.textContent ?? '');
    if (ownText.length > 80) continue;

    const match = matchVisibleMetric(element, ownText, unresolved);
    if (!match) continue;
    cachedMetricLabels.set(match.spec.key, element);
    metrics[match.spec.key] = match.value;
    unresolved.delete(match.spec.key);
  }
};

export const readVisibleStrategyReportMetrics = (): TradingViewMetrics | null => {
  const metrics: TradingViewMetrics = {};
  const unresolved = new Map(VISIBLE_METRIC_SPECS.map((spec) => [spec.key, spec] as const));

  // TradingView usually updates values without replacing their label nodes.
  // Reuse the nodes while polling. Scan again if a cached node is missing or stale.
  for (const spec of VISIBLE_METRIC_SPECS) {
    const cached = cachedMetricLabels.get(spec.key);
    if (!cached) continue;

    const value = readMetricFromLabel(cached, spec);
    if (value === undefined) continue;

    metrics[spec.key] = value;
    unresolved.delete(spec.key);
  }

  if (unresolved.size > 0) collectUncachedMetrics(metrics, unresolved);

  return Object.keys(metrics).length > 0 ? metrics : null;
};

export const isDeepBacktestingActive = (): boolean =>
  findClickableByText(/reset to chart session/i) !== null;

export const deepBacktestingCapability = () => {
  const active = isDeepBacktestingActive();
  const button = findClickableByText(/deep backtesting/i);
  const available = active || button !== null;

  return {
    available,
    reason: available
      ? null
      : 'Deep Backtesting control was not found. It may be unavailable on this TradingView plan or build.',
  };
};

export const ensureStrategyTester = (): boolean => {
  const tradingView = (
    window as typeof window & {
      TradingView?: {
        bottomWidgetBar?: {
          showWidget?: (name: string) => void;
        };
      };
    }
  ).TradingView;

  let apiFailure: unknown;

  if (typeof tradingView?.bottomWidgetBar?.showWidget === 'function') {
    try {
      tradingView.bottomWidgetBar.showWidget('backtesting');
      return true;
    } catch (cause) {
      apiFailure = cause;
    }
  }

  const button = findClickableByText(/strategy (?:tester|report)/i);
  if (button) {
    try {
      button.click();
      return true;
    } catch (cause) {
      throw new OptimiserError(
        'TV_STRATEGY_TESTER_UNAVAILABLE',
        'TradingView Strategy Tester button could not be activated: ' + errorMessage(cause),
      );
    }
  }

  if (apiFailure !== undefined) {
    throw new OptimiserError(
      'TV_STRATEGY_TESTER_UNAVAILABLE',
      'TradingView Strategy Tester API failed and no safe UI fallback was available: ' +
        errorMessage(apiFailure),
    );
  }

  return false;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitForValue = async <T>(
  read: () => T | null,
  timeoutMs: number,
  pollMs = 50,
): Promise<T | null> => {
  const immediate = read();
  if (immediate !== null) return immediate;

  const deadline = Date.now() + timeoutMs;
  const poll = async (): Promise<T | null> => {
    if (Date.now() >= deadline) return null;
    await sleep(pollMs);
    const value = read();
    return value ?? poll();
  };
  return poll();
};

const waitForClickable = (pattern: RegExp, timeoutMs: number): Promise<HTMLElement | null> =>
  waitForValue(() => findClickableByText(pattern), timeoutMs);

export const resetToChartSession = async () => {
  ensureStrategyTester();

  const resetButton = await waitForClickable(/reset to chart session/i, 300);
  if (!resetButton) {
    return { reset: true, changed: false };
  }

  resetButton.click();
  // Wait for the mode change within the timeout, then let the adapter validate
  // the run context. Continue as soon as TradingView changes mode.
  await waitForValue(
    () => (findClickableByText(/reset to chart session/i) === null ? true : null),
    700,
  );

  return { reset: true, changed: true };
};

const setNativeInputValue = (input: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

  if (setter) setter.call(input, value);
  else input.value = value;

  input.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: value,
    }),
  );
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.blur();
};

const visibleDateInputs = (): HTMLInputElement[] => {
  const candidates = [...document.querySelectorAll<HTMLInputElement>('input')];

  const score = (input: HTMLInputElement): number => {
    if (input.offsetParent === null) return -1;

    const text = [
      input.type,
      input.getAttribute('aria-label'),
      input.getAttribute('placeholder'),
      input.getAttribute('name'),
      input.closest('label')?.textContent,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    let value = 0;
    if (input.type === 'date') value += 20;
    if (/date|from|to|start|end/.test(text)) value += 10;
    return value;
  };

  return candidates
    .map((input) => ({ input, score: score(input) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .map(({ input }) => input);
};

const waitForDateInputs = async (timeoutMs: number): Promise<HTMLInputElement[] | null> =>
  waitForValue(() => {
    const inputs = visibleDateInputs();
    return inputs.length >= 2 ? inputs : null;
  }, timeoutMs);

const findReportButton = (): HTMLElement | null => {
  const specific = findClickableByText(/generate report|update report|calculate/i);
  if (specific) return specific;

  // Match "Apply" only while the Deep Backtesting date controls are visible.
  // Other page controls use the same label.
  return visibleDateInputs().length >= 2 ? findClickableByText(/^apply$/i) : null;
};

const waitForReportButton = (timeoutMs: number): Promise<HTMLElement | null> =>
  waitForValue(findReportButton, timeoutMs);

export const refreshDeepBacktestReport = async (): Promise<DeepBacktestResult> => {
  ensureStrategyTester();

  let updateButton = await waitForReportButton(120);

  if (!updateButton) {
    const deepButton = await waitForClickable(/deep backtesting/i, 300);
    if (!deepButton) {
      return {
        supported: false,
        applied: false,
        reason: 'Deep Backtesting is not available in the current TradingView interface.',
      };
    }

    deepButton.click();
    updateButton = await waitForReportButton(600);
  }

  if (!updateButton) {
    return {
      supported: true,
      applied: false,
      reason: 'Could not locate the Deep Backtesting report button.',
    };
  }

  updateButton.click();

  return {
    supported: true,
    applied: true,
    reason: null,
  };
};

export const configureDeepBacktestRange = async (
  startDate: string,
  endDate: string,
): Promise<DeepBacktestResult> => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error('Backtest dates must use YYYY-MM-DD');
  }

  if (startDate >= endDate) {
    throw new Error('Backtest start date must be before the end date');
  }

  ensureStrategyTester();

  const deepButton = await waitForClickable(/deep backtesting/i, 500);
  if (!deepButton) {
    return {
      supported: false,
      applied: false,
      reason: 'Deep Backtesting is not available in the current TradingView interface.',
    };
  }

  deepButton.click();

  const inputs = await waitForDateInputs(800);
  if (!inputs) {
    return {
      supported: true,
      applied: false,
      reason: 'Could not locate TradingView Deep Backtesting date fields.',
    };
  }

  setNativeInputValue(inputs[0]!, startDate);
  setNativeInputValue(inputs[1]!, endDate);

  const updateButton = await waitForReportButton(500);
  if (!updateButton) {
    return {
      supported: true,
      applied: false,
      reason: 'Could not locate the Deep Backtesting report button.',
    };
  }

  updateButton.click();

  return {
    supported: true,
    applied: true,
    reason: null,
  };
};
