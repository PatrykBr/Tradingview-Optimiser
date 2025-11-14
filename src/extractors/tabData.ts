import { SELECTORS } from '../config';
import type { ExtractedItem } from '../types';

/**
 * Extracts performance metrics from TradingView's strategy tester tabs
 * Supports Overview, Performance Summary, Trades, and Ratios tabs
 */
export class TabDataExtractor {
    private filter: 'all' | 'long' | 'short' | 'none';

    constructor(filter: 'all' | 'long' | 'short' | 'none' = 'all') {
        this.filter = filter;
    }

    /**
     * Extract data from the current tab (Overview or Table view)
     * @returns Array of extracted items with metrics and values
     * @throws Error if neither overview nor table data can be extracted
     */
    extract(): ExtractedItem[] {
        try {
            return this.extractOverview();
        } catch {
            return this.extractTable();
        }
    }

    private extractOverview(): ExtractedItem[] {
        const overviewContainer = document.querySelector(SELECTORS.overview.container);
        if (!overviewContainer) {
            throw new Error('Overview container not found - ensure you are viewing a strategy tab');
        }

        const cells = overviewContainer.querySelectorAll(SELECTORS.overview.cells);
        if (cells.length === 0) {
            throw new Error('No data cells found in overview');
        }

        const getText = (cell: Element, selector: string) => cell.querySelector(selector)?.textContent?.trim();

        return Array.from(cells)
            .map(cell => {
                const title = getText(cell, SELECTORS.overview.title);
                const value = getText(cell, SELECTORS.overview.value);

                if (!title || !value) return null;

                const item: ExtractedItem = {
                    title,
                    value,
                    timestamp: new Date().toISOString(),
                    tabType: 'overview'
                };

                const currency = getText(cell, SELECTORS.overview.currency);
                const change = getText(cell, SELECTORS.overview.change);

                if (currency) item.currency = currency;
                if (change) item.change = change;

                return item;
            })
            .filter(Boolean) as ExtractedItem[];
    }

    private extractTable(): ExtractedItem[] {
        const tableContainer = document.querySelector(SELECTORS.table.container);
        if (!tableContainer) {
            throw new Error('Table container not found - ensure you are viewing a strategy performance tab');
        }

        const rows = tableContainer.querySelectorAll(SELECTORS.table.rows);
        if (rows.length === 0) {
            throw new Error('No data rows found in table');
        }

        const tabType = this.determineTabType();
        const results: ExtractedItem[] = [];

        rows.forEach(row => {
            const items = this.extractRowData(row, tabType);
            results.push(...items);
        });

        return results;
    }

    private determineTabType(): 'performance' | 'trades' | 'ratios' {
        if (document.querySelector('button[id="Trades Analysis"][aria-selected="true"]')) {
            return 'trades';
        }
        if (document.querySelector('button[id="Ratios"][aria-selected="true"]')) {
            return 'ratios';
        }
        return 'performance';
    }

    private extractRowData(row: Element, tabType: 'performance' | 'trades' | 'ratios'): ExtractedItem[] {
        const metricElement = row.querySelector(SELECTORS.table.metricCell);
        const valueElements = row.querySelectorAll(SELECTORS.table.valueCell);
        const title = metricElement?.textContent?.trim();

        if (!title || valueElements.length === 0) {
            return [];
        }

        const columnNames = ['All', 'Long', 'Short'] as const;
        const filterIndices = this.getFilterIndices();
        const results: ExtractedItem[] = [];

        filterIndices.forEach(colIndex => {
            if (colIndex < valueElements.length) {
                const item = this.createExtractedItem(valueElements[colIndex], title, columnNames[colIndex], tabType);
                if (item) {
                    results.push(item);
                }
            }
        });

        return results;
    }

    private getFilterIndices(): number[] {
        const filterMap: Record<typeof this.filter, number[]> = {
            all: [0],
            long: [1],
            short: [2],
            none: [0, 1, 2]
        };
        return filterMap[this.filter];
    }

    private createExtractedItem(
        valueElement: Element,
        baseTitle: string,
        columnName: string,
        tabType: 'performance' | 'trades' | 'ratios'
    ): ExtractedItem | null {
        const value = valueElement.textContent?.trim();
        if (!value) {
            return null;
        }

        const currencyElement = valueElement.parentElement?.querySelector(SELECTORS.table.currencyCell);
        const percentElement = valueElement.parentElement?.querySelector(SELECTORS.table.percentCell);

        const item: ExtractedItem = {
            title: this.filter === 'none' ? `${baseTitle} (${columnName})` : baseTitle,
            value,
            timestamp: new Date().toISOString(),
            tabType
        };

        const currency = currencyElement?.textContent?.trim();
        const percent = percentElement?.textContent?.trim();

        if (currency) item.currency = currency;
        if (percent) item.change = percent;

        return item;
    }
}
