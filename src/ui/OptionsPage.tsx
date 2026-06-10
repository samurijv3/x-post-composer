import { useCallback, useEffect, useRef, useState } from 'react';
import { BrandMark } from './BrandMark';
import {
  IcChevL,
  IcCheck,
  IcData,
  IcKey,
  IcMoon,
  IcPrompt,
  IcSettings,
  IcSliders,
  IcSun,
} from './icons';
import {
  getThemePreference,
  setThemePreference,
  subscribeTheme,
  type ThemePreference,
} from '../storage';
import { AccountSection } from './sections/AccountSection';
import { OutputRulesSection } from './sections/OutputRulesSection';
import { PromptsSection } from './sections/PromptsSection';
import { DataSection } from './sections/DataSection';

type SectionId = 'account' | 'rules' | 'prompts' | 'data';

interface SectionMeta {
  id: SectionId;
  name: string;
  blurb: string;
  Icon: (props: React.SVGProps<SVGSVGElement>) => React.JSX.Element;
}

const SECTIONS: SectionMeta[] = [
  {
    id: 'account',
    name: 'Account',
    Icon: IcKey,
    blurb: 'Your handle and API key. Stored locally in this browser — never synced.',
  },
  {
    id: 'rules',
    name: 'Output rules',
    Icon: IcSliders,
    blurb: 'Shape what the model may say and how adventurous it gets. Saves as you go.',
  },
  {
    id: 'prompts',
    name: 'Prompts',
    Icon: IcPrompt,
    blurb: 'Every template and chip behind a draft — fully editable, nothing hidden.',
  },
  {
    id: 'data',
    name: 'Data',
    Icon: IcData,
    blurb: 'Everything Margin has saved lives on your machine. Take it or wipe it.',
  },
];

export function OptionsPage() {
  const [active, setActive] = useState<SectionId>('account');
  const [saved, setSaved] = useState<boolean>(false);
  const savedTimer = useRef<number | null>(null);

  const flashSaved = useCallback(() => {
    setSaved(true);
    if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), 1700);
  }, []);

  const cat = SECTIONS.find((c) => c.id === active) ?? SECTIONS[0]!;

  return (
    <div className="options">
      <div className="options-inner">
        <aside className="opt-aside">
          <button
            type="button"
            className="opt-back"
            onClick={() => window.close()}
            title="Close settings"
          >
            <IcChevL /> Back to X
          </button>
          <div className="opt-brand">
            <BrandMark />
            <div className="brand-name">Margin</div>
          </div>
          <nav className="opt-nav">
            {SECTIONS.map((c) => {
              const Icon = c.Icon;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`opt-nav-btn ${active === c.id ? 'active' : ''}`}
                  onClick={() => setActive(c.id)}
                >
                  <Icon /> {c.name}
                </button>
              );
            })}
          </nav>
          <hr className="hr" style={{ margin: '12px 0' }} />
          <ThemeNavButton />
          <p className="opt-foot">Margin v1 · honest LLM wrapper · no telemetry</p>
        </aside>
        <main className="opt-main">
          <div className="opt-head">
            <div>
              <h1 className="opt-h">{cat.name}</h1>
              <p className="opt-sub">{cat.blurb}</p>
            </div>
            <span className={`opt-saved ${saved ? 'show' : ''}`}>
              <IcCheck /> Saved
            </span>
          </div>
          {active === 'account' && <AccountSection onSaved={flashSaved} />}
          {active === 'rules' && <OutputRulesSection onSaved={flashSaved} />}
          {active === 'prompts' && <PromptsSection onSaved={flashSaved} />}
          {active === 'data' && <DataSection onSaved={flashSaved} />}
        </main>
      </div>
    </div>
  );
}

function ThemeNavButton() {
  const [pref, setPref] = useState<ThemePreference>('light');
  useEffect(() => {
    void getThemePreference().then(setPref);
    const unsub = subscribeTheme(setPref);
    return () => unsub();
  }, []);
  function toggle(): void {
    void setThemePreference(pref === 'dark' ? 'light' : 'dark');
  }
  return (
    <button
      type="button"
      className="opt-nav-btn"
      onClick={toggle}
      title={pref === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {pref === 'dark' ? <IcSun /> : <IcMoon />}
      {pref === 'dark' ? 'Light theme' : 'Dark theme'}
    </button>
  );
}

// Silence unused import while sections wire up.
void IcSettings;
