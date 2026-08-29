import {
  asRecord,
  buildStrategySignature,
  extractTradingViewMetrics,
  hashString,
  normalisePineInputs,
  stableStringify,
  type RawStudyInput,
  type UnknownRecord,
} from '../lib/tradingview/parsers';

import { extractClosedTrades } from '../lib/tradingview/trades';

import {
  configureDeepBacktestRange,
  deepBacktestingCapability,
  ensureStrategyTester,
  isDeepBacktestingActive,
  readVisibleStrategyReportMetrics,
  resetToChartSession,
} from '../lib/tradingview/page-report';

type StudyInputValue = RawStudyInput;

interface StudyLike {
  id?: string;
  name?: string;
  title?: string;
  getStudyMeta?: () => UnknownRecord;
  getInputValues?: () => StudyInputValue[];
  setInputValues?: (values: StudyInputValue[]) => void;
}

interface ChartLike {
  symbol?: () => string;
  resolution?: () => string;
  getAllStudies?: () => StudyLike[];
  getStudyById?: (id: string) => StudyLike | null;
  _chartWidget?: {
    model?: () => {
      model?: () => {
        dataSources?: () => unknown[];
        activeStrategySource?: () => unknown;
      };
    };
  };
}

interface TradingViewApiLike {
  _activeChartWidgetWV?: {
    value?: () => ChartLike;
  };
}

interface BridgeRequest {
  id: string;
  action: string;
  payload?: unknown;
}

const REQUEST_EVENT = 'tvopt:request';
const RESPONSE_EVENT = 'tvopt:response';

const reportObjectIds = new WeakMap<object, number>();
let nextReportObjectId = 1;

const reportObjectId = (value: unknown): number | null => {
  if (value === null || typeof value !== 'object') return null;

  const object = value as object;
  const existing = reportObjectIds.get(object);
  if (existing !== undefined) return existing;

  const id = nextReportObjectId;
  nextReportObjectId += 1;
  reportObjectIds.set(object, id);
  return id;
};

const readMeta = (study: StudyLike): UnknownRecord => {
  try {
    return asRecord(study.getStudyMeta?.());
  } catch {
    return {};
  }
};

const metaName = (meta: UnknownRecord): string | undefined => {
  for (const key of ['description', 'shortDescription', 'shortId', 'name', 'title']) {
    const value = meta[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
};

const isStrategyMeta = (meta: UnknownRecord): boolean =>
  meta.isTVScriptStrategy === true || meta.is_strategy === true;

const getChart = (): ChartLike => {
  const api = (window as typeof window & { TradingViewApi?: TradingViewApiLike }).TradingViewApi;
  const chart = api?._activeChartWidgetWV?.value?.();
  if (!chart) {
    throw new Error('TradingView chart API is not ready yet');
  }
  return chart;
};

const detectStrategies = () => {
  const chart = getChart();
  const found = new Map<
    string,
    { id: string; name: string; shortTitle?: string }
  >();

  // Primary path: TradingView's chart model exposes the actual strategy data
  // sources. This is more reliable than inferring strategy-ness from legend DOM
  // or from the public study wrapper.
  try {
    const sources = chart._chartWidget?.model?.()?.model?.()?.dataSources?.() ?? [];

    for (const source of sources) {
      const candidate = source as {
        id?: string | (() => string);
        metaInfo?: () => UnknownRecord;
        reportData?: () => unknown;
      };

      let meta: UnknownRecord = {};
      try {
        meta = asRecord(candidate.metaInfo?.());
      } catch {
        meta = {};
      }

      const isStrategy =
        isStrategyMeta(meta) || typeof candidate.reportData === 'function';
      if (!isStrategy) continue;

      const rawId =
        typeof candidate.id === 'function' ? candidate.id() : candidate.id;
      const name = metaName(meta);

      if (typeof rawId !== 'string' || !rawId || !name) continue;

      found.set(rawId, {
        id: rawId,
        name,
        ...(typeof meta.shortDescription === 'string'
          ? { shortTitle: meta.shortDescription }
          : {}),
      });
    }
  } catch {
    // Fall through to the public study wrapper below.
  }

  // Fallback for TradingView builds where the internal data-source path changes.
  for (const study of chart.getAllStudies?.() ?? []) {
    const meta = readMeta(study);
    const name =
      metaName(meta) ??
      (typeof study.name === 'string' ? study.name : undefined) ??
      (typeof study.title === 'string' ? study.title : undefined);

    if (!study.id || !name || !isStrategyMeta(meta)) continue;

    found.set(study.id, {
      id: study.id,
      name,
      ...(typeof meta.shortDescription === 'string'
        ? { shortTitle: meta.shortDescription }
        : {}),
    });
  }

  return [...found.values()];
};

const getInternalStudyMeta = (
  chart: ChartLike,
  strategyId: string,
): UnknownRecord => {
  try {
    const sources = chart._chartWidget?.model?.()?.model?.()?.dataSources?.() ?? [];

    for (const source of sources) {
      const candidate = source as {
        id?: string | (() => string);
        metaInfo?: () => UnknownRecord;
      };

      const rawId =
        typeof candidate.id === 'function' ? candidate.id() : candidate.id;
      if (rawId !== strategyId) continue;

      try {
        return asRecord(candidate.metaInfo?.());
      } catch {
        return {};
      }
    }
  } catch {
    // The public study metadata below remains a fallback.
  }

  return {};
};

const readStrategyInputs = (strategyId: string) => {
  const chart = getChart();
  const study = chart.getStudyById?.(strategyId);
  if (!study) throw new Error('TradingView strategy is no longer on the chart');
  if (typeof study.getInputValues !== 'function') {
    throw new Error('TradingView does not expose inputs for this strategy');
  }

  const current = study.getInputValues();
  const publicMeta = readMeta(study);
  const internalMeta = getInternalStudyMeta(chart, strategyId);
  const declaredInputs = [
    ...(Array.isArray(publicMeta.inputs) ? publicMeta.inputs : []),
    ...(Array.isArray(internalMeta.inputs) ? internalMeta.inputs : []),
  ];

  return normalisePineInputs(current, declaredInputs);
};

const applyParameters = (
  strategyId: string,
  parameters: Record<string, unknown>,
) => {
  const chart = getChart();
  const study = chart.getStudyById?.(strategyId);
  if (!study) throw new Error('TradingView strategy is no longer on the chart');
  if (
    typeof study.getInputValues !== 'function' ||
    typeof study.setInputValues !== 'function'
  ) {
    throw new Error('TradingView does not expose writable inputs for this strategy');
  }

  const current = study.getInputValues();
  const known = new Set(current.map((input) => input.id));
  const unknown = Object.keys(parameters).filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error('Unknown TradingView input(s): ' + unknown.join(', '));
  }

  const updated = current.map((input) =>
    Object.prototype.hasOwnProperty.call(parameters, input.id)
      ? { ...input, value: parameters[input.id] }
      : input,
  );

  study.setInputValues(updated);

  const after = study.getInputValues();
  const confirmed: Record<string, unknown> = {};
  for (const input of after) {
    if (Object.prototype.hasOwnProperty.call(parameters, input.id)) {
      confirmed[input.id] = input.value;
    }
  }

  for (const [id, requested] of Object.entries(parameters)) {
    const actual = confirmed[id];
    if (JSON.stringify(actual) !== JSON.stringify(requested)) {
      throw new Error(
        'TradingView rejected input ' +
          id +
          ': requested ' +
          JSON.stringify(requested) +
          ', got ' +
          JSON.stringify(actual),
      );
    }
  }

  return { confirmed };
};

const getStrategySource = (
  chart: ChartLike,
  strategyId: string,
): {
  id?: string | (() => string);
  metaInfo?: () => UnknownRecord;
  reportData?: () => unknown;
} | null => {
  try {
    const model = chart._chartWidget?.model?.()?.model?.();
    if (!model) return null;

    // Current TradingView builds expose the selected strategy through a watched
    // activeStrategySource value. Prefer it because dataSources() can retain a
    // stale strategy/report object after removal or replacement.
    if (typeof model.activeStrategySource === 'function') {
      const watched = model.activeStrategySource();
      const active = unwrapValue(watched) as
        | {
            id?: string | (() => string);
            metaInfo?: () => UnknownRecord;
            reportData?: () => unknown;
          }
        | null;

      if (active) {
        const activeId =
          typeof active.id === 'function' ? active.id() : active.id;

        if (activeId === strategyId) return active;

        // When TradingView explicitly reports a different active strategy, do
        // not fall back to a cached data source belonging to the old one.
        if (typeof activeId === 'string' && activeId) return null;
      }
    }

    const sources = model.dataSources?.() ?? [];
    for (const source of sources) {
      const candidate = source as {
        id?: string | (() => string);
        metaInfo?: () => UnknownRecord;
        reportData?: () => unknown;
      };
      const rawId =
        typeof candidate.id === 'function' ? candidate.id() : candidate.id;
      if (rawId === strategyId) return candidate;
    }
  } catch {
    return null;
  }

  return null;
};

const unwrapValue = (value: unknown): unknown => {
  const record = asRecord(value);
  if (typeof record.value === 'function') {
    try {
      return (record.value as () => unknown)();
    } catch {
      return null;
    }
  }
  return value;
};

const readStrategyMetrics = (strategyId: string) => {
  const chart = getChart();
  const source = getStrategySource(chart, strategyId);

  let internalMetrics: Record<string, number> | null = null;
  if (source && typeof source.reportData === 'function') {
    try {
      internalMetrics = extractTradingViewMetrics(
        unwrapValue(source.reportData()),
      );
    } catch {
      internalMetrics = null;
    }
  }

  const visibleMetrics =
    readVisibleStrategyReportMetrics();

  if (isDeepBacktestingActive() && visibleMetrics) {
    if (internalMetrics) {
      const comparableKeys = [
        'profitFactor',
        'totalTrades',
        'netProfitPercent',
        'maxDrawdownPercent',
        'sharpeRatio',
        'sortinoRatio',
      ];

      const disagrees = comparableKeys.some((key) => {
        const internal = internalMetrics?.[key];
        const visible = visibleMetrics[key];
        if (
          internal === undefined ||
          visible === undefined
        ) {
          return false;
        }

        const tolerance =
          Math.max(1, Math.abs(visible)) * 1.0e-6;
        return Math.abs(internal - visible) > tolerance;
      });

      if (!disagrees) {
        return {
          ...internalMetrics,
          ...visibleMetrics,
        };
      }
    }

    // A disagreement means reportData() is still describing the regular
    // chart session. Never contaminate a Deep Backtesting trial with it.
    return visibleMetrics;
  }

  return internalMetrics ?? visibleMetrics;
};

const readStrategyClosedTrades = (
  strategyId: string,
) => {
  const chart = getChart();
  const source = getStrategySource(
    chart,
    strategyId,
  );

  if (
    !source ||
    typeof source.reportData !== 'function'
  ) {
    return {
      available: false,
      trades: [],
      reason:
        'TradingView strategy report source is unavailable',
    };
  }

  try {
    return extractClosedTrades(
      unwrapValue(source.reportData()),
    );
  } catch (error) {
    return {
      available: false,
      trades: [],
      reason:
        error instanceof Error
          ? error.message
          : String(error),
    };
  }
};

const readStrategyReportSnapshot = (strategyId: string) => {
  const chart = getChart();
  const source = getStrategySource(chart, strategyId);
  if (!source || typeof source.reportData !== 'function') {
    return {
      metrics: null,
      token: null,
      objectId: null,
      backtestRange: null,
      settingsSignature: null,
      error: 'TradingView strategy report source is unavailable',
    };
  }

  let rawReport: unknown;
  try {
    rawReport = unwrapValue(source.reportData());
  } catch (error) {
    return {
      metrics: null,
      token: null,
      objectId: null,
      backtestRange: null,
      settingsSignature: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const objectId = reportObjectId(rawReport);
  const report = asRecord(rawReport);
  const runtimeError =
    report.error ??
    report.runtimeError ??
    report.errorMessage ??
    report.message;

  const metrics = readStrategyMetrics(strategyId);
  const performance = asRecord(report.performance);
  const settings = asRecord(report.settings);
  const dateRange = asRecord(settings.dateRange);
  const backtest = asRecord(dateRange.backtest);

  const from =
    typeof backtest.from === 'number' && Number.isFinite(backtest.from)
      ? backtest.from
      : null;
  const to =
    typeof backtest.to === 'number' && Number.isFinite(backtest.to)
      ? backtest.to
      : null;

  const stableSettings = Object.fromEntries(
    Object.entries(settings).filter(
      ([key]) =>
        ![
          'dateRange',
          'inputs',
          'inputValues',
          'input_values',
          'parameters',
        ].includes(key),
    ),
  );
  const settingsSignature =
    Object.keys(stableSettings).length > 0
      ? hashString(stableStringify(stableSettings))
      : null;

  const revisionFields: UnknownRecord = {};
  for (const key of [
    'calculationId',
    'calculation_id',
    'reportId',
    'report_id',
    'updatedAt',
    'lastUpdate',
    'status',
    'state',
    'from',
    'to',
    'startTime',
    'endTime',
  ]) {
    if (key in report) revisionFields[key] = report[key];
  }

  const token = hashString(
    stableStringify({
      revisionFields,
      performance,
      metrics,
      objectId,
      backtestRange: { from, to },
      settingsSignature,
      deepBacktesting: isDeepBacktestingActive(),
    }),
  );

  return {
    metrics,
    token,
    objectId,
    backtestRange:
      from !== null && to !== null
        ? { from, to }
        : null,
    settingsSignature,
    error:
      typeof runtimeError === 'string' && runtimeError.trim()
        ? runtimeError.trim()
        : null,
  };
};

const getStrategySignature = (strategyId: string): string => {
  const chart = getChart();
  const study = chart.getStudyById?.(strategyId);
  if (!study) throw new Error('TradingView strategy is no longer on the chart');

  return buildStrategySignature(
    readMeta(study),
    getInternalStudyMeta(chart, strategyId),
    study.name ?? study.title ?? null,
    readStrategyInputs(strategyId),
  );
};

const runDiagnostics = (strategyId: string | null) => {
  const checks: Array<{
    id: string;
    label: string;
    ok: boolean;
    detail?: string;
  }> = [];

  let chart: ChartLike | null = null;
  try {
    chart = getChart();
    checks.push({ id: 'chart-api', label: 'TradingView chart API', ok: true });
  } catch (error) {
    checks.push({
      id: 'chart-api',
      label: 'TradingView chart API',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  if (!chart) return { checks, deepBacktesting: deepBacktestingCapability() };

  const strategies = detectStrategies();
  checks.push({
    id: 'strategy-detection',
    label: 'Strategy detection',
    ok: strategies.length > 0,
    detail:
      strategies.length > 0
        ? strategies.length + ' strategy source(s) found'
        : 'No Pine strategy sources found',
  });

  if (strategyId) {
    try {
      const inputs = readStrategyInputs(strategyId);
      checks.push({
        id: 'inputs-readable',
        label: 'Readable Pine inputs',
        ok: inputs.length > 0,
        detail: inputs.length + ' user inputs',
      });
    } catch (error) {
      checks.push({
        id: 'inputs-readable',
        label: 'Readable Pine inputs',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    const study = chart.getStudyById?.(strategyId);
    checks.push({
      id: 'inputs-writable',
      label: 'Writable Pine inputs',
      ok: typeof study?.setInputValues === 'function',
    });

    const source = getStrategySource(chart, strategyId);
    checks.push({
      id: 'report-source',
      label: 'Strategy report source',
      ok: Boolean(source?.reportData),
    });

    const snapshot = readStrategyReportSnapshot(strategyId);
    checks.push({
      id: 'metrics-readable',
      label: 'Strategy Tester metrics',
      ok: Boolean(snapshot.metrics),
      ...(snapshot.error ? { detail: snapshot.error } : {}),
    });

    const tradeSnapshot =
      readStrategyClosedTrades(strategyId);
    checks.push({
      id: 'trade-level-data',
      label: 'Closed-trade data',
      ok: tradeSnapshot.available,
      detail: tradeSnapshot.available
        ? tradeSnapshot.trades.length +
          ' closed trades exposed'
        : tradeSnapshot.reason ??
          'Unavailable',
    });

    try {
      const signature = getStrategySignature(strategyId);
      checks.push({
        id: 'strategy-signature',
        label: 'Strategy signature',
        ok: Boolean(signature),
        detail: signature,
      });
    } catch (error) {
      checks.push({
        id: 'strategy-signature',
        label: 'Strategy signature',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    checks,
    deepBacktesting: deepBacktestingCapability(),
  };
};

const getChartContext = () => {
  const chart = getChart();
  return {
    symbol: chart.symbol?.() ?? 'UNKNOWN',
    timeframe: chart.resolution?.() ?? 'UNKNOWN',
  };
};

export default defineUnlistedScript(() => {
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement)) return;

  script.addEventListener(REQUEST_EVENT, async (event) => {
    if (!(event instanceof CustomEvent)) return;

    const request = event.detail as BridgeRequest;
    if (!request || typeof request.id !== 'string' || typeof request.action !== 'string') {
      return;
    }

    try {
      let result: unknown;

      switch (request.action) {
        case 'detectStrategies':
          result = detectStrategies();
          break;
        case 'readStrategyInputs': {
          const payload = asRecord(request.payload);
          if (typeof payload.strategyId !== 'string') {
            throw new Error('strategyId is required');
          }
          result = readStrategyInputs(payload.strategyId);
          break;
        }
        case 'applyParameters': {
          const payload = asRecord(request.payload);
          if (typeof payload.strategyId !== 'string') {
            throw new Error('strategyId is required');
          }
          result = applyParameters(
            payload.strategyId,
            asRecord(payload.parameters),
          );
          break;
        }
        case 'readMetrics': {
          const payload = asRecord(request.payload);
          if (typeof payload.strategyId !== 'string') {
            throw new Error('strategyId is required');
          }
          result = readStrategyMetrics(payload.strategyId);
          break;
        }
        case 'readReportSnapshot': {
          const payload = asRecord(request.payload);
          if (typeof payload.strategyId !== 'string') {
            throw new Error('strategyId is required');
          }
          result = readStrategyReportSnapshot(payload.strategyId);
          break;
        }
        case 'readClosedTrades': {
          const payload = asRecord(request.payload);
          if (typeof payload.strategyId !== 'string') {
            throw new Error('strategyId is required');
          }
          result = readStrategyClosedTrades(
            payload.strategyId,
          );
          break;
        }
        case 'getStrategySignature': {
          const payload = asRecord(request.payload);
          if (typeof payload.strategyId !== 'string') {
            throw new Error('strategyId is required');
          }
          result = getStrategySignature(payload.strategyId);
          break;
        }
        case 'getBacktestMode':
          result = isDeepBacktestingActive() ? 'deep' : 'chart';
          break;
        case 'resetToChartSession':
          result = await resetToChartSession();
          break;
        case 'configureDeepBacktestRange': {
          const payload = asRecord(request.payload);
          if (
            typeof payload.startDate !== 'string' ||
            typeof payload.endDate !== 'string'
          ) {
            throw new Error('startDate and endDate are required');
          }
          result = await configureDeepBacktestRange(
            payload.startDate,
            payload.endDate,
          );
          break;
        }
        case 'diagnostics': {
          const payload = asRecord(request.payload);
          result = runDiagnostics(
            typeof payload.strategyId === 'string'
              ? payload.strategyId
              : null,
          );
          break;
        }
        case 'ensureStrategyTester':
          result = ensureStrategyTester();
          break;
        case 'getChartContext':
          result = getChartContext();
          break;
        default:
          throw new Error('Unknown TradingView bridge action: ' + request.action);
      }

      script.dispatchEvent(
        new CustomEvent(RESPONSE_EVENT, {
          detail: { id: request.id, ok: true, result },
        }),
      );
    } catch (error) {
      script.dispatchEvent(
        new CustomEvent(RESPONSE_EVENT, {
          detail: {
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          },
        }),
      );
    }
  });
});
