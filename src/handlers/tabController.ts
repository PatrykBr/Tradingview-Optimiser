import { SetupTabHandler } from './setupTab';
import { OptimiseTabHandler } from './optimiseTab';
import { ResultsTabHandler } from './resultsTab';
import { setStatus } from '../utils';

export class TabController {
  private setupHandler = new SetupTabHandler();
  private optimiseHandler = new OptimiseTabHandler();
  private resultsHandler = new ResultsTabHandler();
  private currentTab = 'setup';

  constructor() {
    this.attachTabEventListeners();
    this.setInitialTab();
    
    // Make results handler available globally for onclick handlers in HTML
    (window as any).resultsHandler = this.resultsHandler;
  }

  private attachTabEventListeners(): void {
    ['setup', 'optimise', 'results'].forEach(tabName => {
      const tab = document.getElementById(`${tabName}Tab`);
      if (tab) tab.onclick = () => this.switchTab(tabName);
    });
  }

  private switchTab(tabName: string): void {
    if (tabName === this.currentTab) return;

    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.remove('active');
    });

    const targetTabBtn = document.getElementById(`${tabName}Tab`);
    if (targetTabBtn) {
      targetTabBtn.classList.add('active');
    }

    // Update tab content
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.remove('active');
      pane.classList.add('hidden');
    });

    const targetContent = document.getElementById(`${tabName}TabContent`);
    if (targetContent) {
      targetContent.classList.remove('hidden');
      targetContent.classList.add('active');
    }

    this.currentTab = tabName;
    this.updateStatusForTab(tabName);
  }

  private setInitialTab(): void {
    this.switchTab('setup');
  }

  private updateStatusForTab(tabName: string): void {
    const statusMessages = {
      setup: 'Setup - Load strategies and configure parameters',
      optimise: 'Optimise - Configure optimisation settings and start process',
      results: 'Results - View optimisation results and export data'
    };
    setStatus(statusMessages[tabName as keyof typeof statusMessages] || 'Ready');
  }

  // Public methods to interact with specific handlers
  public getSetupHandler(): SetupTabHandler {
    return this.setupHandler;
  }

  public getOptimiseHandler(): OptimiseTabHandler {
    return this.optimiseHandler;
  }

  public getResultsHandler(): ResultsTabHandler {
    return this.resultsHandler;
  }

  public navigateToTab(tabName: string): void {
    this.switchTab(tabName);
  }
}
