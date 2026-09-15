# Reference Cards for Obsidian.md

Manage reference cards in a side panel and link them to your notes with `{id}` markers.

## UI Preview

<img width="215.5" height="703" alt="image" src="https://github.com/user-attachments/assets/9c87b480-8fe1-48cd-95dd-3732db0696c5" />

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
- While typing tags, matching tags already used on your cards are suggested below the field (↑/↓ to move, Enter to accept, Escape to dismiss)
- Optional unique-title enforcement: when off, a card can't take a title another card already has — a new card keeps an empty title and a renamed card reverts, with a warning you can click to jump to the existing card
- Sort by date added (default), citation order, title, year, or a custom order you set yourself
- **Citation** sort orders cards by where their `{id}` first appears in the current note (cards the note does not cite stay after the cited ones; IDs and notes are left untouched)
- **Custom** sort lets you drag cards into any order; the order is saved and kept across reloads
- Undo/Redo for card deletions
- Delete cards without touching your notes — IDs are stable and never reused
- Deleting a card (or undoing the delete) keeps the panel scrolled where you were, anchored to the surrounding cards
- Show which vault files reference a card via the **?** button
- Math and code blocks are ignored, so LaTeX like `\frac{1}{N}` inside `$…$` is never mistaken for a reference
- Configurable card font size (10–20px)
- Optional alternating card background colors: pick one of five presets for dark mode and five for light mode (they follow your Obsidian theme), or set your own two colors

## Usage

1. Open the side panel via the ribbon icon or command palette → "Open Reference Cards"
2. Click **+** to create a card, fill in title, tags, year, and notes
3. Place cursor in a note, click **+** on a card to insert `{id}`
4. Click `{id}` in Live Preview to jump to that card
5. Use the sort dropdown (Added / Citation / Title / Year / Custom) and the ↑/↓ button to change card order — the choice is remembered
6. Pick **Citation** to order cards by where their `{id}` first appears in the current note; the ↑/↓ button reverses the order of the cited cards
7. Pick **Custom** and drag a card by its grip handle (or anywhere on the card that is not a field or button) to place it; a line shows where it will land. The order is saved immediately
8. Use the **history** button (or click the deletion notice) to undo the last card deletion
9. Double-click title or notes to edit
10. Start typing in a card's **Tags** field to get suggestions from tags you already use; press Enter to accept (a `", "` is added so you can keep typing), ↑/↓ to choose, Escape to dismiss
11. Paste a bare URL into a title to turn it into `[page title](url)` (works with links copied from a browser page too; if the page can't be read, the pasted text is kept)
12. Delete a card with **×** — notes are not modified and remaining IDs are unchanged
13. Click **?** on a card to see which files reference it
14. With **Allow identical card titles** turned off, finishing a title another card already uses clears a new card's title (or reverts a rename) and shows a warning — click the title in the warning to jump to the existing card

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
| Allow identical card titles | When **off**, a card cannot take a title another card already uses (trimmed, case-sensitive; blank titles never count). A new card keeps an empty title, a renamed card reverts, and a warning links to the existing card. Turning it off is refused while any title is still shared — the warning lists those titles (default: on) |
| Card font size | Adjust the font size of card content, 10–20px (default: 13) |
| Reference ID color | Color for `{id}` highlights in the editor and for the `[id]` badge on cards (default: link color) |
| Card background colors | Give cards alternating background colors. The 1st, 3rd, 5th… card uses color A and the 2nd, 4th, 6th… uses color B (default: off) |
| Background preset | One of five preset pairs. The list follows your theme: pick in dark mode for the dark pairs, in light mode for the light pairs. Choosing **Custom** reveals two color pickers |

## License

MIT
