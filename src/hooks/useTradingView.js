import { useState, useEffect, useCallback } from 'react';

export function useTradingView() {
  const [strategies, setStrategies] = useState([]);
  const [selectedStrategy, setSelectedStrategy] = useState(null);
  const [strategySettings, setStrategySettings] = useState(null);
  const [isLoadingStrategies, setIsLoadingStrategies] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);

  // Send message to content script via background
  const sendToContent = useCallback(async (action, data = {}) => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'forwardToContent',
        data: { action, ...data }
      }, (response) => {
        resolve(response);
      });
    });
  }, []);

  // Detect strategies on page load
  useEffect(() => {
    refreshStrategies();
  }, []);

  const refreshStrategies = useCallback(async () => {
    setIsLoadingStrategies(true);
    try {
      const response = await sendToContent('detectStrategies');
      if (response.success) {
        setStrategies(response.strategies);
        // Auto-select first strategy if available
        if (response.strategies.length > 0 && !selectedStrategy) {
          selectStrategy(0);
        }
      }
    } catch (error) {
      console.error('Failed to detect strategies:', error);
    } finally {
      setIsLoadingStrategies(false);
    }
  }, [sendToContent, selectedStrategy]);

  const selectStrategy = useCallback(async (strategyIndex) => {
    const strategy = strategies.find(s => s.index === strategyIndex);
    if (strategy) {
      setSelectedStrategy(strategy);
      // Automatically load settings for selected strategy
      await loadStrategySettings(strategyIndex);
    }
  }, [strategies]);

  const loadStrategySettings = useCallback(async (strategyIndex) => {
    setIsLoadingSettings(true);
    try {
      const response = await sendToContent('readStrategySettings', { strategyIndex });
      if (response.success) {
        setStrategySettings(response.settings);
      }
    } catch (error) {
      console.error('Failed to read strategy settings:', error);
    } finally {
      setIsLoadingSettings(false);
    }
  }, [sendToContent]);

  const refreshSettings = useCallback(async () => {
    if (selectedStrategy) {
      await loadStrategySettings(selectedStrategy.index);
    }
  }, [selectedStrategy, loadStrategySettings]);

  return {
    strategies,
    selectedStrategy,
    strategySettings,
    isLoadingStrategies,
    isLoadingSettings,
    selectStrategy,
    refreshStrategies,
    refreshSettings
  };
} 