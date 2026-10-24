import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import BestSoFarChart from '../components/BestSoFarChart';

describe('best-so-far chart', () => {
  it('preserves plateau endpoints without rendering a coordinate for every trial', () => {
    const points = Array.from({ length: 100_000 }, (_, trial) => ({
      trial, value: trial < 50_000 ? 1 : 2,
    }));
    const html = renderToStaticMarkup(createElement(BestSoFarChart, { points, metricKey: 'profitFactor' }));
    const path = html.match(/ d="([^"]+)"/)?.[1];
    expect(path?.match(/[ML]/g)).toHaveLength(4);
    expect(html).toContain('Best at trial 50000');
    expect(html).toContain('Trial 99999');
  });
});
