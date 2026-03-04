import { describe, expect, it } from 'vitest';
import { sanitizeOptimizationConfigInput, sanitizeTrialParamsInput } from './config-schema';

describe('sanitizeOptimizationConfigInput', () => {
  it('clamps oversized values and strips invalid run ids', () => {
    const sanitized = sanitizeOptimizationConfigInput({
      name: 'Test Config',
      strategyName: 'My Strategy',
      strategyIndex: 0,
      runMode: 'warm_start',
      sampler: 'auto',
      selectedHistoryRunIds: ['run-a', 'run-a', '', 'run-b'],
      targetMetric: 'Profit factor',
      targetMetricDirection: 'maximize',
      targetMetricColumn: 'all',
      totalTrials: 999999,
      parameters: [],
      filters: [],
      antiDetection: { enabled: true, minDelay: 1, maxDelay: 999999 },
    });

    expect(sanitized.totalTrials).toBe(10000);
    expect(sanitized.selectedHistoryRunIds).toEqual(['run-a', 'run-b']);
    expect(sanitized.antiDetection.minDelay).toBeGreaterThanOrEqual(50);
    expect(sanitized.antiDetection.maxDelay).toBeLessThanOrEqual(120000);
  });

  it('deduplicates dropdown options while preserving order', () => {
    const sanitized = sanitizeOptimizationConfigInput({
      name: 'Dropdown Config',
      strategyName: 'My Strategy',
      strategyIndex: 0,
      runMode: 'fresh',
      sampler: 'auto',
      selectedHistoryRunIds: [],
      targetMetric: 'Profit factor',
      targetMetricDirection: 'maximize',
      targetMetricColumn: 'all',
      totalTrials: 50,
      parameters: [
        {
          id: 'mode',
          label: 'Mode',
          section: 'General',
          type: 'dropdown',
          enabled: true,
          currentValue: 'Fast',
          options: ['Fast', 'Fast', 'Safe', '', 'Safe'],
          selectedOptions: ['Fast', 'Fast', 'Missing'],
        },
      ],
      filters: [],
      antiDetection: { enabled: true, minDelay: 200, maxDelay: 600 },
    });

    const dropdown = sanitized.parameters[0];
    expect(dropdown?.type).toBe('dropdown');
    if (dropdown?.type !== 'dropdown') return;
    expect(dropdown.options).toEqual(['Fast', 'Safe']);
    expect(dropdown.selectedOptions).toEqual(['Fast']);
  });

  it('assigns deterministic unique ids for invalid or duplicate filters', () => {
    const sanitized = sanitizeOptimizationConfigInput({
      name: 'Filter Config',
      strategyName: 'My Strategy',
      strategyIndex: 0,
      runMode: 'fresh',
      sampler: 'auto',
      selectedHistoryRunIds: [],
      targetMetric: 'Profit factor',
      targetMetricDirection: 'maximize',
      targetMetricColumn: 'all',
      totalTrials: 50,
      parameters: [],
      filters: [
        { metricName: 'Total trades', operator: '>=', value: 10, enabled: true },
        { id: 'dup', metricName: 'Total trades', operator: '>=', value: 20, enabled: true },
        { id: 'dup', metricName: 'Total trades', operator: '>=', value: 30, enabled: true },
      ],
      antiDetection: { enabled: true, minDelay: 200, maxDelay: 600 },
    });

    expect(sanitized.filters.map((filter) => filter.id)).toEqual(['filter_1', 'dup', 'dup_2']);
  });
});

describe('sanitizeTrialParamsInput', () => {
  it('drops invalid keys and unsupported values', () => {
    const params = sanitizeTrialParamsInput({
      valid_number: 10,
      valid_bool: true,
      valid_text: 'ok',
      'bad key': 1,
      notFinite: Infinity,
      nested: { value: 1 },
    });

    expect(params).toEqual({
      valid_number: 10,
      valid_bool: true,
      valid_text: 'ok',
    });
  });
});
