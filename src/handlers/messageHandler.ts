import { MESSAGES, STORAGE_KEYS, UI_TEXT } from '../config';
import type { MessageRequest, MessageResponse } from '../types';
import { TabDataExtractor } from '../extractors/tabData';
import { StrategyExtractor } from '../extractors/strategy';
import { DateRangeHandler } from './dateRangeHandler';
import { sendMessage, storageGet } from '../utils';

/**
 * Central message handler for content script
 * Routes messages to appropriate extractors and handlers
 */
export class MessageHandler {
    private tabDataExtractor: TabDataExtractor;
    private strategyExtractor: StrategyExtractor;
    private dateRangeHandler: DateRangeHandler;

    constructor() {
        this.tabDataExtractor = new TabDataExtractor();
        this.strategyExtractor = new StrategyExtractor();
        this.dateRangeHandler = new DateRangeHandler();
    }

    /**
     * Handle incoming messages and route to appropriate handler
     * @param request - The message request to process
     * @returns Response indicating success/failure and any data
     */
    async handle(request: MessageRequest): Promise<MessageResponse> {
        if (!request || !request.action) {
            return { success: false, message: 'Invalid request - missing action' };
        }

        const response: MessageResponse = { success: false };

        switch (request.action) {
            case MESSAGES.extractData:
                return this.handleExtractData(request);

            case MESSAGES.extractStrategies:
                return this.handleExtractStrategies();

            case MESSAGES.openStrategySettings:
                return await this.handleOpenStrategySettings(request);

            case MESSAGES.changeDateRange:
                return await this.handleChangeDateRange(request);

            default:
                return response;
        }
    }

    private handleExtractData(request: MessageRequest): MessageResponse {
        if (!request.filter) {
            return { success: false, message: 'Filter parameter is required for data extraction' };
        }

        const filter = request.filter;
        this.tabDataExtractor = new TabDataExtractor(filter);
        const data = this.tabDataExtractor.extract();

        sendMessage({ action: MESSAGES.saveData, data });

        return {
            success: true,
            data: data
        };
    }

    private handleExtractStrategies(): MessageResponse {
        const strategies = this.strategyExtractor.extract();

        return {
            success: true,
            strategies: strategies,
            message: UI_TEXT.success.strategiesExtracted(strategies.length)
        };
    }

    private async handleOpenStrategySettings(request: MessageRequest): Promise<MessageResponse> {
        if (typeof request.strategyIndex !== 'number') {
            return { success: false, message: 'Invalid strategy index' };
        }

        try {
            const strategySettings = await this.strategyExtractor.openSettings(request.strategyIndex);

            // Get existing strategies from storage
            const storageResult = await storageGet(STORAGE_KEYS.strategies);
            const existingStrategies = storageResult[STORAGE_KEYS.strategies];

            // Update the specific strategy with new settings
            if (Array.isArray(existingStrategies) && existingStrategies[request.strategyIndex]) {
                existingStrategies[request.strategyIndex] = {
                    ...existingStrategies[request.strategyIndex],
                    ...strategySettings,
                    timestamp: strategySettings.timestamp
                };

                // Save the updated strategies back to storage
                sendMessage({ action: MESSAGES.saveStrategies, strategies: existingStrategies });
            }

            return {
                success: true,
                strategies: [strategySettings],
                message: UI_TEXT.success.settingsExtracted(strategySettings.name, strategySettings.settings.length)
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private async handleChangeDateRange(request: MessageRequest): Promise<MessageResponse> {
        if (!request.dateRangeSettings) {
            return { success: false, message: 'No date range settings provided' };
        }

        const { enabled, startDate, endDate } = request.dateRangeSettings;

        try {
            const result = await this.dateRangeHandler.changeDateRange(enabled, startDate, endDate);

            if (result.success) {
                // Save the settings to storage
                sendMessage({
                    action: MESSAGES.saveDateRangeSettings,
                    dateRangeSettings: request.dateRangeSettings
                });

                let message: string;
                if (result.alreadySet) {
                    message = enabled
                        ? UI_TEXT.success.dateRangeAlreadySet(startDate, endDate)
                        : UI_TEXT.success.dateRangeAlreadyChart;
                } else {
                    message = enabled
                        ? UI_TEXT.success.dateRangeSet(startDate, endDate)
                        : UI_TEXT.success.dateRangeSetToChart;
                }

                return {
                    success: true,
                    dateRangeSettings: request.dateRangeSettings,
                    message: message
                };
            } else {
                return {
                    success: false,
                    message: 'Failed to change date range - date picker elements not found on this page'
                };
            }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error occurred'
            };
        }
    }
}
