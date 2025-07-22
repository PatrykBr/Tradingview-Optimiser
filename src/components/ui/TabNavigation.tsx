import React from 'react';

interface Tab {
    id: string;
    label: string;
    icon: string;
}

interface TabNavigationProps {
    tabs: Tab[];
    activeTab: string;
    onTabChange: (tabId: string) => void;
}

export const TabNavigation: React.FC<TabNavigationProps> = ({ tabs, activeTab, onTabChange }) => {
    return (
        <nav className='border-popup-border flex border-b'>
            {tabs.map(tab => (
                <button
                    key={tab.id}
                    onClick={() => onTabChange(tab.id)}
                    className={`tab-button flex-1 ${activeTab === tab.id ? 'active' : ''}`}
                >
                    <span className='mr-2'>{tab.icon}</span>
                    {tab.label}
                </button>
            ))}
        </nav>
    );
};
