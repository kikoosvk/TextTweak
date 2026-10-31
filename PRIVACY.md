# TextTweak Privacy Policy

Effective date: October 31, 2026 · Applies to TextTweak 1.0.0

TextTweak is a browser extension maintained through the [kikoosvk/TextTweak project](https://github.com/kikoosvk/TextTweak). It lets you right-click webpage text, edit it directly, save a temporary local version, and switch between original and edited versions.

## Temporary editing state

The developer receives no webpage content, edits or usage information from TextTweak. The extension works directly in your browser and keeps only the temporary state needed for its editing features.

Its scripts run in permitted HTTP and HTTPS pages and frames. They remember the most recently right-clicked element and register keyboard guards early so webpage shortcuts can be isolated while you edit. After you choose **Edit**, the extension checks whether the element is eligible and creates in-memory snapshots of its contents. These snapshots include text, descendant DOM nodes and attributes, and whitespace styling. They may include personal or sensitive information already present in that content or typed or pasted by you. Existing form controls and existing editors are excluded; this does not guarantee that other webpage text is free of sensitive information.

While editing, TextTweak handles your input, text selection, cursor position, undo/redo history, original content, saved content, and temporary drafts. It observes relevant DOM changes and layout to keep the editor and floating controls working. It does not maintain click, mouse-movement, scroll, keystroke or browsing-history logs. Undo/redo uses content snapshots rather than a separate keystroke log.

Browser-provided tab, frame and document identifiers, the sender document URL (checked for HTTP/HTTPS), and a random temporary session token are used to route internal messages and allow only one active editing session per tab. The sender URL is checked transiently, not saved as a visit record. These identifiers are not used to track you across visits. Webpage snapshots and edited text remain in the owning frame; the extension's internal messages carry editing operations, session identifiers and status, not text snapshots.

## Retention and deletion

Editing state is kept in memory associated with the current document and its elements. **Save** keeps a local version available for that page; it does not save a file or write to a server. Ending an editing session removes its controls and active input handlers, while original and saved snapshots can remain available for reopening the element.

TextTweak does not write editing data to extension storage, localStorage, sessionStorage, cookies, IndexedDB, Cache Storage, files, or a remote database. Refreshing the page creates a new document, discards TextTweak's old editing state, and loads the website's content again. Closing the page discards its live state. Browser back/forward caching can retain an old document and its in-memory state; navigating away is not a guaranteed way to clear it. Refresh the affected page to clear the extension's changes. Disabling or uninstalling the extension alone may leave an already-modified page visible until it is refreshed.

## Transmission, sharing and services

TextTweak has no backend, accounts, analytics, advertising, tracking, crash reporting, or external processing services. Its code makes no network requests and does not transmit webpage text or edits to the developer or third parties. The developer does not receive, sell or share your editing data. All executable extension code is included in the installed package.

TextTweak's use of user data is limited to its stated editing purpose and complies with the Chrome Web Store User Data Policy, including its Limited Use requirements. It does not use data for advertising, profiling, creditworthiness or lending.

## The website can observe edits

TextTweak changes the page's live DOM. Website scripts can observe those changes and input events and may store or transmit information under the website's own policies. TextTweak cannot prevent those independent actions, undo website side effects, or guarantee confidentiality from the website. Avoid entering sensitive information into a page you do not trust.

The extension does not itself publish changes to the website or change its server-side content. A website may overwrite temporary edits when it updates the page. Refreshing clears TextTweak's state but does not erase any information independently retained by the website. Browser-internal pages, extension stores, PDFs and other protected or unsupported contexts cannot be edited.

## Questions and changes

For privacy questions, contact the maintainer through [GitHub Issues](https://github.com/kikoosvk/TextTweak/issues). Issues are public: do not include private webpage text or sensitive information. GitHub independently processes information you choose to submit under its own policies; the extension does not submit it for you.

Updates to this policy will be posted in this repository with a revised effective date. Material changes in data handling will also be reflected in the extension's store disclosures.
