import { StrategyPopupHandler } from './strategyPopup';
import { setStatus, storageSet, storageGet, sendMessage } from '../utils';
import { STORAGE_KEYS, MESSAGES } from '../config';
import type { StrategySettings, OptimisationConfig, OptimisationParameter, SavedOptimisationConfig } from '../types';

export class SetupTabHandler {
  private strategyHandler = new StrategyPopupHandler();
  private loadedStrategies: StrategySettings[] = [];
  private currentOptimisationConfig: OptimisationConfig | null = null;
  private savedConfigs: SavedOptimisationConfig[] = [];

  constructor() {
    this.attachEventListeners();
    // Auto-extract strategies when handler is created
    this.autoLoadStrategies();
    // Load saved configurations
    this.loadSavedConfigurations();
  }

  private attachEventListeners(): void {
    const refreshStrategiesBtn = document.getElementById('refreshStrategiesBtn');
    const strategyDropdown = document.getElementById('strategyDropdown') as HTMLSelectElement;
    const saveOptimisationBtn = document.getElementById('saveOptimisationConfig');
    const saveAsNewConfigBtn = document.getElementById('saveAsNewConfigBtn');
    const savedConfigsDropdown = document.getElementById('savedConfigsDropdown') as HTMLSelectElement;
    const loadConfigBtn = document.getElementById('loadConfigBtn');
    const deleteConfigBtn = document.getElementById('deleteConfigBtn');
    const configNameInput = document.getElementById('configName') as HTMLInputElement;
    const configDescInput = document.getElementById('configDescription') as HTMLInputElement;

    if (refreshStrategiesBtn) {
      refreshStrategiesBtn.onclick = () => this.refreshStrategies();
    }

    if (strategyDropdown) {
      strategyDropdown.onchange = () => this.onStrategySelected();
    }

    if (saveOptimisationBtn) {
      saveOptimisationBtn.onclick = () => this.saveOptimisationConfiguration();
    }

    if (saveAsNewConfigBtn) {
      saveAsNewConfigBtn.onclick = () => this.saveAsNewConfiguration();
    }

    if (savedConfigsDropdown) {
      savedConfigsDropdown.onchange = () => this.onSavedConfigSelected();
    }

    if (loadConfigBtn) {
      loadConfigBtn.onclick = () => this.loadSelectedConfiguration();
    }

    if (deleteConfigBtn) {
      deleteConfigBtn.onclick = () => this.deleteSelectedConfiguration();
    }

    // Add input validation for save button
    if (configNameInput) {
      configNameInput.oninput = () => this.updateSaveButtonState();
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
        
        // Show optimisation parameters section if strategy has settings
        if (selectedStrategy.settings && selectedStrategy.settings.length > 0) {
          await this.displayOptimisationParameters(selectedStrategy);
          setStatus(`Selected strategy: ${selectedStrategy.name || 'Unknown'} - ${selectedStrategy.settings.length} parameters available`);
        } else {
          // Try to extract settings if not available
          await this.extractAndDisplayStrategy(selectedStrategy, strategyIndex);
        }
      }
    } else if (settingsSection) {
      settingsSection.classList.add('hidden');
      setStatus('Setup - Load strategies and configure parameters');
    }
  }

  private async extractAndDisplayStrategy(strategy: StrategySettings, strategyIndex: number): Promise<void> {
    const optimisationContainer = document.getElementById('optimisationParams');
    if (!optimisationContainer) return;

    try {
      // Show loading state
      optimisationContainer.innerHTML = `
        <div class="strategy-info">
          <h4>${strategy.name || 'Unknown Strategy'}</h4>
          <p>Loading strategy settings...</p>
          <small>Attempting to extract parameters from TradingView</small>
        </div>
      `;
      
      // Trigger the strategy settings dialog to be opened
      await this.strategyHandler.openStrategySettings(strategyIndex);
      
      // Show processing state
      optimisationContainer.innerHTML = `
        <div class="strategy-info">
          <h4>${strategy.name || 'Unknown Strategy'}</h4>
          <p>Processing extracted parameters...</p>
          <small>Updating display with extracted settings</small>
        </div>
      `;
      
      // Wait for the storage operation to complete
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Reload strategies from storage to get updated settings
      const { storageGet } = await import('../utils');
      const { STORAGE_KEYS } = await import('../config');
      const result = await storageGet([STORAGE_KEYS.strategies]);
      
      if (result.strategies && Array.isArray(result.strategies)) {
        this.loadedStrategies = result.strategies as StrategySettings[];
        const updatedStrategy = this.loadedStrategies.find(s => s.name === strategy.name);
        
        if (updatedStrategy && updatedStrategy.settings && updatedStrategy.settings.length > 0) {
          // Display the optimisation parameters
          await this.displayOptimisationParameters(updatedStrategy);
          setStatus(`Strategy settings loaded: ${updatedStrategy.settings.length} parameters available for optimisation`);
        } else {
          // Show message about manual extraction
          optimisationContainer.innerHTML = `
            <div class="strategy-info">
              <h4>${strategy.name || 'Unknown Strategy'}</h4>
              <p>Parameters extracted but not yet saved to storage.</p>
              <p><strong>Manual extraction:</strong> Please try refreshing or selecting the strategy again.</p>
              <small>The extraction was successful but storage update may be delayed.</small>
            </div>
          `;
          setStatus(`Selected strategy: ${strategy.name || 'Unknown'} - Extraction may need retry`);
        }
      }
    } catch (error) {
      console.error('Error extracting strategy settings:', error);
      optimisationContainer.innerHTML = `
        <div class="strategy-info">
          <h4>${strategy.name || 'Unknown Strategy'}</h4>
          <p>Could not automatically extract strategy settings.</p>
          <p><strong>Manual extraction:</strong> Please click the strategy settings button (⚙️) in TradingView's strategy legend to extract parameters.</p>
          <small>The extension will automatically detect when you open the settings dialog.</small>
        </div>
      `;
      setStatus(`Selected strategy: ${strategy.name || 'Unknown'} - Manual extraction required`);
    }
  }

  public getLoadedStrategies(): StrategySettings[] {
    return this.loadedStrategies;
  }

  private async displayOptimisationParameters(strategy: StrategySettings): Promise<void> {
    const optimisationContainer = document.getElementById('optimisationParams');
    if (!optimisationContainer || !strategy.settings?.length) return;

    // Load existing optimisation config if available
    const result = await storageGet([STORAGE_KEYS.optimisationConfig]);
    let existingConfig: OptimisationConfig | null = null;
    
    if (result.optimisationConfig && 
        (result.optimisationConfig as OptimisationConfig).strategyName === strategy.name) {
      existingConfig = result.optimisationConfig as OptimisationConfig;
    }

    // Generate parameter items
    const parametersHtml = strategy.settings.map((setting, index) => {
      const existingParam = existingConfig?.parameters.find(p => p.label === setting.label);
      const isEnabled = existingParam?.enabled || false;
      const minValue = existingParam?.minValue || '';
      const maxValue = existingParam?.maxValue || '';
      
      return `
        <div class="param-item">
          <div class="param-header">
            <div class="param-info">
              <div class="param-name">${setting.label}</div>
              <div class="param-current">Current: ${setting.value}</div>
            </div>
            <div class="param-toggle">
              <input type="checkbox" 
                     class="param-checkbox" 
                     id="param-${index}" 
                     ${isEnabled ? 'checked' : ''}>
              <label for="param-${index}" class="param-enable-label">Optimise</label>
            </div>
          </div>
          <div class="param-ranges ${!isEnabled ? 'disabled' : 'visible'}" data-param-index="${index}">
            <div class="range-input-group">
              <label class="range-label">Min Value:</label>
              <input type="number" 
                     class="range-input min-input" 
                     placeholder="Minimum" 
                     value="${minValue}"
                     ${!isEnabled ? 'disabled' : ''}>
            </div>
            <div class="range-input-group">
              <label class="range-label">Max Value:</label>
              <input type="number" 
                     class="range-input max-input" 
                     placeholder="Maximum" 
                     value="${maxValue}"
                     ${!isEnabled ? 'disabled' : ''}>
            </div>
          </div>
        </div>
      `;
    }).join('');

    optimisationContainer.innerHTML = parametersHtml;

    // Attach event listeners to checkboxes
    strategy.settings.forEach((_, index) => {
      const checkbox = document.getElementById(`param-${index}`) as HTMLInputElement;
      const rangeContainer = document.querySelector(`[data-param-index="${index}"]`) as HTMLElement;
      const minInput = rangeContainer?.querySelector('.min-input') as HTMLInputElement;
      const maxInput = rangeContainer?.querySelector('.max-input') as HTMLInputElement;

      if (checkbox && rangeContainer) {
        checkbox.onchange = () => {
          const isChecked = checkbox.checked;
          
          if (isChecked) {
            rangeContainer.classList.remove('disabled');
            rangeContainer.classList.add('visible');
          } else {
            rangeContainer.classList.remove('visible');
            rangeContainer.classList.add('disabled');
          }
          
          if (minInput) minInput.disabled = !isChecked;
          if (maxInput) maxInput.disabled = !isChecked;
          
          this.updateSaveButtonState();
        };
      }

      // Add input event listeners for validation
      if (minInput) {
        minInput.oninput = () => this.validateRangeInputs(minInput, maxInput);
      }
      if (maxInput) {
        maxInput.oninput = () => this.validateRangeInputs(minInput, maxInput);
      }
    });

    this.updateSaveButtonState();
  }

  private validateRangeInputs(minInput: HTMLInputElement, maxInput: HTMLInputElement): void {
    const minValue = parseFloat(minInput.value);
    const maxValue = parseFloat(maxInput.value);

    // Reset styles
    minInput.style.borderColor = '';
    maxInput.style.borderColor = '';

    // Validate that min < max if both are provided
    if (!isNaN(minValue) && !isNaN(maxValue) && minValue >= maxValue) {
      minInput.style.borderColor = '#dc3545';
      maxInput.style.borderColor = '#dc3545';
    }

    this.updateSaveButtonState();
  }

  private updateSaveButtonState(): void {
    const saveBtn = document.getElementById('saveOptimisationConfig') as HTMLButtonElement;
    const saveAsNewBtn = document.getElementById('saveAsNewConfigBtn') as HTMLButtonElement;
    const configNameInput = document.getElementById('configName') as HTMLInputElement;
    
    if (!saveBtn || !saveAsNewBtn) return;

    // Check if any parameters are enabled with valid ranges
    const checkboxes = document.querySelectorAll('.param-checkbox:checked') as NodeListOf<HTMLInputElement>;
    let hasValidConfig = false;

    checkboxes.forEach(checkbox => {
      const index = checkbox.id.split('-')[1];
      const rangeContainer = document.querySelector(`[data-param-index="${index}"]`);
      const minInput = rangeContainer?.querySelector('.min-input') as HTMLInputElement;
      const maxInput = rangeContainer?.querySelector('.max-input') as HTMLInputElement;

      if (minInput && maxInput) {
        const minValue = parseFloat(minInput.value);
        const maxValue = parseFloat(maxInput.value);

        // Valid if both values are provided and min < max
        if (!isNaN(minValue) && !isNaN(maxValue) && minValue < maxValue) {
          hasValidConfig = true;
        }
      }
    });

    // Apply Configuration button - enabled if valid config exists
    saveBtn.disabled = !hasValidConfig;

    // Save as New Configuration button - enabled if valid config AND name provided
    const hasConfigName = configNameInput?.value?.trim() !== '';
    saveAsNewBtn.disabled = !hasValidConfig || !hasConfigName;
  }

  private async saveOptimisationConfiguration(): Promise<void> {
    const dropdown = document.getElementById('strategyDropdown') as HTMLSelectElement;
    if (!dropdown.value) {
      setStatus('Error: No strategy selected');
      return;
    }

    const strategyIndex = parseInt(dropdown.value);
    const selectedStrategy = this.loadedStrategies[strategyIndex];
    if (!selectedStrategy) {
      setStatus('Error: Invalid strategy selection');
      return;
    }

    const parameters: OptimisationParameter[] = [];
    const checkboxes = document.querySelectorAll('.param-checkbox') as NodeListOf<HTMLInputElement>;

    checkboxes.forEach((checkbox, index) => {
      const setting = selectedStrategy.settings[index];
      const rangeContainer = document.querySelector(`[data-param-index="${index}"]`);
      const minInput = rangeContainer?.querySelector('.min-input') as HTMLInputElement;
      const maxInput = rangeContainer?.querySelector('.max-input') as HTMLInputElement;

      if (setting && minInput && maxInput) {
        const isEnabled = checkbox.checked;
        const minValue = parseFloat(minInput.value);
        const maxValue = parseFloat(maxInput.value);

        parameters.push({
          label: setting.label,
          currentValue: setting.value,
          minValue: isEnabled && !isNaN(minValue) ? minValue : 0,
          maxValue: isEnabled && !isNaN(maxValue) ? maxValue : 0,
          enabled: isEnabled && !isNaN(minValue) && !isNaN(maxValue) && minValue < maxValue,
          tooltip: setting.tooltip
        });
      }
    });

    const optimisationConfig: OptimisationConfig = {
      strategyName: selectedStrategy.name,
      parameters: parameters,
      timestamp: new Date().toISOString()
    };

    try {
      // Save to storage via background script
      const response = await sendMessage({
        action: MESSAGES.saveOptimisationConfig,
        optimisationConfig: optimisationConfig
      });

      if (response.success) {
        this.currentOptimisationConfig = optimisationConfig;
        
        const enabledCount = parameters.filter(p => p.enabled).length;
        setStatus(`Optimisation configuration saved: ${enabledCount} parameters enabled`);
      } else {
        setStatus(`Error saving optimisation configuration: ${response.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error saving optimisation config:', error);
      setStatus('Error saving optimisation configuration');
    }
  }

  public getCurrentOptimisationConfig(): OptimisationConfig | null {
    return this.currentOptimisationConfig;
  }

  private async loadSavedConfigurations(): Promise<void> {
    try {
      const result = await storageGet([STORAGE_KEYS.savedOptimisationConfigs]);
      if (result.savedOptimisationConfigs && Array.isArray(result.savedOptimisationConfigs)) {
        this.savedConfigs = result.savedOptimisationConfigs as SavedOptimisationConfig[];
        this.populateSavedConfigsDropdown();
      }
    } catch (error) {
      console.error('Error loading saved configurations:', error);
    }
  }

  private populateSavedConfigsDropdown(): void {
    const dropdown = document.getElementById('savedConfigsDropdown') as HTMLSelectElement;
    if (!dropdown) return;

    // Clear existing options except the first one
    dropdown.innerHTML = '<option value="">Select a saved configuration...</option>';

    // Add saved configurations grouped by strategy
    const strategiesSeen = new Set<string>();
    this.savedConfigs.forEach((config, index) => {
      if (!strategiesSeen.has(config.strategyName)) {
        strategiesSeen.add(config.strategyName);
        // Add strategy separator if not first
        if (strategiesSeen.size > 1) {
          const separator = document.createElement('option');
          separator.disabled = true;
          separator.textContent = '──────────';
          dropdown.appendChild(separator);
        }
      }

      const option = document.createElement('option');
      option.value = index.toString();
      option.textContent = `${config.name} (${config.strategyName})`;
      dropdown.appendChild(option);
    });

    this.updateSavedConfigButtons();
  }

  private updateSavedConfigButtons(): void {
    const dropdown = document.getElementById('savedConfigsDropdown') as HTMLSelectElement;
    const loadBtn = document.getElementById('loadConfigBtn') as HTMLButtonElement;
    const deleteBtn = document.getElementById('deleteConfigBtn') as HTMLButtonElement;

    const hasSelection = dropdown?.value && dropdown.value !== '';

    if (loadBtn) loadBtn.disabled = !hasSelection;
    if (deleteBtn) deleteBtn.disabled = !hasSelection;
  }

  private onSavedConfigSelected(): void {
    this.updateSavedConfigButtons();
  }

  private async loadSelectedConfiguration(): Promise<void> {
    const dropdown = document.getElementById('savedConfigsDropdown') as HTMLSelectElement;
    if (!dropdown.value) return;

    const configIndex = parseInt(dropdown.value);
    const selectedConfig = this.savedConfigs[configIndex];
    if (!selectedConfig) return;

    try {
      // Find the strategy
      const strategy = this.loadedStrategies.find(s => s.name === selectedConfig.strategyName);
      if (!strategy) {
        setStatus(`Error: Strategy "${selectedConfig.strategyName}" not found`);
        return;
      }

      // Select the strategy in the dropdown
      const strategyDropdown = document.getElementById('strategyDropdown') as HTMLSelectElement;
      const strategyIndex = this.loadedStrategies.findIndex(s => s.name === selectedConfig.strategyName);
      if (strategyDropdown && strategyIndex >= 0) {
        strategyDropdown.value = strategyIndex.toString();
      }

      // Display the optimisation parameters
      await this.displayOptimisationParameters(strategy);

      // Apply the saved configuration
      selectedConfig.parameters.forEach((savedParam, index) => {
        const checkbox = document.getElementById(`param-${index}`) as HTMLInputElement;
        const rangeContainer = document.querySelector(`[data-param-index="${index}"]`) as HTMLElement;
        const minInput = rangeContainer?.querySelector('.min-input') as HTMLInputElement;
        const maxInput = rangeContainer?.querySelector('.max-input') as HTMLInputElement;

        if (checkbox && rangeContainer && minInput && maxInput) {
          // Find matching parameter by label
          const matchingParam = strategy.settings.find(s => s.label === savedParam.label);
          if (matchingParam) {
            checkbox.checked = savedParam.enabled;
            
            if (savedParam.enabled) {
              rangeContainer.classList.remove('disabled');
              rangeContainer.classList.add('visible');
              minInput.disabled = false;
              maxInput.disabled = false;
              minInput.value = savedParam.minValue.toString();
              maxInput.value = savedParam.maxValue.toString();
            } else {
              rangeContainer.classList.remove('visible');
              rangeContainer.classList.add('disabled');
              minInput.disabled = true;
              maxInput.disabled = true;
            }
          }
        }
      });

      this.updateSaveButtonState();
      setStatus(`Configuration "${selectedConfig.name}" loaded successfully`);
    } catch (error) {
      console.error('Error loading configuration:', error);
      setStatus('Error loading configuration');
    }
  }

  private async deleteSelectedConfiguration(): Promise<void> {
    const dropdown = document.getElementById('savedConfigsDropdown') as HTMLSelectElement;
    if (!dropdown.value) return;

    const configIndex = parseInt(dropdown.value);
    const selectedConfig = this.savedConfigs[configIndex];
    if (!selectedConfig) return;

    if (!confirm(`Are you sure you want to delete the configuration "${selectedConfig.name}"?`)) {
      return;
    }

    try {
      // Remove from array
      this.savedConfigs.splice(configIndex, 1);

      // Save to storage
      const response = await sendMessage({
        action: MESSAGES.saveSavedOptimisationConfigs,
        savedOptimisationConfigs: this.savedConfigs
      });

      if (response.success) {
        this.populateSavedConfigsDropdown();
        setStatus(`Configuration "${selectedConfig.name}" deleted successfully`);
      } else {
        setStatus(`Error deleting configuration: ${response.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error deleting configuration:', error);
      setStatus('Error deleting configuration');
    }
  }

  private async saveAsNewConfiguration(): Promise<void> {
    const dropdown = document.getElementById('strategyDropdown') as HTMLSelectElement;
    const configNameInput = document.getElementById('configName') as HTMLInputElement;
    const configDescInput = document.getElementById('configDescription') as HTMLInputElement;
    
    if (!dropdown.value) {
      setStatus('Error: No strategy selected');
      return;
    }

    const configName = configNameInput?.value?.trim();
    if (!configName) {
      setStatus('Error: Please enter a configuration name');
      return;
    }

    const strategyIndex = parseInt(dropdown.value);
    const selectedStrategy = this.loadedStrategies[strategyIndex];
    if (!selectedStrategy) {
      setStatus('Error: Invalid strategy selection');
      return;
    }

    // Get current parameter configuration
    const parameters: OptimisationParameter[] = [];
    const checkboxes = document.querySelectorAll('.param-checkbox') as NodeListOf<HTMLInputElement>;
    let hasEnabledParams = false;

    checkboxes.forEach((checkbox, index) => {
      const setting = selectedStrategy.settings[index];
      const rangeContainer = document.querySelector(`[data-param-index="${index}"]`);
      const minInput = rangeContainer?.querySelector('.min-input') as HTMLInputElement;
      const maxInput = rangeContainer?.querySelector('.max-input') as HTMLInputElement;

      if (setting && minInput && maxInput) {
        const isEnabled = checkbox.checked;
        const minValue = parseFloat(minInput.value);
        const maxValue = parseFloat(maxInput.value);

        if (isEnabled && !isNaN(minValue) && !isNaN(maxValue) && minValue < maxValue) {
          hasEnabledParams = true;
        }

        parameters.push({
          label: setting.label,
          currentValue: setting.value,
          minValue: isEnabled && !isNaN(minValue) ? minValue : 0,
          maxValue: isEnabled && !isNaN(maxValue) ? maxValue : 0,
          enabled: isEnabled && !isNaN(minValue) && !isNaN(maxValue) && minValue < maxValue,
          tooltip: setting.tooltip
        });
      }
    });

    if (!hasEnabledParams) {
      setStatus('Error: No valid parameters configured for optimisation');
      return;
    }

    const description = configDescInput?.value?.trim() || '';

    // Check for duplicate names
    const existingConfig = this.savedConfigs.find(c => 
      c.name.toLowerCase() === configName.toLowerCase() && 
      c.strategyName === selectedStrategy.name
    );

    if (existingConfig) {
      if (!confirm(`A configuration named "${configName}" already exists for this strategy. Replace it?`)) {
        return;
      }
      // Remove the existing configuration
      const existingIndex = this.savedConfigs.indexOf(existingConfig);
      this.savedConfigs.splice(existingIndex, 1);
    }

    const savedConfig: SavedOptimisationConfig = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      name: configName,
      strategyName: selectedStrategy.name,
      parameters: parameters,
      timestamp: new Date().toISOString(),
      description: description || undefined
    };

    try {
      // Add to array
      this.savedConfigs.push(savedConfig);

      // Save to storage
      const response = await sendMessage({
        action: MESSAGES.saveSavedOptimisationConfigs,
        savedOptimisationConfigs: this.savedConfigs
      });

      if (response.success) {
        this.populateSavedConfigsDropdown();
        
        // Clear the input fields
        configNameInput.value = '';
        if (configDescInput) configDescInput.value = '';
        this.updateSaveButtonState();
        
        const enabledCount = parameters.filter(p => p.enabled).length;
        setStatus(`Configuration "${configName}" saved successfully with ${enabledCount} parameters`);
      } else {
        // Remove from array if save failed
        this.savedConfigs.pop();
        setStatus(`Error saving configuration: ${response.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error saving configuration:', error);
      this.savedConfigs.pop(); // Remove from array if save failed
      setStatus('Error saving configuration');
    }
  }
}
