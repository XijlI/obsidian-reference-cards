import { ItemView, WorkspaceLeaf, App, MarkdownView, MarkdownRenderer, Notice, setIcon } from "obsidian";
import { ReferenceCard, PluginData, createEmptyCard, getAllTags } from "./data";
import { ReferenceCardsSettings } from "./settings";

export const VIEW_TYPE = "reference-cards-view";

interface ReindexSnapshot {
  cards: ReferenceCard[];
  nextId: number;
  idMap: Map<number, number>; // old_id -> new_id
}

interface DeleteSnapshot {
  deletedCard: ReferenceCard;
  deletedIndex: number;
  oldCards: ReferenceCard[];
  oldNextId: number;
  idMap: Map<number, number>;
  fileChanges: { path: string; originalContent: string }[];
}

export class ReferenceCardView extends ItemView {
  private data: PluginData;
  private saveData: () => Promise<void>;
  private getLastMarkdownView: () => MarkdownView | null;
  private settings: ReferenceCardsSettings;
  private filterTag: string = "";
  private searchQuery: string = "";
  private sortField: "index" | "title" | "year" = "index";
  private sortAscending: boolean = true;
  private cardContainer: HTMLElement;
  private headerEl: HTMLElement;
  private reindexSnapshot: ReindexSnapshot | null = null;
  private reindexRedoSnapshot: ReindexSnapshot | null = null;
  private deleteSnapshot: DeleteSnapshot | null = null;
  private deleteRedoSnapshot: { cardId: number } | null = null;
  private activeBacklinksPopup: HTMLElement | null = null;
  private activeBacklinksCleanup: (() => void) | null = null;
  private titleLayoutObserver: ResizeObserver | null = null;
  private lastTitleLayoutWidth = -1;

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
    sortSelect.createEl("option", { text: "Index", value: "index" });
    sortSelect.createEl("option", { text: "Title", value: "title" });
    sortSelect.createEl("option", { text: "Year", value: "year" });
    sortSelect.value = this.sortField;
    sortSelect.addEventListener("change", () => {
      this.sortField = sortSelect.value as "index" | "title" | "year";
      this.renderCards();
    });

    const orderBtn = sortRow.createEl("button", {
      cls: "ref-cards-order-btn",
      text: this.sortAscending ? "↑" : "↓",
    });
    orderBtn.title = this.sortAscending ? "Ascending" : "Descending";
    orderBtn.addEventListener("click", () => {
      this.sortAscending = !this.sortAscending;
      orderBtn.textContent = this.sortAscending ? "↑" : "↓";
      orderBtn.title = this.sortAscending ? "Ascending" : "Descending";
      this.renderCards();
    });

    const reindexBtn = sortRow.createEl("button", {
      cls: "ref-cards-sort-btn ref-cards-sort-btn-icon",
    });
    setIcon(reindexBtn, "refresh-cw");
    reindexBtn.title = "Reindex cards by order in current file";
    reindexBtn.addEventListener("click", () => this.reindex());

    const undoBtn = sortRow.createEl("button", {
      cls: "ref-cards-sort-btn ref-cards-sort-btn-icon" + (!this.reindexSnapshot && !this.reindexRedoSnapshot ? " ref-cards-sort-btn-disabled" : ""),
    });
    if (this.reindexRedoSnapshot) {
      setIcon(undoBtn, "redo-2");
      undoBtn.title = "Redo last reindex";
      undoBtn.disabled = false;
      undoBtn.addEventListener("click", () => this.redoReindex());
    } else {
      setIcon(undoBtn, "undo-2");
      undoBtn.title = "Undo last reindex";
      undoBtn.disabled = !this.reindexSnapshot;
      undoBtn.addEventListener("click", () => this.undoReindex());
    }

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

    let filtered = this.filterTag
      ? this.data.cards.filter((c) => c.tags.includes(this.filterTag))
      : this.data.cards;

    if (this.searchQuery) {
      filtered = filtered.filter((c) => {
        const haystack = [c.title, c.tags.join(" "), c.year, c.notes].join(" ").toLowerCase();
        return haystack.includes(this.searchQuery);
      });
    }

    filtered.sort((a, b) => {
      let cmp = 0;
      if (this.sortField === "index") {
        cmp = a.id - b.id;
      } else if (this.sortField === "title") {
        cmp = a.title.localeCompare(b.title);
      } else if (this.sortField === "year") {
        const ya = parseInt(a.year) || 0;
        const yb = parseInt(b.year) || 0;
        cmp = ya - yb;
      }
      return this.sortAscending ? cmp : -cmp;
    });

    for (const card of filtered) {
      this.renderCard(card);
    }

    this.refreshAllTitleWrapLayouts();
  }

  private renderCard(card: ReferenceCard): void {
    const cardEl = this.cardContainer.createDiv({ cls: "ref-card", attr: { "data-card-id": String(card.id) } });

    const topRow = cardEl.createDiv({ cls: "ref-card-top" });

    const idBadge = topRow.createSpan({ cls: "ref-card-id", text: `[${card.id}]` });

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
  }

  /**
   * Soft-wrapped titles that span more than two lines are hard to read in a
   * narrow panel: the `[id]` badge and the action buttons get vertically
   * centered next to a tall block of text. For those cards, move `[id]` and the
   * buttons to a top row and let the title use the full card width underneath.
   */
  private refreshAllTitleWrapLayouts(): void {
    const topRows = Array.from(this.cardContainer.querySelectorAll<HTMLElement>(".ref-card-top"));

    // Always measure in the default inline layout. Measuring a full-width
    // multiline title would report fewer lines and make the class flip back and
    // forth (3 lines inline -> 2 lines full width -> 3 lines inline -> ...).
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
    if (this.countTitleLines(visibleTitle) > 2) {
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

  private toggleBacklinksPopup(cardId: number, cardEl: HTMLElement, btnEl: HTMLElement): void {
    if (this.activeBacklinksPopup) {
      const wasSame = this.activeBacklinksPopup.dataset.cardId === String(cardId);
      this.closeBacklinksPopup();
      if (wasSame) return;
    }

    const popup = cardEl.createDiv({ cls: "ref-card-backlinks-popup" });
    const btnRect = btnEl.getBoundingClientRect();
    const cardRect = cardEl.getBoundingClientRect();
    popup.style.top = (btnRect.bottom - cardRect.top + 4) + "px";
    popup.style.left = "0";
    popup.dataset.cardId = String(cardId);
    popup.createDiv({ cls: "ref-card-backlinks-loading", text: "Searching..." });
    this.activeBacklinksPopup = popup;

    this.findReferencingFiles(cardId).then((matches) => {
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

  private async findReferencingFiles(cardId: number): Promise<string[]> {
    const pattern = new RegExp(`\\{${cardId}\\}`);
    const mdFiles = this.app.vault.getMarkdownFiles();
    const matches: string[] = [];
    for (const file of mdFiles) {
      const content = await this.app.vault.read(file);
      const stripped = content
        .replace(/\$\$[\s\S]*?\$\$/g, "")
        .replace(/\$[^$\n]+?\$/g, "")
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`[^`\n]+?`/g, "");
      if (pattern.test(stripped)) {
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

  private replaceRefsOutsideProtected(
    content: string,
    replacer: (idStr: string) => string
  ): string {
    const protectedRanges: { start: number; end: number }[] = [];
    const patterns = [
      /\$\$[\s\S]*?\$\$/g,
      /\$[^$\n]+?\$/g,
      /```[\s\S]*?```/g,
      /`[^`\n]+?`/g,
    ];
    for (const pat of patterns) {
      let m: RegExpExecArray | null;
      while ((m = pat.exec(content)) !== null) {
        protectedRanges.push({ start: m.index, end: m.index + m[0].length });
      }
    }
    protectedRanges.sort((a, b) => a.start - b.start);

    const refPat = /\{(\d+)\}/g;
    let result = "";
    let lastIdx = 0;
    let refM: RegExpExecArray | null;
    while ((refM = refPat.exec(content)) !== null) {
      const inProtected = protectedRanges.some(
        (r) => refM!.index >= r.start && refM!.index < r.end
      );
      if (inProtected) continue;
      result += content.slice(lastIdx, refM.index);
      result += replacer(refM[1]);
      lastIdx = refM.index + refM[0].length;
    }
    result += content.slice(lastIdx);
    return result;
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
        const link = container.createEl('a', {
          cls: 'ref-card-link ref-card-url-link',
          text: part.text,
          href: part.url,
        });
        link.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          window.open(part.url, '_blank');
        });
      } else if (part.type === 'wikilink') {
        const link = container.createEl('a', {
          cls: 'ref-card-link ref-card-wikilink',
          text: part.text,
        });
        link.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const file = this.app.metadataCache.getFirstLinkpathDest(part.url!, '');
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
    const card = createEmptyCard(this.data.nextId++);
    this.data.cards.push(card);
    await this.saveData();
    this.renderCards();
    this.renderHeader();

    const cardEl = this.cardContainer.querySelector(`[data-card-id="${card.id}"]`);
    if (cardEl) {
      cardEl.scrollIntoView({ behavior: "smooth", block: "center" });
      const titleInput = cardEl.querySelector(".ref-card-title-input") as HTMLElement;
      if (titleInput) titleInput.focus();
    }
  }

  async deleteCard(id: number): Promise<void> {
    this.deleteRedoSnapshot = null;
    const deletedIndex = this.data.cards.findIndex((c) => c.id === id);
    if (deletedIndex === -1) return;

    const deletedCard = { ...this.data.cards[deletedIndex], tags: [...this.data.cards[deletedIndex].tags] };
    const oldCards = this.data.cards.map((c) => ({ ...c, tags: [...c.tags] }));
    const oldNextId = this.data.nextId;

    this.data.cards.splice(deletedIndex, 1);

    // Build old_id -> new_id map for continuous indexing
    const idMap = new Map<number, number>();
    this.data.cards.forEach((card, index) => {
      const newId = index + 1;
      if (card.id !== newId) {
        idMap.set(card.id, newId);
        card.id = newId;
      }
    });
    this.data.nextId = this.data.cards.length + 1;

    // Update markdown references in all vault files
    const fileChanges: { path: string; originalContent: string }[] = [];
    if (idMap.size > 0) {
      const mdFiles = this.app.vault.getMarkdownFiles();
      for (const file of mdFiles) {
        const content = await this.app.vault.read(file);
        if (!/\{\d+\}/.test(content)) continue;

        const newContent = this.replaceRefsOutsideProtected(content, (idStr) => {
          const oldId = parseInt(idStr, 10);
          const newId = idMap.get(oldId);
          return newId !== undefined ? `{${newId}}` : `{${oldId}}`;
        });

        if (newContent !== content) {
          fileChanges.push({ path: file.path, originalContent: content });
          await this.app.vault.modify(file, newContent);
        }
      }
    }

    // Save snapshot for undo
    this.deleteSnapshot = {
      deletedCard,
      deletedIndex,
      oldCards,
      oldNextId,
      idMap,
      fileChanges,
    };

    await this.saveData();
    this.renderCards();
    this.renderHeader();

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

    const { deletedCard, deletedIndex, oldCards, oldNextId, idMap, fileChanges } = this.deleteSnapshot;

    // Save redo snapshot with the card id to re-delete
    this.deleteRedoSnapshot = { cardId: deletedCard.id };

    // Restore card data
    this.data.cards = oldCards;
    this.data.nextId = oldNextId;

    // Build reverse map: new_id -> old_id
    const reverseMap = new Map<number, number>();
    for (const [oldId, newId] of idMap) {
      reverseMap.set(newId, oldId);
    }

    // Restore file contents
    for (const change of fileChanges) {
      const file = this.app.vault.getAbstractFileByPath(change.path);
      if (file) {
        const content = await this.app.vault.read(file as any);
        const restoredContent = this.replaceRefsOutsideProtected(content, (idStr) => {
          const curId = parseInt(idStr, 10);
          const origId = reverseMap.get(curId);
          return origId !== undefined ? `{${origId}}` : `{${curId}}`;
        });
        await this.app.vault.modify(file as any, restoredContent);
      }
    }

    this.deleteSnapshot = null;

    await this.saveData();
    this.renderCards();
    this.renderHeader();

    new Notice("Delete undone.", 3000);
  }

  async redoReindex(): Promise<void> {
    if (!this.reindexRedoSnapshot) return;

    const mdView = this.getLastMarkdownView();
    if (!mdView) return;

    const { cards, nextId, idMap } = this.reindexRedoSnapshot;

    // Save undo snapshot with current state (before redo)
    this.reindexSnapshot = {
      cards: this.data.cards.map((c) => ({ ...c, tags: [...c.tags] })),
      nextId: this.data.nextId,
      idMap,
    };

    // Apply the reindex using the idMap
    const editor = mdView.editor;
    const content = editor.getValue();
    const newContent = this.replaceRefsOutsideProtected(content, (idStr) => {
      const oldId = parseInt(idStr, 10);
      const newId = idMap.get(oldId);
      return newId !== undefined ? `{${newId}}` : `{${oldId}}`;
    });
    editor.setValue(newContent);

    // Restore reindexed card data
    this.data.cards = cards;
    this.data.nextId = nextId;
    this.reindexRedoSnapshot = null;

    await this.saveData();
    this.renderAll();
  }

  async redoDelete(): Promise<void> {
    if (!this.deleteRedoSnapshot) return;

    const { cardId } = this.deleteRedoSnapshot;
    this.deleteRedoSnapshot = null;
    await this.deleteCard(cardId);
  }

  insertReference(id: number): void {
    const mdView = this.getLastMarkdownView();
    if (!mdView) return;
    const editor = mdView.editor;
    const cursor = editor.getCursor();
    editor.replaceRange(`{${id}}`, cursor);
    editor.setCursor({ line: cursor.line, ch: cursor.ch + String(id).length + 2 });
  }

  scrollToCard(id: number): void {
    // If card is filtered out, clear filter and re-render
    const card = this.data.cards.find((c) => c.id === id);
    if (!card) return;
    if (this.filterTag && !card.tags.includes(this.filterTag)) {
      this.filterTag = "";
      this.renderCards();
      this.renderHeader();
    }

    const cardEl = this.cardContainer.querySelector(`[data-card-id="${id}"]`);
    if (!cardEl) return;

    // Scroll into view
    cardEl.scrollIntoView({ behavior: "smooth", block: "center" });

    // Highlight with pulse effect
    cardEl.removeClass("ref-card-highlight");
    // Force reflow so re-adding the class restarts the animation
    void (cardEl as HTMLElement).offsetWidth;
    cardEl.addClass("ref-card-highlight");
    setTimeout(() => {
      cardEl.removeClass("ref-card-highlight");
    }, 2000);
  }

  updateData(data: PluginData): void {
    this.data = data;
  }

  renderAll(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.style.setProperty("--ref-card-font-size", this.settings.cardFontSize + "px");
    this.renderHeader();
    this.renderCards();
  }

  async reindex(): Promise<void> {
    this.reindexRedoSnapshot = null;
    const mdView = this.getLastMarkdownView();
    if (!mdView) return;

    const editor = mdView.editor;
    const content = editor.getValue();

    // Collect ids in order of first appearance (outside math/code)
    const seen = new Set<number>();
    const orderedIds: number[] = [];
    const stripped = content
      .replace(/\$\$[\s\S]*?\$\$/g, "")
      .replace(/\$[^$\n]+?\$/g, "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`[^`\n]+?`/g, "");
    const refRegex = /\{(\d+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = refRegex.exec(stripped)) !== null) {
      const id = parseInt(match[1], 10);
      if (!seen.has(id)) {
        seen.add(id);
        orderedIds.push(id);
      }
    }

    // Append cards not mentioned, in their current order
    for (const card of this.data.cards) {
      if (!seen.has(card.id)) {
        orderedIds.push(card.id);
      }
    }

    // Build old_id -> new_id map
    const idMap = new Map<number, number>();
    for (let i = 0; i < orderedIds.length; i++) {
      idMap.set(orderedIds[i], i + 1);
    }

    // Save snapshot for undo
    this.reindexSnapshot = {
      cards: this.data.cards.map((c) => ({ ...c, tags: [...c.tags] })),
      nextId: this.data.nextId,
      idMap,
    };

    // Update markdown references
    const newContent = this.replaceRefsOutsideProtected(content, (idStr) => {
      const oldId = parseInt(idStr, 10);
      const newId = idMap.get(oldId);
      return newId !== undefined ? `{${newId}}` : `{${oldId}}`;
    });
    editor.setValue(newContent);

    // Update card ids
    for (const card of this.data.cards) {
      const newId = idMap.get(card.id);
      if (newId !== undefined) {
        card.id = newId;
      }
    }
    this.data.nextId = orderedIds.length + 1;

    await this.saveData();
    this.renderAll();
  }

  async undoReindex(): Promise<void> {
    if (!this.reindexSnapshot) return;

    const mdView = this.getLastMarkdownView();
    if (!mdView) return;

    // Save redo snapshot with current state (after reindex) and the idMap
    this.reindexRedoSnapshot = {
      cards: this.data.cards.map((c) => ({ ...c, tags: [...c.tags] })),
      nextId: this.data.nextId,
      idMap: this.reindexSnapshot.idMap,
    };

    // Build reverse map: new_id -> old_id
    const reverseMap = new Map<number, number>();
    for (const [oldId, newId] of this.reindexSnapshot.idMap) {
      reverseMap.set(newId, oldId);
    }

    // Update markdown references back
    const editor = mdView.editor;
    const content = editor.getValue();
    const newContent = this.replaceRefsOutsideProtected(content, (idStr) => {
      const curId = parseInt(idStr, 10);
      const origId = reverseMap.get(curId);
      return origId !== undefined ? `{${origId}}` : `{${curId}}`;
    });
    editor.setValue(newContent);

    // Restore card data
    this.data.cards = this.reindexSnapshot.cards;
    this.data.nextId = this.reindexSnapshot.nextId;
    this.reindexSnapshot = null;

    await this.saveData();
    this.renderAll();
  }
}
