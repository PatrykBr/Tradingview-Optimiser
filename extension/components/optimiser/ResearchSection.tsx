import { isTerminalStatus } from '../../lib/optimisation/run-progress';
import type { CreateRun } from '../../lib/protocol/types';
import ExperimentHistory from './ExperimentHistory';
import ParameterImportance from './ParameterImportance';
import ResearchValidationResults from './ResearchValidationResults';
import type { ResearchValidationModel } from './useResearchValidation';
import type { OptimisationRunModel } from './useOptimisationRun';

interface ResearchSectionProps {
  run: OptimisationRunModel;
  research: ResearchValidationModel;
  busy: boolean;
  inputLabel: (id: string) => string;
  onLoadExperiment: (config: CreateRun) => Promise<void>;
  onRerunExperiment: (config: CreateRun) => Promise<void>;
}

export default function ResearchSection({
  run,
  research,
  busy,
  inputLabel,
  onLoadExperiment,
  onRerunExperiment,
}: ResearchSectionProps) {
  const currentResearch = run.runConfig?.research;
  const canValidate =
    isTerminalStatus(run.progress?.status) &&
    Boolean(run.progress?.best) &&
    Boolean(
      currentResearch?.robustness.enabled ||
      currentResearch?.stability.enabled ||
      currentResearch?.walk_forward?.enabled ||
      currentResearch?.monte_carlo?.enabled,
    );
  const hasImportance = Object.keys(research.analysis?.parameter_importance ?? {}).length > 0;
  const hasImportanceError =
    Boolean(research.analysisError) || research.analysis?.parameter_importance_status === 'failed';

  if (!canValidate && !hasImportance && !hasImportanceError && research.experiments.length === 0) {
    return null;
  }

  return (
    <section className="researchResults">
      <div className="rowLabel">
        <strong>Research</strong>
        {run.progress?.termination_reason === 'converged' && (
          <span className="researchBadge">converged early</span>
        )}
      </div>

      <ParameterImportance
        analysis={research.analysis}
        {...(research.analysisError
          ? {
              loadError: research.analysisError,
            }
          : {})}
        inputLabel={inputLabel}
      />

      {canValidate && run.runConfig && run.progress && (
        <ResearchValidationResults
          objectiveMetric={run.runConfig.objective_metric}
          progress={run.progress}
          evaluation={research.research}
          {...(research.phase
            ? {
                phase: research.phase,
              }
            : {})}
          busy={research.busy}
          disabled={busy && !research.busy}
          inputLabel={inputLabel}
          onRun={() => {
            void research.runValidation();
          }}
          onCancel={research.cancelValidation}
          onApplyRobustWinner={() => {
            void research.applyRobustWinner();
          }}
        />
      )}

      <ExperimentHistory
        experiments={research.experiments}
        busy={busy}
        connected={run.connected}
        activeRunId={run.activeRunId}
        inputLabel={inputLabel}
        onLoadExperiment={onLoadExperiment}
        onRerunExperiment={onRerunExperiment}
        onRemoveExperiment={research.removeExperiment}
      />
    </section>
  );
}
