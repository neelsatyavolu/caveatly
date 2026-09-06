import React from 'react';
import { Globe } from 'lucide-react';

/** The site's real favicon (via Chrome's favicon cache), globe fallback. */
export function SiteIcon({ pageUrl, size = 30 }) {
  const [failed, setFailed] = React.useState(false);
  const iconPx = Math.round(size * 0.6);
  const src = pageUrl && !failed
    ? chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=${iconPx <= 16 ? 16 : 32}`)
    : null;
  return (
    <span style={{
      width: size, height: size, flex: '0 0 auto', borderRadius: 8,
      background: 'var(--surface-sunken)', border: '1px solid var(--border-default)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--text-muted)', overflow: 'hidden',
    }}>
      {src
        ? <img src={src} width={iconPx} height={iconPx} alt="" style={{ display: 'block' }} onError={() => setFailed(true)} />
        : <Globe size={iconPx} />}
    </span>
  );
}
