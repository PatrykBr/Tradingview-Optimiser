import { TabController } from './handlers/tabController';

// Initialize the new tab-based interface
const tabController = new TabController();

const loadStoredData = async (): Promise<void> => {
  try {
    // Load sample results for demonstration (remove this in production)
    setTimeout(() => {
      tabController.getResultsHandler().loadSampleResults();
    }, 1000);
    
  } catch (error: unknown) {
    console.log('No stored data available');
  }
};

// Initialize
loadStoredData();
