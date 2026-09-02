import { Filter, MessageSquarePlus, RotateCcw } from "lucide-react";
import type { RepairCase, RepairStatus } from "../../shared/types";

interface RepairQueueProps {
  cases: RepairCase[];
  selectedId?: string;
  onSelect: (caseId: string) => void;
  onOpenSmsSimulator: () => void;
  demoMode: boolean;
  resetting: boolean;
  onResetDemo: () => Promise<void>;
  controlledLiveMode: boolean;
}

const groups: Array<{ status: RepairStatus; label: string }> = [
  { status: "new", label: "New" },
  { status: "waiting_for_approval", label: "Waiting for approval" },
  { status: "approved", label: "Approved" },
  { status: "scheduled", label: "Scheduled" },
];

const relativeTime = (value: string) => {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "1 hr ago" : `${hours} hrs ago`;
};

export function RepairQueue({
  cases,
  selectedId,
  onSelect,
  onOpenSmsSimulator,
  demoMode,
  resetting,
  onResetDemo,
  controlledLiveMode,
}: RepairQueueProps) {
  return (
    <aside className="repair-queue" aria-label="Repair queue">
      <div className="queue-heading">
        <h2>Repair queue</h2>
        <button className="icon-button" type="button" aria-label="Filter repairs">
          <Filter aria-hidden="true" />
        </button>
      </div>

      <div className="queue-groups">
        {groups.map((group) => {
          const items = cases.filter((item) => item.status === group.status);
          if (items.length === 0) return null;
          return (
            <section className="queue-group" key={group.status}>
              <h3>
                {group.label} <span>({items.length})</span>
              </h3>
              <div className="queue-list">
                {items.map((repair) => (
                  <button
                    key={repair.id}
                    type="button"
                    onClick={() => onSelect(repair.id)}
                    className={repair.id === selectedId ? "queue-item queue-item--selected" : "queue-item"}
                    aria-current={repair.id === selectedId ? "true" : undefined}
                  >
                    <span className="queue-item__title">{repair.title}</span>
                    <span className="queue-item__time">{relativeTime(repair.updatedAt)}</span>
                    <span className="queue-item__tenant">
                      {repair.tenant.name}, {repair.tenant.unit}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {demoMode ? (
        <div className="demo-controls">
          <button className="test-sms-button" type="button" onClick={onOpenSmsSimulator}>
            <MessageSquarePlus aria-hidden="true" />
            Simulate SMS / MMS
          </button>
          <button
            className="test-sms-button"
            type="button"
            onClick={() => void onResetDemo()}
            disabled={resetting}
          >
            <RotateCcw aria-hidden="true" />
            {resetting ? "Resetting…" : "Reset synthetic demo"}
          </button>
        </div>
      ) : import.meta.env.DEV && !controlledLiveMode ? (
        <button className="test-sms-button" type="button" onClick={onOpenSmsSimulator}>
          <MessageSquarePlus aria-hidden="true" />
          Test an incoming text
        </button>
      ) : null}
    </aside>
  );
}
