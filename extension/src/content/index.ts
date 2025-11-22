import type { ContentScriptRequest, ContentScriptResponse } from "@shared/ipc";
import { handleTradingViewMessage } from "./tradingview";

chrome.runtime.onMessage.addListener(
  (
    request: ContentScriptRequest,
    _sender,
    sendResponse: (response: ContentScriptResponse) => void
  ) => {
    handleTradingViewMessage(request).then(sendResponse);
    return true;
  }
);

