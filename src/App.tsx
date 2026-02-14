import { useState, useCallback, useEffect, useRef } from "react";
import Sidebar, { type View } from "./components/Sidebar";
import Home from "./components/Home";
import ContextList from "./components/ContextList";
import Knowledge from "./components/Knowledge";
import Sources from "./components/Sources";
import Clients from "./components/Clients";
import Settings from "./components/Settings";

export interface NavigationState {
  view: View;
  contextDate?: string;
  contextFilter?: string;
  knowledgeTab?: "project" | "person" | "topic";
}

export default function App() {
  const [nav, setNav] = useState<NavigationState>({ view: "context" });
  const [viewKey, setViewKey] = useState(0);
  const prevView = useRef(nav.view);

  const navigateTo = useCallback((state: Partial<NavigationState> & { view: View }) => {
    setNav(state);
  }, []);

  // Increment key on view change to trigger fade-in animation
  useEffect(() => {
    if (nav.view !== prevView.current) {
      setViewKey((k) => k + 1);
      prevView.current = nav.view;
    }
  }, [nav.view]);

  return (
    <div className="app-layout">
      <Sidebar currentView={nav.view} onNavigate={(v) => navigateTo({ view: v })} />
      <main className="main-content">
        <div className="view-content" key={viewKey}>
          {nav.view === "home" && <Home onNavigate={navigateTo} />}
          {nav.view === "context" && (
            <ContextList
              initialFilter={nav.contextFilter}
              initialDate={nav.contextDate}
            />
          )}
          {nav.view === "knowledge" && <Knowledge initialTab={nav.knowledgeTab} />}
          {nav.view === "sources" && <Sources />}
          {nav.view === "clients" && <Clients />}
          {nav.view === "settings" && <Settings />}
        </div>
      </main>
    </div>
  );
}
