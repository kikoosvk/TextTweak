const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function harness() {
  const events = {}, menus = new Map(), calls = [];
  const event = name => ({ addListener: callback => { events[name] = callback; } });
  const chrome = {
    runtime: { id: 'extension', onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message') },
    contextMenus: { onClicked: event('click'), removeAll: callback => { menus.clear(); callback(); },
      create: (item, callback) => { assert.equal(menus.has(item.id), false); menus.set(item.id, item); callback(); } },
    tabs: { sendMessage: async (...args) => { calls.push(args); return { active: true }; } }
  };
  vm.runInNewContext(fs.readFileSync('extension/background.js', 'utf8'), { chrome });
  const sender = { id: 'extension', tab: { id: 17 }, frameId: 3, documentId: 'document-three', url: 'https://example.com/frame' };
  const token = '11111111-1111-4111-8111-111111111111';
  return { events, menus, calls, chrome, sender, token };
}
test('menu registration is idempotent and invocation uses originating tab/frame', async () => {
  const { events, menus, calls } = harness();
  events.installed(); events.startup(); assert.equal(menus.size, 1);
  events.click({ menuItemId: 'texttweak-edit', frameId: 3 }, { id: 17 });
  assert.equal(calls[0][0], 17); assert.equal(calls[0][2].frameId, 3);
  events.click({ menuItemId: 'unrelated', frameId: 4 }, { id: 18 }); assert.equal(calls.length, 1);
});
test('claims use browser sender identity; foreign senders and invalid tokens are ignored', async () => {
  const { events, sender, token, calls } = harness();
  const message = { channel: 'texttweak-v1', op: 'CLAIM_SESSION', token, owner: { frameId: 99 } };
  await new Promise(resolve => assert.equal(events.message(message, sender, resolve), true));
  assert.equal(calls[0][1].owner.frameId, 3); assert.equal(calls[0][1].owner.documentId, 'document-three');
  assert.equal(calls[0][2].frameId, 0);
  assert.equal(events.message(message, { ...sender, id: 'foreign' }, () => assert.fail()), undefined);
  assert.equal(events.message({ ...message, token: 'bad' }, sender, () => assert.fail()), undefined);
  assert.equal(calls.length, 1);
});
test('only an explicit ended reply or missing document can clear a stale owner', async () => {
  const { events, sender, token, chrome } = harness();
  const message = { channel: 'texttweak-v1', op: 'SESSION_STATUS', owner: { frameId: 3, documentId: 'old-document', token } };
  const query = () => new Promise(resolve => events.message(message, { ...sender, frameId: 0 }, resolve));
  chrome.tabs.sendMessage = async () => undefined; assert.equal((await query()).state, 'unknown');
  chrome.tabs.sendMessage = async () => { throw new Error('The message port closed before a response was received.'); };
  assert.equal((await query()).state, 'unknown');
  chrome.tabs.sendMessage = async () => { throw new Error('Could not establish connection. Receiving end does not exist.'); };
  assert.equal((await query()).state, 'gone');
  chrome.tabs.sendMessage = async () => ({ active: false }); assert.equal((await query()).state, 'ended');
});
