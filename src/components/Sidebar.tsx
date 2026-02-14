import { type View } from "../lib/navigation";

interface SidebarProps {
  currentView: View;
  onNavigate: (view: View) => void;
}

const navItems: Array<{ id: View; label: string; icon: string }> = [
  { id: "context", label: "Context", icon: "\u25C8" },
  { id: "knowledge", label: "Knowledge", icon: "\u2662" },
  { id: "settings", label: "Settings", icon: "\u2699" },
];

export default function Sidebar({ currentView, onNavigate }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-drag-region" />
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`sidebar-item ${currentView === item.id ? "active" : ""}`}
            onClick={() => onNavigate(item.id)}
          >
            <span className="sidebar-icon">{item.icon}</span>
            <span className="sidebar-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <span className="sidebar-brand">amber</span>
      </div>
    </aside>
  );
}
