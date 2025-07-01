import React from 'react';

function LoadingScreen({ title = "Loading Extension", message = "Restoring previous state..." }) {
  return (
    <div className="w-96 h-[600px] bg-tv-gray-900 text-white flex items-center justify-center p-6">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-tv-blue/20 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-tv-blue border-t-transparent rounded-full animate-spin"></div>
        </div>
        <h2 className="text-lg font-semibold mb-2 text-white">{title}</h2>
        <p className="text-sm text-tv-gray-400">{message}</p>
      </div>
    </div>
  );
}

export default LoadingScreen; 