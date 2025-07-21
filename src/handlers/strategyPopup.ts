import { MESSAGES } from '../config';
import type { StrategySettings, MessageResponse } from '../types';
import { tabs, sendMessage, setStatus, getActiveTab } from '../utils';

export class StrategyPopupHandler {

  async extractStrategies(): Promise<void> {
    setStatus('Extracting strategies...');
    
    try {
      const tab = await getActiveTab();
      
      const response = await tabs.sendMessage(tab.id, { 
        action: MESSAGES.extractStrategies
      }) as MessageResponse;
      
      if (response?.strategies && response.strategies.length > 0) {
        sendMessage({ action: MESSAGES.saveStrategies, strategies: response.strategies });
        setStatus(`Found ${response.strategies.length} strategies`);
      } else {
        setStatus('No strategies found');
      }
    } catch (error: unknown) {
      setStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async openStrategySettings(strategyIndex: number): Promise<void> {
    setStatus('Opening strategy settings...');
    
    try {
      const tab = await getActiveTab();
      
      const response = await tabs.sendMessage(tab.id, { 
        action: MESSAGES.openStrategySettings,
        strategyIndex: strategyIndex
      }) as MessageResponse;
      
      if (response?.strategies && response.strategies.length > 0) {
        sendMessage({ action: MESSAGES.saveStrategies, strategies: response.strategies });
        setStatus(response.message || 'Strategy settings extracted');
      } else {
        setStatus('Failed to extract strategy settings');
      }
    } catch (error: unknown) {
      setStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
