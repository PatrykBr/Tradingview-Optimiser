import { MESSAGES, STATUS_MESSAGES } from '../config';
import type { ExtractedItem, MessageResponse, StorageResult } from '../types';
import { tabs, storage, storageGet, getElement, escapeHtml, setStatus, handleError, getActiveTab } from '../utils';

export class TabDataPopupHandler {
  private currentFilter: 'all' | 'long' | 'short' | 'none' = 'none';

  async extract(): Promise<void> {
    setStatus(STATUS_MESSAGES.extracting);
    
    try {
      const tab = await getActiveTab();
      
      const response = await tabs.sendMessage(tab.id, { 
        action: MESSAGES.extractData,
        filter: this.currentFilter
      }) as MessageResponse;
      
      if (response?.data && response.data.length > 0) {
        this.display(response.data);
        const isOverview = response.data.some(item => item.tabType === 'overview');
        let filterText = '';
        
        if (isOverview) {
          filterText = '(filter not applicable for overview)';
        } else {
          filterText = this.currentFilter === 'none' ? '(all columns)' : `(${this.currentFilter} column only)`;
        }
        
        setStatus(`Found ${response.data.length} items ${filterText}`);
      } else {
        setStatus(STATUS_MESSAGES.noData);
      }
    } catch (error: unknown) {
      setStatus(`Error: ${handleError(error)}`);
    }
  }

  display(data: ExtractedItem[]): void {
    const container = getElement('dataContainer');
    
    container.innerHTML = data.map(item => `
      <div class="data-item">
        <div class="data-title">${escapeHtml(item.title)}</div>
        <div class="data-value">${escapeHtml(item.value)}</div>
        ${item.currency ? `<div class="data-currency">${escapeHtml(item.currency)}</div>` : ''}
        ${item.change ? `<div class="data-change">${escapeHtml(item.change)}</div>` : ''}
        ${item.tabType ? `<div class="data-tab-type">Source: ${escapeHtml(item.tabType)} • Filter: ${this.currentFilter === 'none' ? 'all columns' : this.currentFilter}</div>` : ''}
      </div>
    `).join('');
  }

  async clear(): Promise<void> {
    await storage.local.clear();
    getElement('dataContainer').innerHTML = '<div class="no-data">Cleared</div>';
    setStatus(STATUS_MESSAGES.cleared);
  }

  async refresh(): Promise<void> {
    const [tab] = await tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      await tabs.reload(tab.id);
      setStatus(STATUS_MESSAGES.refreshed);
    }
  }

  async clickTab(tabId: string): Promise<void> {
    setStatus(`Switching to ${tabId} tab...`);
    
    try {
      const tab = await getActiveTab();
      
      const response = await tabs.sendMessage(tab.id, { 
        action: MESSAGES.clickTab,
        tabId: tabId
      }) as MessageResponse;
      
      if (response?.success) {
        setStatus(response.message || `Switched to ${tabId} tab`);
      } else {
        setStatus(`Failed to switch to ${tabId} tab`);
      }
    } catch (error: unknown) {
      setStatus(`Error: ${handleError(error)}`);
    }
  }

  setFilter(filter: 'all' | 'long' | 'short'): void {
    if (this.currentFilter === filter) {
      this.currentFilter = 'none';
      this.updateFilterButtons(null);
      setStatus('No filter selected - showing all columns');
    } else {
      this.currentFilter = filter;
      this.updateFilterButtons(filter);
      setStatus(`Filter set to: ${filter} column only`);
    }
  }

  private updateFilterButtons(activeFilter: string | null): void {
    document.querySelectorAll('.btn-filter').forEach(btn => {
      btn.classList.remove('active');
    });
    
    if (activeFilter) {
      const activeButton = document.getElementById(`${activeFilter}Btn`);
      if (activeButton) {
        activeButton.classList.add('active');
      }
    }
  }
}
