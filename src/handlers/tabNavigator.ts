import { TAB_SELECTORS } from '../config';

export class TabNavigator {
  click(tabId: string): boolean {
    try {
      const selector = TAB_SELECTORS[tabId as keyof typeof TAB_SELECTORS];
      const button = selector ? document.querySelector(selector) as HTMLButtonElement : null;
      
      if (button) {
        button.click();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error clicking tab:', error);
      return false;
    }
  }
}
