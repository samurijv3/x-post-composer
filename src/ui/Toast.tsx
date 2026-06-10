import { IcCheck } from './icons';

export interface ToastData {
  message: string;
  /** Used as React key to re-trigger the slide-in animation. */
  stamp: number;
  /** Optional action button (e.g. "Undo"). */
  action?: { label: string; onClick: () => void };
}

interface Props {
  toast: ToastData | null;
}

/**
 * Bottom-centered pill, dark on light surface, surface-on-dark.
 * Auto-dismiss is the caller's responsibility (so an action-bearing
 * toast can stay longer than a vanilla one).
 */
export function Toast({ toast }: Props) {
  if (!toast) return null;
  return (
    <div className="toast" key={toast.stamp} role="status">
      <IcCheck />
      <span>{toast.message}</span>
      {toast.action && (
        <button type="button" className="toast-action" onClick={toast.action.onClick}>
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
