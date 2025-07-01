import React from 'react';

function ErrorScreen({ title = "Error", message, onRetry }) {
  return (
    <div className="w-96 h-[600px] bg-tv-gray-900 text-white flex items-center justify-center p-6">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-tv-red/20 flex items-center justify-center">
          <svg className="w-8 h-8 text-tv-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold mb-2 text-white">{title}</h2>
        <p className="text-sm text-tv-gray-400 mb-6 leading-relaxed">{message}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-4 py-2 bg-tv-blue text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
          >
            Check Connection
          </button>
        )}
      </div>
    </div>
  );
}

export default ErrorScreen; 