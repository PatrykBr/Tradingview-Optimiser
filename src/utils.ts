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
  return new Promise((resolve, reject) => {
    try {
      runtime.sendMessage(message, (response: any) => {
        if (runtime.lastError) {
          reject(runtime.lastError);
        } else {
          resolve(response);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
};

export const storageGet = (keys: string | string[]): Promise<any> => {
  return new Promise((resolve, reject) => {
    storage.local.get(keys, (result: any) => {
      if (runtime.lastError) {
        reject(runtime.lastError);
      } else {
        resolve(result);
      }
    });
  });
};

export const storageSet = (items: Record<string, any>): Promise<void> => {
  return new Promise((resolve, reject) => {
    storage.local.set(items, () => {
      if (runtime.lastError) {
        reject(runtime.lastError);
      } else {
        resolve();
      }
    });
  });
};

export { getBrowser };

export const getElement = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Element with id "${id}" not found`);
  return element;
};

export const escapeHtml = (text: string): string => {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};

export const setStatus = (message: string): void => {
  getElement('status').textContent = message;
};

export const handleError = (error: unknown): string => 
  error instanceof Error ? error.message : 'Unknown error';

export const getActiveTab = async () => {
  const [tab] = await tabs.query({ active: true, currentWindow: true });
  if (!tab.id) throw new Error('No active tab found');
  return tab;
};
