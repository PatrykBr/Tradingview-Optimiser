import type { MessageRequest, MessageResponse } from './types';
import { MessageHandler } from './handlers/messageHandler';
import { runtime } from './utils';

const messageHandler = new MessageHandler();

runtime.onMessage.addListener(
    (
        request: MessageRequest,
        _sender: chrome.runtime.MessageSender,
        sendResponse: (response: MessageResponse) => void
    ) => {
        if (!request) {
            sendResponse({
                success: false,
                error: 'Invalid message request - request is undefined'
            });
            return true;
        }

        messageHandler
            .handle(request)
            .then(sendResponse)
            .catch(error =>
                sendResponse({
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error'
                })
            );
        return true;
    }
);
