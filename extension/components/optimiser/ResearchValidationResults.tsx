import { formatMetric } from '../../lib/optimisation/metrics';
import {
  buildResearchVerdict,
} from '../../lib/optimisation/research-verdict';
import type {
  ResearchEvaluation,
} from '../../lib/optimisation/research';
import type {
  CreateRun,
  RunProgress,
} from '../../lib/protocol/types';

interface ResearchValidationResultsProps {
  config: CreateRun;
  progress: RunProgress;
  evaluation: ResearchEvaluation | null;
  phase?: string;
  busy: boolean;
  inputLabel: (
    id: string,
  ) => string;
  onRun(): void;
  onCancel(): void;
  onApplyRobustWinner(): void;
}

const formatMonteCarloValue = (
  value: number,
  unit: 'percent' | 'pnl',
): string =>
  unit === 'percent'
    ? value.toFixed(2) + '%'
    : value.toFixed(2);

export default function ResearchValidationResults({
  config,
  progress,
  evaluation,
  phase,
  busy,
  inputLabel,
  onRun,
  onCancel,
  onApplyRobustWinner,
}: ResearchValidationResultsProps) {
  const objectiveMetric =
    config.objective_metric;
  const verdict = evaluation
    ? buildResearchVerdict(
        config,
        progress,
        evaluation,
      )
    : null;
  const robustWinner =
    evaluation?.robustness
      ?.candidates[0];
  const stability =
    evaluation?.stability;
  const walkForward =
    evaluation?.walkForward;
  const monteCarlo =
    evaluation?.monteCarlo;

  return (
    <div className="researchBlock">
      <div className="rowLabel">
        <div>
          <div className="researchBlockTitle">
            Validation
          </div>
          {phase && (
            <div className="muted">
              {phase}
            </div>
          )}
        </div>
        <button
          className={
            busy
              ? 'danger researchAction'
              : 'secondary researchAction'
          }
          onClick={
            busy
              ? onCancel
              : onRun
          }
        >
          {busy
            ? 'Cancel'
            : evaluation
              ? 'Re-run'
              : 'Run validation'}
        </button>
      </div>

      {verdict && (
        <div className="researchCard evidenceCard">
          <div className="rowLabel">
            <strong>
              Research evidence
            </strong>
            <span
              className={
                'researchBadge ' +
                (verdict.overall ===
                'strong'
                  ? 'good'
                  : verdict.overall ===
                      'weak'
                    ? 'bad'
                    : 'warn')
              }
            >
              {verdict.overall}
            </span>
          </div>

          <div className="evidenceList">
            {verdict.areas.map(
              (area) => (
                <div
                  className="evidenceRow"
                  key={area.id}
                  title={area.detail}
                >
                  <span>{area.label}</span>
                  <span
                    className={
                      'researchBadge ' +
                      (area.rating ===
                      'strong'
                        ? 'good'
                        : area.rating ===
                            'weak'
                          ? 'bad'
                          : area.rating ===
                              'moderate'
                            ? 'warn'
                            : '')
                    }
                  >
                    {area.rating}
                  </span>
                </div>
              ),
            )}
          </div>

          {verdict.concerns.length > 0 && (
            <div className="evidenceConcern">
              Main concern:{' '}
              {verdict.concerns[0]}
            </div>
          )}
        </div>
      )}

      {robustness && robustWinner && (
        <div className="researchCard">
          <div className="rowLabel">
            <strong>Robust winner</strong>
            <span className="researchBadge good">
              {robustWinner.passedWindows}/
              {robustWinner.totalWindows}{' '}
              folds
            </span>
          </div>

          <div className="researchSummaryGrid">
            <div>
              <span>Optimisation</span>
              <strong>
                {formatMetric(
                  objectiveMetric,
                  robustWinner
                    .optimisationObjective,
                )}
              </strong>
            </div>
            <div>
              <span>OOS median</span>
              <strong>
                {robustWinner
                  .validationObjective ===
                null
                  ? '—'
                  : formatMetric(
                      objectiveMetric,
                      robustWinner
                        .validationObjective,
                    )}
              </strong>
            </div>
            <div>
              <span>Degradation</span>
              <strong>
                {robustWinner
                  .degradationPercent ===
                null
                  ? '—'
                  : robustWinner
                      .degradationPercent
                      .toFixed(1) + '%'}
              </strong>
            </div>
            <div>
              <span>Trial</span>
              <strong>
                #{robustWinner.trialNumber}
              </strong>
            </div>
          </div>

          <button
            className="secondary researchApply"
            onClick={onApplyRobustWinner}
          >
            Apply robust winner
          </button>
        </div>
      )}

      {stability && (
        <div className="researchCard">
          <div className="rowLabel">
            <strong>
              Parameter stability
            </strong>
            <span
              className={
                'researchBadge ' +
                (stability.overallRating ===
                'strong'
                  ? 'good'
                  : stability.overallRating ===
                      'moderate'
                    ? 'warn'
                    : 'bad')
              }
            >
              {stability.overallRating}
            </span>
          </div>

          <div className="stabilityList">
            {stability.parameters.map(
              (parameter) => (
                <div
                  className="stabilityRow"
                  key={
                    parameter.parameter
                  }
                >
                  <span>
                    {inputLabel(
                      parameter.parameter,
                    )}
                  </span>
                  <span
                    className={
                      'researchBadge ' +
                      (parameter.rating ===
                      'strong'
                        ? 'good'
                        : parameter.rating ===
                            'moderate'
                          ? 'warn'
                          : 'bad')
                    }
                  >
                    {parameter.rating}
                  </span>
                </div>
              ),
            )}
          </div>
        </div>
      )}

      {walkForward && (
        <div className="researchCard">
          <div className="rowLabel">
            <strong>
              Walk-forward
            </strong>
            <span
              className={
                'researchBadge ' +
                (walkForward.passedFolds /
                    Math.max(
                      1,
                      walkForward.totalFolds,
                    ) >=
                  0.75
                  ? 'good'
                  : walkForward.passedFolds /
                        Math.max(
                          1,
                          walkForward.totalFolds,
                        ) >=
                      0.5
                    ? 'warn'
                    : 'bad')
              }
            >
              {walkForward.passedFolds}/
              {walkForward.totalFolds}{' '}
              folds
            </span>
          </div>

          <div className="researchSummaryGrid">
            <div>
              <span>Median OOS</span>
              <strong>
                {walkForward
                  .medianTestObjective ===
                null
                  ? '—'
                  : formatMetric(
                      objectiveMetric,
                      walkForward
                        .medianTestObjective,
                    )}
              </strong>
            </div>
            <div>
              <span>Worst OOS</span>
              <strong>
                {walkForward
                  .worstTestObjective ===
                null
                  ? '—'
                  : formatMetric(
                      objectiveMetric,
                      walkForward
                        .worstTestObjective,
                    )}
              </strong>
            </div>
          </div>

          <div className="stabilityList">
            {Object.entries(
              walkForward
                .parameterConsistency,
            )
              .filter(
                ([, rating]) =>
                  rating !==
                  'insufficient',
              )
              .slice(0, 8)
              .map(
                ([parameter, rating]) => (
                  <div
                    className="stabilityRow"
                    key={parameter}
                  >
                    <span>
                      {inputLabel(
                        parameter,
                      )}
                    </span>
                    <span
                      className={
                        'researchBadge ' +
                        (rating === 'stable'
                          ? 'good'
                          : 'warn')
                      }
                    >
                      {rating}
                    </span>
                  </div>
                ),
              )}
          </div>
        </div>
      )}

      {monteCarlo && (
        <div className="researchCard">
          <div className="rowLabel">
            <strong>
              Monte Carlo
            </strong>
            <span
              className={
                'researchBadge ' +
                (monteCarlo.available
                  ? 'good'
                  : 'warn')
              }
            >
              {monteCarlo.available
                ? monteCarlo.sampleSize +
                  ' trades'
                : 'unavailable'}
            </span>
          </div>

          {!monteCarlo.available ? (
            <p className="helpText">
              {monteCarlo.reason}
            </p>
          ) : (
            <>
              <div className="researchSummaryGrid">
                <div>
                  <span>
                    Loss probability
                  </span>
                  <strong>
                    {monteCarlo
                      .probabilityOfLoss ===
                    null
                      ? '—'
                      : (
                          monteCarlo
                            .probabilityOfLoss *
                          100
                        ).toFixed(1) +
                        '%'}
                  </strong>
                </div>
                <div>
                  <span>
                    Median max DD
                  </span>
                  <strong>
                    {monteCarlo
                      .maxDrawdown
                      ? formatMonteCarloValue(
                          monteCarlo
                            .maxDrawdown
                            .median,
                          monteCarlo.unit,
                        )
                      : '—'}
                  </strong>
                </div>
                <div>
                  <span>
                    95% max DD
                  </span>
                  <strong>
                    {monteCarlo
                      .maxDrawdown
                      ? formatMonteCarloValue(
                          monteCarlo
                            .maxDrawdown
                            .p95,
                          monteCarlo.unit,
                        )
                      : '—'}
                  </strong>
                </div>
                <div>
                  <span>
                    PF median
                  </span>
                  <strong>
                    {monteCarlo
                      .profitFactor
                      ? monteCarlo
                          .profitFactor
                          .median.toFixed(
                            2,
                          )
                      : '—'}
                  </strong>
                </div>
              </div>

              {monteCarlo.total && (
                <div className="confidenceLine">
                  {Math.round(
                    monteCarlo.confidence *
                      100,
                  )}
                  % cumulative PnL interval:{' '}
                  <strong>
                    {formatMonteCarloValue(
                      monteCarlo.total.low,
                      monteCarlo.unit,
                    )}
                    {' – '}
                    {formatMonteCarloValue(
                      monteCarlo.total.high,
                      monteCarlo.unit,
                    )}
                  </strong>
                  {' · '}
                  {monteCarlo.source ===
                  'oos'
                    ? 'unseen OOS sample'
                    : 'optimisation sample'}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
