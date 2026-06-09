import { useCallback, useEffect, useState } from 'react';
import { getSettings, setSettings } from '../../storage';
import type { Settings } from '../../types';

const POOL_MIN = 5;
const POOL_MAX = 40;

/**
 * Editor for everything that shapes the deterministic side of
 * generation: the structural rules, the do-not-say banlist, the
 * sampling slider, the (disabled-in-v1) manual/corpus balance, and the
 * temperature pair.
 */
export function OutputRulesTab() {
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [doNotSayText, setDoNotSayText] = useState<string>('');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    const s = await getSettings();
    setSettingsState(s);
    setDoNotSayText(s.doNotSay.join('\n'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function update(patch: Partial<Settings>): Promise<void> {
    await setSettings(patch);
    setSavedAt(Date.now());
    await load();
  }

  async function saveDoNotSay(): Promise<void> {
    const list = doNotSayText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    await update({ doNotSay: list });
  }

  if (!settings) return <div className="stub">Loading…</div>;

  const rules = settings.structuralRules;

  return (
    <div className="tab-panel">
      <section>
        <h2>Structural rules</h2>
        <p className="help">
          Prevention-first: the prompt asks the model to avoid these patterns, then the
          deterministic check + a single repair re-prompt catches any residue. Em-dash and smart
          quotes are also auto-fixed mechanically.
        </p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={rules.noEmDash}
            onChange={(e) =>
              void update({
                structuralRules: { ...rules, noEmDash: e.target.checked },
              })
            }
          />
          <span>No em dashes (—)</span>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={rules.noSmartQuotes}
            onChange={(e) =>
              void update({
                structuralRules: { ...rules, noSmartQuotes: e.target.checked },
              })
            }
          />
          <span>No smart/curly quotes</span>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={rules.noStaccato}
            onChange={(e) =>
              void update({
                structuralRules: { ...rules, noStaccato: e.target.checked },
              })
            }
          />
          <span>No staccato runs (3+ consecutive sentences of ≤4 words)</span>
        </label>
      </section>

      <section>
        <h2>Do-not-say banlist</h2>
        <p className="help">
          One entry per line. Matched case-insensitive and whole-word — &quot;art&quot; will not
          match &quot;start&quot;, multi-word entries match as a contiguous sequence.
        </p>
        <textarea
          rows={10}
          value={doNotSayText}
          onChange={(e) => setDoNotSayText(e.target.value)}
          spellCheck={false}
          aria-label="Do-not-say list, one entry per line"
        />
        <button className="primary" type="button" onClick={() => void saveDoNotSay()}>
          Save banlist
        </button>
      </section>

      <section>
        <h2>Example sampling</h2>
        <div className="field">
          <label htmlFor="poolSize">
            Pool size: {settings.poolSize} (range {POOL_MIN}–{POOL_MAX})
          </label>
          <input
            id="poolSize"
            type="range"
            min={POOL_MIN}
            max={POOL_MAX}
            value={settings.poolSize}
            onChange={(e) => void update({ poolSize: Number(e.target.value) })}
          />
          <div className="help">
            How many of your library items the prompt may sample. Higher = more variety but a
            longer prompt and slightly higher cost per call.
          </div>
        </div>
        <div className="field" title="Available after you import your post archive (Phase 2).">
          <label htmlFor="balance">
            Manual / corpus balance: {settings.manualCorpusBalance}% manual
          </label>
          <input
            id="balance"
            type="range"
            min={0}
            max={100}
            value={settings.manualCorpusBalance}
            disabled
          />
          <div className="help">
            Inert in v1 — kicks in once Phase 2 lets you bulk-import your archive alongside
            manually picked items. Shown so the setting&apos;s shape is visible up front.
          </div>
        </div>
      </section>

      <section>
        <h2>Temperature</h2>
        <p className="help">
          How adventurous the model gets. 0 is deterministic and dry, 1 is high-variance. We use
          two values: one for normal generation, a higher one for Regenerate (so re-rolling
          actually gives you something noticeably different).
        </p>
        <div className="field">
          <label htmlFor="tempGen">Generate temperature: {settings.temperature.generate}</label>
          <input
            id="tempGen"
            type="number"
            step={0.05}
            min={0}
            max={1}
            value={settings.temperature.generate}
            onChange={(e) =>
              void update({
                temperature: { ...settings.temperature, generate: Number(e.target.value) },
              })
            }
          />
        </div>
        <div className="field">
          <label htmlFor="tempRegen">
            Regenerate temperature: {settings.temperature.regenerate}
          </label>
          <input
            id="tempRegen"
            type="number"
            step={0.05}
            min={0}
            max={1}
            value={settings.temperature.regenerate}
            onChange={(e) =>
              void update({
                temperature: { ...settings.temperature, regenerate: Number(e.target.value) },
              })
            }
          />
        </div>
      </section>

      {savedAt !== null && <div className="status ok">Saved.</div>}
    </div>
  );
}
