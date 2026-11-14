import React from 'react';
import { X } from 'lucide-react';

/** Sites where ad blocking is paused, as removable chips. */
export function PausedSites({ sites, onResume }) {
  if (!sites.length) return null;
  return (
    <div>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 6 }}>Paused on</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {sites.map(site => (
          <button key={site} className="fp-chip" aria-label={`Resume blocking on ${site}`} onClick={() => onResume(site)}>
            {site}<X size={13} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}

function groupBySite(rules) {
  return rules.reduce((groups, rule) => ({ ...groups, [rule.site]: [...(groups[rule.site] || []), rule] }), {});
}

/** Elements the user hid with right-click → Block element (lib/custom-rules.js). */
export function HiddenElements() {
  const [rules, setRules] = React.useState(null);
  const load = React.useCallback(() => {
    chrome.runtime.sendMessage({ type: 'customRules:list' })
      .then(resp => setRules(resp?.ok ? resp.rules : []))
      .catch(() => setRules([]));
  }, []);
  React.useEffect(load, [load]);

  const remove = id => chrome.runtime.sendMessage({ type: 'customRules:remove', id }).then(load).catch(load);

  if (rules === null) return null;
  return (
    <div>
      <div style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-body)', color: 'var(--text-strong)' }}>Hidden elements</div>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 1 }}>
        {rules.length
          ? 'Things you hid by right-clicking them. They stay hidden even where blocking is paused. Removing one takes effect when the page reloads.'
          : 'Right-click anything on a page and choose Block element… to hide it for good.'}
      </div>
      {Object.entries(groupBySite(rules)).map(([site, siteRules]) => (
        <div key={site} style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-body)', marginBottom: 4 }}>{site}</div>
          {siteRules.map(rule => (
            <div key={rule.id} className="fp-rule">
              <code title={rule.selector}>{rule.selector}</code>
              <button className="fp-icon-small" aria-label={`Show ${rule.selector} on ${site} again`} onClick={() => remove(rule.id)}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
