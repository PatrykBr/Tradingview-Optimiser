import { MESSAGES, STORAGE_KEYS } from '../config';
import type { DateRangeSettings, MessageResponse } from '../types';
import { storageGet, storageSet, tabs, getActiveTab } from '../utils';

// Extension popup element IDs
const POPUP_ELEMENTS = {
  dateRangeEnabled: 'dateRangeEnabled',
  startDate: 'startDate',
  endDate: 'endDate',
  applyDateRange: 'applyDateRange',
  status: 'status'
} as const;

export class DateRangePopupHandler {
  private enabledToggle: HTMLInputElement | null = null;
  private startDateInput: HTMLInputElement | null = null;
  private endDateInput: HTMLInputElement | null = null;
  private applyButton: HTMLButtonElement | null = null;
  private currentSettings: DateRangeSettings;

  constructor() {
    this.currentSettings = this.getDefaultSettings();
    this.initializeElements();
    this.loadStoredSettings();
    this.attachEventListeners();
  }

  private initializeElements(): void {
    this.enabledToggle = document.getElementById(POPUP_ELEMENTS.dateRangeEnabled) as HTMLInputElement;
    this.startDateInput = document.getElementById(POPUP_ELEMENTS.startDate) as HTMLInputElement;
    this.endDateInput = document.getElementById(POPUP_ELEMENTS.endDate) as HTMLInputElement;
    this.applyButton = document.getElementById(POPUP_ELEMENTS.applyDateRange) as HTMLButtonElement;

    if (!this.enabledToggle || !this.startDateInput || !this.endDateInput || !this.applyButton) {
      console.error('Date range elements not found in popup');
    }
  }

  private getDefaultSettings(): DateRangeSettings {
    const today = new Date();
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(today.getFullYear() - 1);

    return {
      enabled: false,
      startDate: this.formatDate(oneYearAgo),
      endDate: this.formatDate(today),
      timestamp: new Date().toISOString()
    };
  }

  private async loadStoredSettings(): Promise<void> {
    try {
      const result = await storageGet([STORAGE_KEYS.dateRangeSettings]);
      const stored = result.dateRangeSettings as DateRangeSettings;
      
      if (stored && stored.startDate && stored.endDate) {
        this.currentSettings = stored;
      }
      
      this.updateUI();
    } catch (error) {
      console.log('No stored date range settings, using defaults');
      this.updateUI();
    }
  }

  private updateUI(): void {
    if (this.enabledToggle) {
      this.enabledToggle.checked = this.currentSettings.enabled;
    }
    
    if (this.startDateInput) {
      this.startDateInput.value = this.currentSettings.startDate;
      this.startDateInput.disabled = !this.currentSettings.enabled;
    }
    
    if (this.endDateInput) {
      this.endDateInput.value = this.currentSettings.endDate;
      this.endDateInput.disabled = !this.currentSettings.enabled;
    }
    
    if (this.applyButton) {
      this.applyButton.disabled = !this.currentSettings.enabled;
    }
  }

  private attachEventListeners(): void {
    if (this.enabledToggle) {
      this.enabledToggle.addEventListener('change', () => {
        if (this.enabledToggle) {
          this.currentSettings.enabled = this.enabledToggle.checked;
          this.updateUI();
          this.saveSettings();
        }
      });
    }

    if (this.startDateInput) {
      this.startDateInput.addEventListener('change', () => {
        if (this.startDateInput) {
          this.currentSettings.startDate = this.startDateInput.value;
          this.saveSettings();
        }
      });
    }

    if (this.endDateInput) {
      this.endDateInput.addEventListener('change', () => {
        if (this.endDateInput) {
          this.currentSettings.endDate = this.endDateInput.value;
          this.saveSettings();
        }
      });
    }

    if (this.applyButton) {
      this.applyButton.addEventListener('click', () => {
        this.applyDateRange();
      });
    }
  }

  private async saveSettings(): Promise<void> {
    this.currentSettings.timestamp = new Date().toISOString();
    await storageSet({ [STORAGE_KEYS.dateRangeSettings]: this.currentSettings });
  }

  public async applyDateRange(): Promise<void> {
    try {
      // Get the active tab
      const tab = await getActiveTab();

      // Send message to content script
      const response = await tabs.sendMessage(tab.id, {
        action: MESSAGES.changeDateRange,
        dateRangeSettings: this.currentSettings
      }) as MessageResponse;

      if (response && response.success) {
        this.showStatus(`Date range ${this.currentSettings.enabled ? 'set to custom range' : 'set to chart range'}`, 'success');
      } else {
        this.showStatus(response?.error || 'Failed to change date range', 'error');
      }
    } catch (error: any) {
      console.error('Error applying date range:', error);
      
      // Check if it's a connection error (content script not loaded)
      if (error.message && error.message.includes('Could not establish connection')) {
        this.showStatus('Content script not loaded. Please refresh the page and try again.', 'error');
      } else {
        this.showStatus('Error applying date range. Make sure you are on a supported trading website.', 'error');
      }
    }
  }

  private showStatus(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
    const statusElement = document.getElementById(POPUP_ELEMENTS.status);
    if (statusElement) {
      statusElement.textContent = message;
      statusElement.className = `status ${type}`;
      
      // Clear status after 3 seconds
      setTimeout(() => {
        if (statusElement.textContent === message) {
          statusElement.textContent = 'Ready';
          statusElement.className = 'status info';
        }
      }, 3000);
    }
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  public getSettings(): DateRangeSettings {
    return { ...this.currentSettings };
  }
}
