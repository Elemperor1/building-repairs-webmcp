import { Building2, ChevronDown, Menu } from "lucide-react";

interface AppHeaderProps {
  toolStatus: "connected" | "unavailable" | "error";
}

export function AppHeader({ toolStatus }: AppHeaderProps) {
  const statusLabel =
    toolStatus === "connected"
      ? "Agent tools connected"
      : toolStatus === "error"
        ? "Agent tools need attention"
        : "Browser agent tools unavailable";

  return (
    <header className="app-header">
      <button className="icon-button menu-button" aria-label="Open navigation" type="button">
        <Menu aria-hidden="true" />
      </button>
      <h1>Building repairs</h1>
      <div className="header-actions">
        <button
          className="building-picker"
          type="button"
          aria-label="Choose building: 18 Hawthorn Court"
        >
          <Building2 aria-hidden="true" />
          <span>18 Hawthorn Court</span>
          <ChevronDown aria-hidden="true" />
        </button>
        <div className={`tool-status tool-status--${toolStatus}`} role="status">
          <span className="status-dot" aria-hidden="true" />
          {statusLabel}
        </div>
        <button
          className="profile-button"
          type="button"
          aria-label="PM — open property manager profile"
        >
          PM
        </button>
      </div>
    </header>
  );
}
