# Reference Cards for Obsidian.md

Manage reference cards in a side panel and link them to your notes with `{id}` markers.

## UI Preview

<img width="303" height="470" alt="image" src="https://github.com/user-attachments/assets/a5b75184-3d9d-4f26-b58b-60d56033bec5" />

## Features

- Create and manage reference cards in a side panel
- Insert `{id}` markers into notes to link cards
- Click `{id}` in Live Preview to jump to the card
- Cards support title, tags, year, and notes fields
- Clickable links in title and notes (URLs, wiki links, markdown links)
- Filter cards by tag
- Sort by index, title, or year
- Reindex cards based on `{id}` order in the current note
- Undo/Redo for reindex and delete operations
- Delete cards with automatic reindexing across all vault files

## Usage

1. Open the side panel via the ribbon icon or command palette → "Open Reference Cards"
2. Click **+** to create a card, fill in title, tags, year, and notes
3. Place cursor in a note, click **+** on a card to insert `{id}`
4. Click `{id}` in Live Preview to jump to that card
5. Use the sort dropdown and arrow button to change card order
6. Use the toolbar buttons for reindex, undo, and redo
7. Double-click title or notes to edit
8. Delete a card with **×** — vault references are reindexed automatically

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
| Title soft wrap | Allow long titles to wrap across multiple lines (default: on) |

## License

MIT
