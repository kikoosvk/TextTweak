const { test, expect, chromium } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
let context, worker, profile, page, cdp, worlds;

test.beforeAll(async () => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'texttweak-test-'));
  const extension = path.resolve('extension');
  context = await chromium.launchPersistentContext(profile, {
    ignoreDefaultArgs: ['--disable-extensions'],
    channel: 'chromium', headless: process.env.TEXTTWEAK_HEADED !== '1', timeout: 20000,
    ...(process.env.TEXTTWEAK_BROWSER ? { executablePath: process.env.TEXTTWEAK_BROWSER } : {}),
    args: ['--enable-unsafe-extension-debugging', '--no-proxy-server', '--host-resolver-rules=MAP texttweak.test 127.0.0.1', ...(process.env.TEXTTWEAK_BROWSER ? [] : [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`])]
  });
  if (process.env.TEXTTWEAK_BROWSER && !context.serviceWorkers().length) {
    const browserCDP = await context.browser().newBrowserCDPSession();
    await browserCDP.send('Extensions.loadUnpacked', { path: extension });
    await browserCDP.detach();
    await context.pages()[0].goto('chrome://extensions');
  }
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
});
test.afterAll(async () => { await context?.close(); if (profile) await fs.rm(profile, { recursive: true, force: true }); });
test.beforeEach(async () => {
  page = await context.newPage(); cdp = await context.newCDPSession(page); worlds = [];
  cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context));
  cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) => { worlds = worlds.filter(world => world.id !== executionContextId); });
  await cdp.send('Runtime.enable'); await page.goto('http://localhost:8765');
});
test.afterEach(async () => { await page.close(); });

// DevTools enters the real extension isolated world. No test bridge is shipped.
async function isolated(expression, frameUrl = page.url()) {
  for (const world of worlds.filter(world => !world.auxData?.isDefault)) {
    try {
      const probe = await cdp.send('Runtime.evaluate', { contextId: world.id, expression: `typeof TextTweak !== 'undefined' && location.href === ${JSON.stringify(frameUrl)}`, returnByValue: true });
      if (!probe.result.value) continue;
      const result = await cdp.send('Runtime.evaluate', { contextId: world.id, expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.result.description);
      return result.result.value;
    } catch (error) { if (!/Cannot find context/.test(error.message)) throw error; }
  }
  throw new Error(`Extension world not found: ${frameUrl}`);
}
async function edit(selector, frame = page, clickOptions = {}) {
  await frame.locator(selector).scrollIntoViewIfNeeded();
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await frame.locator(selector).click({ button: 'right', ...clickOptions });
  // Same worker-to-content message as the native menu; broadcast lets a cross-origin frame receive it.
  await worker.evaluate(async (top) => {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await chrome.tabs.sendMessage(tabs[0].id, { channel: 'texttweak-v1', op: 'EDIT_REQUEST' }, top ? {frameId:0} : {});
  }, frame === page);
}
async function save() { await isolated('TextTweak.session.toolbar.save.click()'); }
async function toggle() { await isolated('TextTweak.session.toolbar.toggle.click()'); }
async function replace(text) {
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.insertText(text);
}

test('Hello world / Hello everyone / Hello there: independent drafts, immutable Original, promotion', async () => {
  await edit('#text'); await expect(page.locator('#text')).toHaveAttribute('contenteditable', 'plaintext-only');
  expect(await isolated('TextTweak.session.toolbar.toggle.hidden')).toBe(true);
  await replace('Hello everyone'); await save();
  await expect(page.locator('#text')).toHaveText('Hello everyone');
  await expect(page.locator('#text')).not.toHaveAttribute('contenteditable');
  await edit('#text'); await replace('Hello there'); await toggle();
  await expect(page.locator('#text')).toHaveText('Hello world');
  await replace('Original draft'); await toggle(); await expect(page.locator('#text')).toHaveText('Hello there');
  await toggle(); await expect(page.locator('#text')).toHaveText('Original draft'); await save();
  await edit('#text'); await expect(page.locator('#text')).toHaveText('Original draft');
  await toggle(); await expect(page.locator('#text')).toHaveText('Hello world'); await save();
  await expect(page.locator('#text')).toHaveCSS('white-space', 'normal');
});

test('native typing, keyboard isolation, line breaks, history and focus boundaries', async () => {
  await edit('#text'); await page.keyboard.type(' more');
  expect(await page.evaluate(() => keys)).toEqual({ window: 0, capture: 0, bubble: 0 });
  await expect(page.locator('#text')).toHaveText('Hello world more');
  await page.keyboard.press('ControlOrMeta+z'); await expect(page.locator('#text')).toHaveText('Hello world');
  await page.keyboard.press('ControlOrMeta+Shift+z'); await expect(page.locator('#text')).toHaveText('Hello world more');
  await page.keyboard.press('Enter'); await page.keyboard.type('next');
  await page.locator('#outside').click(); await page.keyboard.press('Space');
  expect((await page.evaluate(() => keys)).window).toBeGreaterThan(0);
  await expect(page.locator('#text')).toHaveAttribute('contenteditable', 'plaintext-only');
  await save(); expect(await page.locator('#text').innerText()).toContain('more\nnext');
  await edit('#text'); const saved = await page.locator('#text').innerText();
  await page.keyboard.press('ControlOrMeta+z'); expect(await page.locator('#text').innerText()).toBe(saved);
  await toggle(); await page.keyboard.press('ControlOrMeta+z'); await expect(page.locator('#text')).toHaveText('Hello world');
});

test('snapshots retain markup node identities and attached listeners', async () => {
  await page.evaluate(() => { window.originalBold = bold; window.originalLink = link; });
  await edit('#markup'); await page.keyboard.type(' added'); await save(); await edit('#markup'); await toggle();
  expect(await page.evaluate(() => bold === originalBold && link === originalLink)).toBe(true);
  await save(); await page.locator('#link').click(); expect(await page.evaluate(() => linkClicks)).toBe(1);
});

test('reject existing editors, roots and containers; preserve exact false attribute', async () => {
  for (const selector of ['#input', 'textarea', '#inherited', '#container']) {
    await edit(selector); expect(await isolated('TextTweak.session === null')).toBe(true);
  }
  await edit('#false'); await save(); await expect(page.locator('#false')).toHaveAttribute('contenteditable', 'false');
  await edit('#deep'); await expect(page.locator('#deep')).toHaveAttribute('contenteditable', 'plaintext-only');
  await expect(page.locator('#nested')).not.toHaveAttribute('contenteditable');
});

test('one session per tab including cross-origin frames; removal releases lock', async () => {
  await edit('#text');
  const frame = page.frames().find(frame => frame.url().includes('frame.html'));
  await edit('#frameText', frame); await expect(frame.locator('#frameText')).not.toHaveAttribute('contenteditable');
  await page.evaluate(() => document.querySelector('#text').remove());
  await expect.poll(() => isolated('TextTweak.session === null')).toBe(true);
  await edit('#frameText', frame); await expect(frame.locator('#frameText')).toHaveAttribute('contenteditable', 'plaintext-only');
  await frame.evaluate(() => location.reload()); await frame.waitForLoadState();
  await edit('#deep'); await expect(page.locator('#deep')).toHaveAttribute('contenteditable', 'plaintext-only');
});

test('open shadow root text is editable and shortcuts remain isolated', async () => {
  await edit('#shadowText'); await page.keyboard.type(' space');
  await expect(page.locator('#shadowText')).toHaveText('Shadow text space');
  expect(await page.evaluate(() => keys)).toEqual({ window: 0, capture: 0, bubble: 0 }); await save();
});

test('forbidden paste, drop and formatting are canceled; toolbar stays in viewport', async () => {
  await edit('#bottom');
  await expect(page.locator('#bottom')).toHaveAttribute('contenteditable', 'plaintext-only');
  const blocked = await page.locator('#bottom').evaluate(node => {
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    const format = new InputEvent('beforeinput', { inputType: 'formatBold', bubbles: true, cancelable: true });
    const image = new ClipboardEvent('paste', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true });
    return [node.dispatchEvent(drop), node.dispatchEvent(format), node.dispatchEvent(image)];
  });
  expect(blocked).toEqual([false, false, false]);
  await page.evaluate(() => scrollTo(0, 0));
  await expect.poll(() => isolated('(() => { const r = TextTweak.session.toolbar.panel.getBoundingClientRect(); return r.x >= 8 && r.y >= 8 && r.right <= innerWidth - 8 && r.bottom <= innerHeight - 8; })()')).toBe(true);
  await page.keyboard.press('Escape'); expect(await isolated('!!TextTweak.session')).toBe(true);
  await page.screenshot({ path: 'test-results/toolbar.png' });
});

test('stale releases do not unlock the owner and separate tabs can edit', async () => {
  await edit('#text');
  await isolated('TextTweak.message({op:"RELEASE_SESSION",token:crypto.randomUUID()})');
  const other = await context.newPage(); await other.goto('http://localhost:8765');
  await other.locator('#text').click({ button: 'right' });
  await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await chrome.tabs.sendMessage(tabs[0].id, { channel: 'texttweak-v1', op: 'EDIT_REQUEST' });
  });
  await expect(other.locator('#text')).toHaveAttribute('contenteditable', 'plaintext-only'); await other.close();
  await page.bringToFront();
  const frame = page.frames().find(frame => frame.url().includes('frame.html'));
  await edit('#frameText', frame); await expect(frame.locator('#frameText')).not.toHaveAttribute('contenteditable');
});

test('repeated saves remove UI and refresh discards edits', async () => {
  for (let index = 0; index < 4; index++) { await edit('#text'); await page.keyboard.type('!'); await save(); }
  expect(await page.locator('texttweak-ui').count()).toBe(0);
  await page.reload(); await expect(page.locator('#text')).toHaveText('Hello world');
});

test('worker restart retains the active lock and draft', async () => {
  await edit('#text'); await page.keyboard.type(' draft');
  const statuses = [];
  cdp.on('ServiceWorker.workerVersionUpdated', data => statuses.push(...data.versions.map(v => v.runningStatus)));
  await cdp.send('ServiceWorker.enable');
  await worker.evaluate(() => { globalThis.restartSentinel = true; });
  await cdp.send('ServiceWorker.stopAllWorkers');
  await expect.poll(() => statuses.includes('stopped')).toBe(true);
  const claim = await isolated('TextTweak.message({op:"CLAIM_SESSION",token:crypto.randomUUID()})');
  expect(claim).toEqual({ ok: false, reason: 'busy' });
  expect(await worker.evaluate(() => globalThis.restartSentinel)).toBeUndefined();
  await expect(page.locator('#text')).toHaveText('Hello world draft');
  await save();
});

test('mouse toolbar preserves selection and keyboard buttons work after focus leaves editor', async () => {
  await edit('#text'); await page.keyboard.type(' saved'); await save(); await edit('#text');
  await page.keyboard.press('Home'); await page.keyboard.type('X');
  const before = await isolated('TextTweak.state.selection(TextTweak.session.target).anchorOffset');
  const clickToggle = async () => {
    const point = await isolated('(() => { const r = TextTweak.session.toolbar.toggle.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()');
    await page.mouse.click(point.x, point.y);
  };
  await clickToggle(); await clickToggle();
  expect(await isolated('TextTweak.state.selection(TextTweak.session.target).anchorOffset')).toBe(before);
  await isolated('TextTweak.session.toolbar.save.focus()'); await page.keyboard.press('Enter');
  expect(await isolated('TextTweak.session === null')).toBe(true);
});

test('descendant whitespace, immutable text values, and target replacement', async () => {
  await edit('#styled');
  await isolated('TextTweak.state.select(TextTweak.session.target,{anchor:document.querySelector("#styled span").firstChild,focus:document.querySelector("#styled span").firstChild,anchorOffset:14,focusOffset:14})');
  await page.keyboard.insertText('\nsecond  line'); await save();
  await expect(page.locator('#styled')).toHaveCSS('white-space', 'pre-wrap');
  expect(await page.locator('#styled').innerText()).toContain('second  line');
  await edit('#styled'); await toggle(); await expect(page.locator('#styled span')).toHaveText('multiline text');
  await save(); await expect(page.locator('#styled span')).toHaveCSS('white-space', 'normal');
  await edit('#text'); await page.keyboard.type(' lost');
  await page.evaluate(() => {
    const node = document.createElement('p'); node.id = 'text'; node.textContent = 'Replacement';
    document.querySelector('#text').replaceWith(node);
  });
  await expect.poll(() => isolated('TextTweak.session === null')).toBe(true);
  await edit('#text'); expect(await isolated('TextTweak.session.toolbar.toggle.hidden')).toBe(true);
  await expect(page.locator('#text')).toHaveText('Replacement');
});

test('native composition is one undo transaction and does not merge with ordinary typing', async () => {
  await edit('#text');
  await cdp.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.imeSetComposition', { text: '日本語', selectionStart: 3, selectionEnd: 3 });
  await cdp.send('Input.insertText', { text: '日本語' });
  await expect(page.locator('#text')).toHaveText('Hello world日本語');
  await page.keyboard.type('!'); await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('#text')).toHaveText('Hello world日本語');
  await page.keyboard.press('ControlOrMeta+z'); await expect(page.locator('#text')).toHaveText('Hello world');
});

test('drawing surfaces, designMode, and stale right-click targets never expand into ancestors', async () => {
  await page.evaluate(() => {
    const container = document.createElement('div');
    container.innerHTML = '<svg width="80" height="40"><rect id="drawing" width="80" height="40" fill="blue"/></svg>';
    document.body.prepend(container);
  });
  await edit('#drawing'); expect(await isolated('TextTweak.session === null')).toBe(true);
  await page.evaluate(() => { document.designMode = 'on'; });
  await edit('#text'); expect(await isolated('TextTweak.session === null')).toBe(true);
  await page.evaluate(() => { document.designMode = 'off'; });
  await page.locator('#text').click({ button: 'right' });
  await page.evaluate(() => document.querySelector('#text').remove());
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await chrome.tabs.sendMessage(tab.id, { channel: 'texttweak-v1', op: 'EDIT_REQUEST' }, { frameId: 0 });
  });
  expect(await isolated('TextTweak.session === null')).toBe(true);
});


test('ordinary HTTP origin can start and save an edit without secure-context crypto', async () => {
  await page.goto('http://texttweak.test:8765');
  expect(await page.evaluate(() => isSecureContext)).toBe(false);
  expect(await isolated('typeof crypto.randomUUID')).toBe('undefined');
  await page.locator('#text').click({ button: 'right' });
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    void chrome.tabs.sendMessage(tab.id, { channel: 'texttweak-v1', op: 'EDIT_REQUEST' }, { frameId: 0 }).catch(() => {});
  });
  await expect(page.locator('#text')).toHaveAttribute('contenteditable', 'plaintext-only');
  expect(await isolated('TextTweak.session.token')).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  await replace('HTTP edit'); await save(); await expect(page.locator('#text')).toHaveText('HTTP edit');
  await edit('#text'); await toggle(); await expect(page.locator('#text')).toHaveText('Hello world'); await save();
});

test('containers with buttons are protected, including buttons in open shadow roots', async () => {
  await page.evaluate(() => {
    const paragraph = document.querySelector('#text');
    paragraph.innerHTML = 'Subscribe to our newsletter <button id="subscribe">Subscribe</button>';
    window.subscribeButton = paragraph.querySelector('button');
  });
  await edit('#text', page, { position: { x: 10, y: 10 } });
  expect(await isolated('TextTweak.session === null')).toBe(true);
  expect(await isolated('chrome.dom.openOrClosedShadowRoot(document.querySelector("texttweak-ui")).textContent')).toContain('editor or control');
  expect(await page.evaluate(() => document.querySelector('#subscribe') === window.subscribeButton)).toBe(true);
  await expect(page.locator('#text')).not.toHaveAttribute('contenteditable');
  await page.evaluate(() => {
    const paragraph = document.querySelector('#text'); paragraph.textContent = 'Subscribe ';
    paragraph.appendChild(document.createElement('span')).attachShadow({ mode: 'open' }).innerHTML = '<button>Subscribe</button>';
  });
  await edit('#text', page, { position: { x: 10, y: 10 } }); expect(await isolated('TextTweak.session === null')).toBe(true);
  await edit('#deep'); await expect(page.locator('#deep')).toHaveAttribute('contenteditable', 'plaintext-only');
});

test('closed shadow content is rejected without taking the session lock', async () => {
  await page.evaluate(() => {
    const host = document.createElement('div'); host.id = 'closedHost';
    host.style.cssText = 'display:block;width:220px;height:40px';
    host.attachShadow({ mode: 'closed' }).innerHTML = '<span>Special offer</span>';
    document.querySelector('#text').after(host);
  });
  expect(await page.locator('#closedHost').evaluate(node => node.shadowRoot)).toBe(null);
  await edit('#closedHost');
  expect(await isolated('TextTweak.session === null')).toBe(true);
  expect(await isolated('chrome.dom.openOrClosedShadowRoot(document.querySelector("texttweak-ui")).textContent')).toContain('closed web component');
  await expect(page.locator('#closedHost')).not.toHaveAttribute('contenteditable');
  await edit('#text'); await expect(page.locator('#text')).toHaveAttribute('contenteditable', 'plaintext-only'); await save();
  // A container must not consume its closed component during Select All / replace, either.
  await page.evaluate(() => document.querySelector('#text').append(document.querySelector('#closedHost')));
  await edit('#text', page, { position: { x: 10, y: 10 } }); expect(await isolated('TextTweak.session === null')).toBe(true);
  // Accessible open-root text remains supported.
  await edit('#shadowText'); await expect(page.locator('#shadowText')).toHaveAttribute('contenteditable', 'plaintext-only');
});

test('single-line heading edits do not expose source indentation or retain whitespace overrides', async () => {
  await page.evaluate(() => {
    const heading = document.createElement('h3'); heading.id = 'padded-heading';
    heading.textContent = '\n      \n   \n       Extensions and AI\n     \n \n   ';
    document.querySelector('#text').before(heading);
  });
  const heading = page.locator('#padded-heading');
  const height = await heading.evaluate(node => node.getBoundingClientRect().height);
  await edit('#padded-heading');
  expect(await heading.textContent()).toBe('Extensions and AI');
  expect(await heading.evaluate(node => node.getBoundingClientRect().height)).toBe(height);
  await save();
  await expect(heading).toHaveCSS('white-space', 'normal');
  // Edit the prepared label; the untouched Original still retains its source indentation.
  await edit('#padded-heading');
  await isolated(`(() => {
    const node = document.querySelector('#padded-heading').firstChild;
    const start = node.data.indexOf('Extensions and AI');
    TextTweak.state.select(TextTweak.session.target, {anchor:node,focus:node,anchorOffset:start,focusOffset:start+17});
  })()`);
  await page.keyboard.insertText('Extensions and tools'); await save();
  expect(await heading.evaluate(node => node.style.getPropertyValue('white-space'))).toBe('');
  expect(await heading.evaluate(node => node.getBoundingClientRect().height)).toBe(height);
  expect(await heading.innerText()).toBe('Extensions and tools');
  await edit('#padded-heading'); await toggle(); await save();
  expect(await heading.innerText()).toBe('Extensions and AI');
});

test('saved whitespace overrides disappear after replacing multiline text with a single line', async () => {
  await edit('#text'); await replace('First  line\nSecond line'); await save();
  expect(await page.locator('#text').innerText()).toBe('First  line\nSecond line');
  await edit('#text'); await replace('One line'); await save();
  await expect(page.locator('#text')).toHaveCSS('white-space', 'normal');
  expect(await page.locator('#text').evaluate(node => node.style.getPropertyValue('white-space'))).toBe('');
  await edit('#text'); await save();
  await expect(page.locator('#text')).toHaveCSS('white-space', 'normal');
});


test('draft preparation preserves inline nodes, visible word spacing, and selection', async () => {
  await page.evaluate(() => {
    const target = document.querySelector('#markup');
    target.innerHTML = '\n   A   <b id="bold">bold</b>\n   <a id="link" href="#destination">link</a>   remains.\n  ';
    window.retainedBold = document.querySelector('#bold');
    const selected = getSelection(), node = target.firstChild;
    selected.setBaseAndExtent(node, node.data.indexOf('A'), node, node.data.indexOf('A') + 1);
  });
  // Dispatching contextmenu avoids the test driver's mouse click replacing this selection.
  await page.locator('#markup').dispatchEvent('contextmenu');
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await chrome.tabs.sendMessage(tab.id, { channel: 'texttweak-v1', op: 'EDIT_REQUEST' }, {frameId:0});
  });
  expect(await page.locator('#markup').textContent()).toBe('A bold link remains.');
  expect(await page.evaluate(() => getSelection().toString())).toBe('A');
  expect(await page.evaluate(() => document.querySelector('#bold') === retainedBold)).toBe(true);
  await save();
  // Saving untouched Original restores the captured source, including its indentation.
  expect(await page.locator('#markup').textContent()).toBe('\n   A   bold\n   link   remains.\n  ');
});

test('prepared drafts preserve deliberate spacing on reopen and author preformatted text', async () => {
  await page.evaluate(() => { document.querySelector('#text').textContent = '\n   Hello world\n  '; });
  await edit('#text'); expect(await page.locator('#text').textContent()).toBe('Hello world');
  await page.keyboard.type('  added'); await page.keyboard.press('Enter'); await page.keyboard.type('next');
  await save();
  const saved = await page.locator('#text').innerText();
  expect(saved).toBe('Hello world  added\nnext');
  await edit('#text'); expect(await page.locator('#text').innerText()).toBe(saved);
  await toggle(); expect(await page.locator('#text').textContent()).toBe('Hello world');
  await toggle(); expect(await page.locator('#text').innerText()).toBe(saved); await save();
  await page.evaluate(() => {
    const pre = document.createElement('pre'); pre.id = 'preformatted';
    pre.textContent = '  intentional\n    indentation  '; document.querySelector('#text').after(pre);
  });
  await edit('#preformatted');
  expect(await page.locator('#preformatted').textContent()).toBe('  intentional\n    indentation  ');
  await save(); await expect(page.locator('#preformatted')).toHaveCSS('white-space', 'pre');
});

test('preparing an inline target keeps its visible separator from neighboring text', async () => {
  await page.evaluate(() => { document.querySelector('#nested').innerHTML = 'Before<span id="deep">   inside   </span>after'; });
  const before = await page.locator('#nested').innerText();
  await edit('#deep');
  expect(await page.locator('#nested').innerText()).toBe(before);
  expect(await page.locator('#deep').textContent()).toBe(' inside ');
  await save(); expect(await page.locator('#nested').innerText()).toBe(before);
});
