import { SELECTORS } from '../config';
import type { ExtractedItem } from '../types';

export class TabDataExtractor {
    private filter: 'all' | 'long' | 'short' | 'none';

    constructor(filter: 'all' | 'long' | 'short' | 'none' = 'all') {
        this.filter = filter;
    }

    extract(): ExtractedItem[] {
        const overviewData = this.extractOverview();
        return overviewData.length > 0 ? overviewData : this.extractTable();
    }

    private extractOverview(): ExtractedItem[] {
        const overviewContainer = document.querySelector(SELECTORS.overview.container);
        if (!overviewContainer) return [];

        const cells = overviewContainer.querySelectorAll(SELECTORS.overview.cells);

        return Array.from(cells)
            .map((cell, index) => {
                const getText = (selector: string) => cell.querySelector(selector)?.textContent?.trim();

                const title = getText(SELECTORS.overview.title) || `Item ${index + 1}`;
                const value = getText(SELECTORS.overview.value);

                if (!value) return null;

                const item: ExtractedItem = {
                    title,
                    value,
                    timestamp: new Date().toISOString(),
                    tabType: 'overview'
                };

                const currency = getText(SELECTORS.overview.currency);
                const change = getText(SELECTORS.overview.change);

                if (currency) item.currency = currency;
                if (change) item.change = change;

                return item;
            })
            .filter(Boolean) as ExtractedItem[];
    }

    private extractTable(): ExtractedItem[] {
        const results: ExtractedItem[] = [];
        const tableContainer = document.querySelector(SELECTORS.table.container);

        if (!tableContainer) return results;

        const rows = tableContainer.querySelectorAll(SELECTORS.table.rows);

        // Determine tab type
        let tabType: 'performance' | 'trades' | 'ratios' = 'performance';
        if (document.querySelector('button[id="Trades Analysis"][aria-selected="true"]')) {
            tabType = 'trades';
        } else if (document.querySelector('button[id="Ratios"][aria-selected="true"]')) {
            tabType = 'ratios';
        }

        rows.forEach((row, index) => {
            const metricElement = row.querySelector(SELECTORS.table.metricCell);
            const valueElements = row.querySelectorAll(SELECTORS.table.valueCell);

            if (metricElement && valueElements.length > 0) {
                const title = metricElement.textContent?.trim() || `Metric ${index + 1}`;

                const columnNames = ['All', 'Long', 'Short'];
                const filterIndices = {
                    all: [0],
                    long: [1],
                    short: [2],
                    none: [0, 1, 2]
                };

                const indicesToExtract = filterIndices[this.filter];

                indicesToExtract.forEach(colIndex => {
                    if (colIndex < valueElements.length) {
                        const valueElement = valueElements[colIndex];
                        const value = valueElement.textContent?.trim();

                        if (value && value !== '') {
                            const currencyElement = valueElement.parentElement?.querySelector(
                                SELECTORS.table.currencyCell
                            );
                            const percentElement = valueElement.parentElement?.querySelector(
                                SELECTORS.table.percentCell
                            );

                            const itemTitle = this.filter === 'none' ? `${title} (${columnNames[colIndex]})` : title;

                            const item: ExtractedItem = {
                                title: itemTitle,
                                value: value,
                                timestamp: new Date().toISOString(),
                                tabType: tabType
                            };

                            const currency = currencyElement?.textContent?.trim();
                            const percent = percentElement?.textContent?.trim();

                            if (currency) item.currency = currency;
                            if (percent) item.change = percent;

                            results.push(item);
                        }
                    }
                });
            }
        });

        return results;
    }
}
