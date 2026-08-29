import type {
  RunAnalysis,
} from '../../lib/protocol/types';

interface ParameterImportanceProps {
  analysis: RunAnalysis | null;
  inputLabel: (
    id: string,
  ) => string;
}

export default function ParameterImportance({
  analysis,
  inputLabel,
}: ParameterImportanceProps) {
  const entries = Object.entries(
    analysis?.parameter_importance ?? {},
  )
    .sort(([, left], [, right]) =>
      right - left,
    )
    .slice(0, 8);

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="researchBlock">
      <div className="researchBlockTitle">
        Parameter importance
      </div>
      <div className="muted researchImportanceHint">
        Conditional parameters appear when they were sampled consistently.
      </div>
      <div className="importanceList">
        {entries.map(
          ([parameter, importance]) => (
            <div
              className="importanceRow"
              key={parameter}
            >
              <div className="importanceMeta">
                <span>
                  {inputLabel(parameter)}
                </span>
                <strong>
                  {Math.round(
                    importance * 100,
                  )}
                  %
                </strong>
              </div>
              <div className="importanceTrack">
                <div
                  className="importanceFill"
                  style={{
                    width:
                      Math.max(
                        2,
                        importance * 100,
                      ) + '%',
                  }}
                />
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
