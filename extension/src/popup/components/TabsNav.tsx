import { useOptimiser } from "../state/optimiserContext";
import { cn } from "../utils/cn";

const tabs = [
  { id: "parameters", label: "Strategy" },
  { id: "settings", label: "Optimisation" },
  { id: "results", label: "Live Results" },
] as const;

function TabsNav() {
  const { state, actions } = useOptimiser();

  return (
    <nav className="flex items-center justify-between border-b border-white/5 px-3 text-sm">
      {tabs.map((tab) => {
        const isActive = state.tab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            className={cn(
              "flex-1 border-b-2 px-3 py-2 font-medium transition-colors",
              isActive ? "border-cyan-400 text-cyan-100" : "border-transparent text-slate-400 hover:text-slate-100",
            )}
            onClick={() => actions.setTab(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

export default TabsNav;
