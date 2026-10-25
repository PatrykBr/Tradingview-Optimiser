import { Fragment } from 'react';
import { OPTIMISATION_METRICS } from '../../lib/optimisation/metrics';
import type { OptimisationDraft } from '../../lib/optimisation/draft';
import type { StrategyConfigurationModel } from './useStrategyConfiguration';

type StringField = {
  [K in keyof OptimisationDraft]: OptimisationDraft[K] extends string ? K : never;
}[keyof OptimisationDraft];
type BooleanField = {
  [K in keyof OptimisationDraft]: OptimisationDraft[K] extends boolean ? K : never;
}[keyof OptimisationDraft];
interface FieldSpec {
  key: StringField;
  label: string;
  title?: string;
  type?: 'number' | 'date';
  min?: number;
  max?: number;
  step?: number;
}
interface ResearchSetting {
  key: BooleanField;
  label: string;
  title: string;
  description: string;
  fields: FieldSpec[];
}

const RESEARCH_SETTINGS: ResearchSetting[] = [
  {
    key: 'convergenceEnabled',
    label: 'Stop when converged',
    title:
      'Stop when the best feasible objective has not improved enough within the patience window.',
    description:
      'Stops after the best feasible result has stopped improving by the required amount.',
    fields: [
      {
        key: 'convergenceMinTrials',
        label: 'Min trials',
        min: 5,
        title: 'Complete at least this many trials before convergence can stop the study.',
      },
      {
        key: 'convergencePatience',
        label: 'Patience',
        min: 5,
        title:
          'Allow this many trials without sufficient improvement before stopping. Increase it to allow more exploration.',
      },
      {
        key: 'convergenceMinImprovementPercent',
        label: 'Min improve %',
        min: 0,
        step: 0.1,
        title:
          'Percentage improvement required to reset the convergence window. Lower values count smaller gains as progress.',
      },
    ],
  },
  {
    key: 'robustnessEnabled',
    label: 'Out-of-sample robustness',
    title:
      'Reserve the final part of the date range for validation. After optimisation, test the top feasible candidates on those unseen windows.',
    description: 'Reserves the final part of your Deep Backtesting range for unseen validation.',
    fields: [
      {
        key: 'robustnessValidationPercent',
        label: 'OOS %',
        min: 10,
        max: 50,
        title:
          'Percentage of the date range reserved for validation. A larger share leaves less training history.',
      },
      {
        key: 'robustnessFolds',
        label: 'Folds',
        min: 1,
        max: 10,
        title:
          'Split the unseen period into this many sequential validation windows. More folds add backtests and shorten each window.',
      },
      {
        key: 'robustnessTopCandidates',
        label: 'Candidates',
        min: 1,
        max: 20,
        title:
          'Number of distinct feasible parameter sets to validate. Expect one extra backtest per candidate per fold.',
      },
    ],
  },
  {
    key: 'stabilityEnabled',
    label: 'Best-parameter stability test',
    title:
      'Change each numeric parameter near the selected winner and repeat the backtest to check its sensitivity.',
    description: 'Checks how small parameter changes affect the selected result.',
    fields: [
      {
        key: 'stabilityPerturbationPercent',
        label: 'Perturbation %',
        min: 0.1,
        max: 25,
        step: 0.1,
        title: 'Distance to move each numeric parameter, as a percentage of its full search range.',
      },
    ],
  },
  {
    key: 'walkForwardEnabled',
    label: 'Full walk-forward re-optimisation',
    title:
      'Run a fresh study for each chronological fold. Test each winner on the next unseen period. Each fold adds optimisation trials and a validation backtest.',
    description:
      'Tests whether repeated optimisation produces useful results on later unseen periods.',
    fields: [
      {
        key: 'walkForwardFolds',
        label: 'Folds',
        min: 2,
        max: 8,
        title: 'Number of training and unseen-test cycles. More folds add optimisation trials.',
      },
      {
        key: 'walkForwardTrialsPerFold',
        label: 'Trials/fold',
        min: 5,
        max: 10_000,
        title:
          'Trial budget for each fold. Total extra optimisation work is roughly folds multiplied by trials per fold.',
      },
      {
        key: 'walkForwardInitialTrainingPercent',
        label: 'Initial train %',
        min: 30,
        max: 80,
        title:
          'Percentage of the date range used for the first training window. Later folds include more history.',
      },
    ],
  },
  {
    key: 'monteCarloEnabled',
    label: 'Trade-level Monte Carlo',
    title:
      'Resample observed closed trades to estimate profit factor, cumulative PnL and drawdown distributions. Requires a recognised TradingView trade list.',
    description:
      'Resamples closed trades. Reports unavailable if TradingView does not expose a recognised trade list.',
    fields: [
      {
        key: 'monteCarloSimulations',
        label: 'Simulations',
        min: 500,
        max: 50_000,
        title:
          'Number of bootstrap paths. More paths make percentile estimates smoother and use more CPU time.',
      },
      {
        key: 'monteCarloConfidencePercent',
        label: 'Confidence %',
        min: 50,
        max: 99,
        title:
          'Central interval reported for simulated outcomes. A higher percentage gives a wider interval.',
      },
    ],
  },
];

const FILTERS = [
  {
    key: 'maxDrawdownFilter',
    label: 'Max drawdown %',
    title: 'Reject trials above this maximum drawdown percentage.',
  },
  {
    key: 'minProfitFactorFilter',
    label: 'Min profit factor',
    title: 'Reject trials below this profit factor.',
    step: 0.01,
  },
  {
    key: 'minTradesFilter',
    label: 'Min trades',
    title: 'Reject trials with fewer than this many trades.',
  },
] as const;

interface OptimisationSettingsSectionProps {
  model: StrategyConfigurationModel;
  activeRunId: string | null;
  connected: boolean;
  busy: boolean;
  onStart(): void;
  onStop(): void;
}

function SettingField({
  field,
  model,
  locked,
}: Readonly<{
  field: FieldSpec;
  model: StrategyConfigurationModel;
  locked: boolean;
}>) {
  const { key, label, title, type = 'number', ...attributes } = field;
  return (
    <label title={title}>
      <span>{label}</span>
      <input
        type={type}
        {...attributes}
        name={key}
        value={model.form[key]}
        disabled={locked}
        onChange={(event) => model.updateForm({ [key]: event.target.value })}
      />
    </label>
  );
}

export default function OptimisationSettingsSection({
  model,
  activeRunId,
  connected,
  busy,
  onStart,
  onStop,
}: Readonly<OptimisationSettingsSectionProps>) {
  const locked = activeRunId !== null || busy;
  const { form } = model;
  return (
    <section>
      <strong>Optimisation</strong>
      <div className="fieldGrid">
        <label title="Choose the TradingView metric to optimise. Use filters to set limits on other metrics.">
          <span>Metric</span>
          <select
            value={form.objectiveMetric}
            disabled={locked}
            onChange={(event) => model.updateForm({ objectiveMetric: event.target.value })}
          >
            {OPTIMISATION_METRICS.map((metric) => (
              <option key={metric.key} value={metric.key}>
                {metric.label}
              </option>
            ))}
          </select>
        </label>
        <SettingField
          model={model}
          locked={locked}
          field={{
            key: 'targetTrials',
            label: 'Max trials',
            min: 1,
            max: 100_000,
            title:
              'Limit the number of Optuna trials. More trials take longer. Convergence stopping can end the study early.',
          }}
        />
      </div>
      <div className="subsection">
        <label
          className="toggleRow"
          title="Run Deep Backtesting over a fixed date range. Required for out-of-sample validation, walk-forward and Monte Carlo."
        >
          <input
            type="checkbox"
            checked={form.dateRangeEnabled}
            disabled={locked}
            onChange={(event) => model.updateForm({ dateRangeEnabled: event.target.checked })}
          />
          <span>Custom Deep Backtesting range</span>
        </label>
        {form.dateRangeEnabled && (
          <div className="dateGrid">
            <SettingField
              model={model}
              locked={locked}
              field={{ key: 'startDate', label: 'From', type: 'date' }}
            />
            <SettingField
              model={model}
              locked={locked}
              field={{ key: 'endDate', label: 'To', type: 'date' }}
            />
          </div>
        )}
      </div>
      <div className="subsection researchSettings">
        <div className="rowLabel">
          <strong>Research</strong>
          <span className="muted">optional</span>
        </div>
        {RESEARCH_SETTINGS.map((setting) => (
          <Fragment key={setting.key}>
            <label className="toggleRow" title={setting.title}>
              <input
                type="checkbox"
                name={setting.key}
                checked={form[setting.key]}
                disabled={locked}
                onChange={(event) => model.updateForm({ [setting.key]: event.target.checked })}
              />
              <span>{setting.label}</span>
            </label>
            {form[setting.key] && (
              <>
                <p className="helpText researchHint">{setting.description}</p>
                <div
                  className={
                    setting.fields.length === 1
                      ? 'researchGrid singleResearchField'
                      : 'researchGrid'
                  }
                >
                  {setting.fields.map((field) => (
                    <SettingField key={field.key} field={field} model={model} locked={locked} />
                  ))}
                </div>
              </>
            )}
          </Fragment>
        ))}
      </div>
      <div className="filterList">
        {FILTERS.map(({ key, label, title, ...attributes }) => (
          <label className="filterRow" title={title} key={key}>
            <input
              type="checkbox"
              checked={form[key].enabled}
              disabled={locked}
              onChange={(event) => model.updateFilter(key, { enabled: event.target.checked })}
            />
            <span>{label}</span>
            <input
              type="number"
              {...attributes}
              value={form[key].value}
              disabled={locked || !form[key].enabled}
              onChange={(event) => model.updateFilter(key, { value: event.target.value })}
            />
          </label>
        ))}
      </div>
      {activeRunId === null ? (
        <button
          className="primary"
          disabled={!connected || busy || model.selectedInputCount === 0}
          onClick={onStart}
        >
          {busy ? 'Preparing…' : 'Start optimisation'}
        </button>
      ) : (
        <button className="danger" onClick={onStop}>
          Stop optimisation
        </button>
      )}
    </section>
  );
}
