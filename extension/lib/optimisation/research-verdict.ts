import type { RunProgress } from '../protocol/types';
import type { ResearchEvaluation } from './research';

export type EvidenceRating = 'strong' | 'moderate' | 'weak' | 'insufficient';

export interface EvidenceArea {
  id: string;
  label: string;
  rating: EvidenceRating;
  detail: string;
}

export interface ResearchVerdict {
  overall: EvidenceRating;
  areas: EvidenceArea[];
  concerns: string[];
}

const tradeSampleArea = (progress: RunProgress): EvidenceArea => {
  const totalTrades = progress.best?.metrics.totalTrades;

  if (typeof totalTrades !== 'number' || !Number.isFinite(totalTrades)) {
    return {
      id: 'sample',
      label: 'Trade sample',
      rating: 'insufficient',
      detail: 'TradingView did not expose a trade count for the best result.',
    };
  }

  if (totalTrades >= 300) {
    return {
      id: 'sample',
      label: 'Trade sample',
      rating: 'strong',
      detail: Math.round(totalTrades) + ' trades form a broad historical sample.',
    };
  }

  if (totalTrades >= 100) {
    return {
      id: 'sample',
      label: 'Trade sample',
      rating: 'moderate',
      detail: Math.round(totalTrades) + ' trades leave sampling uncertainty.',
    };
  }

  return {
    id: 'sample',
    label: 'Trade sample',
    rating: 'weak',
    detail:
      Math.round(totalTrades) +
      ' trades form a small sample. A few outcomes can change the metrics substantially.',
  };
};

const robustnessArea = (research: ResearchEvaluation): EvidenceArea | null => {
  const result = research.robustness;
  const winner = result?.candidates[0];

  if (!result || !winner) {
    return null;
  }

  const passRate = winner.totalWindows > 0 ? winner.passedWindows / winner.totalWindows : 0;
  const degradation = winner.degradationPercent;

  const rating: EvidenceRating =
    passRate === 1 && degradation !== null && degradation <= 20
      ? 'strong'
      : passRate >= 0.67 && (degradation === null || degradation <= 40)
        ? 'moderate'
        : 'weak';

  return {
    id: 'robustness',
    label: 'OOS robustness',
    rating,
    detail:
      winner.passedWindows +
      '/' +
      winner.totalWindows +
      ' unseen folds passed' +
      (degradation === null
        ? '.'
        : ', with ' + degradation.toFixed(1) + '% objective degradation.'),
  };
};

const stabilityArea = (research: ResearchEvaluation): EvidenceArea | null => {
  const result = research.stability;

  if (!result) return null;

  const rating: EvidenceRating =
    result.overallRating === 'strong'
      ? 'strong'
      : result.overallRating === 'moderate'
        ? 'moderate'
        : 'weak';

  return {
    id: 'stability',
    label: 'Parameter stability',
    rating,
    detail:
      result.overallRating === 'strong'
        ? 'Nearby numeric parameter values retained similar performance.'
        : result.overallRating === 'moderate'
          ? 'Some nearby parameter values reduced performance.'
          : 'Small parameter changes caused large degradation or filter failures.',
  };
};

const walkForwardArea = (research: ResearchEvaluation): EvidenceArea | null => {
  const result = research.walkForward;

  if (!result) return null;

  const passRate = result.totalFolds > 0 ? result.passedFolds / result.totalFolds : 0;

  const rating: EvidenceRating =
    passRate >= 0.75 ? 'strong' : passRate >= 0.5 ? 'moderate' : 'weak';

  return {
    id: 'walk-forward',
    label: 'Walk-forward',
    rating,
    detail:
      result.passedFolds +
      '/' +
      result.totalFolds +
      ' independently re-optimised folds passed the configured constraints.',
  };
};

const monteCarloArea = (research: ResearchEvaluation): EvidenceArea | null => {
  const result = research.monteCarlo;

  if (!result) return null;

  if (!result.available) {
    return {
      id: 'monte-carlo',
      label: 'Monte Carlo',
      rating: 'insufficient',
      detail: result.reason ?? 'Trade-level data was unavailable.',
    };
  }

  const lossProbability = result.probabilityOfLoss;

  if (lossProbability === null) {
    return {
      id: 'monte-carlo',
      label: 'Monte Carlo',
      rating: 'insufficient',
      detail: 'The simulation did not produce a usable loss probability.',
    };
  }

  const rawRating: EvidenceRating =
    lossProbability <= 0.05 ? 'strong' : lossProbability <= 0.2 ? 'moderate' : 'weak';
  const rating: EvidenceRating =
    result.source === 'optimisation' && rawRating === 'strong' ? 'moderate' : rawRating;

  return {
    id: 'monte-carlo',
    label: 'Monte Carlo',
    rating,
    detail:
      (lossProbability * 100).toFixed(1) +
      '% of bootstrap simulations finished with negative cumulative PnL' +
      (result.source === 'oos'
        ? ' on the unseen OOS trade sample.'
        : ' on the optimisation-period trade sample. In-sample Monte Carlo contributes at most moderate evidence.'),
  };
};

const overallFrom = (areas: EvidenceArea[]): EvidenceRating => {
  const rated = areas.filter((area) => area.rating !== 'insufficient');

  if (rated.length === 0) {
    return 'insufficient';
  }

  const weak = rated.filter((area) => area.rating === 'weak').length;
  const strong = rated.filter((area) => area.rating === 'strong').length;

  if (weak >= 2) return 'weak';

  if (weak === 0 && strong >= 2) {
    return 'strong';
  }

  return 'moderate';
};

export const buildResearchVerdict = (
  progress: RunProgress,
  research: ResearchEvaluation,
): ResearchVerdict => {
  const areas: EvidenceArea[] = [tradeSampleArea(progress)];

  for (const area of [
    robustnessArea(research),
    stabilityArea(research),
    walkForwardArea(research),
    monteCarloArea(research),
  ]) {
    if (area) areas.push(area);
  }

  const concerns = areas
    .filter((area) => area.rating === 'weak' || area.rating === 'insufficient')
    .map((area) => area.label + ': ' + area.detail);

  return {
    overall: overallFrom(areas),
    areas,
    concerns,
  };
};
