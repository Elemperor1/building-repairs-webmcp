import { AlertCircle, X } from "lucide-react";

export function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="error-banner" role="alert">
      <AlertCircle aria-hidden="true" />
      <span>{message}</span>
      <button className="icon-button" type="button" aria-label="Dismiss error" onClick={onClose}>
        <X aria-hidden="true" />
      </button>
    </div>
  );
}

export function Notice({ message }: { message: string }) {
  return (
    <div className="notice" role="status">
      {message}
    </div>
  );
}

export function LoadingShell() {
  return (
    <div className="loading-shell" aria-label="Loading repairs">
      <span />
      <span />
      <span />
    </div>
  );
}
