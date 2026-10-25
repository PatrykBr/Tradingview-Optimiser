import { useMemo } from 'react';

import { analyseSearchSpace } from '../../lib/optimisation/search-space-advisor';
import type { StrategyConfigurationModel } from './useStrategyConfiguration';

interface SearchSpaceAdvisorProps {
  model: StrategyConfigurationModel;
}

export default function SearchSpaceAdvisor({ model }: SearchSpaceAdvisorProps) {
  const advice = useMemo(
    () => analyseSearchSpace(model.inputs, model.parameterConfigs, model.form.targetTrials),
    [model.inputs, model.parameterConfigs, model.form.targetTrials],
  );

  if (advice.selectedParameters === 0) {
    return null;
  }

  return (
    <details className="searchAdvisor">
      <summary>
        <span>Pre-flight check</span>
        <span className="muted">
          {advice.items.some((item) => item.severity === 'warning') ? 'review' : 'no warnings'}
        </span>
      </summary>

      <div className="searchAdvisorSummary">
        <span>
          {advice.selectedParameters} parameter
          {advice.selectedParameters === 1 ? '' : 's'}
        </span>
        <span>{advice.continuousParameters} continuous</span>
        <span>{advice.conditionalParameters} conditional</span>
        {advice.discreteCombinations !== null && (
          <span>~{advice.discreteCombinations.toLocaleString()} discrete combinations</span>
        )}
      </div>

      <div className="advisorBudget">
        Estimated trial range:{' '}
        <strong>
          {advice.recommendedTrials.minimum} to {advice.recommendedTrials.comfortable}
        </strong>
      </div>

      <div className="advisorList">
        {advice.items.map((item) => (
          <div className={'advisorItem ' + item.severity} key={item.title + item.detail}>
            <span className="advisorDot" aria-hidden="true" />
            <div>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
