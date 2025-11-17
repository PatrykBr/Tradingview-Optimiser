type TabId = "parameters" | "settings" | "results";

interface TabsNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const tabs = [
  { id: "parameters" as const, label: "Strategy" },
  { id: "settings" as const, label: "Optimisation" },
  { id: "results" as const, label: "Live Results" },
];

function TabsNav({ activeTab, onTabChange }: TabsNavProps) {
  return (
    <nav className="flex items-center justify-between border-b border-white/5 px-3 text-sm">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            className={`flex-1 border-b-2 px-3 py-2 font-medium transition-colors ${
              isActive ? "border-cyan-400 text-cyan-100" : "border-transparent text-slate-400 hover:text-slate-100"
            }`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

export default TabsNav;

