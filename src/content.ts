import type { MessageRequest } from './types';
import { MessageHandler } from './handlers/messageHandler';
import { runtime } from './utils';

const messageHandler = new MessageHandler();

runtime.onMessage.addListener((request: MessageRequest, _: any, sendResponse: any) => {
  messageHandler.handle(request).then(response => {
    sendResponse(response);
  }).catch(error => {
    sendResponse({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  });
  
  return true;
});

console.log('DOM Reader loaded');
