// Unit test for the daily anonymous heartbeat (src/lib/heartbeat.js): runs in
// Node against a stubbed chrome.* API and fetch, so no request ever reaches
// analytics.n3el.dev.
import { HEARTBEAT_URL, UNINSTALL_URL } from '../src/lib/heartbeat.js';

let failed = 0;
const check = (ok, label) => {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${label}`);
  if (!ok) failed += 1;
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DAY1 = Date.UTC(2026, 8, 23, 10);
const DAY1_LATE = Date.UTC(2026, 8, 23, 23, 59);
const DAY2 = Date.UTC(2026, 8, 24, 0, 5);

function makeArea(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(keys) {
      if (keys && typeof keys === 'object' && !Array.isArray(keys)) {
        return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, k in data ? data[k] : d]));
      }
      const list = typeof keys === 'string' ? [keys] : keys;
      return Object.fromEntries(list.filter(k => k in data).map(k => [k, data[k]]));
    },
    async set(items) { Object.assign(data, items); },
  };
}

function install({ sync = {}, manifest = { version: '0.1.2', update_url: 'https://clients2.google.com/service/update2/crx' }, fetchImpl } = {}) {
  const calls = [];
  const env = { calls, uninstallUrl: null, local: makeArea(), sync: makeArea(sync) };
  globalThis.chrome = {
    storage: { local: env.local, sync: env.sync },
    runtime: {
      getManifest: () => manifest,
      getPlatformInfo: async () => ({ os: 'mac', arch: 'x86-64' }),
      setUninstallURL: async url => { env.uninstallUrl = url; },
    },
  };
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (fetchImpl) return fetchImpl();
    return new Response(null, { status: 204 });
  };
  return env;
}

Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/141.0.7390.54 Safari/537.36' },
  configurable: true,
});

// Fresh module instance per scenario (the in-flight guard is module state).
let n = 0;
const load = () => import(`../src/lib/heartbeat.js?case=${n++}`);

console.log('— opted in (default)');
{
  const env = install();
  const hb = await load();
  check(await hb.maybeSendHeartbeat(DAY1) === true, 'first wake-up sends a heartbeat');
  const [call] = env.calls;
  check(env.calls.length === 1 && call.url === HEARTBEAT_URL, `POSTs to ${HEARTBEAT_URL}`);
  check(call?.init.method === 'POST' && call.init.signal instanceof AbortSignal, 'POST with a timeout signal');
  const b = call?.body || {};
  check(UUID_V4.test(b.install_id), `install_id is a UUID v4 (${b.install_id})`);
  check(env.local.data.installId === b.install_id, 'install_id persisted in chrome.storage.local');
  check(
    b.product === 'caveatly' && b.version === '0.1.2' && b.platform === 'chrome'
      && b.os_version === '141' && b.arch === 'x86_64' && b.channel === 'release',
    `payload fields (${JSON.stringify({ ...b, install_id: '…' })})`,
  );
  check(
    Object.keys(b).sort().join() === 'arch,channel,install_id,os_version,platform,product,version',
    'payload has no extra fields',
  );
  check(env.local.data.heartbeatDay === '2026-09-23', 'last-sent UTC day persisted');

  check(await hb.maybeSendHeartbeat(DAY1_LATE) === false && env.calls.length === 1, 'second wake-up the same UTC day sends nothing');
  const [a, c] = await Promise.all([hb.maybeSendHeartbeat(DAY2), hb.maybeSendHeartbeat(DAY2)]);
  check(env.calls.length === 2 && a === true && c === true, 'next UTC day sends once, even with concurrent wake-ups');
  check(env.calls[1].body.install_id === b.install_id, 'same install_id on later days');

  await hb.syncUninstallUrl(true);
  check(env.uninstallUrl === UNINSTALL_URL, `uninstall URL set to ${UNINSTALL_URL}`);
}

console.log('\n— opted out');
{
  const env = install({ sync: { usageStats: false } });
  const hb = await load();
  check(await hb.maybeSendHeartbeat(DAY1) === false && env.calls.length === 0, 'no request when usageStats is off');
  check(env.local.data.installId === undefined, 'no install_id generated when off');
  await hb.syncUninstallUrl(false);
  check(env.uninstallUrl === '', 'uninstall URL cleared');
}

console.log('\n— unpacked build + network failure');
{
  const env = install({ manifest: { version: '0.1.2' }, fetchImpl: () => { throw new TypeError('Failed to fetch'); } });
  const hb = await load();
  check(await hb.maybeSendHeartbeat(DAY1) === false, 'network error is swallowed');
  check(env.calls[0]?.body.channel === 'dev', 'unpacked install reports channel "dev"');
  check(await hb.maybeSendHeartbeat(DAY1_LATE) === false && env.calls.length === 1, 'no retry the same day after a failure');
}

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
