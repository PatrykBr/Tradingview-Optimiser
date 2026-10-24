import type {
  StrategyInput,
  StrategyInputType,
  TradingViewMetrics,
} from './types';

export type UnknownRecord = Record<string, unknown>;

export interface RawStudyInput {
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

export const asRecord = (value: unknown): UnknownRecord =>
  value !== null && typeof value === 'object'
    ? (value as UnknownRecord)
    : {};

const inferInputType = (
  meta: UnknownRecord,
  value: unknown,
): StrategyInputType => {
  const declared = String(
    meta.type ?? meta.inputType ?? '',
  ).toLowerCase();
  const options = meta.options ?? meta.values;

  if (Array.isArray(options) && options.length > 0) {
    return 'categorical';
  }
  if (declared.includes('bool')) return 'boolean';
  if (
    declared.includes('integer') ||
    declared === 'int'
  ) {
    return 'integer';
  }
  if (declared.includes('float')) return 'float';
  if (
    declared.includes('resolution') ||
    declared.includes('timeframe')
  ) {
    return 'timeframe';
  }
  if (declared.includes('source')) return 'source';
  if (declared.includes('time')) return 'time';
  if (
    declared.includes('string') ||
    declared.includes('text')
  ) {
    return 'string';
  }

  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? 'integer'
      : 'float';
  }
  if (typeof value === 'string') return 'string';
  return 'unsupported';
};

const normaliseInputBound = (
  value: unknown,
): number | undefined => {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value)
  ) {
    return undefined;
  }

  // TradingView uses large finite sentinel values for unbounded Pine inputs.
  // Exclude them from optimisation limits.
  if (Math.abs(value) >= 1.0e12) {
    return undefined;
  }

  return value;
};

export const normalisePineInputs = (
  current: RawStudyInput[],
  declaredInputs: unknown[],
): StrategyInput[] => {
  const pineInputs = current.filter((input) =>
    /^in_\d+$/.test(input.id),
  );

  const metaById = new Map<string, UnknownRecord>();
  for (const item of declaredInputs) {
    const record = asRecord(item);
    if (typeof record.id !== 'string') continue;

    metaById.set(record.id, {
      ...(metaById.get(record.id) ?? {}),
      ...record,
    });
  }

  return pineInputs.map((input) => {
    const inputMeta: UnknownRecord = {
      ...asRecord(input),
      ...(metaById.get(input.id) ?? {}),
    };

    const optionsCandidate =
      inputMeta.options ?? inputMeta.values;
    const options = Array.isArray(optionsCandidate)
      ? optionsCandidate
      : undefined;

    const labelCandidate =
      inputMeta.name ??
      inputMeta.description ??
      inputMeta.title ??
      input.id;

    const minCandidate = normaliseInputBound(
      inputMeta.min ?? inputMeta.minval,
    );
    const maxCandidate = normaliseInputBound(
      inputMeta.max ?? inputMeta.maxval,
    );
    const stepCandidate = inputMeta.step;

    return {
      id: input.id,
      label:
        typeof labelCandidate === 'string' &&
        labelCandidate.trim()
          ? labelCandidate.trim()
          : input.id,
      type: inferInputType(inputMeta, input.value),
      currentValue: input.value,
      ...(options ? { options } : {}),
      ...(minCandidate !== undefined
        ? { min: minCandidate }
        : {}),
      ...(maxCandidate !== undefined
        ? { max: maxCandidate }
        : {}),
      ...(typeof stepCandidate === 'number'
        ? { step: stepCandidate }
        : {}),
    };
  });
};

const normaliseMetricNumber = (
  value: unknown,
): number | undefined => {
  if (
    typeof value !== 'number' ||
    Number.isNaN(value)
  ) {
    return undefined;
  }
  if (value === Number.POSITIVE_INFINITY) {
    return 1.0e12;
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return -1.0e12;
  }
  return value;
};

export const extractTradingViewMetrics = (
  rawReport: unknown,
): TradingViewMetrics | null => {
  const report = asRecord(rawReport);
  const performance = asRecord(report.performance);
  const all = asRecord(performance.all);

  if (
    Object.keys(performance).length === 0 ||
    Object.keys(all).length === 0
  ) {
    return null;
  }

  const metrics: TradingViewMetrics = {};
  const put = (key: string, value: unknown) => {
    const numeric = normaliseMetricNumber(value);
    if (numeric !== undefined) metrics[key] = numeric;
  };

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
  put(
    'averageWinningTrade',
    all.avgWinningTrade ?? all.averageWinningTrade,
  );
  put(
    'averageLosingTrade',
    all.avgLosingTrade ?? all.averageLosingTrade,
  );
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
  put(
    'sharpeRatio',
    performance.sharpeRatio ?? all.sharpeRatio,
  );
  put(
    'sortinoRatio',
    performance.sortinoRatio ?? all.sortinoRatio,
  );
  put(
    'buyAndHoldReturn',
    performance.buyAndHoldReturn ??
      all.buyAndHoldReturn,
  );

  for (const [key, value] of Object.entries(all)) {
    put('tv.all.' + key, value);
  }
  for (const [key, value] of Object.entries(
    performance,
  )) {
    if (key === 'all') continue;
    put('tv.performance.' + key, value);
  }

  return Object.keys(metrics).length > 0
    ? metrics
    : null;
};

export const stableStringify = (
  value: unknown,
): string => {
  const seen = new WeakSet<object>();

  const normalise = (item: unknown): unknown => {
    if (Array.isArray(item)) {
      return item.map(normalise);
    }
    if (item === null || typeof item !== 'object') {
      return item;
    }
    if (seen.has(item as object)) return '[Circular]';
    seen.add(item as object);

    return Object.fromEntries(
      Object.entries(item as UnknownRecord)
        .sort(([left], [right]) =>
          left.localeCompare(right),
        )
        .map(([key, child]) => [
          key,
          normalise(child),
        ]),
    );
  };

  return JSON.stringify(normalise(value));
};

export const hashString = (value: string): string => {
  let hash = 2166136261;
  for (
    let index = 0;
    index < value.length;
    index += 1
  ) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0)
    .toString(16)
    .padStart(8, '0');
};

export const buildStrategySignature = (
  publicMeta: UnknownRecord,
  internalMeta: UnknownRecord,
  studyName: string | null,
  inputs: StrategyInput[],
): string =>
  hashString(
    stableStringify({
      description:
        internalMeta.description ??
        publicMeta.description ??
        studyName,
      shortDescription:
        internalMeta.shortDescription ??
        publicMeta.shortDescription ??
        null,
      scriptIdPart:
        internalMeta.scriptIdPart ??
        publicMeta.scriptIdPart ??
        null,
      pineId:
        internalMeta.pineId ??
        publicMeta.pineId ??
        null,
      pineVersion:
        internalMeta.pineVersion ??
        publicMeta.pineVersion ??
        null,
      id:
        internalMeta.id ??
        publicMeta.id ??
        null,
      inputs: inputs.map((input) => ({
        id: input.id,
        label: input.label,
        type: input.type,
        options: input.options ?? null,
      })),
    }),
  );
