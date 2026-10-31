/* Routing is stateless: the top document owns the tab lock. */
'use strict';
/** @typedef {{frameId: number, documentId: string, token: string}} Owner */
const CHANNEL = 'texttweak-v1';
const MENU = 'texttweak-edit';
const tokenOK = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const identityOK = value => value && Number.isInteger(value.frameId) && value.frameId >= 0 &&
  typeof value.documentId === 'string' && tokenOK(value.token);
const send = (tabId, message, destination) => chrome.tabs.sendMessage(tabId,
  { channel: CHANNEL, ...message }, destination);

function registerMenu() {
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    chrome.contextMenus.create({ id: MENU, title: 'Edit',
      contexts: ['page', 'selection', 'link', 'frame'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'] }, () => void chrome.runtime.lastError);
  });
}
chrome.runtime.onInstalled.addListener(registerMenu);
chrome.runtime.onStartup.addListener(registerMenu);
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU || !Number.isInteger(tab?.id)) return;
  send(tab.id, { op: 'EDIT_REQUEST' }, { frameId: info.frameId ?? 0 }).catch(() => {
    send(tab.id, { op: 'NOTICE', text: 'TextTweak is unavailable here. Refresh the page and try again.' },
      { frameId: 0 }).catch(() => {});
  });
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.tab || !sender.documentId ||
      !/^https?:\/\//.test(sender.url || '') || message?.channel !== CHANNEL) return;
  const owner = { frameId: sender.frameId, documentId: sender.documentId, token: message.token };
  let result;
  if (['CLAIM_SESSION', 'RELEASE_SESSION'].includes(message.op) && tokenOK(message.token)) {
    result = send(sender.tab.id, { op: message.op, owner }, { frameId: 0 });
  } else if (message.op === 'SESSION_STATUS' && sender.frameId === 0 && identityOK(message.owner)) {
    result = send(sender.tab.id, { op: 'SESSION_STATUS', token: message.owner.token },
      { documentId: message.owner.documentId }).then(status => ({ state: status?.active === true ? 'active' : status?.active === false ? 'ended' : 'unknown' }))
      .catch(error => ({ state: /Receiving end does not exist|No document with|No frame with|No tab with/.test(error.message)
        ? 'gone' : 'unknown' }));
  } else return;
  result.then(respond, () => respond({ ok: false, reason: 'unavailable' }));
  return true;
});
