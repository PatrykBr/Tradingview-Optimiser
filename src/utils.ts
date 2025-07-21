declare const browser: typeof chrome;

const getBrowser = () => {
  if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.id) {
    return browser;
  }
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
    return chrome;
  }
  if (typeof window !== 'undefined' && (window as any).browser) {
    return (window as any).browser;
  }
  if (typeof window !== 'undefined' && (window as any).chrome) {
    return (window as any).chrome;
  }
  throw new Error('Browser extension API not available');
};

export const runtime = getBrowser().runtime;
export const storage = getBrowser().storage;
export const tabs = getBrowser().tabs;

export const sendMessage = (message: any): Promise<any> => {
  console.log('Sending message:', message);
  return new Promise((resolve, reject) => {
    try {
      runtime.sendMessage(message, (response: any) => {
        console.log('Message response:', response);
        runtime.lastError ? reject(runtime.lastError) : resolve(response);
      });
    } catch (error) {
      console.error('Send message error:', error);
      reject(error);
    }
  });
};

export const storageGet = (keys: string | string[]): Promise<any> => 
  new Promise((resolve, reject) => {
    storage.local.get(keys, (result: any) => 
      runtime.lastError ? reject(runtime.lastError) : resolve(result)
    );
  });

export const storageSet = (items: Record<string, any>): Promise<void> => 
  new Promise((resolve, reject) => {
    storage.local.set(items, () => 
      runtime.lastError ? reject(runtime.lastError) : resolve()
    );
  });

export { getBrowser };

export const setStatus = (message: string): void => {
  const statusElement = document.getElementById('status');
  if (statusElement) statusElement.textContent = message;
};

export const getActiveTab = async () => {
  const [tab] = await tabs.query({ active: true, currentWindow: true });
  if (!tab.id) throw new Error('No active tab found');
  return tab;
};
