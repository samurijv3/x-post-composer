import { useCallback, useEffect, useState } from 'react';
import { countItems, getSettings, setSettings } from '../../storage';
import { isMessageOfType, onNotice } from '../../messaging';
import type { Settings } from '../../types';

interface Props {
  onSaved: () => void;
}

const POOL_MIN = 5;
const POOL_MAX = 40;

/**
 * Output rules section: structural toggles + do-not-say banlist +
 * pool size + temperature pair. Applies immediately on every change
 * (flashes the "Saved" indicator via onSaved).
 */
export function OutputRulesSection({ onSaved }: Props) {
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [banlistText, setBanlistText] = useState<string>('');
  const [libraryCount, setLibraryCount] = useState<number>(0);

  const load = useCallback(async () => {
    const s = await getSettings();
    setSettingsState(s);
    setBanlistText(s.doNotSay.join('\n'));
  }, []);

  const refreshCount = useCallback(async () => {
    try {
      setLibraryCount(await countItems());
    } catch {
      setLibraryCount(0);
    }
  }, []);

  useEffect(() => {
    void load();
    void refreshCount();
    const unsub = onNotice((notice) => {
      if (isMessageOfType(notice, 'bg:library-changed')) void refreshCount();
    });
    return () => unsub();
  }, [load, refreshCount]);

  async function update(patch: Partial<Settings>): Promise<void> {
    await setSettings(patch);
    onSaved();
    await load();
  }

  async function saveBanlist(): Promise<void> {
    const list = banlistText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    await update({ doNotSay: list });
  }

  if (!settings) return <div className="opt-card">Loading…</div>;
  const rules = settings.structuralRules;

  const regenLeqGen = settings.temperature.regenerate <= settings.temperature.generate;
  return (
    <div className="opt-stack">
      <div className="opt-cols-2">
        <div className="opt-col">
          <div className="opt-card">
            <div className="opt-card-title">Structural rules</div>
            <p className="opt-card-desc">
              The prompt asks the model to avoid these; a deterministic check + one repair pass
              catches any residue.
            </p>
            <div className="rule-list">
              <label className="field-row rule-toggle">
                <span>No em dashes (—)</span>
                <span className="switch">
                  <input
                    type="checkbox"
                    checked={rules.noEmDash}
                    onChange={(e) =>
                      void update({
                        structuralRules: { ...rules, noEmDash: e.target.checked },
                      })
                    }
                  />
                  <span className="track" />
                </span>
              </label>
              <label className="field-row rule-toggle">
                <span>No smart / curly quotes</span>
                <span className="switch">
                  <input
                    type="checkbox"
                    checked={rules.noSmartQuotes}
                    onChange={(e) =>
                      void update({
                        structuralRules: { ...rules, noSmartQuotes: e.target.checked },
                      })
                    }
                  />
                  <span className="track" />
                </span>
              </label>
              <label className="field-row rule-toggle">
                <span>No staccato runs (3+ short sentences)</span>
                <span className="switch">
                  <input
                    type="checkbox"
                    checked={rules.noStaccato}
                    onChange={(e) =>
                      void update({
                        structuralRules: { ...rules, noStaccato: e.target.checked },
                      })
                    }
                  />
                  <span className="track" />
                </span>
              </label>
            </div>
          </div>

          <div className="opt-card">
            <div className="opt-card-title">Example sampling</div>
            <div className="field-row">
              <span className="fld-label">Pool size</span>
              <span className="count">{settings.poolSize}</span>
            </div>
            <input
              type="range"
              className="range"
              min={POOL_MIN}
              max={POOL_MAX}
              value={settings.poolSize}
              onChange={(e) => void update({ poolSize: Number(e.target.value) })}
            />
            <p className="opt-card-desc" style={{ marginTop: 10, marginBottom: 0 }}>
              How many of your saved examples the prompt may sample. Higher = more variety, longer
              prompt. You currently have <strong>{libraryCount}</strong>{' '}
              {libraryCount === 1 ? 'example' : 'examples'} saved
              {libraryCount > 0 && libraryCount < settings.poolSize ? (
                <> — pool size effectively caps at that number.</>
              ) : (
                <>.</>
              )}
            </p>
          </div>
        </div>

        <div className="opt-col">
          <div className="opt-card">
            <div className="opt-card-title">Do-not-say banlist</div>
            <p className="opt-card-desc">
              One entry per line. Matched whole-word and case-insensitive.
            </p>
            <textarea
              rows={6}
              value={banlistText}
              onChange={(e) => setBanlistText(e.target.value)}
              onBlur={() => void saveBanlist()}
              style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)' }}
              spellCheck={false}
            />
          </div>

          <div className="opt-card">
            <div className="opt-card-title">Temperature</div>
            <div className="field-row">
              <span className="fld-label">Generate</span>
              <span className="count">{settings.temperature.generate.toFixed(2)}</span>
            </div>
            <input
              type="range"
              className="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.temperature.generate}
              onChange={(e) =>
                void update({
                  temperature: { ...settings.temperature, generate: Number(e.target.value) },
                })
              }
            />
            <div className="field-row" style={{ marginTop: 8 }}>
              <span className="fld-label">Regenerate</span>
              <span className="count">{settings.temperature.regenerate.toFixed(2)}</span>
            </div>
            <input
              type="range"
              className="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.temperature.regenerate}
              onChange={(e) =>
                void update({
                  temperature: { ...settings.temperature, regenerate: Number(e.target.value) },
                })
              }
            />
            <p className="opt-card-desc" style={{ marginTop: 10, marginBottom: 0 }}>
              Regenerate runs hotter so re-rolls feel different
              {regenLeqGen && (
                <>
                  {' '}
                  — yours is currently <strong>not higher</strong> than Generate, so re-rolls may
                  feel samey.
                </>
              )}
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
