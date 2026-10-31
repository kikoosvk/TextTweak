(() => {
  'use strict';
  const T = TextTweak;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host { all: initial !important; }
    [popover] { all: initial; box-sizing: border-box; position: fixed; inset: auto;
      margin: 0; padding: 5px; border: 1px solid #d5dce8; border-radius: 10px;
      background: #fff; color: #18243a; box-shadow: 0 4px 20px #14243a30;
      font: 13px/1.4 system-ui, sans-serif; color-scheme: light; }
    .controls { display: flex; gap: 4px; }
    button { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 5px;
      min-height: 30px; padding: 5px 9px; border-radius: 6px; cursor: pointer; font: inherit; }
    button:hover { background: #edf1f8; } button:focus-visible { outline: 2px solid #2861d5; outline-offset: 1px; }
    button.save { color: #fff; background: #2459be; } button.save:hover { background: #174394; }
    button[hidden] { display: none; } svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; }
    .live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    .notice { max-width: min(360px, calc(100vw - 16px)); padding: 10px 14px; }
  `);
  function surface() {
    const host = document.createElement('texttweak-ui');
    T.ui.add(host);
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.adoptedStyleSheets = [sheet];
    const panel = document.createElement('div'); panel.setAttribute('popover', 'manual');
    shadow.append(panel); (document.body || document.documentElement).append(host);
    return { host, panel };
  }
  function button(label, path, action) {
    const control = document.createElement('button'); control.type = 'button';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 20 20'); icon.setAttribute('aria-hidden', 'true');
    const shape = document.createElementNS(icon.namespaceURI, 'path'); shape.setAttribute('d', path);
    icon.append(shape); control.append(icon, document.createTextNode(label));
    control.addEventListener('pointerdown', event => { if (event.button === 0) event.preventDefault(); });
    control.addEventListener('click', action);
    return control;
  }
  T.toolbar = session => {
    const { host, panel } = surface();
    const controls = document.createElement('div'); controls.className = 'controls';
    controls.setAttribute('role', 'toolbar'); controls.setAttribute('aria-label', 'TextTweak');
    const toggle = button('Toggle', 'M7 4 2 8l5 4M3 8h9a5 5 0 1 1 0 10', () => session.toggle());
    const save = button('Save', 'm3 10 5 5L17 5', () => session.save()); save.className = 'save'; save.title = 'Save edit';
    save.setAttribute('aria-label', 'Save edit');
    const live = document.createElement('span'); live.className = 'live'; live.setAttribute('aria-live', 'polite');
    controls.append(toggle, save); panel.append(controls, live); panel.showPopover();
    let scheduled = 0;
    function position() {
      scheduled = 0;
      if (!session.target.isConnected) { session.end('removed'); return; }
      const rect = session.target.getBoundingClientRect(), box = panel.getBoundingClientRect();
      const vv = window.visualViewport;
      const left = (vv?.offsetLeft || 0) + 8, top = (vv?.offsetTop || 0) + 8;
      const right = left + (vv?.width || innerWidth) - 16, bottom = top + (vv?.height || innerHeight) - 16;
      let x = rect.right - box.width, y = rect.top - box.height - 6;
      if (y < top) {
        if (rect.right + 6 + box.width <= right) { x = rect.right + 6; y = rect.top; }
        else if (rect.left - box.width - 6 >= left) { x = rect.left - box.width - 6; y = rect.top; }
        else y = rect.bottom + 6;
      }
      panel.style.left = `${Math.max(left, Math.min(x, right - box.width))}px`;
      panel.style.top = `${Math.max(top, Math.min(y, bottom - box.height))}px`;
    }
    const schedule = () => { if (!scheduled) scheduled = requestAnimationFrame(position); };
    const options = { signal: session.abort.signal, capture: true };
    window.addEventListener('scroll', schedule, options); window.addEventListener('resize', schedule, options);
    window.visualViewport?.addEventListener('resize', schedule, options);
    window.visualViewport?.addEventListener('scroll', schedule, options);
    const sizes = new ResizeObserver(schedule);
    for (let node = session.target; node; node = T.parent(node)) sizes.observe(node);
    sizes.observe(panel);
    function update() {
      toggle.hidden = !session.record.saved;
      toggle.title = session.branch === 'saved' ? 'Show original' : 'Show edited';
      toggle.setAttribute('aria-label', toggle.title);
      live.textContent = session.branch === 'saved' ? 'Showing edited version' : 'Showing original version'; schedule();
    }
    update(); position();
    return { update, schedule, toggle, save, panel,
      destroy() { cancelAnimationFrame(scheduled); sizes.disconnect(); host.remove(); } };
  };
  let notice;
  T.notice = text => {
    notice?.();
    if (!document.documentElement) return;
    const { host, panel } = surface(); panel.className = 'notice'; panel.setAttribute('role', 'status');
    panel.textContent = text; panel.style.left = '8px'; panel.style.bottom = '8px'; panel.showPopover();
    let timer;
    const remove = () => { clearTimeout(timer); host.remove(); if (notice === remove) notice = null; };
    notice = remove; timer = setTimeout(remove, 4500);
  };
})();
