import { formatMetric } from '../../lib/optimisation/metrics';
import {
  buildResearchVerdict,
  type EvidenceRating,
  type ResearchVerdict,
} from '../../lib/optimisation/research-verdict';
import type { ResearchEvaluation } from '../../lib/optimisation/research';
import type { RunProgress } from '../../lib/protocol/types';

interface ResearchValidationResultsProps {
  objectiveMetric: string;
  progress: RunProgress;
  evaluation: ResearchEvaluation | null;
  phase?: string;
  busy: boolean;
  disabled: boolean;
  inputLabel: (id: string) => string;
  onRun(): void;
  onCancel(): void;
  onApplyRobustWinner(): void;
}

const formatMonteCarloValue = (value: number, unit: 'percent' | 'pnl'): string =>
  unit === 'percent' ? value.toFixed(2) + '%' : value.toFixed(2);

const badgeClasses: Record<EvidenceRating | 'fragile', string> = {
  strong: 'good',
  moderate: 'warn',
  weak: 'bad',
  insufficient: '',
  fragile: 'bad',
};

const foldBadgeClass = (passed: number, total: number): string => {
  const rate = passed / Math.max(1, total);
  if (rate >= 0.75) return 'good';
  return rate >= 0.5 ? 'warn' : 'bad';
};

export default function ResearchValidationResults({
  objectiveMetric,
  progress,
  evaluation,
  phase,
  busy,
  disabled,
  inputLabel,
  onRun,
  onCancel,
  onApplyRobustWinner,
}: Readonly<ResearchValidationResultsProps>) {
  const verdict = evaluation ? buildResearchVerdict(progress, evaluation) : null;
  const actionLabel = evaluation ? 'Re-run' : 'Run validation';
  const robustWinner = evaluation?.robustness?.candidates[0];
  const stability = evaluation?.stability;
  const walkForward = evaluation?.walkForward;
  const monteCarlo = evaluation?.monteCarlo;

  return (
    <div className="researchBlock">
      <div className="rowLabel">
        <div>
          <div className="researchBlockTitle">Validation</div>
          {phase && <div className="muted">{phase}</div>}
        </div>
        <button
          disabled={disabled}
          className={busy ? 'danger researchAction' : 'secondary researchAction'}
          onClick={busy ? onCancel : onRun}
        >
          {busy ? 'Cancel' : actionLabel}
        </button>
      </div>

      {verdict && <EvidenceCard verdict={verdict} />}

      {robustWinner && (
        <RobustWinnerCard
          robustWinner={robustWinner}
          objectiveMetric={objectiveMetric}
          busy={busy}
          disabled={disabled}
          onApplyRobustWinner={onApplyRobustWinner}
        />
      )}

      {stability && <StabilityCard stability={stability} inputLabel={inputLabel} />}

      {walkForward && (
        <WalkForwardCard
          walkForward={walkForward}
          objectiveMetric={objectiveMetric}
          inputLabel={inputLabel}
        />
      )}

      {monteCarlo && <MonteCarloCard monteCarlo={monteCarlo} />}
    </div>
  );
}

function EvidenceCard({ verdict }: Readonly<{ verdict: ResearchVerdict }>) {
  return (
    <div className="researchCard evidenceCard">
      <div className="rowLabel">
        <strong>Research evidence</strong>
        <span className={'researchBadge ' + (badgeClasses[verdict.overall] || 'warn')}>
          {verdict.overall}
        </span>
      </div>

      <div className="evidenceList">
        {verdict.areas.map((area) => (
          <div className="evidenceRow" key={area.id} title={area.detail}>
            <span>{area.label}</span>
            <span className={'researchBadge ' + badgeClasses[area.rating]}>{area.rating}</span>
          </div>
        ))}
      </div>

      {verdict.concerns.length > 0 && (
        <div className="evidenceConcern">Main concern: {verdict.concerns[0]}</div>
      )}
    </div>
  );
}

function RobustWinnerCard({
  robustWinner,
  objectiveMetric,
  busy,
  disabled,
  onApplyRobustWinner,
}: Readonly<{
  robustWinner: NonNullable<ResearchEvaluation['robustness']>['candidates'][number];
  objectiveMetric: string;
  busy: boolean;
  disabled: boolean;
  onApplyRobustWinner: () => void;
}>) {
  return (
    <div className="researchCard">
      <div className="rowLabel">
        <strong>Robust winner</strong>
        <span className="researchBadge good">
          {robustWinner.passedWindows}/{robustWinner.totalWindows} folds
        </span>
      </div>

      <div className="researchSummaryGrid">
        <div>
          <span>Optimisation</span>
          <strong>{formatMetric(objectiveMetric, robustWinner.optimisationObjective)}</strong>
        </div>
        <div>
          <span>OOS median</span>
          <strong>
            {robustWinner.validationObjective === null
              ? 'Unavailable'
              : formatMetric(objectiveMetric, robustWinner.validationObjective)}
          </strong>
        </div>
        <div>
          <span>Degradation</span>
          <strong>
            {robustWinner.degradationPercent === null
              ? 'Unavailable'
              : robustWinner.degradationPercent.toFixed(1) + '%'}
          </strong>
        </div>
        <div>
          <span>Trial</span>
          <strong>#{robustWinner.trialNumber}</strong>
        </div>
      </div>

      <button
        className="secondary researchApply"
        disabled={busy || disabled}
        onClick={onApplyRobustWinner}
      >
        Apply robust winner
      </button>
    </div>
  );
}

function StabilityCard({
  stability,
  inputLabel,
}: Readonly<{
  stability: NonNullable<ResearchEvaluation['stability']>;
  inputLabel: (id: string) => string;
}>) {
  return (
    <div className="researchCard">
      <div className="rowLabel">
        <strong>Parameter stability</strong>
        <span className={'researchBadge ' + badgeClasses[stability.overallRating]}>
          {stability.overallRating}
        </span>
      </div>

      <div className="stabilityList">
        {stability.parameters.map((parameter) => (
          <div className="stabilityRow" key={parameter.parameter}>
            <span>{inputLabel(parameter.parameter)}</span>
            <span className={'researchBadge ' + badgeClasses[parameter.rating]}>
              {parameter.rating}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WalkForwardCard({
  walkForward,
  objectiveMetric,
  inputLabel,
}: Readonly<{
  walkForward: NonNullable<ResearchEvaluation['walkForward']>;
  objectiveMetric: string;
  inputLabel: (id: string) => string;
}>) {
  return (
    <div className="researchCard">
      <div className="rowLabel">
        <strong>Walk-forward</strong>
        <span
          className={
            'researchBadge ' + foldBadgeClass(walkForward.passedFolds, walkForward.totalFolds)
          }
        >
          {walkForward.passedFolds}/{walkForward.totalFolds} folds
        </span>
      </div>

      <div className="researchSummaryGrid">
        <div>
          <span>Median OOS</span>
          <strong>
            {walkForward.medianTestObjective === null
              ? 'Unavailable'
              : formatMetric(objectiveMetric, walkForward.medianTestObjective)}
          </strong>
        </div>
        <div>
          <span>Worst OOS</span>
          <strong>
            {walkForward.worstTestObjective === null
              ? 'Unavailable'
              : formatMetric(objectiveMetric, walkForward.worstTestObjective)}
          </strong>
        </div>
      </div>

      <div className="stabilityList">
        {Object.entries(walkForward.parameterConsistency)
          .filter(([, rating]) => rating !== 'insufficient')
          .slice(0, 8)
          .map(([parameter, rating]) => (
            <div className="stabilityRow" key={parameter}>
              <span>{inputLabel(parameter)}</span>
              <span className={'researchBadge ' + (rating === 'stable' ? 'good' : 'warn')}>
                {rating}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

function MonteCarloCard({
  monteCarlo,
}: Readonly<{ monteCarlo: NonNullable<ResearchEvaluation['monteCarlo']> }>) {
  return (
    <div className="researchCard">
      <div className="rowLabel">
        <strong>Monte Carlo</strong>
        <span className={'researchBadge ' + (monteCarlo.available ? 'good' : 'warn')}>
          {monteCarlo.available ? monteCarlo.sampleSize + ' trades' : 'unavailable'}
        </span>
      </div>

      {!monteCarlo.available ? (
        <p className="helpText">{monteCarlo.reason}</p>
      ) : (
        <>
          <div className="researchSummaryGrid">
            <div>
              <span>Loss probability</span>
              <strong>
                {monteCarlo.probabilityOfLoss === null
                  ? 'Unavailable'
                  : (monteCarlo.probabilityOfLoss * 100).toFixed(1) + '%'}
              </strong>
            </div>
            <div>
              <span>Median max drawdown</span>
              <strong>
                {monteCarlo.maxDrawdown
                  ? formatMonteCarloValue(monteCarlo.maxDrawdown.median, monteCarlo.unit)
                  : 'Unavailable'}
              </strong>
            </div>
            <div>
              <span>95th percentile drawdown</span>
              <strong>
                {monteCarlo.maxDrawdown
                  ? formatMonteCarloValue(monteCarlo.maxDrawdown.p95, monteCarlo.unit)
                  : 'Unavailable'}
              </strong>
            </div>
            <div>
              <span>Median profit factor</span>
              <strong>
                {monteCarlo.profitFactor
                  ? monteCarlo.profitFactor.median.toFixed(2)
                  : 'Unavailable'}
              </strong>
            </div>
          </div>

          {monteCarlo.total && (
            <div className="confidenceLine">
              {Math.round(monteCarlo.confidence * 100)}% cumulative PnL interval:{' '}
              <strong>
                {formatMonteCarloValue(monteCarlo.total.low, monteCarlo.unit)}
                {' to '}
                {formatMonteCarloValue(monteCarlo.total.high, monteCarlo.unit)}
              </strong>
              {' · '}
              {monteCarlo.source === 'oos' ? 'unseen OOS sample' : 'optimisation sample'}
            </div>
          )}
        </>
      )}
    </div>
  );
}
