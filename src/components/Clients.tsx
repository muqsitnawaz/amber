import { useState, useEffect } from "react";
import { getMcpConnections } from "../lib/api";

export default function Clients() {
  const [mcpConnections, setMcpConnections] = useState(0);

  useEffect(() => {
    getMcpConnections().then(setMcpConnections).catch(() => {});
  }, []);

  return (
    <div className="clients-view">
      <div className="view-header">
        <h1>Clients</h1>
      </div>

      <div className="mcp-section">
        <div className="section-title">MCP Server</div>
        <div className="mcp-status">
          <div className="mcp-connection-row">
            <span className={`mcp-dot ${mcpConnections > 0 ? "active" : ""}`} />
            <span className="mcp-label">
              {mcpConnections > 0
                ? `${mcpConnections} agent${mcpConnections > 1 ? "s" : ""} connected`
                : "No agents connected"}
            </span>
            <button
              className="btn-refresh-small"
              onClick={() => getMcpConnections().then(setMcpConnections).catch(() => {})}
            >
              Refresh
            </button>
          </div>
          <div className="mcp-hint">
            AI agents connect via MCP to read and write memories. Add Amber to your agent's MCP config to enable.
          </div>
        </div>
      </div>
    </div>
  );
}
