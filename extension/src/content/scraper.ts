/**
 * Result Scraper
 *
 * Reads the TradingView Strategy Tester performance summary
 * and extracts all metric values.
 */

import type { ContentScriptResponse } from '../shared/messages';
import type { Metric } from '../shared/types';
import { sleep } from '../utils/delay';
import { ensureBacktestingPanelOpen } from './tradingview-dom';

const SUMMARY_TABLE_SPECS = [
  { id: 'returns-summary-table', section: 'Returns' },
  { id: 'benchmarking-table', section: 'Benchmarking' },
  { id: 'ratios-table', section: 'Ratios' },
  { id: 'trades-analysis-table', section: 'Trades' },
  { id: 'capital-efficiency-table', section: 'Capital' },
  { id: 'margin-efficiency-table', section: 'Margin' },
  { id: 'run-ups-table', section: 'Run-ups' },
  { id: 'drawdowns-table', section: 'Drawdowns' },
] as const;

/**
 * Parse a numeric value from a TradingView metric string.
 * Handles formats like "+0.03", "42.31%", "1,000,000.00", "-22,915.29"
 */
function parseMetricValue(raw: string): number {
  if (!raw || raw === '∅' || raw === '—' || raw === 'N/A') return 0;

  // Remove currency symbols, commas, and whitespace
  let cleaned = raw
    .replace(
      /(CAD|USD|EUR|GBP|JPY|AUD|CHF|NZD|HKD|SGD|SEK|NOK|DKK|ZAR|TRY|BRL|INR|KRW|TWD|MXN|PLN|CZK|HUF|ILS|RUB|CNY|%)/g,
      '',
    )
    .replace(/,/g, '')
    .trim();

  // Handle special characters
  cleaned = cleaned.replace(/[−–]/g, '-'); // normalize minus signs

  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Scrape the top bar summary cards.
 */
function scrapeTopBar(panel: HTMLElement): Metric[] {
  const metrics: Metric[] = [];
  const cards = panel.querySelectorAll('[class*="containerCell-"]');

  for (const card of cards) {
    const nameEl = card.querySelector('[class*="title-"]') as HTMLElement;
    const valueEl = card.querySelector('[class*="value-"]') as HTMLElement;
    const currencyEl = card.querySelector('[class*="currency-"]') as HTMLElement;
    const changeEl = card.querySelector('[class*="change-"]') as HTMLElement;

    if (nameEl && valueEl) {
      const name = nameEl.textContent?.trim() ?? '';
      const value = valueEl.textContent?.trim() ?? '';
      const isPositive = card.querySelector('[class*="positiveValue-"]') !== null;
      const isNegative = card.querySelector('[class*="negativeValue-"]') !== null;

      metrics.push({
        name,
        value,
        numericValue: parseMetricValue(value),
        currency: currencyEl?.textContent?.trim(),
        percentValue: changeEl?.textContent?.trim(),
        column: 'all',
        section: 'Top Bar',
        isPositive,
        isNegative,
      });
    }
  }

  return metrics;
}

/**
 * Scrape a data table by its data-qa-id.
 * Tables have columns: Metric | All | Long | Short (some only Metric | All)
 */
function scrapeTable(panel: HTMLElement, tableId: string, section: string): Metric[] {
  const metrics: Metric[] = [];
  const table = panel.querySelector(`[data-qa-id="${tableId}"]`);
  if (!table) return metrics;

  const rows = table.querySelectorAll('tr.ka-row');

  for (const row of rows) {
    const cells = row.querySelectorAll('td.ka-cell');
    if (cells.length < 2) continue;

    // First cell is the metric name
    const nameEl = cells[0].querySelector('[class*="title-"]') as HTMLElement;
    const name = nameEl?.textContent?.trim() ?? '';
    if (!name) continue;

    // Parse each column: All, Long, Short
    const columns: Array<'all' | 'long' | 'short'> = ['all', 'long', 'short'];

    for (let i = 1; i < cells.length && i <= 3; i++) {
      const cell = cells[i];
      const valueEl = cell.querySelector('[class*="value-"]') as HTMLElement;
      const currencyEl = cell.querySelector('[class*="currency-"]') as HTMLElement;
      const percentEl = cell.querySelector('[class*="percentValue-"]') as HTMLElement;
      const isPositive = cell.querySelector('[class*="positiveValue-"]') !== null;
      const isNegative = cell.querySelector('[class*="negativeValue-"]') !== null;

      if (valueEl) {
        const value = valueEl.textContent?.trim() ?? '';
        metrics.push({
          name,
          value,
          numericValue: parseMetricValue(value),
          currency: currencyEl?.textContent?.trim(),
          percentValue: percentEl?.textContent?.trim(),
          column: columns[i - 1],
          section,
          isPositive,
          isNegative,
        });
      }
    }
  }

  return metrics;
}

function scrapeAllSummaryTables(panel: HTMLElement): Metric[] {
  return SUMMARY_TABLE_SPECS.flatMap((table) => scrapeTable(panel, table.id, table.section));
}

/**
 * Main scraper: reads all metrics from the strategy tester panel.
 */
export async function scrapeResults(): Promise<ContentScriptResponse> {
  try {
    const panel = await ensureBacktestingPanelOpen({ timeoutMs: 2500, pollIntervalMs: 80 });
    if (!panel) {
      return {
        type: 'RESULTS_SCRAPED',
        metrics: [],
        success: false,
        error: 'Strategy Report panel not found. Open Strategy Report and retry.',
      };
    }

    // Ensure we're on the Metrics tab
    const metricsTab = panel.querySelector('button[id="Strategy report"]') as HTMLButtonElement;
    if (metricsTab && metricsTab.getAttribute('aria-selected') !== 'true') {
      metricsTab.click();
      await sleep(150);
    }

    // Retry loop: wait for table content to render after tab switch
    let allMetrics: Metric[] = [];
    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      allMetrics = [];

      // Top bar cards
      allMetrics.push(...scrapeTopBar(panel));

      // Expand all sections if collapsed
      const sectionButtons = panel.querySelectorAll('[data-qa-id$="-button"]');
      for (const btn of sectionButtons) {
        if (btn.getAttribute('aria-expanded') === 'false') {
          (btn as HTMLElement).click();
          await sleep(50);
        }
      }

      allMetrics.push(...scrapeAllSummaryTables(panel));

      if (allMetrics.length > 0) break;

      // Wait before retrying
      if (attempt < maxAttempts - 1) {
        await sleep(300);
      }
    }

    if (allMetrics.length === 0) {
      // One more recovery attempt: panel may have collapsed or re-rendered during recalculation.
      const recoveredPanel = await ensureBacktestingPanelOpen({ timeoutMs: 1500, pollIntervalMs: 80 });
      if (recoveredPanel) {
        allMetrics = [];
        allMetrics.push(...scrapeTopBar(recoveredPanel));
        allMetrics.push(...scrapeAllSummaryTables(recoveredPanel));
      }
    }

    if (allMetrics.length === 0) {
      return {
        type: 'RESULTS_SCRAPED',
        metrics: [],
        success: false,
        error: 'No metrics found. Strategy Report may be collapsed or backtest still loading.',
      };
    }

    return {
      type: 'RESULTS_SCRAPED',
      metrics: allMetrics,
      success: true,
    };
  } catch (err) {
    return {
      type: 'RESULTS_SCRAPED',
      metrics: [],
      success: false,
      error: err instanceof Error ? err.message : 'Scraping failed',
    };
  }
}
