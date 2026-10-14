import type { CreateRun, RunProgress, TrialSummary } from '../protocol/types';

const csvCell = (value: unknown): string => {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);

  return '"' + text.replace(/"/g, '""') + '"';
};

const collectKeys = (
  trials: TrialSummary[],
  selector: (trial: TrialSummary) => Record<string, unknown>,
): string[] =>
  [...new Set(trials.flatMap((trial) => Object.keys(selector(trial))))].sort();

export const buildTrialsCsv = (
  config: CreateRun,
  progress: RunProgress,
): string => {
  const parameterKeys = collectKeys(
    progress.trials,
    (trial) => trial.parameters,
  );
  const metricKeys = collectKeys(
    progress.trials,
    (trial) => trial.metrics,
  );
  const constraintKeys = collectKeys(
    progress.trials,
    (trial) => trial.constraints,
  );

  const header = [
    'trial',
    'state',
    'objective',
    'duration_ms',
    'reused_from_trial',
    'failure_reason',
    ...parameterKeys.map((key) => 'param:' + key),
    ...metricKeys.map((key) => 'metric:' + key),
    ...constraintKeys.map((key) => 'constraint:' + key),
  ];

  const rows = progress.trials.map((trial) => [
    trial.trial_number,
    trial.state,
    trial.objective_value,
    trial.duration_ms,
    trial.reused_from_trial ?? null,
    trial.failure_reason,
    ...parameterKeys.map((key) => trial.parameters[key]),
    ...metricKeys.map((key) => trial.metrics[key]),
    ...constraintKeys.map((key) => trial.constraints[key]),
  ]);

  const metadata = [
    ['run_id', config.run_id],
    ['strategy', config.chart.strategy_name],
    ['symbol', config.chart.symbol],
    ['timeframe', config.chart.timeframe],
    ['strategy_signature', config.chart.strategy_signature],
    ['objective', config.objective_metric],
    ['direction', config.direction],
    [
      'backtest_range',
      config.backtest_range
        ? config.backtest_range.start_date +
          ' to ' +
          config.backtest_range.end_date
        : 'chart history',
    ],
  ];

  return [
    ...metadata.map((row) => row.map(csvCell).join(',')),
    '',
    header.map(csvCell).join(','),
    ...rows.map((row) => row.map(csvCell).join(',')),
  ].join('\r\n');
};

export const buildRunJson = (
  config: CreateRun,
  progress: RunProgress,
): string =>
  JSON.stringify(
    {
      config,
      progress,
      exported_at: new Date().toISOString(),
    },
    null,
    2,
  );


interface RunExport {
  filename: string;
  mimeType: string;
  content: string;
}

const safeFilename = (
  value: string,
): string =>
  value
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'optimisation';

export const buildRunExport = (
  config: CreateRun,
  progress: RunProgress,
  format: 'csv' | 'json',
): RunExport => {
  const base =
    safeFilename(
      config.chart.strategy_name,
    ) +
    '-' +
    config.run_id.slice(0, 8);
  const isCsv = format === 'csv';

  return {
    filename: base + '.' + format,
    mimeType: isCsv
      ? 'text/csv'
      : 'application/json',
    content: isCsv
      ? buildTrialsCsv(
          config,
          progress,
        )
      : buildRunJson(
          config,
          progress,
        ),
  };
};
