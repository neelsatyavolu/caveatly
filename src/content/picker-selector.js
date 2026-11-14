// Builds a CSS selector for the element picker. Injected right before
// picker.js into the same isolated world; exposes one function on globalThis.
// Prefers what survives a site redeploy: ids, readable class names and
// test/aria attributes. Hashed names (CSS modules, styled-components) and
// nth-of-type chains are used only when nothing else makes the match unique.
(() => {
  const MAX_DEPTH = 6;
  const MAX_CLASSES = 2;
  const STABLE_ATTRS = ['data-testid', 'data-test', 'data-test-id', 'data-qa', 'data-ad', 'data-ad-slot',
    'data-component', 'aria-label', 'role', 'name', 'itemtype'];

  // "css-1x2y3z", "sc-bdVaJa", "Header_title__a1B2c", "jsx-123456", "_3xk9Q".
  function looksHashed(token) {
    if (token.length > 40) return true;
    if (/^(css|sc|jsx|emotion|styled|svelte)-/i.test(token)) return true;
    if (/__[A-Za-z0-9_-]{5,}$/.test(token)) return true;
    if (/\d{4,}/.test(token)) return true;
    if (/^_/.test(token) && /\d/.test(token)) return true;
    const mixed = /[a-z]/.test(token) && /[A-Z]/.test(token) && /\d/.test(token);
    return mixed && !/[-_]/.test(token);
  }

  const isReadable = token => /^[A-Za-z][\w-]*$/.test(token) && !looksHashed(token);

  function count(selector) {
    try {
      return document.querySelectorAll(selector).length;
    } catch {
      return Infinity;
    }
  }

  function quoteValue(value) {
    return `"${value.replace(/["\\]/g, '\\$&')}"`;
  }

  function stableId(el) {
    return el.id && isReadable(el.id) && count(`#${CSS.escape(el.id)}`) === 1 ? `#${CSS.escape(el.id)}` : '';
  }

  function attrPart(el) {
    for (const name of STABLE_ATTRS) {
      const value = el.getAttribute(name);
      if (value && value.length <= 60 && !/[\n{}]/.test(value)) return `[${name}=${quoteValue(value)}]`;
    }
    return '';
  }

  // Tag plus the classes that narrow the match most (fewest elements matched).
  function segment(el) {
    const tag = el.localName;
    const classes = [...el.classList].filter(isReadable)
      .map(c => ({ c, n: count(`${tag}.${CSS.escape(c)}`) }))
      .sort((a, b) => a.n - b.n)
      .slice(0, MAX_CLASSES)
      .map(({ c }) => `.${CSS.escape(c)}`);
    return `${tag}${classes.join('')}${attrPart(el)}`;
  }

  function nthOfType(el) {
    const parent = el.parentElement;
    if (!parent) return '';
    const same = [...parent.children].filter(c => c.localName === el.localName);
    return same.length > 1 ? `:nth-of-type(${same.indexOf(el) + 1})` : '';
  }

  const join = parts => parts.join(' > ');

  function selectorFor(el) {
    const parts = [];
    const nodes = [];
    let node = el;
    for (let depth = 0; node && node !== document.documentElement && depth < MAX_DEPTH; depth++) {
      const id = stableId(node);
      parts.unshift(id || segment(node));
      nodes.unshift(id ? null : node);
      if (count(join(parts)) === 1 || id) break;
      node = node.parentElement;
    }
    // Still ambiguous: pin positions, starting with the picked element itself.
    for (let i = parts.length - 1; i >= 0 && count(join(parts)) !== 1; i--) {
      if (nodes[i]) parts[i] = `${parts[i]}${nthOfType(nodes[i])}`;
    }
    return join(parts);
  }

  globalThis.__caveatlySelectorFor = selectorFor;
})();
