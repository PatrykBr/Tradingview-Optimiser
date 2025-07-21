import { MESSAGES } from '../config';
import type { MessageRequest, MessageResponse } from '../types';
import { TabDataExtractor } from '../extractors/tabData';
import { StrategyExtractor } from '../extractors/strategy';
import { DateRangeHandler } from './dateRangeHandler';
import { sendMessage } from '../utils';

export class MessageHandler {
  private tabDataExtractor: TabDataExtractor;
  private strategyExtractor: StrategyExtractor;
  private dateRangeHandler: DateRangeHandler;

  constructor() {
    this.tabDataExtractor = new TabDataExtractor();
    this.strategyExtractor = new StrategyExtractor();
    this.dateRangeHandler = new DateRangeHandler();
  }

  async handle(request: MessageRequest): Promise<MessageResponse> {
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
    const filter = request.filter || 'all';
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
      message: `Found ${strategies.length} strategies`
    };
  }

  private async handleOpenStrategySettings(request: MessageRequest): Promise<MessageResponse> {
    if (typeof request.strategyIndex !== 'number') {
      return { success: false, message: 'Invalid strategy index' };
    }

    try {
      const strategySettings = await this.strategyExtractor.openSettings(request.strategyIndex);
      
      if (strategySettings) {
        // Get existing strategies and update the specific one
        const existingStrategies = this.strategyExtractor.extract();
        
        if (existingStrategies[request.strategyIndex]) {
          existingStrategies[request.strategyIndex] = strategySettings;
          
          // Save the updated strategies back to storage
          const { sendMessage } = await import('../utils');
          const { MESSAGES } = await import('../config');
          sendMessage({ action: MESSAGES.saveStrategies, strategies: existingStrategies });
        }
        
        return {
          success: true,
          strategies: existingStrategies,
          message: `Extracted settings for: ${strategySettings.name} (${strategySettings.settings.length} parameters)`
        };
      } else {
        return {
          success: false,
          message: 'Failed to extract strategy settings - dialog may not have opened'
        };
      }
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
          message = enabled ? 
            `Date range was already set to ${startDate} - ${endDate}` : 
            'Date range was already set to chart range';
        } else {
          message = enabled ? 
            `Date range set to ${startDate} - ${endDate}` : 
            'Date range set to chart range';
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
      console.error('Error in handleChangeDateRange:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }
}
