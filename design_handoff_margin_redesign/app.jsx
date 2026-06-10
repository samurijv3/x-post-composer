// app.jsx — browser frame + docked panel / options view + Tweaks.
const { useState: useStateA, useEffect: useEffectA, useLayoutEffect } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "view": "panel",
  "navMode": "minimal",
  "vibe": "quiet",
  "density": "comfortable",
  "accent": "blue",
  "dark": false,
  "demoError": "off"
}/*EDITMODE-END*/;

const WIN_W = 1200, WIN_H = 772;

function PageTimeline() {
  return (
    <div className="page">
      <div className="page-scroll">
        <div className="page-watermark">x.com / home — context source (illustrative)</div>
        <div className="page-railhead">
          <div className="dot" />
          <div className="bar" style={{ width: 120 }} />
          <span style={{ flex: 1 }} />
          <div className="bar" style={{ width: 60 }} />
        </div>
        {window.TIMELINE.map((c, i) => (
          <div key={i} className={`tl-card ${c.target ? 'is-target' : ''}`}>
            <div className="ava" />
            <div className="body">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div className="tl-line" style={{ width: 90, height: 11 }} />
                <div className="tl-line" style={{ width: 50 }} />
              </div>
              {c.lines.map((w, j) => <div key={j} className="tl-line" style={{ width: w + '%' }} />)}
              {c.target && <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, marginTop: 4 }}>↑ pulled into Margin as reply context</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function App() {
  const [t, setTweak] = window.useTweaks(TWEAK_DEFAULTS);
  const [toast, setToast] = useStateA(null);
  const [scale, setScale] = useStateA(1);
  const [library, setLibrary] = useStateA(window.LIBRARY);

  function fireToast(msg, action) { setToast({ msg, action, stamp: Date.now() }); window.clearTimeout(fireToast._t); fireToast._t = window.setTimeout(() => setToast(null), action ? 5200 : 1800); }
  const toggleTheme = () => setTweak('dark', !t.dark);

  useLayoutEffect(() => {
    function fit() {
      const s = Math.min(1, (window.innerWidth - 48) / WIN_W, (window.innerHeight - 48) / WIN_H);
      setScale(s);
    }
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const tabs = t.view === 'options'
    ? [{ title: 'X / Home' }, { title: 'Margin — Settings' }]
    : [{ title: 'X / Home' }];
  const activeIndex = t.view === 'options' ? 1 : 0;
  const url = t.view === 'options' ? 'extension · margin/options' : 'x.com/home';

  return (
    <div className="stage" data-theme={t.dark ? 'dark' : 'light'} data-accent={t.accent} data-vibe={t.vibe} data-density={t.density}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}>
        <window.ChromeWindow width={WIN_W} height={WIN_H} url={url} tabs={tabs} activeIndex={activeIndex}>
          {t.view === 'options' ? (
            <div style={{ height: '100%', overflow: 'auto' }}>
              <window.OptionsPage dark={t.dark} onToggleTheme={toggleTheme} onClose={() => setTweak('view', 'panel')} library={library} setLibrary={setLibrary} />
            </div>
          ) : (
            <div style={{ height: '100%', display: 'flex', minHeight: 0 }}>
              <div style={{ flex: 1, minWidth: 0 }}><PageTimeline /></div>
              <div className="dock">
                <window.Panel navMode={t.navMode} dark={t.dark} onToggleTheme={toggleTheme}
                  onOpenOptions={() => setTweak('view', 'options')} demoError={t.demoError}
                  library={library} setLibrary={setLibrary} toast={toast} onToast={fireToast} />
              </div>
            </div>
          )}
        </window.ChromeWindow>
      </div>

      <window.TweaksPanel>
        <window.TweakSection label="View" />
        <window.TweakRadio label="Surface" value={t.view} options={['panel', 'options']} onChange={(v) => setTweak('view', v)} />
        <window.TweakSection label="Navigation (side panel)" />
        <window.TweakRadio label="Pattern" value={t.navMode} options={['minimal', 'rail', 'tabs']} onChange={(v) => setTweak('navMode', v)} />
        <window.TweakSection label="Look & feel" />
        <window.TweakRadio label="Vibe" value={t.vibe} options={['quiet', 'soft', 'crisp']} onChange={(v) => setTweak('vibe', v)} />
        <window.TweakRadio label="Density" value={t.density} options={['comfortable', 'compact']} onChange={(v) => setTweak('density', v)} />
        <window.TweakSelect label="Accent" value={t.accent} options={['blue', 'slate', 'amber']} onChange={(v) => setTweak('accent', v)} />
        <window.TweakToggle label="Dark mode" value={t.dark} onChange={(v) => setTweak('dark', v)} />
        <window.TweakSection label="Demo states" />
        <window.TweakSelect label="Generation error" value={t.demoError} options={['off', 'auth', 'rate-limit', 'network']} onChange={(v) => setTweak('demoError', v)} />
      </window.TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
