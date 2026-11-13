// Picks the scriptlet calls that apply to a hostname. Pure functions, shared by
// the MAIN-world scriptlet scripts (exact hostnames, before page scripts run)
// and the service worker (entity filters such as `google.*`).
//
// Data format (built by tools/scriptlet-data.mjs, one table per filter list):
//   calls:      [[fnName, ...args]]            unique scriptlet calls
//   filters:    [[callIndex, excludedDomains]]  one per filter line
//   domains:    { 'youtube.com': [filterIndex], 'google.*': [filterIndex] }
//   exceptions: { 'example.com': ['*' | JSON.stringify(call)] }   from #@#+js

/** youtube.com and every parent: m.youtube.com -> [m.youtube.com, youtube.com, com]. */
export function hostKeys(hostname) {
  const labels = String(hostname || '').toLowerCase().split('.').filter(Boolean);
  return labels.map((_, i) => labels.slice(i).join('.'));
}

/**
 * Entity keys (`name.*`) for a hostname. With the public suffix known
 * (`www.google` for www.google.co.uk) this is exact; without it, every label
 * run is a candidate, which is only safe for exclusions and exceptions,
 * where matching too much means doing less.
 */
export function entityKeys(hostname, hostWithoutSuffix) {
  if (hostWithoutSuffix != null) return hostKeys(hostWithoutSuffix).map(k => `${k}.*`);
  const labels = String(hostname || '').toLowerCase().split('.').filter(Boolean);
  const keys = [];
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) keys.push(`${labels.slice(i, j).join('.')}.*`);
  }
  return keys;
}

function excepted(data, keys, call) {
  const id = JSON.stringify(call);
  return keys.some(k => data.exceptions[k]?.some(e => e === '*' || e === id));
}

function collect(data, matchKeys, guardKeys, skipFilter) {
  const seen = new Set();
  const out = [];
  for (const key of matchKeys) {
    for (const filterIndex of data.domains[key] || []) {
      const [callIndex, excluded] = data.filters[filterIndex];
      if (seen.has(callIndex) || skipFilter(filterIndex)) continue;
      if (excluded.some(d => guardKeys.includes(d))) continue;
      const call = data.calls[callIndex];
      if (excepted(data, guardKeys, call)) continue;
      seen.add(callIndex);
      out.push(call);
    }
  }
  return out;
}

/** Calls from filters that name this host or a parent domain exactly. */
export function callsForHost(data, hostname) {
  const hosts = hostKeys(hostname);
  const guard = [...hosts, ...entityKeys(hostname)];
  return collect(data, hosts, guard, () => false);
}

/**
 * Calls from entity filters (`google.*`) that callsForHost did not already
 * cover for this host, given the hostname minus its public suffix.
 */
export function callsForEntity(data, hostname, hostWithoutSuffix) {
  const hosts = hostKeys(hostname);
  const entities = entityKeys(hostname, hostWithoutSuffix);
  const byHost = new Set(hosts.flatMap(k => data.domains[k] || []));
  const guard = [...hosts, ...entities, ...entityKeys(hostname)];
  return collect(data, entities, guard, filterIndex => byHost.has(filterIndex));
}
