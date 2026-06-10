import { IcKey, IcRefresh, IcSettings, IcWarn } from '../icons';

/** Mirrors GenerationResultErr['kind'] — the six failure flavours the UI words differently. */
export type ErrorKind = 'auth' | 'rate-limit' | 'network' | 'server' | 'bad-request' | 'other';

interface ErrorDef {
  tone: 'danger' | 'warn';
  title: string;
  msg: string;
  action: 'settings' | 'retry';
}

const ERRORS: Record<ErrorKind, ErrorDef> = {
  auth: {
    tone: 'danger',
    title: 'Check your API key',
    msg: 'Anthropic rejected the saved key. Update it in settings, then try again.',
    action: 'settings',
  },
  'rate-limit': {
    tone: 'warn',
    title: 'Rate limited',
    msg: 'Too many requests in a row. Wait a moment, then retry.',
    action: 'retry',
  },
  network: {
    tone: 'warn',
    title: "Couldn't reach Anthropic",
    msg: 'A network error interrupted the request. Check your connection and retry.',
    action: 'retry',
  },
  server: {
    tone: 'warn',
    title: 'Anthropic is having trouble',
    msg: 'The service returned a server error. Wait a moment and retry.',
    action: 'retry',
  },
  'bad-request': {
    tone: 'danger',
    title: 'Anthropic rejected the request',
    msg: 'The prompt was malformed. Check the Prompts settings; try Reset to default if you edited a template.',
    action: 'settings',
  },
  other: {
    tone: 'warn',
    title: "Couldn't generate",
    msg: 'An unexpected error occurred. Retry, or check Inspect last prompt in settings.',
    action: 'retry',
  },
};

interface ErrorCardProps {
  kind: ErrorKind;
  onRetry: () => void;
  onSettings: () => void;
}

export function ErrorCard({ kind, onRetry, onSettings }: ErrorCardProps) {
  const e = ERRORS[kind];
  return (
    <div className={`error-card ${e.tone}`}>
      {e.tone === 'danger' ? <IcKey className="ec-ic" /> : <IcWarn className="ec-ic" />}
      <div style={{ flex: 1 }}>
        <div className="ec-title">{e.title}</div>
        <div className="ec-msg">{e.msg}</div>
        <div className="ec-actions">
          {e.action === 'settings' ? (
            <button type="button" className="btn sm" onClick={onSettings}>
              <IcSettings /> Open settings
            </button>
          ) : (
            <button type="button" className="btn sm" onClick={onRetry}>
              <IcRefresh /> Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
