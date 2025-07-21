import { MESSAGES } from '../config';
import type { MessageRequest, MessageResponse } from '../types';
import { TabDataExtractor } from '../extractors/tabData';
import { StrategyExtractor } from '../extractors/strategy';
import { TabNavigator } from './tabNavigator';
import { DateRangeHandler } from './dateRangeHandler';
import { sendMessage } from '../utils';

export class MessageHandler {
  private tabDataExtractor: TabDataExtractor;
  private strategyExtractor: StrategyExtractor;
  private tabNavigator: TabNavigator;
  private dateRangeHandler: DateRangeHandler;

  constructor() {
    this.tabDataExtractor = new TabDataExtractor();
    this.strategyExtractor = new StrategyExtractor();
    this.tabNavigator = new TabNavigator();
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
      
      case MESSAGES.clickTab:
        return this.handleClickTab(request);
      
      case MESSAGES.changeDateRange:
        return await this.handleChangeDateRange(request);
      
      case MESSAGES.ping:
        return { success: true, message: 'Ready' };
      
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
        return {
          success: true,
          strategies: [strategySettings],
          message: `Extracted settings for: ${strategySettings.name}`
        };
      } else {
        return {
          success: false,
          message: 'Failed to extract strategy settings'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private handleClickTab(request: MessageRequest): MessageResponse {
    if (!request.tabId) {
      return { success: false, message: 'No tab ID provided' };
    }

    const success = this.tabNavigator.click(request.tabId);
    
    return {
      success: success,
      message: success ? 
        `Switched to ${request.tabId} tab` : 
        `Failed to switch to ${request.tabId} tab`
    };
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
