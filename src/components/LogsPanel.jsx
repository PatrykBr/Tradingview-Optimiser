import React, { useEffect, useRef, useState } from 'react';

function LogsPanel({ logs }) {
  const [logLevel, setLogLevel] = useState('basic');
  const logsEndRef = useRef(null);

  useEffect(() => {
    // Load log level from storage
    chrome.storage.local.get('logLevel', (data) => {
      if (data.logLevel) {
        setLogLevel(data.logLevel);
      }
    });
  }, []);

  useEffect(() => {
    // Auto-scroll to bottom when new logs arrive
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleLogLevelChange = (level) => {
    setLogLevel(level);
    chrome.storage.local.set({ logLevel: level });
  };

  const filteredLogs = logs.filter(log => {
    if (logLevel === 'basic') {
      return log.level === 'info' || log.level === 'error';
    }
    return true; // Show all logs for detailed level
  });

  const getLogColor = (level) => {
    switch (level) {
      case 'error':
        return 'text-tv-red';
      case 'warning':
        return 'text-tv-orange';
      case 'info':
        return 'text-tv-blue';
      case 'debug':
        return 'text-tv-gray-400';
      default:
        return 'text-white';
    }
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    });
  };

  return (
    <div className="bg-tv-gray-800 rounded p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Logs</h3>
        <div className="flex items-center space-x-2">
          <label className="text-sm text-tv-gray-400">Log Level:</label>
          <select
            value={logLevel}
            onChange={(e) => handleLogLevelChange(e.target.value)}
            className="bg-tv-gray-700 text-white rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-tv-blue"
          >
            <option value="basic">Basic</option>
            <option value="detailed">Detailed</option>
          </select>
        </div>
      </div>

      <div className="bg-tv-gray-900 rounded p-3 h-96 overflow-y-auto font-mono text-xs">
        {filteredLogs.length === 0 ? (
          <p className="text-tv-gray-500 text-center py-4">No logs yet</p>
        ) : (
          <div className="space-y-1">
            {filteredLogs.map((log, index) => (
              <div key={index} className="flex">
                <span className="text-tv-gray-500 mr-2">{formatTimestamp(log.timestamp)}</span>
                <span className={`uppercase mr-2 ${getLogColor(log.level)}`}>
                  [{log.level}]
                </span>
                <span className="text-tv-gray-300 flex-1 break-all">{log.message}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        )}
      </div>

      <div className="mt-2 flex justify-end">
        <button
          onClick={() => navigator.clipboard.writeText(
            filteredLogs.map(log => 
              `${formatTimestamp(log.timestamp)} [${log.level.toUpperCase()}] ${log.message}`
            ).join('\n')
          )}
          className="text-sm text-tv-blue hover:text-blue-400 transition-colors"
        >
          Copy Logs
        </button>
      </div>
    </div>
  );
}

export default LogsPanel; 