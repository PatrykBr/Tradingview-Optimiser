import { StrategyPopupHandler } from './strategyPopup';
import { setStatus } from '../utils';
import type { StrategySettings } from '../types';

export class SetupTabHandler {
  private strategyHandler = new StrategyPopupHandler();
  private loadedStrategies: StrategySettings[] = [];

  constructor() {
    this.attachEventListeners();
    // Auto-extract strategies when handler is created
    this.autoLoadStrategies();
  }

  private attachEventListeners(): void {
    const refreshStrategiesBtn = document.getElementById('refreshStrategiesBtn');
    const strategyDropdown = document.getElementById('strategyDropdown') as HTMLSelectElement;

    if (refreshStrategiesBtn) {
      refreshStrategiesBtn.onclick = () => this.refreshStrategies();
    }

    if (strategyDropdown) {
      strategyDropdown.onchange = () => this.onStrategySelected();
    }
  }

  private async autoLoadStrategies(): Promise<void> {
    setStatus('Loading strategies automatically...');
    
    try {
      await this.loadStrategies();
    } catch (error) {
      setStatus('Auto-load strategies failed - click refresh to retry');
      this.updateDropdownToSelectState();
    }
  }

  private async refreshStrategies(): Promise<void> {
    setStatus('Refreshing strategies...');
    this.updateDropdownToLoadingState();
    
    try {
      await this.loadStrategies();
    } catch (error) {
      setStatus('Error refreshing strategies');
      this.updateDropdownToSelectState();
    }
  }

  private async loadStrategies(): Promise<void> {
    try {
      // Use the existing strategy handler to extract strategies
      await this.strategyHandler.extractStrategies();
      
      // Add a small delay to ensure storage operation completes
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Get the strategies from the handler - we need to access stored data
      const { storageGet } = await import('../utils');
      const { STORAGE_KEYS } = await import('../config');
      
      const result = await storageGet([STORAGE_KEYS.strategies]);
      
      if (result.strategies && Array.isArray(result.strategies) && result.strategies.length > 0) {
        this.loadedStrategies = result.strategies as StrategySettings[];
        this.populateDropdown();
        setStatus(`Loaded ${this.loadedStrategies.length} strategies`);
      } else {
        setStatus('No strategies found');
        this.updateDropdownToSelectState();
      }
    } catch (error) {
      console.error('Error loading strategies:', error);
      setStatus('Error loading strategies');
      this.updateDropdownToSelectState();
    }
  }

  private updateDropdownToLoadingState(): void {
    const dropdown = document.getElementById('strategyDropdown') as HTMLSelectElement;
    if (dropdown) {
      dropdown.innerHTML = '<option value="">Loading strategies...</option>';
      dropdown.disabled = true;
    }
  }

  private updateDropdownToSelectState(): void {
    const dropdown = document.getElementById('strategyDropdown') as HTMLSelectElement;
    if (dropdown) {
      dropdown.innerHTML = '<option value="">Select a strategy...</option>';
      dropdown.disabled = false;
    }
  }

  private populateDropdown(): void {
    const dropdown = document.getElementById('strategyDropdown') as HTMLSelectElement;
    if (dropdown && this.loadedStrategies.length > 0) {
      dropdown.innerHTML = '<option value="">Select a strategy...</option>';
      
      this.loadedStrategies.forEach((strategy, index) => {
        const option = document.createElement('option');
        option.value = index.toString(); // Use index to reference the strategy
        option.textContent = strategy.name || `Strategy ${index + 1}`;
        dropdown.appendChild(option);
      });
      
      dropdown.disabled = false;
    }
  }

  private async onStrategySelected(): Promise<void> {
    const dropdown = document.getElementById('strategyDropdown') as HTMLSelectElement;
    const settingsSection = document.getElementById('strategySettingsSection');
    
    if (dropdown.value && settingsSection) {
      const strategyIndex = parseInt(dropdown.value);
      const selectedStrategy = this.loadedStrategies[strategyIndex];
      
      if (selectedStrategy) {
        settingsSection.classList.remove('hidden');
        await this.displaySelectedStrategySettings(selectedStrategy);
        setStatus(`Selected strategy: ${selectedStrategy.name || 'Unknown'}`);
      }
    } else if (settingsSection) {
      settingsSection.classList.add('hidden');
      setStatus('Setup - Load strategies and configure parameters');
    }
  }

  private async displaySelectedStrategySettings(strategy: StrategySettings): Promise<void> {
    const settingsContainer = document.getElementById('strategySettings');
    if (!settingsContainer) return;

    try {
      // Find the strategy index for opening settings dialog
      const strategyIndex = this.loadedStrategies.findIndex(s => s.name === strategy.name);
      
      if (strategyIndex >= 0) {
        // Show loading state
        settingsContainer.innerHTML = `
          <div class="strategy-info">
            <h4>${strategy.name || 'Unknown Strategy'}</h4>
            <p>Loading strategy settings...</p>
            <small>Attempting to extract parameters from TradingView</small>
          </div>
        `;
        
        // Trigger the strategy settings dialog to be opened
        const extractionResult = await this.strategyHandler.openStrategySettings(strategyIndex);
        
        // Show processing state
        settingsContainer.innerHTML = `
          <div class="strategy-info">
            <h4>${strategy.name || 'Unknown Strategy'}</h4>
            <p>Processing extracted parameters...</p>
            <small>Updating display with extracted settings</small>
          </div>
        `;
        
        // Wait a shorter time for the storage operation to complete
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Reload strategies from storage to get updated settings
        const { storageGet } = await import('../utils');
        const { STORAGE_KEYS } = await import('../config');
        const result = await storageGet([STORAGE_KEYS.strategies]);
        
        if (result.strategies && Array.isArray(result.strategies)) {
          this.loadedStrategies = result.strategies as StrategySettings[];
          const updatedStrategy = this.loadedStrategies.find(s => s.name === strategy.name);
          
          if (updatedStrategy && updatedStrategy.settings && updatedStrategy.settings.length > 0) {
            // Display the updated strategy information
            settingsContainer.innerHTML = `
              <div class="strategy-info">
                <h4>${updatedStrategy.name || 'Unknown Strategy'}</h4>
                <p><strong>Settings:</strong> ${updatedStrategy.settings.length} parameters detected</p>
                ${this.renderStrategySettings(updatedStrategy.settings)}
                <small>Settings extracted from TradingView strategy dialog</small>
              </div>
            `;
            setStatus(`Strategy settings loaded: ${updatedStrategy.settings.length} parameters`);
          } else {
            // Still show the original strategy but with manual extraction message
            settingsContainer.innerHTML = `
              <div class="strategy-info">
                <h4>${strategy.name || 'Unknown Strategy'}</h4>
                <p>Parameters extracted but not yet saved to storage.</p>
                <p><strong>Manual extraction:</strong> Please try refreshing or selecting the strategy again.</p>
                <small>The extraction was successful but storage update may be delayed.</small>
              </div>
            `;
          }
        }
      }
    } catch (error) {
      console.error('Error displaying strategy settings:', error);
      settingsContainer.innerHTML = `
        <div class="strategy-info">
          <h4>${strategy.name || 'Unknown Strategy'}</h4>
          <p>Could not automatically extract strategy settings.</p>
          <p><strong>Manual extraction:</strong> Please click the strategy settings button (⚙️) in TradingView's strategy legend to extract parameters.</p>
          <small>The extension will automatically detect when you open the settings dialog.</small>
        </div>
      `;
    }
  }

  private renderStrategySettings(settings: Array<{label: string; value: string; tooltip?: string}> | undefined): string {
    if (!settings?.length) return '<p><em>No settings available</em></p>';

    const settingsHtml = settings.map(setting => 
      `<div class="setting-item">
        <span class="setting-name">${setting.label}:</span>
        <span class="setting-value">${setting.value}</span>
        ${setting.tooltip ? `<span class="setting-tooltip" title="${setting.tooltip}">ⓘ</span>` : ''}
      </div>`
    ).join('');

    return `<div class="settings-grid">${settingsHtml}</div>`;
  }

  public getLoadedStrategies(): StrategySettings[] {
    return this.loadedStrategies;
  }
}
