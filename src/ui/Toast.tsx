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
 * X's toast: a blue bar, bottom-center, white text; the action is
 * bold underlined white inside it; an action-bearing toast carries a
 * thin white draining bar matching the ~5 s undo window. Auto-dismiss
 * is the caller's responsibility.
 */
export function Toast({ toast }: Props) {
  if (!toast) return null;
  return (
    <div className="toast" key={toast.stamp} role="status">
      <span>{toast.message}</span>
      {toast.action && (
        <button type="button" className="toast-action" onClick={toast.action.onClick}>
          {toast.action.label}
        </button>
      )}
      {toast.action && <span className="toast-drain" aria-hidden="true" />}
    </div>
  );
}
