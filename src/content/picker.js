// Element picker for "Block element…". Injected by the service worker into the
// frame the user right-clicked, after picker-selector.js. Starts on the element
// under the right-click (remembered by content/custom-rules.js), lets the user
// widen/narrow or click another element, preview the page without it, and save.
// The UI lives in a closed shadow root so page CSS cannot reach it.
(() => {
  globalThis.__caveatlyPicker?.close();

  const selectorFor = globalThis.__caveatlySelectorFor;
  const HOST_TAG = 'caveatly-picker';

  const STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #17161a; -webkit-font-smoothing: antialiased; }
    .box { position: fixed; display: none; border-radius: 3px; }
    .box.selected { outline: 2px solid #12735f; background: rgba(18, 115, 95, 0.12); }
    .box.hover { outline: 1px dashed #12735f; }
    .panel { position: fixed; right: 16px; bottom: 16px; width: 320px; max-width: calc(100vw - 32px);
      pointer-events: auto; background: #fbf9f4; border: 1px solid #e8e2d7; border-radius: 9px;
      box-shadow: 0 18px 48px rgba(23, 22, 26, 0.16); padding: 14px; display: grid; gap: 10px; }
    .head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    h2 { margin: 0; font: inherit; font-size: 14px; font-weight: 600; }
    .count, .hint, .error { margin: 0; font-size: 12px; color: #78736b; }
    .error { color: #a23a2a; }
    .error:empty { display: none; }
    code { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #17161a;
      background: #fff; border: 1px solid #e8e2d7; border-radius: 6px; padding: 6px 8px; }
    .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .row.end { justify-content: space-between; border-top: 1px solid #e8e2d7; padding-top: 10px; }
    .actions { display: flex; gap: 6px; margin-left: auto; }
    button { font: inherit; font-size: 13px; min-height: 32px; padding: 0 12px; border-radius: 7px; cursor: pointer;
      border: 1px solid #e8e2d7; background: #fff; color: #17161a; }
    button:hover { border-color: #cfc7b8; }
    button:focus-visible { outline: 2px solid #12735f; outline-offset: 2px; }
    button:disabled { opacity: 0.5; cursor: default; }
    button[aria-pressed="true"] { border-color: #12735f; color: #12735f; background: rgba(18, 115, 95, 0.08); }
    button.primary { background: #12735f; border-color: #12735f; color: #fff; font-weight: 600; }
    button.primary:hover:not(:disabled) { background: #0e5c4c; border-color: #0e5c4c; }
  `;

  const PANEL = `
    <div class="head"><h2 id="t">Block element</h2><p class="count" data-id="count" aria-live="polite"></p></div>
    <code data-id="selector"></code>
    <div class="row">
      <button type="button" data-id="wider" aria-keyshortcuts="ArrowUp">Wider</button>
      <button type="button" data-id="narrower" aria-keyshortcuts="ArrowDown">Narrower</button>
      <button type="button" data-id="preview" aria-pressed="false" aria-keyshortcuts="P">Preview</button>
    </div>
    <p class="error" data-id="error" role="alert"></p>
    <div class="row end">
      <p class="hint">Arrows or +/− adjust. Esc cancels.</p>
      <div class="actions">
        <button type="button" data-id="cancel">Cancel</button>
        <button type="button" class="primary" data-id="block">Block</button>
      </div>
    </div>`;

  // ————— UI —————

  const host = document.createElement(HOST_TAG);
  // Inline !important so a page rule like `* { display: none }` can't hide the picker.
  host.style.setProperty('display', 'block', 'important');
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>${STYLES}</style><div class="layer">
    <div class="box hover"></div><div class="box selected"></div>
    <section class="panel" role="dialog" aria-labelledby="t">${PANEL}</section></div>`;
  const [hoverBox, selectedBox] = shadow.querySelectorAll('.box');
  const ui = Object.fromEntries([...shadow.querySelectorAll('[data-id]')].map(el => [el.dataset.id, el]));

  // ————— State —————

  let selected = null;     // element the rule is built from
  let selector = '';
  let hovered = null;      // element a click would pick
  let following = true;    // selection follows the mouse until the user picks
  let narrowPath = [];     // children we widened away from, for "Narrower"
  let previewing = false;
  let saving = false;
  let previewed = [];      // {el, value, priority} to restore when the preview ends

  const isPickable = el => el instanceof Element && el !== host
    && el !== document.documentElement && el !== document.body && el.isConnected;

  function place(box, el) {
    const rect = el?.isConnected ? el.getBoundingClientRect() : null;
    if (!rect || (!rect.width && !rect.height)) {
      box.style.display = 'none';
      return;
    }
    Object.assign(box.style, {
      display: 'block', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    });
  }

  function matchCount() {
    try {
      return selector ? document.querySelectorAll(selector).length : 0;
    } catch {
      return 0;
    }
  }

  function render() {
    place(selectedBox, previewing ? null : selected);
    place(hoverBox, hovered && hovered !== selected ? hovered : null);
    const n = matchCount();
    ui.selector.textContent = selector || 'Point at something and click to select it.';
    ui.selector.title = selector;
    ui.count.textContent = selector ? `Hides ${n} element${n === 1 ? '' : 's'}` : '';
    ui.wider.disabled = !selected || !isPickable(selected.parentElement);
    ui.narrower.disabled = !selected || (!narrowPath.length && !selected.firstElementChild);
    ui.block.disabled = !n || saving;
    ui.preview.setAttribute('aria-pressed', String(previewing));
    updatePreview();
  }

  // Inline !important beats every page rule, including inline !important
  // styles, which a <style> element could not override.
  function updatePreview() {
    for (const { el, value, priority } of previewed) el.style.setProperty('display', value, priority);
    previewed = [];
    if (!previewing || !selector) return;
    let matches = [];
    try {
      matches = [...document.querySelectorAll(selector)];
    } catch {
      return;
    }
    previewed = matches.map(el => ({
      el, value: el.style.getPropertyValue('display'), priority: el.style.getPropertyPriority('display'),
    }));
    for (const el of matches) el.style.setProperty('display', 'none', 'important');
  }

  function select(el, { keepPath = false } = {}) {
    if (!isPickable(el)) return;
    selected = el;
    selector = selectorFor(el);
    if (!keepPath) narrowPath = [];
    ui.error.textContent = '';
    render();
  }

  function widen() {
    if (!selected || !isPickable(selected.parentElement)) return;
    narrowPath = [...narrowPath, selected];
    following = false;
    select(selected.parentElement, { keepPath: true });
  }

  function narrow() {
    if (!selected) return;
    const child = narrowPath.length ? narrowPath[narrowPath.length - 1] : selected.firstElementChild;
    if (!child) return;
    narrowPath = narrowPath.slice(0, -1);
    following = false;
    select(child, { keepPath: true });
  }

  function togglePreview() {
    previewing = !previewing;
    render();
  }

  async function save() {
    if (!selector || saving) return;
    saving = true;
    render();
    try {
      const res = await chrome.runtime.sendMessage({ type: 'customRules:add', selector });
      if (!res?.ok) throw new Error(res?.message || 'Could not save the rule.');
      close();
    } catch (err) {
      saving = false;
      ui.error.textContent = err.message || 'Could not save the rule.';
      render();
    }
  }

  // ————— Events —————

  const fromPicker = event => event.composedPath().includes(host);

  function onMove(event) {
    if (fromPicker(event)) return;
    const el = document.elementFromPoint(event.clientX, event.clientY);
    if (!isPickable(el)) return;
    hovered = el;
    if (following) select(el);
    else render();
  }

  // Swallow page clicks so links and buttons don't fire while picking.
  function onPointer(event) {
    if (fromPicker(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type !== 'click') return;
    const el = document.elementFromPoint(event.clientX, event.clientY);
    following = false;
    select(isPickable(el) ? el : event.target);
  }

  const KEYS = {
    Escape: () => close(),
    ArrowUp: widen, '+': widen, '=': widen,
    ArrowDown: narrow, '-': narrow, _: narrow,
    p: togglePreview, P: togglePreview,
  };

  function onKey(event) {
    const onButton = shadow.activeElement?.localName === 'button';
    const action = event.key === 'Enter' && !onButton ? save : KEYS[event.key];
    if (!action || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    action();
  }

  const reposition = () => requestAnimationFrame(render);

  const LISTENERS = [
    [document, 'mousemove', onMove, { capture: true, passive: true }],
    [document, 'mousedown', onPointer, true],
    [document, 'mouseup', onPointer, true],
    [document, 'click', onPointer, true],
    [window, 'keydown', onKey, true],
    [window, 'scroll', reposition, { capture: true, passive: true }],
    [window, 'resize', reposition, { passive: true }],
  ];

  ui.wider.addEventListener('click', widen);
  ui.narrower.addEventListener('click', narrow);
  ui.preview.addEventListener('click', togglePreview);
  ui.cancel.addEventListener('click', () => close());
  ui.block.addEventListener('click', save);

  function close() {
    for (const [target, type, fn, opts] of LISTENERS) target.removeEventListener(type, fn, opts);
    host.remove();
    previewing = false;
    updatePreview();
    if (globalThis.__caveatlyPicker === api) delete globalThis.__caveatlyPicker;
  }

  const api = {
    close,
    select(el) {
      following = false;
      select(el);
      if (selected) ui.block.focus();
    },
  };
  globalThis.__caveatlyPicker = api;

  for (const [target, type, fn, opts] of LISTENERS) target.addEventListener(type, fn, opts);
  document.documentElement.append(host);

  const start = globalThis.__caveatlyContextTarget;
  globalThis.__caveatlyContextTarget = null;
  render();
  ui.cancel.focus();
  if (isPickable(start)) api.select(start);
})();
