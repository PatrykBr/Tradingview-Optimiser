import { MESSAGES, STATUS_MESSAGES } from '../config';
import type { StrategySettings, MessageResponse } from '../types';
import { tabs, sendMessage, getElement, escapeHtml, setStatus, handleError, getActiveTab } from '../utils';

export class StrategyPopupHandler {

  async extractStrategies(): Promise<void> {
    setStatus('Extracting strategies...');
    
    try {
      const tab = await getActiveTab();
      
      const response = await tabs.sendMessage(tab.id, { 
        action: MESSAGES.extractStrategies
      }) as MessageResponse;
      
      if (response?.strategies && response.strategies.length > 0) {
        this.displayStrategies(response.strategies);
        sendMessage({ action: MESSAGES.saveStrategies, strategies: response.strategies });
        setStatus(`Found ${response.strategies.length} strategies`);
        
        this.showStrategyList(response.strategies);
      } else {
        setStatus('No strategies found');
        this.hideStrategyList();
      }
    } catch (error: unknown) {
      setStatus(`Error: ${handleError(error)}`);
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
        this.displayStrategies(response.strategies);
        sendMessage({ action: MESSAGES.saveStrategies, strategies: response.strategies });
        setStatus(response.message || 'Strategy settings extracted');
      } else {
        setStatus('Failed to extract strategy settings');
      }
    } catch (error: unknown) {
      setStatus(`Error: ${handleError(error)}`);
    }
  }

  displayStrategies(strategies: StrategySettings[]): void {
    const container = getElement('dataContainer');
    
    container.innerHTML = strategies.map(strategy => `
      <div class="strategy-settings">
        <div class="strategy-name">${escapeHtml(strategy.name)}</div>
        ${strategy.settings.map(setting => `
          <div class="strategy-setting">
            <span class="setting-label">${escapeHtml(setting.label)}:</span>
            <span class="setting-value">${escapeHtml(setting.value)}</span>
          </div>
        `).join('')}
        <div class="data-tab-type">Extracted: ${new Date(strategy.timestamp).toLocaleString()}</div>
      </div>
    `).join('');
  }

  private showStrategyList(strategies: StrategySettings[]): void {
    const strategyList = getElement('strategyList');
    strategyList.classList.remove('hidden');
    
    strategyList.innerHTML = strategies.map((strategy, index) => `
      <button class="btn-strategy-item" data-strategy-index="${index}">
        📋 ${escapeHtml(strategy.name)} Settings
      </button>
    `).join('');
    
    // Add event listeners for strategy buttons
    strategyList.querySelectorAll('.btn-strategy-item').forEach(button => {
      button.addEventListener('click', async (e) => {
        const target = e.target as HTMLElement;
        const strategyIndex = parseInt(target.getAttribute('data-strategy-index') || '0');
        await this.openStrategySettings(strategyIndex);
      });
    });
  }

  private hideStrategyList(): void {
    const strategyList = getElement('strategyList');
    strategyList.classList.add('hidden');
  }
}
