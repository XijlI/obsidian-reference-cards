# Reference Cards for Obsidian.md

Manage reference cards in a side panel and link them to your notes with `{id}` markers.

## UI Preview

<img width="272" height="597" alt="image" src="https://github.com/user-attachments/assets/2eeae789-c346-4de8-8f33-8526ecf7b9de" />

## Features

- Create and manage reference cards in a side panel
- New cards animate into place from the **+** button (respects reduced-motion)
- Each card gets a unique, randomly generated 3-character ID (letters + digits, e.g. `{a1b}`)
- Insert `{id}` markers into notes to link cards
- Click `{id}` in Live Preview to jump to the card
- Cards support title, tags, year, and notes fields
- Clickable links in title and notes (URLs, wiki links, markdown links)
- Paste a link into a card title to fetch the page title automatically and insert it as `[title](url)`
- Filter cards by tag
- Sort by date added (default), citation order, title, or year
- **Citation** sort orders cards by where their `{id}` first appears in the current note (cards the note does not cite stay after the cited ones; IDs and notes are left untouched)
- Undo/Redo for card deletions
- Delete cards without touching your notes — IDs are stable and never reused
- Deleting a card (or undoing the delete) keeps the panel scrolled where you were, anchored to the surrounding cards
- Show which vault files reference a card via the **?** button
- Math and code blocks are ignored, so LaTeX like `\frac{1}{N}` inside `$…$` is never mistaken for a reference
- Configurable card font size (10–20px)

## Usage

1. Open the side panel via the ribbon icon or command palette → "Open Reference Cards"
2. Click **+** to create a card, fill in title, tags, year, and notes
3. Place cursor in a note, click **+** on a card to insert `{id}`
4. Click `{id}` in Live Preview to jump to that card
5. Use the sort dropdown (Added / Citation / Title / Year) and the ↑/↓ button to change card order — the choice is remembered
6. Pick **Citation** to order cards by where their `{id}` first appears in the current note; the ↑/↓ button reverses the order of the cited cards
7. Use the **history** button (or click the deletion notice) to undo the last card deletion
8. Double-click title or notes to edit
9. Paste a bare URL into a title to turn it into `[page title](url)` (works with links copied from a browser page too; if the page can't be read, the pasted text is kept)
10. Delete a card with **×** — notes are not modified and remaining IDs are unchanged
11. Click **?** on a card to see which files reference it

## Installation

### From Community Plugins

1. Open Settings → Community Plugins → Browse
2. Search for "Reference Cards"
3. Install and enable

### Manual

1. Download `main.js`, `manifest.json`, `styles.css` from the latest release
2. Copy them to `.obsidian/plugins/reference-cards/` in your vault
3. Enable the plugin in Settings → Community Plugins

## Settings

| Setting | Description |
|---------|-------------|
| Fetch link titles on paste | When a URL is pasted into a card title, fetch the page title and insert it as a markdown link (default: on). Falls back to the pasted text when the page can't be read |
| Title soft wrap | Allow long titles to wrap across multiple lines (default: on). Titles longer than three lines switch to a compact layout: the `[id]` and action buttons move to the top row and the title gets the full card width below them |
| Card font size | Adjust the font size of card content, 10–20px (default: 13) |
| Reference ID color | Color for `{id}` highlights in the editor (default: link color) |

## License

MIT
