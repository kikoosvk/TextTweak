const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { TextTweak: {}, performance };
vm.runInNewContext(fs.readFileSync('extension/content/state.js', 'utf8'), context);
const { History } = context.TextTweak.state;
const node = {}, selectionNode = {};
const state = (value, offset) => ({ content: { children: [{ node, value, attrs: null, children: [] }], white: { value: '', priority: '' } },
  selection: { anchor: selectionNode, focus: selectionNode, anchorOffset: offset, focusOffset: offset } });
test('typing coalesces only with contiguous selection and within 750 ms', () => {
  const h = new History(), a = state('', 0), b = state('a', 1), c = state('ab', 2), d = state('abc', 3);
  h.push(a, b, 'insertText', 0); h.push(b, c, 'insertText', 500); h.push(c, d, 'insertText', 1300);
  assert.equal(h.undo(), c); assert.equal(h.undo(), a); assert.equal(h.undo(), null);
  assert.equal(h.redo(), c); assert.equal(h.redo(), d);
});
test('new edit clears redo and separate transactions never merge', () => {
  const h = new History(), a = state('', 0), b = state('a', 1), c = state('ab', 2);
  h.push(a, b, 'insertFromPaste', 0); h.push(b, c, 'insertFromPaste', 10);
  assert.equal(h.undo(), b); h.push(b, c, 'composition', 20); assert.equal(h.redo(), null);
  assert.equal(h.undoStack.length, 2);
});
test('100 transaction cap and a fresh history cannot cross draft boundaries', () => {
  const h = new History();
  for (let i = 0; i < 110; i++) h.push(state(String(i), i), state(String(i + 1), i + 1), 'insertFromPaste', i);
  assert.equal(h.undoStack.length, 100); assert.equal(new History().undo(), null);
});

test('selection replacement cannot coalesce into following typing', () => {
  const h = new History(), selected = state('abc', 0), replaced = state('x', 1), typed = state('xy', 2);
  selected.selection.focusOffset = 3;
  h.push(selected, replaced, 'insertText', 0); h.push(replaced, typed, 'insertText', 20);
  assert.equal(h.undo(), replaced); assert.equal(h.undo(), selected);
});

test('unpacked package uses only planned permissions, ordered scripts and correctly sized PNGs', () => {
  const manifest = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['contextMenus']);
  assert.equal(manifest.content_scripts[0].run_at, 'document_start');
  assert.equal(manifest.content_scripts[0].world, 'ISOLATED');
  assert.equal(manifest.content_scripts[0].all_frames, true);
  for (const [size, file] of Object.entries(manifest.icons)) {
    const png = fs.readFileSync(`extension/${file}`);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), Number(size)); assert.equal(png.readUInt32BE(20), Number(size));
    assert.equal(png[25], 6); // RGBA, including transparency.
  }
  assert.equal(manifest.content_scripts[0].js[0], 'content/bootstrap.js');
  for (const file of [manifest.background.service_worker, ...manifest.content_scripts[0].js]) {
    const source = fs.readFileSync(`extension/${file}`, 'utf8');
    new vm.Script(source, { filename: file });
    assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|WebSocket|eval|execCommand)\s*\(|chrome\.storage|localStorage|console\./);
  }
});
