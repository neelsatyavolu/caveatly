// Reuters' ad script (blocked by rules.json) also provides window.bootstrap,
// the consent/geolocation result that page features such as the video player
// wait for. Answer it here so those features still load without the ad script.
(() => {
  const results = {
    is_prohibited_country: false,
    geolocation: { country: "us", state: "" },
    require_ccpa_consent: false,
    require_gdpr_consent: false,
  };
  const run = (fn) => {
    try { fn(); } catch (err) { console.error("[reuters-adblock] bootstrap callback failed", err); }
  };
  const queue = [];
  queue.push = (...fns) => { fns.forEach((fn) => typeof fn === "function" && setTimeout(() => run(fn), 0)); return 0; };
  window.bootstrap = {
    queue,
    getResults: (cb) => { if (typeof cb === "function") setTimeout(() => run(() => cb(results)), 0); },
    otGroupsUpdatedOnce: () => {},
  };
})();
