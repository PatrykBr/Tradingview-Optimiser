import { setStatus } from '../utils';

interface OptimisationResult {
  iteration: number;
  metric: string;
  value: number;
  parameters: Record<string, any>;
}

export class ResultsTabHandler {
  private allResults: OptimisationResult[] = [];
  private bestResult: OptimisationResult | null = null;

  constructor() {
    this.attachEventListeners();
  }

  private attachEventListeners(): void {
    const listeners = {
      applyBestBtn: () => this.applyBestResult(),
      exportCsvBtn: () => this.exportToCsv(),
      exportJsonBtn: () => this.exportToJson()
    };

    Object.entries(listeners).forEach(([id, handler]) => {
      const element = document.getElementById(id);
      if (element) element.onclick = handler;
    });
  }

  public updateResults(results: OptimisationResult[]): void {
    this.allResults = results;
    this.findBestResult();
    this.renderBestResult();
    this.renderAllResults();
    this.showActionButtons();
  }

  public addResult(result: OptimisationResult): void {
    this.allResults.push(result);
    this.findBestResult();
    this.renderBestResult();
    this.renderAllResults();
  }

  private findBestResult(): void {
    this.bestResult = this.allResults.length === 0 ? null :
      this.allResults.reduce((best, current) => current.value > best.value ? current : best);
  }

  private renderBestResult(): void {
    const container = document.getElementById('bestResults');
    if (!container) return;

    container.innerHTML = !this.bestResult ? 
      '<div class="no-results">No optimisation results yet</div>' :
      `<div class="best-result-item">
        <div class="result-header">
          <h4>Best ${this.bestResult.metric}: ${this.bestResult.value}</h4>
          <span class="iteration-badge">Iteration ${this.bestResult.iteration}</span>
        </div>
        <div class="result-parameters">
          <h5>Best Parameters:</h5>
          <div class="parameters-grid">
            ${Object.entries(this.bestResult.parameters).map(([key, value]) => 
              `<div class="parameter-item">
                <span class="param-name">${key}:</span>
                <span class="param-value">${value}</span>
              </div>`
            ).join('')}
          </div>
        </div>
      </div>`;
  }

  private renderAllResults(): void {
    const container = document.getElementById('allResults');
    if (!container) return;

    if (this.allResults.length === 0) {
      container.innerHTML = '<div class="no-results">No optimisation results yet</div>';
      return;
    }

    // Sort results by iteration
    const sortedResults = [...this.allResults].sort((a, b) => a.iteration - b.iteration);

    container.innerHTML = `
      <div class="results-table">
        <div class="results-header">
          <span>Iteration</span>
          <span>Metric Value</span>
          <span>Parameters</span>
        </div>
        ${sortedResults.map(result => `
          <div class="result-row ${result === this.bestResult ? 'best-result' : ''}">
            <span class="iteration">${result.iteration}</span>
            <span class="metric-value">${result.value}</span>
            <span class="parameters">
              ${Object.entries(result.parameters).map(([key, value]) => 
                `${key}: ${value}`
              ).join(', ')}
            </span>
          </div>
        `).join('')}
      </div>
    `;
  }

  private showActionButtons(): void {
    const actionSection = document.getElementById('actionButtonsSection');
    if (actionSection && this.allResults.length > 0) {
      actionSection.classList.remove('hidden');
    }
  }

  private applyBestResult(): void {
    if (!this.bestResult) return setStatus('No best result to apply');

    setStatus('Applying best parameters to TradingView strategy...');
    console.log('Applying best result:', this.bestResult);
    setStatus('Best parameters applied - feature requires TradingView integration');
  }

  private exportToCsv(): void {
    if (!this.allResults.length) return setStatus('No results to export');

    const headers = ['Iteration', 'Metric', 'Value', ...Object.keys(this.allResults[0].parameters)];
    const csvContent = [
      headers.join(','),
      ...this.allResults.map(result => [
        result.iteration, result.metric, result.value,
        ...Object.values(result.parameters)
      ].join(','))
    ].join('\n');

    this.downloadFile(csvContent, 'optimisation-results.csv', 'text/csv');
    setStatus('Results exported to CSV');
  }

  private exportToJson(): void {
    if (!this.allResults.length) return setStatus('No results to export');

    const jsonContent = JSON.stringify({
      bestResult: this.bestResult,
      allResults: this.allResults,
      exportDate: new Date().toISOString()
    }, null, 2);

    this.downloadFile(jsonContent, 'optimisation-results.json', 'application/json');
    setStatus('Results exported to JSON');
  }

  private downloadFile(content: string, filename: string, contentType: string): void {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // Sample method to demonstrate functionality
  public loadSampleResults(): void {
    const sampleResults: OptimisationResult[] = [
      {
        iteration: 1,
        metric: 'Net Profit %',
        value: 125.5,
        parameters: { 'RSI Period': 14, 'SMA Period': 20, 'Stop Loss %': 2.5 }
      },
      {
        iteration: 2,
        metric: 'Net Profit %',
        value: 138.2,
        parameters: { 'RSI Period': 16, 'SMA Period': 18, 'Stop Loss %': 3.0 }
      },
      {
        iteration: 3,
        metric: 'Net Profit %',
        value: 142.7,
        parameters: { 'RSI Period': 15, 'SMA Period': 22, 'Stop Loss %': 2.8 }
      }
    ];

    this.updateResults(sampleResults);
    setStatus('Sample results loaded for demonstration');
  }
}
