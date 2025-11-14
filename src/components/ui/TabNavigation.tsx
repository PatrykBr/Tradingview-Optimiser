interface Tab {
    readonly id: string;
    readonly label: string;
    readonly icon: string;
}

interface TabNavigationProps {
    tabs: readonly Tab[];
    activeTab: string;
    onTabChange: (tabId: string) => void;
}

export function TabNavigation({ tabs, activeTab, onTabChange }: TabNavigationProps) {
    return (
        <nav className='border-popup-border flex border-b'>
            {tabs.map(tab => (
                <button
                    key={tab.id}
                    type='button'
                    onClick={() => onTabChange(tab.id)}
                    className={`tab-button flex-1 ${activeTab === tab.id ? 'active' : ''}`}
                >
                    <span className='mr-2'>{tab.icon}</span>
                    {tab.label}
                </button>
            ))}
        </nav>
    );
}
