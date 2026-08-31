import type {
  DeepBacktestResult,
  TradingViewMetrics,
} from './types';

const normaliseText = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

const parseUiNumber = (
  value: string,
  preferPercent = false,
): number | undefined => {
  const matches = value.match(
    /[−-]?\d[\d\s,.]*(?:\.\d+)?%?/g,
  );
  if (!matches) return undefined;

  const candidates = matches
    .map((raw) => {
      const percent = raw.includes('%');
      const cleaned = raw
        .replace(/−/g, '-')
        .replace(/%/g, '')
        .replace(/\s/g, '');

      let normalised = cleaned;
      if (cleaned.includes(',') && cleaned.includes('.')) {
        normalised = cleaned.replace(/,/g, '');
      } else if (
        cleaned.includes(',') &&
        !cleaned.includes('.')
      ) {
        const parts = cleaned.split(',');
        normalised =
          parts.at(-1)?.length === 3
            ? cleaned.replace(/,/g, '')
            : cleaned.replace(',', '.');
      }

      const numeric = Number(normalised);
      return Number.isFinite(numeric)
        ? { numeric, percent }
        : null;
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
    : candidates.find((candidate) => !candidate.percent) ??
      candidates[0];

  return preferred?.numeric;
};

const findClickableByText = (
  pattern: RegExp,
): HTMLElement | null => {
  const candidates = document.querySelectorAll<HTMLElement>(
    'button, [role="button"], [role="tab"]',
  );

  for (const candidate of candidates) {
    if (candidate.offsetParent === null) continue;

    const text = normaliseText(
      candidate.textContent ??
        candidate.getAttribute('aria-label') ??
        '',
    );
    if (pattern.test(text)) return candidate;
  }

  return null;
};

const findVisibleMetricValue = (
  labels: RegExp[],
  preferPercent = false,
): number | undefined => {
  const elements = document.querySelectorAll<HTMLElement>(
    'span, div, td, th',
  );

  for (const element of elements) {
    if (element.offsetParent === null) continue;

    const ownText = normaliseText(element.textContent ?? '');
    if (
      ownText.length > 80 ||
      !labels.some((pattern) => pattern.test(ownText))
    ) {
      continue;
    }

    let container: HTMLElement | null = element;
    for (let depth = 0; depth < 4 && container; depth += 1) {
      const text = normaliseText(container.textContent ?? '');
      const withoutLabel = labels.reduce(
        (current, pattern) =>
          current.replace(pattern, ' '),
        text,
      );
      const value = parseUiNumber(
        withoutLabel,
        preferPercent,
      );
      if (value !== undefined) return value;
      container = container.parentElement;
    }
  }

  return undefined;
};

export const readVisibleStrategyReportMetrics =
  (): TradingViewMetrics | null => {
    const metrics: TradingViewMetrics = {};
    const put = (
      key: string,
      value: number | undefined,
    ) => {
      if (value !== undefined) metrics[key] = value;
    };

    put(
      'profitFactor',
      findVisibleMetricValue([/^profit factor$/i]),
    );
    put(
      'totalTrades',
      findVisibleMetricValue([/^total trades$/i]),
    );
    put(
      'percentProfitable',
      findVisibleMetricValue(
        [
          /^profitable trades$/i,
          /^percent profitable$/i,
        ],
        true,
      ),
    );
    put(
      'netProfitPercent',
      findVisibleMetricValue(
        [/^total p&l$/i, /^net profit$/i],
        true,
      ),
    );
    put(
      'maxDrawdownPercent',
      findVisibleMetricValue(
        [
          /^max equity drawdown$/i,
          /^max(?:imum)? drawdown$/i,
        ],
        true,
      ),
    );
    put(
      'sharpeRatio',
      findVisibleMetricValue([/^sharpe ratio$/i]),
    );
    put(
      'sortinoRatio',
      findVisibleMetricValue([/^sortino ratio$/i]),
    );

    for (const [key, value] of Object.entries(metrics)) {
      metrics['tv.visible.' + key] = value;
    }

    return Object.keys(metrics).length > 0
      ? metrics
      : null;
  };

export const isDeepBacktestingActive = (): boolean =>
  findClickableByText(/reset to chart session/i) !== null;

export const deepBacktestingCapability = () => {
  const button = findClickableByText(/deep backtesting/i);

  return {
    available: button !== null,
    reason:
      button === null
        ? 'Deep Backtesting control was not found. It may be unavailable on this TradingView plan or build.'
        : null,
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

  try {
    if (
      typeof tradingView?.bottomWidgetBar?.showWidget ===
      'function'
    ) {
      tradingView.bottomWidgetBar.showWidget('backtesting');
      return true;
    }

    const button = findClickableByText(
      /strategy (?:tester|report)/i,
    );
    if (button) {
      button.click();
      return true;
    }

    return false;
  } catch {
    return false;
  }
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const resetToChartSession = async () => {
  ensureStrategyTester();
  await sleep(150);

  const resetButton = findClickableByText(
    /reset to chart session/i,
  );
  if (!resetButton) {
    return { reset: true, changed: false };
  }

  resetButton.click();
  await sleep(250);
  return { reset: true, changed: true };
};

const setNativeInputValue = (
  input: HTMLInputElement,
  value: string,
): void => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;

  if (setter) setter.call(input, value);
  else input.value = value;

  input.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: value,
    }),
  );
  input.dispatchEvent(
    new Event('change', { bubbles: true }),
  );
  input.blur();
};

const visibleDateInputs = (): HTMLInputElement[] => {
  const candidates = [
    ...document.querySelectorAll<HTMLInputElement>('input'),
  ];

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

export const refreshDeepBacktestReport =
  async (): Promise<DeepBacktestResult> => {
    ensureStrategyTester();
    await sleep(100);

    let updateButton = findClickableByText(
      /generate report|update report|apply|calculate/i,
    );

    if (!updateButton) {
      const deepButton = findClickableByText(
        /deep backtesting/i,
      );
      if (!deepButton) {
        return {
          supported: false,
          applied: false,
          reason:
            'Deep Backtesting is not available in the current TradingView interface.',
        };
      }

      deepButton.click();
      await sleep(180);
      updateButton = findClickableByText(
        /generate report|update report|apply|calculate/i,
      );
    }

    if (!updateButton) {
      return {
        supported: true,
        applied: false,
        reason:
          'Could not locate the Deep Backtesting report button.',
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
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(endDate)
  ) {
    throw new Error(
      'Backtest dates must use YYYY-MM-DD',
    );
  }

  if (startDate >= endDate) {
    throw new Error(
      'Backtest start date must be before the end date',
    );
  }

  ensureStrategyTester();
  await sleep(250);

  const deepButton = findClickableByText(
    /deep backtesting/i,
  );
  if (!deepButton) {
    return {
      supported: false,
      applied: false,
      reason:
        'Deep Backtesting is not available in the current TradingView interface.',
    };
  }

  deepButton.click();
  await sleep(350);

  const inputs = visibleDateInputs();
  if (inputs.length < 2) {
    return {
      supported: true,
      applied: false,
      reason:
        'Could not locate TradingView Deep Backtesting date fields.',
    };
  }

  setNativeInputValue(inputs[0]!, startDate);
  setNativeInputValue(inputs[1]!, endDate);
  await sleep(100);

  const updateButton = findClickableByText(
    /generate report|update report|apply|calculate/i,
  );
  if (!updateButton) {
    return {
      supported: true,
      applied: false,
      reason:
        'Could not locate the Deep Backtesting report button.',
    };
  }

  updateButton.click();

  return {
    supported: true,
    applied: true,
    reason: null,
  };
};
