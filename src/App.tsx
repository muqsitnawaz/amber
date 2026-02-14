import { useState, useCallback } from "react";
import Sidebar from "./components/Sidebar";
import ContextList from "./components/ContextList";
import Knowledge from "./components/Knowledge";
import Settings from "./components/Settings";
import { normalizeView, type View } from "./lib/navigation";

export default function App() {
  const initialView = normalizeView(new URLSearchParams(window.location.search).get("view"));
  const [view, setView] = useState<View>(initialView);

  const navigateTo = useCallback((v: View) => {
    setView(v);
  }, []);

  return (
    <div className="app-layout">
      <Sidebar currentView={view} onNavigate={navigateTo} />
      <main className="main-content">
        <div className="view-content">
          {view === "context" && <ContextList />}
          {view === "knowledge" && <Knowledge />}
          {view === "settings" && <Settings />}
        </div>
      </main>
    </div>
  );
}
