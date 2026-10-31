/* This global exists only in the extension's isolated world. */
var TextTweak = (() => {
  'use strict';
  const api = { session: null, candidate: null, sequence: 0, records: new WeakMap(), ui: new WeakSet() };
  api.parent = node => node?.parentElement || node?.getRootNode()?.host || null;
  api.inside = (root, node) => {
    for (let current = node; current; current = api.parent(current)) if (current === root) return true;
    return root.contains(node);
  };
  api.focused = root => {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active && api.inside(root, active);
  };
  api.message = message => chrome.runtime.sendMessage({ channel: 'texttweak-v1', ...message });
  window.addEventListener('contextmenu', event => {
    const path = event.composedPath();
    const element = path.find(node => node instanceof Element);
    api.candidate = element instanceof HTMLElement && !path.some(node => api.ui.has(node)) ? { element, sequence: ++api.sequence } : null;
  }, true);
  for (const type of ['keydown', 'keyup', 'keypress']) window.addEventListener(type, event => {
    const session = api.session;
    if (!session || !api.focused(session.target) || !event.composedPath().includes(session.target)) return;
    if (!session.target.isConnected) { session.end('removed'); return; }
    if (type === 'keydown') session.key?.(event);
    event.stopImmediatePropagation();
  }, true);
  return api;
})();
