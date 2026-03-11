import type { WarmStartTrialSeed } from '../shared/messages';
import type { OptimizationConfig, TrialHistoryRun, TrialResult } from '../shared/types';
import { resolveFamilyName } from '../shared/study-signature';

function serializeTrialParamValue(value: number | string | boolean): string {
  return `${typeof value}:${String(value)}`;
}

export function resolveWarmStartSourceRuns(
  historyRuns: TrialHistoryRun[],
  selectedHistoryRunIds: string[],
  familyName: string,
): TrialHistoryRun[] {
  const familyRuns = historyRuns
    .filter((run) => run.familyName === familyName)
    .sort((a, b) => a.completedAt - b.completedAt);

  const selectedIds = new Set(selectedHistoryRunIds.filter((id) => typeof id === 'string' && id.length > 0));
  if (selectedIds.size === 0) {
    return [];
  }

  return familyRuns.filter((run) => selectedIds.has(run.id));
}

export function pruneSelectedHistoryRunIds(selectedHistoryRunIds: string[], historyRuns: TrialHistoryRun[]): string[] {
  if (selectedHistoryRunIds.length === 0) return selectedHistoryRunIds;
  const existingRunIds = new Set(historyRuns.map((run) => run.id));
  return selectedHistoryRunIds.filter((id) => existingRunIds.has(id));
}

export function recomputeVisibleHistoryTrials(
  config: OptimizationConfig | null,
  historyRuns: TrialHistoryRun[],
): TrialResult[] {
  if (config?.runMode !== 'warm_start') {
    return [];
  }

  const familyName = resolveFamilyName(config);
  if (!familyName) {
    return [];
  }

  return resolveWarmStartSourceRuns(historyRuns, config.selectedHistoryRunIds ?? [], familyName)
    .flatMap((run) => run.trials)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function buildWarmStartSeedTrials(runs: TrialHistoryRun[], maxSeeds: number): WarmStartTrialSeed[] {
  const dedup = new Map<string, WarmStartTrialSeed>();
  const orderedRuns = [...runs].sort((a, b) => a.completedAt - b.completedAt);
  for (const run of orderedRuns) {
    for (const trial of run.trials) {
      if (!trial.passedFilters || !Number.isFinite(trial.objectiveValue)) {
        continue;
      }
      const key = Object.keys(trial.params)
        .sort((a, b) => a.localeCompare(b))
        .map((name) => `${name}:${serializeTrialParamValue(trial.params[name])}`)
        .join('|');
      dedup.set(key, {
        params: trial.params as Record<string, number | string | boolean>,
        value: trial.objectiveValue,
      });
    }
  }

  const seeds = [...dedup.values()];
  if (seeds.length <= maxSeeds) {
    return seeds;
  }
  return seeds.slice(seeds.length - maxSeeds);
}
