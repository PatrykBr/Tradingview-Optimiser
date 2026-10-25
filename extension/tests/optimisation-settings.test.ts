import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, mock } from 'bun:test';
import OptimisationSettingsSection from '../components/optimiser/OptimisationSettingsSection';
import type { StrategyConfigurationModel } from '../components/optimiser/useStrategyConfiguration';
import {
  cloneOptimisationDraft,
  DEFAULT_OPTIMISATION_DRAFT,
  type OptimisationDraft,
} from '../lib/optimisation/draft';

const render = (patch: Partial<OptimisationDraft> = {}, activeRunId: string | null = null) => {
  const model = {
    form: { ...cloneOptimisationDraft(DEFAULT_OPTIMISATION_DRAFT), ...patch },
    selectedInputCount: 1,
  };
  return renderToStaticMarkup(
    createElement(OptimisationSettingsSection, {
      model: model as StrategyConfigurationModel,
      activeRunId,
      connected: true,
      busy: false,
      onStart: mock(),
      onStop: mock(),
    }),
  );
};

describe('optimisation settings', () => {
  it('keeps optional settings hidden until their feature is enabled', () => {
    const html = render();
    expect(html).toContain('Start optimisation');
    for (const field of [
      'convergenceMinTrials',
      'robustnessFolds',
      'stabilityPerturbationPercent',
      'walkForwardTrialsPerFold',
      'monteCarloSimulations',
      'startDate',
    ]) {
      expect(html).not.toContain(`name="${field}"`);
    }
  });

  it('retains every research control, numeric constraint and date field', () => {
    const html = render({
      dateRangeEnabled: true,
      convergenceEnabled: true,
      robustnessEnabled: true,
      stabilityEnabled: true,
      walkForwardEnabled: true,
      monteCarloEnabled: true,
    });
    for (const field of [
      'convergenceMinTrials',
      'convergencePatience',
      'convergenceMinImprovementPercent',
      'robustnessValidationPercent',
      'robustnessFolds',
      'robustnessTopCandidates',
      'stabilityPerturbationPercent',
      'walkForwardFolds',
      'walkForwardTrialsPerFold',
      'walkForwardInitialTrainingPercent',
      'monteCarloSimulations',
      'monteCarloConfidencePercent',
      'startDate',
      'endDate',
    ]) {
      expect(html).toContain(`name="${field}"`);
    }
    expect(html).toMatch(/min="0\.1" max="25" step="0\.1" name="stabilityPerturbationPercent"/);
    expect(html).toMatch(/min="500" max="50000" name="monteCarloSimulations"/);
  });

  it('locks editing but keeps stopping available during an active run', () => {
    const html = render({ convergenceEnabled: true }, 'active-run');
    const field = html.match(/<input\b(?=[^>]*\bname="convergenceMinTrials")[^>]*>/)?.[0];
    expect(field).toContain('disabled=""');
    expect(html).toContain('Stop optimisation');
    expect(html).not.toContain('Start optimisation');
  });
});
