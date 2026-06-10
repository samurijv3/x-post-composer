// options.jsx — full-page settings view (the extension's options page).
const { useState: useStateO, useRef: useRefO } = React;

const SECTION_COMPONENT = { account: 'AccountSection', rules: 'RulesSection', prompts: 'PromptsSection', data: 'DataSection' };

function OptionsPage({ dark, onToggleTheme, onClose, library, setLibrary }) {
  const [active, setActive] = useStateO('account');
  const [saved, setSaved] = useStateO(false);
  const savedTimer = useRefO(null);
  const Section = window[SECTION_COMPONENT[active]];
  const cat = window.SET_CATEGORIES.find((c) => c.id === active);

  function flashSaved() {
    setSaved(true);
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), 1700);
  }

  return (
    <div className="options">
      <div className="options-inner">
        <aside className="opt-aside">
          {onClose && <button className="opt-back" onClick={onClose}><window.IcChevL /> Back to X</button>}
          <div className="opt-brand">
            <div className="brand-mark"><span className="bm-rule" /><span className="bm-lines" /></div>
            <div className="brand-name">Margin</div>
          </div>
          <nav className="opt-nav">
            {window.SET_CATEGORIES.map((c) => {
              const Icon = window[c.icon];
              return (
                <button key={c.id} className={`opt-nav-btn ${active === c.id ? 'active' : ''}`} onClick={() => setActive(c.id)}>
                  <Icon /> {c.name}
                </button>
              );
            })}
          </nav>
          <div className="hr" style={{ margin: '12px 0' }} />
          <button className="opt-nav-btn" onClick={onToggleTheme}>
            {dark ? <window.IcSun /> : <window.IcMoon />} {dark ? 'Light theme' : 'Dark theme'}
          </button>
          <p className="opt-foot">Margin v1 · honest LLM wrapper · no telemetry</p>
        </aside>

        <main className="opt-main">
          <div className="opt-head">
            <div>
              <h1 className="opt-h">{cat.name}</h1>
              <p className="opt-sub">{cat.blurb}</p>
            </div>
            <span className={`opt-saved ${saved ? 'show' : ''}`}><window.IcCheck /> Saved</span>
          </div>
          <Section onSaved={flashSaved} library={library} setLibrary={setLibrary} />
        </main>
      </div>
    </div>
  );
}

window.OptionsPage = OptionsPage;
