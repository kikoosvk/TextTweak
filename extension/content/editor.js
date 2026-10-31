(() => {
  'use strict';
  const T = TextTweak, S = T.state;
  const forbidden = 'input,textarea,select,option,button,iframe,frame,object,embed,canvas,svg,math,script,style,link,meta,template,noscript';
  const editorSelector = 'input,textarea,select,button,[contenteditable]:not([contenteditable="false"])';
  const sameOwner = (a, b) => a && b && a.token === b.token && a.documentId === b.documentId && a.frameId === b.frameId;
  /** @type {{frameId: number, documentId: string, token: string}|null} */
  let owner = null, queue = Promise.resolve();
  // Claims are serialized in the top document, including across worker restarts.
  async function coordinate(message) {
    if (message.op === 'RELEASE_SESSION') {
      if (sameOwner(owner, message.owner)) owner = null;
      return { ok: true };
    }
    if (owner) {
      const status = await T.message({ op: 'SESSION_STATUS', owner }).catch(() => ({ state: 'unknown' }));
      if (!['ended', 'gone'].includes(status?.state)) return { ok: false, reason: 'busy' };
      owner = null;
    }
    owner = message.owner;
    return { ok: true };
  }
  // Unlike randomUUID(), getRandomValues() is available on ordinary HTTP origins.
  function sessionToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // The extension API can identify a closed boundary without patching attachShadow
  // or inspecting/editing the component's internal contents.
  const closedShadow = node => node instanceof HTMLElement &&
    chrome.dom.openOrClosedShadowRoot(node)?.mode === 'closed';
  function containsClosedShadow(root) {
    return Array.from(root.querySelectorAll('*')).some(node =>
      closedShadow(node) || (node.shadowRoot && containsClosedShadow(node.shadowRoot)));
  }
  // Compare captured text values, not live nodes: source indentation already in
  // Original must not become visible just because a label was changed.
  function needsSavedWhitespace(original, text) {
    const textOf = entries => entries.map(entry => entry.node.nodeType === Node.TEXT_NODE
      ? entry.value : textOf(entry.children)).join('');
    const previous = textOf(original.children);
    let start = 0, oldEnd = previous.length, end = text.length;
    while (start < oldEnd && start < end && previous[start] === text[start]) start++;
    while (oldEnd > start && end > start && previous[oldEnd - 1] === text[end - 1]) { oldEnd--; end--; }
    if (start === end) return false;
    // Include adjoining spaces when a single inserted space makes a repeated run,
    // but do not count unchanged source padding beside a replaced word.
    return Array.from(text.matchAll(/[ \t\r\n]+/g)).some(match =>
      match.index < end && match.index + match[0].length > start &&
      (/[\t\r\n]/.test(match[0]) || match[0].length > 1));
  }
  function reason(target) {
    if (!(target instanceof HTMLElement) || !target.isConnected || target.ownerDocument !== document) return 'This text is no longer available.';
    if (document.designMode.toLowerCase() === 'on') return 'This page is already an editor.';
    if (target === document.body || target === document.documentElement || target.matches(forbidden)) return 'This element cannot be edited with TextTweak.';
    for (let node = target; node; node = T.parent(node)) {
      if (closedShadow(node)) return 'Text inside a closed web component cannot be edited with TextTweak.';
      if (T.ui.has(node) || node.matches?.(forbidden) || node.isContentEditable || node.inert) return 'Existing editors and controls cannot be edited with TextTweak.';
    }
    if (containsClosedShadow(target) || (target.shadowRoot && containsClosedShadow(target.shadowRoot))) return 'This element contains a closed web component and cannot be edited with TextTweak.';
    const hasEditor = root => !!root.querySelector(editorSelector) || Array.from(root.querySelectorAll('*'))
      .some(node => node.shadowRoot && hasEditor(node.shadowRoot));
    if (hasEditor(target) || (target.shadowRoot && hasEditor(target.shadowRoot))) return 'This element contains an existing editor or control.';
    const style = getComputedStyle(target);
    if (!target.getClientRects().length || style.visibility !== 'visible' || !target.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return 'This text is hidden or not rendered.';
    return null;
  }
  function resolve(element) {
    for (let node = element; node; node = T.parent(node)) if (T.records.has(node)) return node;
    return element;
  }
  async function edit() {
    const candidate = T.candidate; T.candidate = null;
    if (T.session) { T.notice('Save the current edit first.'); return; }
    if (!candidate) { T.notice('Right-click visible webpage text to edit it.'); return; }
    // Validate the actual click first: never expand a rejected control into a tracked ancestor.
    let error = reason(candidate.element);
    if (error) { T.notice(error); return; }
    const target = resolve(candidate.element); error = reason(target);
    if (error) { T.notice(error); return; }
    const token = sessionToken();
    const session = { token, target, abort: new AbortController(), end: () => {}, pending: true };
    T.session = session;
    const claim = await T.message({ op: 'CLAIM_SESSION', token }).catch(() => null);
    if (!claim?.ok) {
      if (T.session === session) T.session = null;
      T.notice(claim?.reason === 'busy' ? 'Save the current edit first.' : 'TextTweak is unavailable in this frame. Refresh the page and try again.'); return;
    }
    const release = () => T.message({ op: 'RELEASE_SESSION', token }).catch(() => {});
    if (!target.isConnected || reason(target)) { T.session = null; release(); T.notice('This text is no longer available.'); return; }
    let originalAttribute, initialized = false, mutations;
    const overlays = new Map();
    const clearWhite = () => {
      for (const [node, value] of overlays) {
        if (node.getAttribute('style') === value.appliedStyle) {
          if (value.styleAttribute === null) node.removeAttribute('style');
          else node.setAttribute('style', value.styleAttribute);
        } else S.setWhite(node, value); // Preserve unrelated author changes made during editing.
      }
      overlays.clear();
    };
    const needsWhite = node => node instanceof HTMLElement && /[\n\r]| {2}/.test(node.textContent);
    const applyWhite = () => {
      for (const node of [target, ...target.querySelectorAll('*')]) if (node === target || needsWhite(node)) {
        if (!overlays.has(node)) {
          const previous = { ...S.white(node), styleAttribute: node.getAttribute('style') };
          node.style.setProperty('white-space', 'pre-wrap', 'important');
          overlays.set(node, { ...previous, appliedStyle: node.getAttribute('style') });
        } else node.style.setProperty('white-space', 'pre-wrap', 'important');
      }
    };
    session.end = cause => {
      if (T.session !== session) return;
      session.abort.abort(); mutations?.disconnect(); session.toolbar?.destroy(); clearWhite();
      if (initialized) {
        if (originalAttribute === null) target.removeAttribute('contenteditable');
        else target.setAttribute('contenteditable', originalAttribute);
      }
      T.session = null; release();
      if (cause === 'removed') T.notice('The page removed this text. Editing ended.');
    };
    try {
      let record = T.records.get(target);
      let initialSelection = S.selection(target);
      if (!record) {
        const original = S.capture(target);
        initialSelection = S.prepareDraft(target, initialSelection);
        record = { original, editableOriginal: S.capture(target), saved: null };
        T.records.set(target, record);
      }
      Object.assign(session, { record, branch: record.saved ? 'saved' : 'original',
        drafts: { original: { content: record.editableOriginal, selection: null }, saved: record.saved && { content: record.saved, selection: null } },
        history: new S.History(), pending: false });
      // Reopen from the last explicit save, as opposed to later website rewrites.
      if (record.saved) S.restore(target, record.saved);
      originalAttribute = target.getAttribute('contenteditable'); initialized = true;
      target.setAttribute('contenteditable', 'plaintext-only'); applyWhite(); S.select(target, initialSelection);
      let lastSelection = S.selection(target);
      const current = () => {
        lastSelection = S.selection(target) || lastSelection;
        return { content: S.capture(target, overlays), selection: lastSelection };
      };
      let baseline = current(), before = null, composition = null, composing = false;
      const valid = () => { if (target.isConnected && target.ownerDocument === document) return true; session.end('removed'); return false; };
      const load = draft => {
        clearWhite(); S.restore(target, draft.content); applyWhite(); S.select(target, draft.selection);
        baseline = current(); before = null; session.toolbar?.schedule();
      };
      const commitComposition = () => {
        if (!composition) return;
        const after = current(); session.history.push(composition, after, 'composition');
        composition = null; baseline = after; before = null;
      };
      const history = direction => {
        if (!valid() || composing) return;
        commitComposition(); const draft = session.history[direction](); if (draft) load(draft);
      };
      session.toggle = () => {
        if (!valid() || composing) return;
        commitComposition(); session.drafts[session.branch] = current();
        session.branch = session.branch === 'saved' ? 'original' : 'saved';
        load(session.drafts[session.branch]); session.history = new S.History(); session.toolbar.update();
      };
      session.save = () => {
        if (!valid() || composing) return;
        commitComposition();
        clearWhite();
        // Store the author's presentation, not our derived display override. On
        // reopen this lets later single-line edits discard a previous pre-wrap.
        record.saved = S.capture(target);
        if (S.equal(record.saved, record.editableOriginal)) S.restore(target, record.original);
        else if (needsSavedWhitespace(record.editableOriginal, target.textContent)) {
          target.style.setProperty('white-space', 'pre-wrap', 'important');
          for (const node of target.querySelectorAll('*')) if (needsWhite(node)) node.style.setProperty('white-space', 'pre-wrap', 'important');
        }
        session.end('save');
      };
      session.key = event => {
        if (event.isComposing || composing) return;
        const modifier = (event.metaKey || event.ctrlKey) && !event.altKey;
        const key = event.key.toLowerCase();
        if (modifier && (key === 'z' || key === 'y')) {
          event.preventDefault(); history(key === 'y' || event.shiftKey ? 'redo' : 'undo');
        } else if (modifier && ['b', 'i', 'u'].includes(key)) event.preventDefault();
      };
      const listen = (node, type, handler, capture = true) => node.addEventListener(type, handler, { capture, signal: session.abort.signal });
      listen(document, 'selectionchange', () => { lastSelection = S.selection(target) || lastSelection; });
      listen(target, 'beforeinput', event => {
        if (!valid()) return;
        if (event.inputType.startsWith('history')) {
          event.preventDefault();
          if (event.cancelable) history(event.inputType === 'historyUndo' ? 'undo' : 'redo');
          return;
        }
        if (/^(format|insertFromDrop|insertHTML)/.test(event.inputType)) { event.preventDefault(); return; }
        if (!composing && !composition) before = current();
      });
      listen(target, 'input', event => {
        if (!valid()) return;
        // A non-cancelable native history event must never escape the draft boundary.
        if (event.inputType.startsWith('history')) {
          load(baseline); history(event.inputType === 'historyUndo' ? 'undo' : 'redo'); return;
        }
        applyWhite();
        if (!composing && !composition) {
          const after = current(); session.history.push(before || baseline, after, event.inputType || 'input');
          baseline = after; before = null;
        }
        session.toolbar.schedule();
      });
      listen(target, 'compositionstart', () => { commitComposition(); composition = current(); composing = true; });
      listen(target, 'compositionend', () => {
        composing = false;
        // Finish after the synchronous commit input, before the next keyboard task.
        queueMicrotask(() => { if (T.session === session && !composing) commitComposition(); });
      });
      listen(target, 'paste', event => {
        if (!event.clipboardData?.types.includes('text/plain')) event.preventDefault();
      });
      for (const type of ['dragenter', 'dragover', 'drop']) listen(target, type, event => event.preventDefault());
      for (const type of ['click', 'auxclick']) listen(target, type, event => {
        if (event.composedPath().some(node => node instanceof Element && node.matches('a[href]'))) event.preventDefault();
      });
      listen(window, 'pagehide', () => session.end('departure'));
      // Observe child lists along the composed ancestor chain, never a whole-document subtree.
      function watchAncestors() {
        mutations.disconnect();
        for (let node = target; node; node = node.parentNode || node.host) mutations.observe(node, { childList: true });
      }
      mutations = new MutationObserver(() => {
        if (!valid()) return;
        watchAncestors(); session.toolbar.schedule();
      });
      watchAncestors(); session.toolbar = T.toolbar(session);
    } catch {
      session.end('failure'); T.notice('TextTweak could not start editing this element.');
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab || message?.channel !== 'texttweak-v1') return;
    if (message.op === 'EDIT_REQUEST') {
      edit().then(() => respond({ ok: true }), () => {
        T.notice('TextTweak could not start editing this element.');
        respond({ ok: false });
      });
      return true;
    }
    if (message.op === 'SESSION_STATUS') { respond({ active: T.session?.token === message.token }); return; }
    if (message.op === 'NOTICE' && typeof message.text === 'string') { T.notice(message.text.slice(0, 200)); return; }
    if (window === window.top && ['CLAIM_SESSION', 'RELEASE_SESSION'].includes(message.op) &&
        typeof message.owner?.documentId === 'string' && /^[a-f0-9-]{36}$/.test(message.owner?.token)) {
      const result = queue.then(() => coordinate(message)); queue = result.catch(() => {});
      result.then(respond, () => respond({ ok: false })); return true;
    }
  });
})();
