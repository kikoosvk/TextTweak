(() => {
  'use strict';
  const T = TextTweak;
  /** @typedef {{value: string, priority: string, styleAttribute?: string|null, appliedStyle?: string|null}} WhiteSpace */
  /** @typedef {{node: Node, value: string|null, attrs: Array<[string,string]>|null, children: NodeSnapshot[]}} NodeSnapshot */
  /** @typedef {{children: NodeSnapshot[], white: WhiteSpace}} Snapshot */
  /** @typedef {{anchor: Node, anchorOffset: number, focus: Node, focusOffset: number}} Bookmark */
  /** @typedef {{content: Snapshot, selection: Bookmark|null}} Draft */
  const white = element => ({ value: element.style.getPropertyValue('white-space'), priority: element.style.getPropertyPriority('white-space') });
  const setWhite = (element, value) => {
    if (value.value) element.style.setProperty('white-space', value.value, value.priority);
    else element.style.removeProperty('white-space');
  };
  /** Capture values, not mutable live-node values; references preserve listeners on restore. */
  /** @param {HTMLElement} root @param {Map<HTMLElement, WhiteSpace>} overlays @returns {Snapshot} */
  function capture(root, overlays = new Map()) {
    function visit(node) {
      let attrs = node.nodeType === 1 ? Array.from(node.attributes, attr => [attr.name, attr.value]) : null;
      if (attrs && overlays.has(node)) {
        const overlay = overlays.get(node);
        let styleValue = overlay.styleAttribute;
        if (node.getAttribute('style') !== overlay.appliedStyle) {
          const style = document.createElement('span');
          style.setAttribute('style', node.getAttribute('style') || '');
          setWhite(style, overlay);
          styleValue = style.getAttribute('style');
        }
        attrs = attrs.filter(([name]) => name !== 'style');
        if (styleValue !== null) attrs.push(['style', styleValue]);
      }
      return { node, value: node.nodeValue, attrs, children: Array.from(node.childNodes, visit) };
    }
    return { children: Array.from(root.childNodes, visit), white: overlays.get(root) || white(root) };
  }
  /** @param {HTMLElement} root @param {Snapshot} snapshot */
  function restore(root, snapshot) {
    function reconcile(parent, children) {
      for (let i = 0; i < children.length; i++) {
        const entry = children[i], node = entry.node;
        if (parent.childNodes[i] !== node) parent.insertBefore(node, parent.childNodes[i] || null);
        if (node.nodeValue !== entry.value) node.nodeValue = entry.value;
        if (entry.attrs) {
          const attrs = new Map(entry.attrs);
          for (const attr of Array.from(node.attributes)) if (!attrs.has(attr.name)) node.removeAttribute(attr.name);
          for (const [name, value] of attrs) if (node.getAttribute(name) !== value) node.setAttribute(name, value);
        }
        reconcile(node, entry.children);
      }
      while (parent.childNodes.length > children.length) parent.lastChild.remove();
    }
    reconcile(root, snapshot.children);
    setWhite(root, snapshot.white);
  }
  function equal(a, b) {
    const entriesEqual = (left, right) => left.length === right.length && left.every((entry, i) => {
      const other = right[i];
      return entry.node === other.node && entry.value === other.value &&
        JSON.stringify(entry.attrs && [...entry.attrs].sort()) === JSON.stringify(other.attrs && [...other.attrs].sort()) &&
        entriesEqual(entry.children, other.children);
    });
    return a.white.value === b.white.value && a.white.priority === b.white.priority && entriesEqual(a.children, b.children);
  }
  function selection(root) {
    const selected = root.getRootNode().getSelection?.() || window.getSelection();
    if (!selected?.anchorNode || !T.inside(root, selected.anchorNode) || !T.inside(root, selected.focusNode)) return null;
    return { anchor: selected.anchorNode, anchorOffset: selected.anchorOffset,
      focus: selected.focusNode, focusOffset: selected.focusOffset };
  }
  function select(root, bookmark, focus = true) {
    if (focus) root.focus({ preventScroll: true });
    const selected = root.getRootNode().getSelection?.() || window.getSelection();
    const limit = node => node.nodeType === 3 ? node.length : node.childNodes.length;
    if (bookmark && T.inside(root, bookmark.anchor) && T.inside(root, bookmark.focus)) {
      selected.setBaseAndExtent(bookmark.anchor, Math.min(bookmark.anchorOffset, limit(bookmark.anchor)),
        bookmark.focus, Math.min(bookmark.focusOffset, limit(bookmark.focus)));
    } else {
      const range = document.createRange(); range.selectNodeContents(root); range.collapse(false);
      selected.removeAllRanges(); selected.addRange(range);
    }
  }
  /** Normalize only CSS-collapsed source whitespace, keeping elements and text nodes.
   * Run before enabling contenteditable or applying editing styles. */
  function prepareDraft(root, bookmark) {
    const changes = new Map();
    let flow = [];
    function flush() {
      let visible = false, pending = null;
      const renderedSpace = () => {
        const range = document.createRange();
        range.setStart(pending.node, pending.start);
        range.setEnd(pending.endNode, pending.end);
        const vertical = getComputedStyle(pending.node.parentElement).writingMode.startsWith('vertical');
        return Array.from(range.getClientRects()).some(rect => (vertical ? rect.height : rect.width) > 0);
      };
      for (const { node, collapse } of flow) {
        const output = Array(node.length).fill('');
        changes.set(node, output);
        for (let i = 0; i < node.length; i++) {
          const char = node.data[i];
          if (collapse && /[ \t\r\n\f]/.test(char)) {
            if (!pending) pending = { output, index: i, node, start: i };
            pending.endNode = node; pending.end = i + 1;
          } else {
            if (pending && (visible || renderedSpace())) pending.output[pending.index] = ' ';
            pending = null; output[i] = char; visible = true;
          }
        }
      }
      // An inline editing target can have a visible separator at its outer edge.
      if (pending && renderedSpace()) pending.output[pending.index] = ' ';
      flow = [];
    }
    function visit(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const style = getComputedStyle(node.parentElement);
        flow.push({ node, collapse: ['normal', 'nowrap'].includes(style.whiteSpace) });
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      const style = getComputedStyle(node);
      if (style.display === 'none' || ['SCRIPT', 'STYLE', 'TEMPLATE'].includes(node.tagName)) return;
      const boundary = node !== root && (node.tagName === 'BR' ||
        !['inline', 'inline-block', 'inline-flex', 'inline-grid', 'contents'].includes(style.display));
      if (boundary) flush();
      for (const child of node.childNodes) visit(child);
      if (boundary) flush();
    }
    visit(root); flush();
    const adjusted = bookmark && { ...bookmark };
    for (const [node, output] of changes) {
      if (adjusted?.anchor === node) adjusted.anchorOffset = output.slice(0, adjusted.anchorOffset).join('').length;
      if (adjusted?.focus === node) adjusted.focusOffset = output.slice(0, adjusted.focusOffset).join('').length;
      const text = output.join('');
      if (node.data !== text) node.data = text;
    }
    return adjusted;
  }
  const sameSelection = (a, b) => !!a && !!b && a.anchor === b.anchor && a.focus === b.focus &&
    a.anchorOffset === b.anchorOffset && a.focusOffset === b.focusOffset;
  const collapsed = a => !!a && a.anchor === a.focus && a.anchorOffset === a.focusOffset;
  class History {
    constructor() { this.undoStack = []; this.redoStack = []; }
    /** @param {Draft} before @param {Draft} after @param {string} kind @param {number} time */
    push(before, after, kind, time = performance.now()) {
      if (equal(before.content, after.content)) return;
      const previous = this.undoStack.at(-1);
      const merge = ['insertText', 'deleteContentBackward', 'deleteContentForward'].includes(kind) &&
        collapsed(before.selection) && collapsed(after.selection) && previous?.kind === kind &&
        collapsed(previous.before.selection) &&
        time - previous.time <= 750 && sameSelection(previous.after.selection, before.selection) &&
        equal(previous.after.content, before.content);
      if (merge) { previous.after = after; previous.time = time; }
      else { this.undoStack.push({ before, after, kind, time }); if (this.undoStack.length > 100) this.undoStack.shift(); }
      this.redoStack.length = 0;
    }
    undo() { const entry = this.undoStack.pop(); if (!entry) return null; this.redoStack.push(entry); return entry.before; }
    redo() { const entry = this.redoStack.pop(); if (!entry) return null; this.undoStack.push(entry); return entry.after; }
  }
  T.state = { prepareDraft, capture, restore, equal, selection, select, white, setWhite, History };
})();
