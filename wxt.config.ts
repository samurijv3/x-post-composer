import { defineConfig } from 'wxt';

/**
 * WXT config for the X post composer extension.
 *
 * Security posture (see CLAUDE.md §6):
 *  - host_permissions restricted to x.com and twitter.com — no <all_urls>.
 *  - permissions include only what the extension actually uses.
 *  - The API key is read only by the background service worker via the
 *    storage layer; this config does not handle secrets.
 */
export default defineConfig({
  srcDir: '.',
  modules: ['@wxt-dev/module-react'],
  // Auto-imports add hidden behavior. This is a public, security-sensitive
  // extension where every import should be explicit and inspectable — see
  // CLAUDE.md §1 (ethos: honest, transparent, no magic).
  imports: false,
  manifest: {
    name: 'X Post Composer',
    description:
      'Scratch pad for composing X.com posts and replies in your own voice. Bring your own Anthropic API key.',
    permissions: ['storage', 'sidePanel', 'clipboardWrite', 'unlimitedStorage'],
    host_permissions: [
      'https://x.com/*',
      'https://www.x.com/*',
      'https://twitter.com/*',
      'https://www.twitter.com/*',
    ],
    action: {
      default_title: 'Open X Post Composer',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
    commands: {
      'capture-reply-and-open': {
        // Chrome only allows Alt/Ctrl/Shift modifier combos for cross-OS
        // shortcuts; users can rebind at chrome://extensions/shortcuts.
        suggested_key: {
          default: 'Alt+Shift+R',
          mac: 'Alt+Shift+R',
        },
        description:
          'Open the X Post Composer side panel and auto-capture the open reply context',
      },
    },
  },
});
