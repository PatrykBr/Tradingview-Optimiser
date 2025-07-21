import { STORAGE_KEYS } from './config';
import type { StrategySettings, StorageResult, DateRangeSettings } from './types';
import { TabDataPopupHandler } from './handlers/tabDataPopup';
import { StrategyPopupHandler } from './handlers/strategyPopup';
import { DateRangePopupHandler } from './handlers/dateRangePopup';
import { storageGet } from './utils';

const tabDataHandler = new TabDataPopupHandler();
const strategyHandler = new StrategyPopupHandler();
const dateRangeHandler = new DateRangePopupHandler();

const loadStoredData = async (): Promise<void> => {
  try {
    const result = await storageGet([
      STORAGE_KEYS.extractedData, 
      STORAGE_KEYS.strategies, 
      STORAGE_KEYS.dateRangeSettings
    ]) as StorageResult;
    
    if (result.extractedData && Array.isArray(result.extractedData) && result.extractedData.length > 0) {
      const firstItem = result.extractedData[0];
      if (firstItem && 'title' in firstItem && 'value' in firstItem) {
        tabDataHandler.display(result.extractedData as any);
      }
    }
    
    if (!result.extractedData && result.strategies && Array.isArray(result.strategies) && result.strategies.length > 0) {
      strategyHandler.displayStrategies(result.strategies as StrategySettings[]);
    }
  } catch (error: unknown) {
    console.log('No stored data available');
  }
};

// Event handlers
const eventHandlers = {
  extractBtn: () => tabDataHandler.extract(),
  clearBtn: () => tabDataHandler.clear(),
  refreshBtn: () => tabDataHandler.refresh(),
  overviewBtn: () => tabDataHandler.clickTab('overview'),
  performanceBtn: () => tabDataHandler.clickTab('performance'),
  tradesBtn: () => tabDataHandler.clickTab('trades'),
  ratiosBtn: () => tabDataHandler.clickTab('ratios'),
  allBtn: () => tabDataHandler.setFilter('all'),
  longBtn: () => tabDataHandler.setFilter('long'),
  shortBtn: () => tabDataHandler.setFilter('short'),
  extractStrategiesBtn: () => strategyHandler.extractStrategies()
};

Object.entries(eventHandlers).forEach(([id, handler]) => {
  document.getElementById(id)!.onclick = handler;
});

// Initialize
loadStoredData();
