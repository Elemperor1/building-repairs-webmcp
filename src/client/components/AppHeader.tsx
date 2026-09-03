import { Building2, ChevronDown, Menu, ShieldCheck } from "lucide-react";

interface AppHeaderProps {
  toolStatus: "connected" | "unavailable" | "error";
  demoMode: boolean;
}

export function AppHeader({ toolStatus, demoMode }: AppHeaderProps) {
  const statusLabel =
    toolStatus === "connected"
      ? "WebMCP ready"
      : toolStatus === "error"
        ? "WebMCP needs attention"
        : "WebMCP isn't available in this browser";

  return (
    <header className="app-header">
      <button className="icon-button menu-button" aria-label="Open navigation" type="button">
        <Menu aria-hidden="true" />
      </button>
      <div className="brand-lockup">
        <h1>Fix This</h1>
        <span>Repairs without the runaround.</span>
      </div>
      {demoMode ? (
        <div className="demo-banner" role="status">
          <ShieldCheck aria-hidden="true" />
          <strong>Synthetic Pennsylvania demo</strong>
          <span>No real messages or calls</span>
        </div>
      ) : null}
      <div className="header-actions">
        <button
          className="building-picker"
          type="button"
          aria-label={`Choose building: ${demoMode ? "Hawthorn Court Demo Apartments" : "18 Hawthorn Court"}`}
        >
          <Building2 aria-hidden="true" />
          <span>{demoMode ? "Hawthorn Court Demo Apartments" : "18 Hawthorn Court"}</span>
          <ChevronDown aria-hidden="true" />
        </button>
        <div className={`tool-status tool-status--${toolStatus}`} role="status">
          <span className="status-dot" aria-hidden="true" />
          {statusLabel}
        </div>
        <button
          className="profile-button"
          type="button"
          aria-label={demoMode ? "Priya Shah, demo manager" : "PM — open property manager profile"}
        >
          {demoMode ? "PS" : "PM"}
        </button>
      </div>
    </header>
  );
}
