import { Tabs, type TabDef } from './Tabs';
import { AccountTab } from './tabs/AccountTab';
import { VoiceTab } from './tabs/VoiceTab';
import { OutputRulesTab } from './tabs/OutputRulesTab';
import { PromptsTab } from './tabs/PromptsTab';
import { DataTab } from './tabs/DataTab';
import { CaptureControls } from './CaptureControls';
import { Composer } from './Composer';
import './styles.css';

interface AppProps {
  /** "panel" or "options" — drives the heading and whether to show
   *  composer + capture controls. The options page surfaces just the
   *  tabs since X has no role there. */
  surface: 'panel' | 'options';
}

export function App({ surface }: AppProps) {
  const tabs: TabDef[] = [
    { id: 'account', label: 'Account', content: <AccountTab /> },
    { id: 'voice', label: 'Voice', content: <VoiceTab /> },
    { id: 'output', label: 'Output rules', content: <OutputRulesTab /> },
    { id: 'prompts', label: 'Prompts', content: <PromptsTab /> },
    { id: 'data', label: 'Data', content: <DataTab /> },
  ];

  return (
    <div className="app">
      <h1>X Post Composer — {surface === 'panel' ? 'Side panel' : 'Settings'}</h1>
      {surface === 'panel' && (
        <>
          <Composer />
          <CaptureControls />
        </>
      )}
      <Tabs tabs={tabs} initialId={surface === 'panel' ? 'voice' : 'account'} />
    </div>
  );
}
