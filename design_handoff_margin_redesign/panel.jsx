// panel.jsx — side-panel shell: brand header, nav patterns (Compose + Voice), screen router.
const { useState: useStateP } = React;

function Panel({ navMode, dark, onToggleTheme, onOpenOptions, demoError, library, setLibrary, toast, onToast }) {
  const [screen, setScreen] = useStateP('compose');

  const Brand = (
    <div className="brand">
      <div className="brand-mark"><span className="bm-rule" /><span className="bm-lines" /></div>
      <div>
        <div className="brand-name">Margin</div>
        <div className="brand-sub">in the margin of X</div>
      </div>
    </div>
  );

  const HeadActions = (
    <>
      {navMode === 'minimal' && (
        <button className="icon-btn" title={screen === 'voice' ? 'Compose' : 'Voice'}
                onClick={() => setScreen(screen === 'voice' ? 'compose' : 'voice')}>
          {screen === 'voice' ? <window.IcCompose /> : <window.IcVoice />}
        </button>
      )}
      <button className="icon-btn" title="Toggle theme" onClick={onToggleTheme}>
        {dark ? <window.IcSun /> : <window.IcMoon />}
      </button>
      <button className="icon-btn" title="Settings (full page)" onClick={onOpenOptions}>
        <window.IcSettings />
      </button>
    </>
  );

  return (
    <div className="panel">
      <div className="panel-head">
        {Brand}
        <span className="head-spacer" />
        {HeadActions}
      </div>

      {navMode === 'rail' && (
        <div className="railnav">
          <button className={screen === 'compose' ? 'active' : ''} onClick={() => setScreen('compose')}><window.IcCompose /> Compose</button>
          <button className={screen === 'voice' ? 'active' : ''} onClick={() => setScreen('voice')}><window.IcVoice /> Voice</button>
        </div>
      )}

      <div className="panel-body">
        {screen === 'compose' && <window.ComposeScreen onToast={onToast} onOpenOptions={onOpenOptions} demoError={demoError} libraryCount={library.length} />}
        {screen === 'voice' && <window.VoiceScreen onToast={onToast} items={library} setItems={setLibrary} />}
      </div>

      {navMode === 'tabs' && (
        <div className="tabbar">
          <button className={screen === 'compose' ? 'active' : ''} onClick={() => setScreen('compose')}><window.IcCompose /> Compose</button>
          <button className={screen === 'voice' ? 'active' : ''} onClick={() => setScreen('voice')}><window.IcVoice /> Voice</button>
        </div>
      )}

      {toast && (
        <div className="toast" key={toast.stamp}>
          <window.IcCheck />
          <span>{toast.msg}</span>
          {toast.action && <button className="toast-action" onClick={toast.action.onClick}>{toast.action.label}</button>}
        </div>
      )}
    </div>
  );
}

window.Panel = Panel;
