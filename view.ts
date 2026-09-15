import { ItemView, WorkspaceLeaf, App, MarkdownView, Notice, setIcon } from "obsidian";
import { ReferenceCard, PluginData, createEmptyCard, getAllTags } from "./data";
import { ReferenceCardsSettings, SortField } from "./settings";
import { collectRefIds, escapeRegExp, generateCardId, maskProtectedRegions } from "./refs";
import { buildMarkdownLink, extractPastedLink, fetchLinkTitle, isMarkdownLink } from "./link-title";

export const VIEW_TYPE = "reference-cards-view";

const CITATION_SORT_TOOLTIP = "Sort cards by the first appearence in current file";
const CUSTOM_SORT_TOOLTIP = "Drag cards to set your own order — it is saved and kept";

/** Explanation shown on the closed sort control and the matching option. */
function sortFieldTooltip(field: SortField): string {
  if (field === "citation") return CITATION_SORT_TOOLTIP;
  if (field === "custom") return CUSTOM_SORT_TOOLTIP;
  return "";
}

interface DeleteSnapshot {
  deletedCard: ReferenceCard;
  deletedIndex: number;
}

export class ReferenceCardView extends ItemView {
  private data: PluginData;
  private saveData: () => Promise<void>;
  private getLastMarkdownView: () => MarkdownView | null;
  private settings: ReferenceCardsSettings;
  private filterTag: string = "";
  private searchQuery: string = "";
  private cardContainer: HTMLElement;
  private headerEl: HTMLElement;
  private deleteSnapshot: DeleteSnapshot | null = null;
  private deleteRedoSnapshot: { cardId: string } | null = null;
  private activeBacklinksPopup: HTMLElement | null = null;
  private activeBacklinksCleanup: (() => void) | null = null;
  private titleLayoutObserver: ResizeObserver | null = null;
  private lastTitleLayoutWidth = -1;
  private draggedCardId: string | null = null;
  private dragBlocked = false;
  private dropTargetId: string | null = null;
  private dropAfter = false;

  constructor(
    leaf: WorkspaceLeaf,
    app: App,
    data: PluginData,
    saveData: () => Promise<void>,
    getLastMarkdownView: () => MarkdownView | null,
    settings: ReferenceCardsSettings
  ) {
    super(leaf);
    this.app = app;
    this.data = data;
    this.saveData = saveData;
    this.getLastMarkdownView = getLastMarkdownView;
    this.settings = settings;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Reference Cards";
  }

  getIcon(): string {
    return "file-text";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("ref-cards-container");
    (container as HTMLElement).style.setProperty("--ref-card-font-size", this.settings.cardFontSize + "px");

    this.headerEl = container.createDiv({ cls: "ref-cards-header" });
    this.renderHeader();

    const searchRow = container.createDiv({ cls: "ref-cards-search" });
    const searchInput = searchRow.createEl("input", {
      cls: "ref-cards-search-input",
      attr: { type: "text", placeholder: "Search cards..." },
    });
    searchInput.value = this.searchQuery;
    searchInput.addEventListener("input", () => {
      this.searchQuery = searchInput.value.toLowerCase();
      this.renderCards();
    });

    this.cardContainer = container.createDiv({ cls: "ref-cards-list" });
    // Drag-and-drop reordering is handled at the list level so the gaps
    // between cards are drop targets too. The listeners live on the container,
    // which survives `renderCards()` rebuilds.
    this.cardContainer.addEventListener("dragover", (e) => this.onCardDragOver(e));
    this.cardContainer.addEventListener("drop", (e) => this.onCardDrop(e));
    this.cardContainer.addEventListener("dragleave", (e) => {
      const next = e.relatedTarget as Node | null;
      if (!next || !this.cardContainer.contains(next)) this.clearDropMarkers();
    });
    this.renderCards();

    // Re-evaluate title wrapping whenever the panel is resized (line count depends on width).
    // Observe the view content rather than the scrollable list: the list's own
    // scrollbar can appear/disappear as card heights change, which would feed
    // width changes back into this observer and could oscillate.
    this.titleLayoutObserver = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width ?? 0;
      if (Math.abs(width - this.lastTitleLayoutWidth) < 0.5) return;
      this.lastTitleLayoutWidth = width;
      this.refreshAllTitleWrapLayouts();
    });
    this.titleLayoutObserver.observe(this.contentEl);
  }

  async onClose(): Promise<void> {
    this.closeBacklinksPopup();
    // Flush any pending debounced edit instead of dropping up to 500ms of work.
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
      await this.saveData();
    }
    this.titleLayoutObserver?.disconnect();
    this.titleLayoutObserver = null;
  }

  private renderHeader(): void {
    this.headerEl.empty();

    const topRow = this.headerEl.createDiv({ cls: "ref-cards-header-row" });

    const addBtn = topRow.createEl("button", { cls: "ref-cards-add-btn", text: "+" });
    addBtn.addEventListener("click", () => this.addCard());

    const filterSelect = topRow.createEl("select", { cls: "ref-cards-filter" });
    const allTags = getAllTags(this.data.cards);

    filterSelect.createEl("option", { text: "All tags", value: "" });
    for (const tag of allTags) {
      filterSelect.createEl("option", { text: tag, value: tag });
    }
    filterSelect.value = this.filterTag;
    filterSelect.addEventListener("change", () => {
      this.filterTag = filterSelect.value;
      this.renderCards();
    });

    const sortRow = this.headerEl.createDiv({ cls: "ref-cards-sort-row" });

    const sortSelect = sortRow.createEl("select", { cls: "ref-cards-sort-select" });
    sortSelect.createEl("option", { text: "Added", value: "added" });
    sortSelect.createEl("option", {
      text: "Citation",
      value: "citation",
      title: CITATION_SORT_TOOLTIP,
    });
    sortSelect.createEl("option", { text: "Title", value: "title" });
    sortSelect.createEl("option", { text: "Year", value: "year" });
    sortSelect.createEl("option", { text: "Custom", value: "custom", title: CUSTOM_SORT_TOOLTIP });
    sortSelect.value = this.settings.sortField;
    // Option titles only show while the dropdown is open, so mirror the
    // explanation on the closed control as well.
    sortSelect.title = sortFieldTooltip(this.settings.sortField);

    const orderBtn = sortRow.createEl("button", {
      cls: "ref-cards-order-btn",
      text: this.settings.sortAscending ? "↑" : "↓",
    });
    // Custom order is whatever the user dragged into place, so there is nothing
    // for ascending/descending to flip.
    orderBtn.disabled = this.settings.sortField === "custom";
    orderBtn.title = this.settings.sortAscending ? "Ascending" : "Descending";

    sortSelect.addEventListener("change", () => {
      this.settings.sortField = sortSelect.value as SortField;
      sortSelect.title = sortFieldTooltip(this.settings.sortField);
      orderBtn.disabled = this.settings.sortField === "custom";
      void this.saveData();
      this.renderCards();
    });

    orderBtn.addEventListener("click", () => {
      this.settings.sortAscending = !this.settings.sortAscending;
      orderBtn.textContent = this.settings.sortAscending ? "↑" : "↓";
      orderBtn.title = this.settings.sortAscending ? "Ascending" : "Descending";
      void this.saveData();
      this.renderCards();
    });

    const undoDeleteBtn = sortRow.createEl("button", {
      cls: "ref-cards-sort-btn ref-cards-sort-btn-icon" + (!this.deleteSnapshot && !this.deleteRedoSnapshot ? " ref-cards-sort-btn-disabled" : ""),
    });
    if (this.deleteRedoSnapshot) {
      setIcon(undoDeleteBtn, "redo-2");
      undoDeleteBtn.title = "Redo last card deletion";
      undoDeleteBtn.disabled = false;
      undoDeleteBtn.addEventListener("click", () => this.redoDelete());
    } else {
      setIcon(undoDeleteBtn, "history");
      undoDeleteBtn.title = "Undo last card deletion";
      undoDeleteBtn.disabled = !this.deleteSnapshot;
      undoDeleteBtn.addEventListener("click", () => this.undoDelete());
    }
  }

  private renderCards(): void {
    this.cardContainer.empty();

    // Copy before filtering/sorting: `this.data.cards` is the persisted order
    // and must not be reordered as a side effect of the sort control.
    let filtered = this.filterTag
      ? this.data.cards.filter((c) => c.tags.includes(this.filterTag))
      : [...this.data.cards];

    if (this.searchQuery) {
      filtered = filtered.filter((c) => {
        const haystack = [c.title, c.tags.join(" "), c.year, c.notes].join(" ").toLowerCase();
        return haystack.includes(this.searchQuery);
      });
    }

    // "Custom" keeps the array order above, which drag-and-drop rewrites; every
    // other mode derives its own order and leaves the persisted array alone.
    // "Citation" ranks each card by the first `{id}` appearance in the active
    // note; cards the note does not cite are pinned after the cited ones in
    // their persisted array order. Ascending/descending flips only the cited
    // cards, so the uncited ones never jump to the top.
    if (this.settings.sortField === "custom") {
      // Persisted order as-is.
    } else if (this.settings.sortField === "citation") {
      const rank = new Map(this.getCitationOrder().map((id, index) => [id, index]));
      filtered.sort((a, b) => {
        const ra = rank.get(a.id);
        const rb = rank.get(b.id);
        if (ra === undefined && rb === undefined) return 0;
        if (ra === undefined) return 1;
        if (rb === undefined) return -1;
        return this.settings.sortAscending ? ra - rb : rb - ra;
      });
    } else {
      filtered.sort((a, b) => {
        let cmp = 0;
        if (this.settings.sortField === "title") {
          cmp = a.title.localeCompare(b.title);
        } else if (this.settings.sortField === "year") {
          const ya = parseInt(a.year) || 0;
          const yb = parseInt(b.year) || 0;
          cmp = ya - yb;
        } else {
          cmp = a.createdAt - b.createdAt;
        }
        return this.settings.sortAscending ? cmp : -cmp;
      });
    }

    for (const card of filtered) {
      this.renderCard(card);
    }

    this.refreshAllTitleWrapLayouts();
  }

  /**
   * Unique `{id}`s in order of first appearance in the active note, ignoring
   * math/code spans. Empty when no note is active, which leaves the list in its
   * persisted order.
   */
  private getCitationOrder(): string[] {
    const mdView = this.getLastMarkdownView();
    return mdView ? collectRefIds(mdView.editor.getValue()) : [];
  }

  /**
   * Remembers a visible card and its offset from the top of the scroll area.
   * `renderCards()` empties and rebuilds the list, which resets the list's
   * `scrollTop`, so callers capture an anchor before the rebuild and restore it
   * afterwards to keep the panel where the user was looking.
   *
   * The anchor is the first card touching the viewport. When that card is the
   * one being deleted it cannot anchor anything, so its neighbour is used: the
   * card above keeps the scroll position, letting the following cards slide up
   * into the freed slot.
   */
  private captureScrollAnchor(excludeId: string | null): { id: string; top: number } | null {
    const containerTop = this.cardContainer.getBoundingClientRect().top;
    const cards = Array.from(
      this.cardContainer.querySelectorAll<HTMLElement>(".ref-card[data-card-id]")
    );

    let anchor = cards.find((el) => el.getBoundingClientRect().bottom > containerTop + 1) ?? null;
    if (anchor && excludeId && anchor.dataset.cardId === excludeId) {
      anchor =
        (anchor.previousElementSibling as HTMLElement | null) ??
        (anchor.nextElementSibling as HTMLElement | null);
    }
    if (!anchor) return null;

    const id = anchor.dataset.cardId;
    if (!id) return null;
    return { id, top: anchor.getBoundingClientRect().top - containerTop };
  }

  /** Puts the anchor card back at the offset captured before a re-render. */
  private restoreScrollAnchor(anchor: { id: string; top: number } | null): void {
    if (!anchor) return;
    const el = this.cardContainer.querySelector<HTMLElement>(
      `[data-card-id="${CSS.escape(anchor.id)}"]`
    );
    if (!el) return;

    const containerTop = this.cardContainer.getBoundingClientRect().top;
    const current = el.getBoundingClientRect().top - containerTop;
    this.cardContainer.scrollTop += current - anchor.top;
  }

  private renderCard(card: ReferenceCard): void {
    const cardEl = this.cardContainer.createDiv({ cls: "ref-card", attr: { "data-card-id": String(card.id) } });

    const topRow = cardEl.createDiv({ cls: "ref-card-top" });

    if (this.settings.sortField === "custom") {
      const handle = topRow.createSpan({
        cls: "ref-card-drag-handle",
        attr: { "aria-label": "Drag to reorder" },
      });
      handle.title = "Drag to reorder";
      setIcon(handle, "grip-vertical");
    }

    topRow.createSpan({ cls: "ref-card-id", text: `[${card.id}]` });

    const titleContainer = topRow.createDiv({
      cls: "ref-card-title-container" + (this.settings.titleSoftWrap ? " ref-card-title-softwrap" : ""),
    });

    const titleView = titleContainer.createDiv({
      cls: "ref-card-title-view",
      attr: { "data-placeholder": "Title..." },
    });
    this.renderTextWithLinks(card.title, titleView);

    const titleInput = titleContainer.createDiv({
      cls: "ref-card-title-edit" + (this.settings.titleSoftWrap ? " ref-card-title-softwrap" : ""),
      attr: { "data-placeholder": "Title..." },
    });
    titleInput.contentEditable = "true";
    titleInput.textContent = card.title;
    titleInput.style.display = "none";

    const showTitleEdit = () => {
      titleView.style.display = "none";
      titleInput.style.display = "block";
      titleInput.focus();
      this.refreshTitleWrapLayout(topRow);
    };

    const hideTitleEdit = () => {
      titleView.style.display = "";
      titleInput.style.display = "none";
      titleView.empty();
      this.renderTextWithLinks(card.title, titleView);
      this.refreshTitleWrapLayout(topRow);
    };

    titleView.addEventListener("dblclick", showTitleEdit);
    titleInput.addEventListener("blur", hideTitleEdit);
    titleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        titleInput.blur();
      }
    });
    titleInput.addEventListener("input", () => {
      card.title = titleInput.textContent || "";
      this.refreshTitleWrapLayout(topRow);
      this.debouncedSave();
    });
    titleInput.addEventListener("paste", (e) =>
      this.handleTitlePaste(e, titleInput, card)
    );

    const insertBtn = topRow.createEl("button", { cls: "ref-card-insert-btn", text: "+" });
    insertBtn.title = "Insert reference at cursor";
    insertBtn.addEventListener("click", () => this.insertReference(card.id));

    const backlinksBtn = topRow.createEl("button", { cls: "ref-card-backlinks-btn", text: "?" });
    backlinksBtn.title = "Show files referencing this card";
    backlinksBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleBacklinksPopup(card.id, cardEl, backlinksBtn);
    });

    const deleteBtn = topRow.createEl("button", { cls: "ref-card-delete-btn", text: "×" });
    deleteBtn.title = "Delete card";
    deleteBtn.addEventListener("click", () => this.deleteCard(card.id));

    const tagsRow = cardEl.createDiv({ cls: "ref-card-tags" });
    tagsRow.createSpan({ cls: "ref-card-label", text: "Tags:" });
    const tagsInput = tagsRow.createEl("input", {
      cls: "ref-card-tags-input",
      attr: { type: "text", placeholder: "comma, separated" },
    });
    tagsInput.value = card.tags.join(", ");
    tagsInput.addEventListener("input", () => {
      card.tags = tagsInput.value
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      this.debouncedSave();
    });
    tagsInput.addEventListener("change", () => {
      this.renderHeader();
    });

    const yearRow = cardEl.createDiv({ cls: "ref-card-year" });
    yearRow.createSpan({ cls: "ref-card-label", text: "Year:" });
    const yearInput = yearRow.createEl("input", {
      cls: "ref-card-year-input",
      attr: { type: "text", placeholder: "e.g. 2024" },
    });
    yearInput.value = card.year;
    yearInput.addEventListener("input", () => {
      card.year = yearInput.value;
      this.debouncedSave();
    });

    const notesContainer = cardEl.createDiv({ cls: "ref-card-notes-container" });

    const notesView = notesContainer.createDiv({
      cls: "ref-card-notes-view",
      attr: { "data-placeholder": "Notes..." },
    });
    this.renderTextWithLinks(card.notes, notesView);

    const notesArea = notesContainer.createEl("textarea", {
      cls: "ref-card-notes-edit",
      attr: { placeholder: "Notes..." },
    });
    notesArea.value = card.notes;
    notesArea.style.display = "none";

    const showNotesEdit = () => {
      notesView.style.display = "none";
      notesArea.style.display = "block";
      notesArea.focus();
      this.resizeTextarea(notesArea);
    };

    const hideNotesEdit = () => {
      notesView.style.display = "";
      notesArea.style.display = "none";
      notesView.empty();
      this.renderTextWithLinks(card.notes, notesView);
    };

    notesView.addEventListener("dblclick", showNotesEdit);
    notesArea.addEventListener("blur", hideNotesEdit);
    notesArea.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        notesArea.blur();
      }
    });
    notesArea.addEventListener("input", () => {
      card.notes = notesArea.value;
      this.resizeTextarea(notesArea);
      this.debouncedSave();
    });

    if (this.settings.sortField === "custom") {
      this.enableCardDrag(cardEl, card);
    }
  }

  /**
   * Makes a card draggable. Only active in `custom` sort mode, where the
   * persisted array order is what the list shows, so a drop can rewrite it.
   */
  private enableCardDrag(cardEl: HTMLElement, card: ReferenceCard): void {
    cardEl.draggable = true;

    // A press that starts on a field or button must keep its normal behaviour
    // (selecting text, clicking) rather than starting a card drag.
    cardEl.addEventListener("mousedown", (e) => {
      const target = e.target as HTMLElement | null;
      this.dragBlocked = !!target?.closest(
        "input, textarea, [contenteditable='true'], a, button"
      );
    });

    cardEl.addEventListener("dragstart", (e) => {
      if (this.dragBlocked || !e.dataTransfer) {
        e.preventDefault();
        return;
      }
      this.draggedCardId = card.id;
      e.dataTransfer.effectAllowed = "move";
      // Some platforms refuse to start a drag without payload data.
      e.dataTransfer.setData("text/plain", card.id);
      cardEl.addClass("ref-card-dragging");
    });

    cardEl.addEventListener("dragend", () => {
      this.draggedCardId = null;
      this.dragBlocked = false;
      cardEl.removeClass("ref-card-dragging");
      this.clearDropMarkers();
    });
  }

  private onCardDragOver(e: DragEvent): void {
    if (!this.draggedCardId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

    const { targetId, after } = this.resolveDropPosition(e.clientY);
    if (!targetId) {
      this.clearDropMarkers();
      return;
    }
    this.showDropMarker(targetId, after);
  }

  private onCardDrop(e: DragEvent): void {
    if (!this.draggedCardId) return;
    e.preventDefault();

    const draggedId = this.draggedCardId;
    const { targetId, after } = this.resolveDropPosition(e.clientY);
    this.draggedCardId = null;
    this.clearDropMarkers();
    if (targetId) {
      void this.moveCardTo(draggedId, targetId, after);
    }
  }

  /**
   * Resolves a pointer height to the card it should be dropped before/after.
   * The dragged card is skipped so it can never target itself.
   */
  private resolveDropPosition(clientY: number): { targetId: string | null; after: boolean } {
    const cards = Array.from(
      this.cardContainer.querySelectorAll<HTMLElement>(".ref-card[data-card-id]")
    ).filter((el) => el.dataset.cardId !== this.draggedCardId);

    for (const el of cards) {
      const rect = el.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return { targetId: el.dataset.cardId ?? null, after: false };
      }
    }
    // Below the last other card: append after it.
    const last = cards[cards.length - 1]?.dataset.cardId ?? null;
    return { targetId: last, after: true };
  }

  private showDropMarker(targetId: string, after: boolean): void {
    if (this.dropTargetId === targetId && this.dropAfter === after) return;
    this.clearDropMarkers();

    const el = this.cardContainer.querySelector<HTMLElement>(
      `.ref-card[data-card-id="${CSS.escape(targetId)}"]`
    );
    if (!el) return;
    this.dropTargetId = targetId;
    this.dropAfter = after;
    el.addClass(after ? "ref-card-drop-after" : "ref-card-drop-before");
  }

  private clearDropMarkers(): void {
    this.dropTargetId = null;
    this.dropAfter = false;
    this.cardContainer
      .querySelectorAll<HTMLElement>(".ref-card-drop-before, .ref-card-drop-after")
      .forEach((el) => {
        el.removeClass("ref-card-drop-before");
        el.removeClass("ref-card-drop-after");
      });
  }

  /**
   * Moves `draggedId` next to `targetId` in the persisted array and saves, so
   * the custom order survives a reload.
   */
  private async moveCardTo(draggedId: string, targetId: string, after: boolean): Promise<void> {
    const cards = this.data.cards;
    const fromIndex = cards.findIndex((c) => c.id === draggedId);
    const targetIndexRaw = cards.findIndex((c) => c.id === targetId);
    if (fromIndex === -1 || targetIndexRaw === -1 || draggedId === targetId) return;

    const [moved] = cards.splice(fromIndex, 1);
    // Removing the dragged card shifts the target left when it sat after it.
    const targetIndex = fromIndex < targetIndexRaw ? targetIndexRaw - 1 : targetIndexRaw;
    cards.splice(after ? targetIndex + 1 : targetIndex, 0, moved);

    // The rebuild resets the list's scrollTop, so hold the position.
    const anchor = this.captureScrollAnchor(null);
    await this.saveData();
    this.renderCards();
    this.restoreScrollAnchor(anchor);
  }

  /**
   * Turns a pasted link into a markdown link in the Title field.
   *
   * Pasting a bare URL — or a single link copied from a browser page — fetches
   * the page title and inserts `[title](url)`. The clipboard text is shown
   * immediately inside a temporary span and upgraded in place once the title
   * arrives, so a slow or failed lookup still leaves a usable value. Anything
   * that is not exactly one web link keeps the editor's default paste.
   */
  private handleTitlePaste(e: ClipboardEvent, titleInput: HTMLElement, card: ReferenceCard): void {
    if (!this.settings.fetchLinkTitles) return;
    const clipboard = e.clipboardData;
    if (!clipboard) return;

    const text = clipboard.getData("text/plain") || "";
    // Already a markdown link (pasted markdown source): leave it untouched.
    if (isMarkdownLink(text)) return;

    const link = extractPastedLink(text, clipboard.getData("text/html") || null);
    if (!link) return;

    e.preventDefault();

    // A clipboard label reads better than a raw URL while the title is in
    // flight, and is the fallback when the page cannot be read.
    const fallback =
      link.label && !/^https?:\/\//i.test(link.label)
        ? buildMarkdownLink(link.label, link.url)
        : link.url;

    const pending = document.createElement("span");
    pending.className = "ref-card-title-pending";
    pending.textContent = fallback;
    this.insertIntoEditable(titleInput, pending);

    fetchLinkTitle(link.url).then((title) => {
      // The user may have deleted the pasted text (or the card) meanwhile.
      if (!pending.isConnected || !title) return;
      pending.textContent = buildMarkdownLink(title, link.url);
      // The field's own input handling copies the text onto the card and saves.
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
      // If editing already ended (or the panel re-rendered), repaint the view.
      this.refreshRenderedTitle(card);
    });
  }

  /**
   * Inserts plain text (as a node) at the caret of a contentEditable and runs
   * the field's `input` handling. Using Range directly instead of a normal
   * paste keeps rich clipboard HTML — which previously dropped the link's
   * href — out of the field.
   */
  private insertIntoEditable(el: HTMLElement, node: Node): void {
    el.focus();
    const selection = window.getSelection();
    const range =
      selection && selection.rangeCount > 0 && el.contains(selection.anchorNode)
        ? selection.getRangeAt(0)
        : null;

    if (range && selection) {
      range.deleteContents();
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      el.appendChild(node);
    }

    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /**
   * Repaints a card's rendered title from `card.title` (used after an async
   * title lookup lands while the field is back in view mode, or after a
   * re-render replaced the element the paste started in).
   */
  private refreshRenderedTitle(card: ReferenceCard): void {
    const cardEl = this.cardContainer.querySelector<HTMLElement>(
      `.ref-card[data-card-id="${card.id}"]`
    );
    if (!cardEl) return;
    const titleInput = cardEl.querySelector<HTMLElement>(".ref-card-title-edit");
    // While editing, the input already shows the updated text.
    if (titleInput && titleInput.style.display !== "none") return;

    const titleView = cardEl.querySelector<HTMLElement>(".ref-card-title-view");
    if (!titleView) return;
    titleView.empty();
    this.renderTextWithLinks(card.title, titleView);

    const topRow = cardEl.querySelector<HTMLElement>(".ref-card-top");
    if (topRow) this.refreshTitleWrapLayout(topRow);
  }

  /**
   * Soft-wrapped titles that span more than three lines are hard to read in a
   * narrow panel: the `[id]` badge and the action buttons get vertically
   * centered next to a tall block of text. For those cards, move `[id]` and the
   * buttons to a top row and let the title use the full card width underneath.
   */
  private refreshAllTitleWrapLayouts(): void {
    const topRows = Array.from(this.cardContainer.querySelectorAll<HTMLElement>(".ref-card-top"));

    // Always measure in the default inline layout. Measuring a full-width
    // multiline title would report fewer lines and make the class flip back and
    // forth (4 lines inline -> 3 lines full width -> 4 lines inline -> ...).
    for (const topRow of topRows) {
      topRow.removeClass("ref-card-top-multiline");
    }

    if (!this.settings.titleSoftWrap) return;

    for (const topRow of topRows) {
      this.applyTitleWrapLayout(topRow);
    }
  }

  private refreshTitleWrapLayout(topRow: HTMLElement): void {
    topRow.removeClass("ref-card-top-multiline");
    if (this.settings.titleSoftWrap) {
      this.applyTitleWrapLayout(topRow);
    }
  }

  private applyTitleWrapLayout(topRow: HTMLElement): void {
    const titleView = topRow.querySelector<HTMLElement>(".ref-card-title-view");
    const titleInput = topRow.querySelector<HTMLElement>(".ref-card-title-edit");
    const visibleTitle = titleInput && titleInput.style.display !== "none" ? titleInput : titleView;
    if (!visibleTitle) return;
    if (this.countTitleLines(visibleTitle) > 3) {
      topRow.addClass("ref-card-top-multiline");
    }
  }

  private countTitleLines(el: HTMLElement): number {
    const style = window.getComputedStyle(el);
    let lineHeight = parseFloat(style.lineHeight);
    if (!lineHeight || Number.isNaN(lineHeight)) {
      lineHeight = (parseFloat(style.fontSize) || 13) * 1.4;
    }
    if (lineHeight <= 0) return 1;

    const rect = el.getBoundingClientRect();
    const paddingY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const borderY = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
    const contentHeight = rect.height - paddingY - borderY;
    if (contentHeight <= 0) return 1;
    return Math.max(1, Math.round(contentHeight / lineHeight));
  }

  private resizeTextarea(textarea: HTMLTextAreaElement): void {
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + "px";
  }

  private toggleBacklinksPopup(cardId: string, cardEl: HTMLElement, btnEl: HTMLElement): void {
    if (this.activeBacklinksPopup) {
      const wasSame = this.activeBacklinksPopup.dataset.cardId === cardId;
      this.closeBacklinksPopup();
      if (wasSame) return;
    }

    const popup = cardEl.createDiv({ cls: "ref-card-backlinks-popup" });
    const btnRect = btnEl.getBoundingClientRect();
    const cardRect = cardEl.getBoundingClientRect();
    popup.style.top = (btnRect.bottom - cardRect.top + 4) + "px";
    popup.style.left = "0";
    popup.dataset.cardId = cardId;
    popup.createDiv({ cls: "ref-card-backlinks-loading", text: "Searching..." });
    this.activeBacklinksPopup = popup;

    this.findReferencingFiles(cardId, () => this.activeBacklinksPopup !== popup).then((matches) => {
      if (!this.activeBacklinksPopup || this.activeBacklinksPopup !== popup) return;
      popup.empty();

      if (matches.length === 0) {
        popup.createDiv({ cls: "ref-card-backlinks-empty", text: "No references found" });
      } else {
        for (const path of matches) {
          const basename = path.replace(/\.md$/, "");
          const link = popup.createEl("a", {
            cls: "ref-card-backlinks-link",
            text: `[[${basename}]]`,
          });
          link.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.closeBacklinksPopup();
            this.app.workspace.openLinkText(path, "", false);
          });
        }
      }
    });

    const onDocClick = (e: MouseEvent) => {
      if (!popup.contains(e.target as Node)) {
        this.closeBacklinksPopup();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        this.closeBacklinksPopup();
      }
    };
    this.activeBacklinksCleanup = () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
    setTimeout(() => {
      document.addEventListener("click", onDocClick);
      document.addEventListener("keydown", onKey);
    }, 0);
  }

  private async findReferencingFiles(
    cardId: string,
    isCancelled: () => boolean = () => false
  ): Promise<string[]> {
    const pattern = new RegExp(`\\{${escapeRegExp(cardId)}\\}`);
    const mdFiles = this.app.vault.getMarkdownFiles();
    const matches: string[] = [];
    for (const file of mdFiles) {
      if (isCancelled()) return matches;
      // cachedRead avoids disk IO per file; maskProtectedRegions blanks out
      // math/code so `{1}` inside LaTeX or a code block is not counted.
      const content = await this.app.vault.cachedRead(file);
      if (pattern.test(maskProtectedRegions(content))) {
        matches.push(file.path);
      }
    }
    return matches;
  }

  private closeBacklinksPopup(): void {
    if (this.activeBacklinksCleanup) {
      this.activeBacklinksCleanup();
      this.activeBacklinksCleanup = null;
    }
    if (this.activeBacklinksPopup) {
      this.activeBacklinksPopup.remove();
      this.activeBacklinksPopup = null;
    }
  }

  private renderTextWithLinks(text: string, container: HTMLElement): void {
    const urlRegex = /(https?:\/\/[^\s<]+[^<.,;:"'\s])/g;
    const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
    const mdLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

    const parts: { text: string; type: 'text' | 'url' | 'wikilink' | 'mdlink'; url?: string }[] = [];
    let lastIndex = 0;

    // Find URLs
    let match: RegExpExecArray | null;
    const urlMatches: { start: number; end: number; url: string }[] = [];
    while ((match = urlRegex.exec(text)) !== null) {
      urlMatches.push({ start: match.index, end: match.index + match[0].length, url: match[0] });
    }

    // Find wiki links
    const wikiMatches: { start: number; end: number; link: string }[] = [];
    while ((match = wikiLinkRegex.exec(text)) !== null) {
      wikiMatches.push({ start: match.index, end: match.index + match[0].length, link: match[1] });
    }

    // Find markdown links
    const mdMatches: { start: number; end: number; label: string; url: string }[] = [];
    while ((match = mdLinkRegex.exec(text)) !== null) {
      mdMatches.push({ start: match.index, end: match.index + match[0].length, label: match[1], url: match[2] });
    }

    // Merge all matches and sort by position
    const allMatches: { start: number; end: number; type: 'url' | 'wikilink' | 'mdlink'; value: string; label?: string }[] = [];
    for (const m of urlMatches) {
      allMatches.push({ start: m.start, end: m.end, type: 'url', value: m.url });
    }
    for (const m of wikiMatches) {
      allMatches.push({ start: m.start, end: m.end, type: 'wikilink', value: m.link });
    }
    for (const m of mdMatches) {
      allMatches.push({ start: m.start, end: m.end, type: 'mdlink', value: m.url, label: m.label });
    }
    allMatches.sort((a, b) => a.start - b.start);

    // Remove overlapping matches (prefer earlier matches)
    const filteredMatches: typeof allMatches = [];
    let lastEnd = 0;
    for (const m of allMatches) {
      if (m.start >= lastEnd) {
        filteredMatches.push(m);
        lastEnd = m.end;
      }
    }

    // Build parts
    for (const m of filteredMatches) {
      if (m.start > lastIndex) {
        parts.push({ text: text.slice(lastIndex, m.start), type: 'text' });
      }
      if (m.type === 'wikilink') {
        parts.push({ text: `[[${m.value}]]`, type: 'wikilink', url: m.value });
      } else if (m.type === 'mdlink') {
        parts.push({ text: m.label!, type: 'mdlink', url: m.value });
      } else {
        parts.push({ text: m.value, type: 'url', url: m.value });
      }
      lastIndex = m.end;
    }
    if (lastIndex < text.length) {
      parts.push({ text: text.slice(lastIndex), type: 'text' });
    }

    // Render parts
    for (const part of parts) {
      if (part.type === 'text') {
        container.createSpan({ text: part.text });
      } else if (part.type === 'url' || part.type === 'mdlink') {
        const href = part.url ?? "";
        // Only open real web links; ignore javascript:/file: etc.
        if (!/^https?:\/\//i.test(href)) {
          container.createSpan({ text: part.text });
          continue;
        }
        const link = container.createEl('a', {
          cls: 'ref-card-link ref-card-url-link',
          text: part.text,
          href,
        });
        link.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          window.open(href, '_blank');
        });
      } else if (part.type === 'wikilink') {
        const link = container.createEl('a', {
          cls: 'ref-card-link ref-card-wikilink',
          text: part.text,
        });
        link.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          // Strip the display-text alias: [[link|alias]] -> link
          const target = part.url!.split("|")[0].trim();
          const file = this.app.metadataCache.getFirstLinkpathDest(target, '');
          if (file) {
            this.app.workspace.openLinkText(file.path, '', false);
          }
        });
      }
    }
  }

  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private debouncedSave(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.saveData();
    }, 500);
  }

  async addCard(): Promise<void> {
    const existing = new Set(this.data.cards.map((c) => c.id));
    const card = createEmptyCard(generateCardId(existing));
    this.data.cards.push(card);
    await this.saveData();
    this.renderCards();
    this.renderHeader();

    const cardEl = this.cardContainer.querySelector<HTMLElement>(
      `[data-card-id="${CSS.escape(card.id)}"]`
    );
    if (!cardEl) return;

    // Establish the card's final on-screen position before animating, then fly
    // a copy of it in from the "+" button.
    cardEl.scrollIntoView({ behavior: "auto", block: "center" });
    const addBtn = this.headerEl.querySelector<HTMLElement>(".ref-cards-add-btn");
    const enterEdit = () => this.focusCardTitle(cardEl);

    if (addBtn && !this.prefersReducedMotion()) {
      this.animateCardArrival(cardEl, addBtn, enterEdit);
    } else {
      enterEdit();
    }
  }

  private focusCardTitle(cardEl: HTMLElement): void {
    // Enter edit mode on the fresh card (showTitleEdit is bound to dblclick).
    cardEl
      .querySelector<HTMLElement>(".ref-card-title-view")
      ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  }

  private prefersReducedMotion(): boolean {
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  /**
   * Flies a non-interactive copy of `cardEl` from `fromEl` to the card's current
   * position (mirrors the `scrollToCard` highlight pattern). The real card keeps
   * its slot but stays hidden until the copy lands, then is revealed and
   * `onDone` runs once.
   */
  private animateCardArrival(cardEl: HTMLElement, fromEl: HTMLElement, onDone: () => void): void {
    const cardRect = cardEl.getBoundingClientRect();
    const fromRect = fromEl.getBoundingClientRect();

    // Nothing to animate (hidden layout / detached element): fail soft.
    if (cardRect.width === 0 || cardRect.height === 0 || fromRect.width === 0) {
      onDone();
      return;
    }

    const ghost = cardEl.cloneNode(true) as HTMLElement;
    ghost.addClass("ref-card-ghost");
    ghost.style.left = `${cardRect.left}px`;
    ghost.style.top = `${cardRect.top}px`;
    ghost.style.width = `${cardRect.width}px`;
    ghost.style.height = `${cardRect.height}px`;
    document.body.appendChild(ghost);
    cardEl.addClass("ref-card-arriving");

    // Offset that moves the ghost's centre onto the source element's centre.
    const dx = fromRect.left + fromRect.width / 2 - (cardRect.left + cardRect.width / 2);
    const dy = fromRect.top + fromRect.height / 2 - (cardRect.top + cardRect.height / 2);

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      ghost.remove();
      cardEl.removeClass("ref-card-arriving");
      onDone();
    };

    const animation = ghost.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(0.3)`, opacity: 0.2 },
        { transform: "translate(0, 0) scale(1)", opacity: 1 },
      ],
      { duration: 340, easing: "cubic-bezier(0.22, 0.9, 0.3, 1)", fill: "forwards" }
    );
    animation.onfinish = finish;
    animation.oncancel = finish;
  }

  async deleteCard(id: string): Promise<void> {
    this.deleteRedoSnapshot = null;
    const deletedIndex = this.data.cards.findIndex((c) => c.id === id);
    if (deletedIndex === -1) return;

    const deletedCard = {
      ...this.data.cards[deletedIndex],
      tags: [...this.data.cards[deletedIndex].tags],
    };

    // IDs are stable: deleting never renumbers the remaining cards and never
    // rewrites notes. Any `{id}` markers for this card are simply left alone —
    // the ID is never reused, so they can never point at a different card.
    this.deleteSnapshot = { deletedCard, deletedIndex };
    this.data.cards.splice(deletedIndex, 1);

    await this.saveData();
    // Capture right before the rebuild: deleting re-renders every card and
    // would otherwise reset the panel's scroll position.
    const anchor = this.captureScrollAnchor(id);
    this.renderCards();
    this.renderHeader();
    this.restoreScrollAnchor(anchor);

    // Show notice with undo option
    const notice = new Notice(
      `Deleted card [${deletedCard.id}] "${deletedCard.title}". Click to undo.`,
      8000
    );
    notice.noticeEl.addEventListener("click", () => {
      this.undoDelete();
      notice.hide();
    });
    notice.noticeEl.style.cursor = "pointer";
  }

  async undoDelete(): Promise<void> {
    if (!this.deleteSnapshot) return;

    const { deletedCard, deletedIndex } = this.deleteSnapshot;
    this.deleteRedoSnapshot = { cardId: deletedCard.id };

    const index = Math.min(deletedIndex, this.data.cards.length);
    this.data.cards.splice(index, 0, deletedCard);
    this.deleteSnapshot = null;

    await this.saveData();
    // Undoing also re-renders the list, so hold the scroll position too.
    const anchor = this.captureScrollAnchor(null);
    this.renderCards();
    this.renderHeader();
    this.restoreScrollAnchor(anchor);

    new Notice("Delete undone.", 3000);
  }

  async redoDelete(): Promise<void> {
    if (!this.deleteRedoSnapshot) return;

    const { cardId } = this.deleteRedoSnapshot;
    this.deleteRedoSnapshot = null;
    await this.deleteCard(cardId);
  }

  insertReference(id: string): void {
    const mdView = this.getLastMarkdownView();
    if (!mdView) return;
    const editor = mdView.editor;
    const cursor = editor.getCursor();
    editor.replaceRange(`{${id}}`, cursor);
    editor.setCursor({ line: cursor.line, ch: cursor.ch + id.length + 2 });
  }

  scrollToCard(id: string): void {
    const card = this.data.cards.find((c) => c.id === id);
    if (!card) return;

    // If the card is hidden by the tag filter or search, clear both so the
    // scroll target actually exists.
    let needsRender = false;
    if (this.filterTag && !card.tags.includes(this.filterTag)) {
      this.filterTag = "";
      needsRender = true;
    }
    if (this.searchQuery) {
      this.searchQuery = "";
      const searchInput = this.contentEl.querySelector<HTMLInputElement>(".ref-cards-search-input");
      if (searchInput) searchInput.value = "";
      needsRender = true;
    }
    if (needsRender) {
      this.renderCards();
      this.renderHeader();
    }

    const cardEl = this.cardContainer.querySelector<HTMLElement>(
      `[data-card-id="${CSS.escape(id)}"]`
    );
    if (!cardEl) return;

    // Scroll into view
    cardEl.scrollIntoView({ behavior: "smooth", block: "center" });

    // Highlight with pulse effect
    cardEl.removeClass("ref-card-highlight");
    // Force reflow so re-adding the class restarts the animation
    void cardEl.offsetWidth;
    cardEl.addClass("ref-card-highlight");
    setTimeout(() => {
      cardEl.removeClass("ref-card-highlight");
    }, 2000);
  }

  renderAll(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.style.setProperty("--ref-card-font-size", this.settings.cardFontSize + "px");
    this.renderHeader();
    this.renderCards();
  }
}
