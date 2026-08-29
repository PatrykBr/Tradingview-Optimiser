import type { BestSoFarPoint } from '../lib/optimisation/results';

interface BestSoFarChartProps {
  points: BestSoFarPoint[];
}

export default function BestSoFarChart({
  points,
}: BestSoFarChartProps) {
  if (points.length < 2) return null;

  const width = 330;
  const height = 92;
  const padding = 8;

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;

  const firstTrial = points[0]!.trial;
  const lastTrial = points[points.length - 1]!.trial;
  const trialSpread = lastTrial - firstTrial || 1;

  const coordinates = points.map((point) => {
    const x =
      padding +
      ((point.trial - firstTrial) / trialSpread) *
        (width - padding * 2);
    const y =
      height -
      padding -
      ((point.value - min) / spread) *
        (height - padding * 2);

    return { x, y };
  });

  const path = coordinates
    .map(
      (point, index) =>
        (index === 0 ? 'M' : 'L') +
        point.x.toFixed(2) +
        ' ' +
        point.y.toFixed(2),
    )
    .join(' ');

  return (
    <div className="bestChart">
      <svg
        viewBox={'0 0 ' + width + ' ' + height}
        role="img"
        aria-label="Best objective value so far"
      >
        <path className="bestChartLine" d={path} fill="none" />
      </svg>
      <div className="bestChartLabels">
        <span>Trial {firstTrial}</span>
        <span>Trial {lastTrial}</span>
      </div>
    </div>
  );
}
