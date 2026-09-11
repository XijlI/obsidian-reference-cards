# Reference Cards for Obsidian.md

Manage reference cards in a side panel and link them to your notes with `{id}` markers.

## UI Preview

<img width="272" height="597" alt="image" src="https://github.com/user-attachments/assets/2eeae789-c346-4de8-8f33-8526ecf7b9de" />

## Features

- Create and manage reference cards in a side panel
- Each card gets a unique, randomly generated 3-character ID (letters + digits, e.g. `{a1b}`)
- Insert `{id}` markers into notes to link cards
- Click `{id}` in Live Preview to jump to the card
- Cards support title, tags, year, and notes fields
- Clickable links in title and notes (URLs, wiki links, markdown links)
- Filter cards by tag
- Sort by index, title, or year
- Reorder cards based on `{id}` order in the current note (IDs and notes are left untouched)
- Undo/Redo for reorder and delete operations
- Delete cards without touching your notes — IDs are stable and never reused
- Show which vault files reference a card via the **?** button
- Math and code blocks are ignored, so LaTeX like `\frac{1}{N}` inside `$…$` is never mistaken for a reference
- Configurable card font size (10–20px)

## Usage

1. Open the side panel via the ribbon icon or command palette → "Open Reference Cards"
2. Click **+** to create a card, fill in title, tags, year, and notes
3. Place cursor in a note, click **+** on a card to insert `{id}`
4. Click `{id}` in Live Preview to jump to that card
5. Use the sort dropdown and arrow button to change card order
6. Use the toolbar buttons to reorder cards by the current note's `{id}` order, and to undo/redo
7. Double-click title or notes to edit
8. Delete a card with **×** — notes are not modified and remaining IDs are unchanged
9. Click **?** on a card to see which files reference it

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
| Title soft wrap | Allow long titles to wrap across multiple lines (default: on). Titles longer than two lines switch to a compact layout: the `[id]` and action buttons move to the top row and the title gets the full card width below them |
| Card font size | Adjust the font size of card content, 10–20px (default: 13) |
| Reference ID color | Color for `{id}` highlights in the editor (default: link color) |

## License

MIT
