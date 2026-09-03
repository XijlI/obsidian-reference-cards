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
2. Click **+** in the header to create a new card
3. Fill in the title, tags (comma-separated), year, and notes
4. Position your cursor in a note, then click **+** on a card to insert `{id}`
5. In Live Preview, click any `{id}` to jump to that card in the side panel
6. Use the **sort dropdown** and **↑↓** button to change card ordering
7. Click **Reindex** to reassign IDs based on `{id}` order in the current note; **Undo** to revert
8. Double-click title or notes to edit; press Enter or click away to save
9. Links in title and notes are clickable in view mode (URLs open in browser, wiki links navigate to notes)
10. Delete a card with **×** — all `{id}` references in the vault are reindexed automatically; click the notice or **Undo Delete** to revert

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
