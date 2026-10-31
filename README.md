# TextTweak

Right-click webpage text, choose **Edit**, and type directly into the page. A small floating toolbar lets you **Save** the local change or **Toggle** between original and saved versions.

## Install

1. Download or clone this repository.
2. In Chrome open `chrome://extensions`; in Vivaldi open `vivaldi://extensions`.
3. Enable **Developer mode**, choose **Load unpacked**, and select the **extension/** folder.
4. **Refresh already-open webpages.** Refresh again after updating or reloading the extension.

No build, npm install, account, backend, or runtime dependency is required. Node and npm are only for development tests. Chrome 120 is the minimum supported API version. Automated tests have passed in Chrome 156 on macOS; Vivaldi and Windows compatibility remain unverified.

## Use

- Right-click the text itself and select **Edit**. The deepest eligible HTML element becomes a plaintext editor; existing form fields and editors are protected, as are containers containing buttons or other form editors.
- Type, select, delete, or paste plain text. Enter and Shift+Enter insert line breaks. Drag-and-drop and formatting commands are blocked.
- **Save** ends editing and leaves the displayed content on the page. Refresh restores the website's content.
- Reopening starts from the latest save. **Toggle** appears after the first save and switches between Original and Edited. Its tooltip names the next version.
- Both versions keep their unsaved drafts during that session. Saving either version promotes it to the latest save; the first Original stays immutable.
- Undo/Redo applies only to the displayed draft. Toggle and reopen start a fresh history. Use Cmd+Z / Cmd+Shift+Z on macOS, or Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z on Windows.
- Outside clicks, Escape, Tab, and focus loss do not save or cancel. Keyboard isolation applies only while focus is inside the editor. Save before editing another element in the same tab.
- If the page removes the target, editing ends with a notice. A replacement element never inherits that element's history.

Example: save **Hello everyone** over **Hello world**, reopen and type **Hello there**. Toggle shows **Hello world**; Toggle again returns to the unsaved **Hello there**. Saving an edited Original draft changes Saved, never Original.

## Permissions and privacy

The only named permission is `contextMenus`. Static scripts run at `document_start` in matching HTTP(S) documents and frames. This intentionally causes a broad site-access warning: capturing the right-click target and registering early keyboard guards requires scripts to be present before you choose Edit. There is no `tabs`, `scripting`, `activeTab`, clipboard, storage, or network permission.

TextTweak makes no external requests, stores nothing persistently, logs no edited text, and has no analytics or page-message bridge. Content snapshots stay in the owning frame; internal messages carry only operations, session identities, and status. State disappears on refresh. Local DOM edits **are visible to website scripts**, which could transmit observed changes independently of this extension.

## Boundaries

This is a local text editing tool, not a website editor or a way to publish changes. Framework rerenders can overwrite edits. Restoring snapshots reuses original DOM nodes where possible to retain listeners, but can trigger custom-element lifecycle callbacks and cannot restore arbitrary framework state or reverse website side effects. Deleting across element boundaries can merge or remove markup; unaffected markup is preserved where the browser permits it.

Unsupported contexts include browser-internal pages, extension stores, PDF viewers, other extensions' pages, `file://`, opaque/special-scheme frames, canvas text, CSS-generated content, and closed shadow-root internals. Closed shadow hosts and containers containing them are rejected with a notice, without starting a session. HTTP(S) frames need an available top-frame coordinator. Frame toolbars stay inside their frame and cannot remain visible when the frame itself is offscreen. Modal dialogs, hidden frames, and unusual author CSS may obstruct the editor or toolbar.

Early window capture guards block later webpage keyboard listeners while editing, but cannot undo earlier listeners, prevent browser/OS shortcuts, or stop independent website reactions to input and DOM mutations. There is no main-world injection or prototype patching.

Before editing starts, TextTweak collapses hidden HTML indentation in the working draft while preserving inline elements and author-preserved whitespace. Original retains the exact source; saved drafts keep spaces and line breaks you enter.

Single-line edits restore the page's whitespace styling on Save. TextTweak retains `white-space: pre-wrap` only when an edit introduces whitespace that needs preservation, such as repeated spaces or literal line breaks. Existing HTML indentation alone does not require that override. Replacing such an edit with ordinary single-line text removes the override; original whitespace declarations and their priority are preserved.

## Development

```sh
npm ci
npx playwright install chromium
npm test
```

The suite includes 8 Node checks and 22 browser tests covering drafts, history, frame coordination, keyboard isolation, ordinary HTTP pages, protected controls, and shadow-root boundaries. Native context-menu and OS clipboard checks, OS IME testing, and live YouTube shortcut validation remain outstanding.

The tests use Node's built-in test runner and an extension-capable Chrome for Testing launched by Playwright. Browser tests enter the actual isolated extension world through DevTools; there is no production test bridge. The fixture server binds port 8765 and provides a cross-origin frame. Tests use temporary browser profiles, never your normal profile.

```sh
npm run test:state
npm run test:browser
# Optional installed-browser run (macOS example):
TEXTTWEAK_BROWSER='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:browser
# Add TEXTTWEAK_HEADED=1 for a visible test window.
```

`assets/texttweak-icon.svg` is original editable artwork. Regenerate the four transparent manifest PNGs with `npm run icons`. All npm dependencies are development-only.

Implementation: `background.js` registers the menu and routes authenticated messages. The ordered content scripts bootstrap early guards, capture/reconcile snapshots, render the closed-shadow popover, and manage editing. The top document serializes session claims; the worker keeps no essential session state. A missing/ambiguous owner response never authorizes a second editor.

API references: [content scripts](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts), [context menus](https://developer.chrome.com/docs/extensions/reference/api/contextMenus), and [document-targeted messaging](https://developer.chrome.com/docs/extensions/reference/api/tabs).
