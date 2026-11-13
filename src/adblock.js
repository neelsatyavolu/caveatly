// Element hiding for ad blocking. Runs at document_start in every frame and asks
// the service worker for cosmetic filters; the worker injects the stylesheet and
// returns extended (procedural) selectors, which Ghostery's injector applies here.
import { injectCosmetics } from '@ghostery/adblocker-webextension-cosmetics';

const INACTIVE = { active: false, scripts: [], styles: '', extended: [] };

injectCosmetics(window, true, async features => {
  try {
    return (await chrome.runtime.sendMessage({ ...features, type: 'cosmetics' })) || INACTIVE;
  } catch {
    return INACTIVE; // worker restarting or extension reloaded: leave the page alone
  }
});
