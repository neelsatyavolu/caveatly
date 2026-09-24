// Anonymous daily usage ping to analytics.n3el.dev (opt out in Settings →
// "Share anonymous usage stats"). Sends a random install ID, the extension
// version, the Chrome major version and CPU arch — never URLs, page content,
// keys or anything about the user. At most one attempt per UTC day; failures
// are silent and never retried.
import { getSettings } from './settings.js';

export const HEARTBEAT_URL = 'https://analytics.n3el.dev/v1/heartbeat';
export const UNINSTALL_URL = 'https://analytics.n3el.dev/u/caveatly';
const PRODUCT_ID = 'caveatly';
const TIMEOUT_MS = 10000;
const ARCH_NAMES = { 'x86-64': 'x86_64', 'x86-32': 'x86' };

const utcDay = now => new Date(now).toISOString().slice(0, 10);

async function getInstallId() {
  const { installId } = await chrome.storage.local.get('installId');
  if (installId) return installId;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ installId: id });
  return id;
}

async function buildPayload() {
  const manifest = chrome.runtime.getManifest();
  const { arch } = await chrome.runtime.getPlatformInfo();
  return {
    product: PRODUCT_ID,
    install_id: await getInstallId(),
    version: manifest.version,
    platform: 'chrome',
    os_version: navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] || 'unknown',
    arch: ARCH_NAMES[arch] || arch,
    // Only Web Store installs carry update_url; unpacked/zip installs report "dev".
    channel: manifest.update_url ? 'release' : 'dev',
  };
}

/** Uninstall page counts the uninstall; cleared when the user opts out. */
export async function syncUninstallUrl(enabled) {
  try {
    await chrome.runtime.setUninstallURL(enabled ? UNINSTALL_URL : '');
  } catch {
    // best effort
  }
}

async function sendIfDue(now) {
  const { usageStats } = await getSettings();
  if (!usageStats) return false;
  const today = utcDay(now);
  const { heartbeatDay } = await chrome.storage.local.get('heartbeatDay');
  if (heartbeatDay === today) return false;
  // Mark before sending: one attempt per day, so an outage can't cause a retry storm.
  await chrome.storage.local.set({ heartbeatDay: today });
  await fetch(HEARTBEAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(await buildPayload()),
    credentials: 'omit',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return true;
}

let inflight = null;

/** Fire-and-forget; resolves true if a ping was sent. Never throws. */
export function maybeSendHeartbeat(now = Date.now()) {
  inflight ??= sendIfDue(now).catch(() => false).finally(() => { inflight = null; });
  return inflight;
}
