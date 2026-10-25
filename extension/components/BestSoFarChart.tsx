import { formatMetric } from '../lib/optimisation/metrics';
import type { BestSoFarPoint } from '../lib/optimisation/results';

interface BestSoFarChartProps {
  points: BestSoFarPoint[];
  metricKey: string;
}

export default function BestSoFarChart({ points, metricKey }: BestSoFarChartProps) {
  if (points.length < 2) return null;

  const width = 330;
  const height = 92;
  const leftPadding = 34;
  const rightPadding = 8;
  const verticalPadding = 10;

  // Best-so-far values are monotonic, so the endpoints bound the domain.
  const first = points[0]!;
  const last = points.at(-1)!;
  const rawMin = Math.min(first.value, last.value);
  const rawMax = Math.max(first.value, last.value);
  const rawSpread = rawMax - rawMin;

  const domainPadding = rawSpread > 0 ? rawSpread * 0.08 : Math.max(Math.abs(rawMax) * 0.05, 0.05);
  const min = rawMin - domainPadding;
  const max = rawMax + domainPadding;
  const spread = max - min;

  const firstTrial = first.trial;
  const lastTrial = last.trial;
  const trialSpread = lastTrial - firstTrial || 1;

  // Keep both ends of each plateau: intermediate points lie on the same line.
  const plotted = points.filter(
    (point, index) =>
      index === 0 ||
      index === points.length - 1 ||
      point.value !== points[index - 1]!.value ||
      point.value !== points[index + 1]!.value,
  );
  const coordinates = plotted.map((point) => {
    const x =
      leftPadding +
      ((point.trial - firstTrial) / trialSpread) * (width - leftPadding - rightPadding);
    const y =
      height - verticalPadding - ((point.value - min) / spread) * (height - verticalPadding * 2);

    return {
      ...point,
      x,
      y,
    };
  });

  const path = coordinates
    .map(
      (point, index) => (index === 0 ? 'M' : 'L') + point.x.toFixed(2) + ' ' + point.y.toFixed(2),
    )
    .join(' ');

  const improvements = coordinates.filter(
    (point, index) => index === 0 || point.value !== coordinates[index - 1]!.value,
  );
  const best = improvements.at(-1)!;

  const markerStride = Math.max(1, Math.ceil(improvements.length / 10));
  const visibleMarkers = improvements.filter(
    (_, index) => index === 0 || index === improvements.length - 1 || index % markerStride === 0,
  );

  return (
    <div className="bestChart">
      <div className="bestChartHeader">
        <span>Best so far</span>
        <strong>{formatMetric(metricKey, best.value)}</strong>
      </div>

      <svg
        viewBox={'0 0 ' + width + ' ' + height}
        role="img"
        aria-label={'Best objective value so far: ' + formatMetric(metricKey, best.value)}
      >
        <text className="bestChartAxisLabel" x="2" y="13">
          {formatMetric(metricKey, rawMax)}
        </text>
        <text className="bestChartAxisLabel" x="2" y={height - 2}>
          {formatMetric(metricKey, rawMin)}
        </text>

        <path className="bestChartLine" d={path} fill="none" />

        {visibleMarkers.map((point) => {
          const current = point.trial === best.trial;

          return (
            <circle
              key={point.trial}
              className={current ? 'bestChartPoint bestChartPointCurrent' : 'bestChartPoint'}
              cx={point.x}
              cy={point.y}
              r={current ? 3 : 2}
            />
          );
        })}
      </svg>

      <div className="bestChartLabels">
        <span>Trial {firstTrial}</span>
        <span>Best at trial {best.trial}</span>
        <span>Trial {lastTrial}</span>
      </div>
    </div>
  );
}
