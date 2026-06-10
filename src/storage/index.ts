export { getSettings, setSettings, subscribeSettings } from './config';
export { getApiKey, setApiKey, migrateApiKey, clearApiKey, type KeyStorageMode } from './key';
export {
  openCorpus,
  addItem,
  updateItem,
  deleteItem,
  getAllItems,
  getItemsByType,
  countItems,
  DB_NAME,
  DB_VERSION,
} from './corpus';
export {
  getCaptureMode,
  setCaptureMode,
  subscribeCaptureMode,
  type ActiveCaptureMode,
} from './captureMode';
export {
  getReplyContextLock,
  setReplyContextLock,
  subscribeReplyContextLock,
} from './replyContextLock';
export {
  getThemePreference,
  setThemePreference,
  subscribeTheme,
  bindDocumentTheme,
  type ThemePreference,
} from './theme';
export {
  getLastPrompt,
  setLastPrompt,
  subscribeLastPrompt,
  type LastPromptRecord,
} from './lastPrompt';
