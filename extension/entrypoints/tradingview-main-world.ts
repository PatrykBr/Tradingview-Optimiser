type UnknownRecord = Record<string, unknown>;

interface StudyInputValue {
  id: string;
  value: unknown;
  name?: string;
  type?: string;
  options?: unknown[];
  values?: unknown[];
  min?: number;
  max?: number;
  minval?: number;
  maxval?: number;
  step?: number;
}

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

const asRecord = (value: unknown): UnknownRecord =>
  value !== null && typeof value === 'object' ? (value as UnknownRecord) : {};

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

const inferInputType = (
  meta: UnknownRecord,
  value: unknown,
):
  | 'integer'
  | 'float'
  | 'boolean'
  | 'categorical'
  | 'string'
  | 'time'
  | 'timeframe'
  | 'source'
  | 'unsupported' => {
  const declared = String(meta.type ?? meta.inputType ?? '').toLowerCase();
  const options = meta.options ?? meta.values;

  if (Array.isArray(options) && options.length > 0) return 'categorical';
  if (declared.includes('bool')) return 'boolean';
  if (declared.includes('integer') || declared === 'int') return 'integer';
  if (declared.includes('float')) return 'float';
  if (declared.includes('resolution') || declared.includes('timeframe')) return 'timeframe';
  if (declared.includes('source')) return 'source';
  if (declared.includes('time')) return 'time';
  if (declared.includes('string') || declared.includes('text')) return 'string';

  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'float';
  if (typeof value === 'string') return 'string';
  return 'unsupported';
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

  // Pine user inputs are compiled to in_0, in_1, ... . Other entries such as
  // pineId, pineVersion, pineFeatures and text are TradingView implementation
  // metadata and must never be exposed as optimisable strategy parameters.
  const pineInputs = current.filter((input) => /^in_\d+$/.test(input.id));

  const publicMeta = readMeta(study);
  const internalMeta = getInternalStudyMeta(chart, strategyId);
  const declaredInputs = [
    ...(Array.isArray(publicMeta.inputs) ? publicMeta.inputs : []),
    ...(Array.isArray(internalMeta.inputs) ? internalMeta.inputs : []),
  ];

  const metaById = new Map<string, UnknownRecord>();
  for (const item of declaredInputs) {
    const record = asRecord(item);
    if (typeof record.id === 'string') {
      metaById.set(record.id, {
        ...(metaById.get(record.id) ?? {}),
        ...record,
      });
    }
  }

  return pineInputs.map((input) => {
    // getInputValues() itself may already contain the compiled Pine title/type.
    // Merge it with the richer metaInfo().inputs definition when available.
    const inputRecord = asRecord(input);
    const inputMeta: UnknownRecord = {
      ...inputRecord,
      ...(metaById.get(input.id) ?? {}),
    };

    const optionsCandidate =
      inputMeta.options ??
      inputMeta.values;
    const options = Array.isArray(optionsCandidate)
      ? optionsCandidate
      : undefined;

    const labelCandidate =
      inputMeta.name ??
      inputMeta.description ??
      inputMeta.title ??
      input.id;

    const minCandidate =
      inputMeta.min ??
      inputMeta.minval;
    const maxCandidate =
      inputMeta.max ??
      inputMeta.maxval;
    const stepCandidate = inputMeta.step;

    return {
      id: input.id,
      label:
        typeof labelCandidate === 'string' && labelCandidate.trim()
          ? labelCandidate.trim()
          : input.id,
      type: inferInputType(inputMeta, input.value),
      currentValue: input.value,
      ...(options ? { options } : {}),
      ...(typeof minCandidate === 'number' ? { min: minCandidate } : {}),
      ...(typeof maxCandidate === 'number' ? { max: maxCandidate } : {}),
      ...(typeof stepCandidate === 'number' ? { step: stepCandidate } : {}),
    };
  });
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
  reportData?: () => unknown;
} | null => {
  try {
    const sources = chart._chartWidget?.model?.()?.model?.()?.dataSources?.() ?? [];
    for (const source of sources) {
      const candidate = source as {
        id?: string | (() => string);
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

const asFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
};

const readStrategyMetrics = (strategyId: string) => {
  const chart = getChart();
  const source = getStrategySource(chart, strategyId);
  if (!source || typeof source.reportData !== 'function') return null;

  let rawReport: unknown;
  try {
    rawReport = unwrapValue(source.reportData());
  } catch {
    return null;
  }

  const report = asRecord(rawReport);
  const performance = asRecord(report.performance);
  const all = asRecord(performance.all);

  if (Object.keys(performance).length === 0 || Object.keys(all).length === 0) {
    return null;
  }

  const metrics: Record<string, number> = {};

  const put = (key: string, value: unknown) => {
    const numeric = asFiniteNumber(value);
    if (numeric !== undefined) metrics[key] = numeric;
  };

  // Canonical names used by the optimiser UI and Optuna constraints.
  put('netProfit', all.netProfit);
  put('netProfitPercent', all.netProfitPercent);
  put('grossProfit', all.grossProfit);
  put('grossLoss', all.grossLoss);
  put('profitFactor', all.profitFactor);
  put('totalTrades', all.totalTrades);
  put('winningTrades', all.winningTrades);
  put('losingTrades', all.losingTrades);
  put('percentProfitable', all.percentProfitable);
  put('averageTrade', all.avgTrade ?? all.averageTrade);
  put('averageWinningTrade', all.avgWinningTrade ?? all.averageWinningTrade);
  put('averageLosingTrade', all.avgLosingTrade ?? all.averageLosingTrade);
  put('largestWinningTrade', all.largestWinningTrade);
  put('largestLosingTrade', all.largestLosingTrade);
  put(
    'maxDrawdown',
    performance.maxStrategyDrawDown ??
      performance.maxDrawDown ??
      all.maxDrawDown,
  );
  put(
    'maxDrawdownPercent',
    performance.maxStrategyDrawDownPercent ??
      performance.maxDrawDownPercent ??
      all.maxDrawDownPercent,
  );
  put('sharpeRatio', performance.sharpeRatio ?? all.sharpeRatio);
  put('sortinoRatio', performance.sortinoRatio ?? all.sortinoRatio);
  put('buyAndHoldReturn', performance.buyAndHoldReturn ?? all.buyAndHoldReturn);

  // Preserve every other numeric field TradingView exposes. Canonical fields
  // above remain stable, while these names make the full report available for
  // inspection/export without guessing every TradingView metric in advance.
  for (const [key, value] of Object.entries(all)) {
    put('tv.all.' + key, value);
  }
  for (const [key, value] of Object.entries(performance)) {
    if (key === 'all') continue;
    put('tv.performance.' + key, value);
  }

  return Object.keys(metrics).length > 0 ? metrics : null;
};

const ensureStrategyTester = () => {
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
    tradingView?.bottomWidgetBar?.showWidget?.('backtesting');
    return true;
  } catch {
    return false;
  }
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

  script.addEventListener(REQUEST_EVENT, (event) => {
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
