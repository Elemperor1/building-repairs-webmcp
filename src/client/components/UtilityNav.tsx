import {
  CalendarDays,
  CircleHelp,
  FileText,
  Home,
  LogOut,
  Settings,
  Users,
  Wrench,
} from "lucide-react";

const primaryItems = [
  { label: "Repairs", icon: Home, active: true },
  { label: "Contractors", icon: Wrench },
  { label: "People", icon: Users },
  { label: "Calendar", icon: CalendarDays },
  { label: "Documents", icon: FileText },
  { label: "Settings", icon: Settings },
];

export function UtilityNav() {
  return (
    <nav className="utility-nav" aria-label="Main navigation">
      <div className="utility-nav__primary">
        {primaryItems.map(({ label, icon: Icon, active }) => (
          <button
            key={label}
            className={active ? "utility-link utility-link--active" : "utility-link"}
            type="button"
            aria-label={label}
            aria-current={active ? "page" : undefined}
            title={label}
          >
            <Icon aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="utility-nav__secondary">
        <button className="utility-link" type="button" aria-label="Help" title="Help">
          <CircleHelp aria-hidden="true" />
        </button>
        <button className="utility-link" type="button" aria-label="Sign out" title="Sign out">
          <LogOut aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
