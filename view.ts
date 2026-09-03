import { ItemView, WorkspaceLeaf, App, MarkdownView, MarkdownRenderer, Notice } from "obsidian";
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
  private deleteSnapshot: DeleteSnapshot | null = null;

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
  }

  async onClose(): Promise<void> {
    // cleanup
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
      cls: "ref-cards-sort-btn",
      text: "Reindex",
    });
    reindexBtn.title = "Reindex cards by order in current file";
    reindexBtn.addEventListener("click", () => this.reindex());

    const undoBtn = sortRow.createEl("button", {
      cls: "ref-cards-sort-btn" + (this.reindexSnapshot ? "" : " ref-cards-sort-btn-disabled"),
      text: "Undo",
    });
    undoBtn.title = "Undo last reindex";
    undoBtn.disabled = !this.reindexSnapshot;
    undoBtn.addEventListener("click", () => this.undoReindex());

    const undoDeleteBtn = sortRow.createEl("button", {
      cls: "ref-cards-sort-btn" + (this.deleteSnapshot ? "" : " ref-cards-sort-btn-disabled"),
      text: "Undo Delete",
    });
    undoDeleteBtn.title = "Undo last card deletion";
    undoDeleteBtn.disabled = !this.deleteSnapshot;
    undoDeleteBtn.addEventListener("click", () => this.undoDelete());
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
    };

    const hideTitleEdit = () => {
      titleView.style.display = "";
      titleInput.style.display = "none";
      titleView.empty();
      this.renderTextWithLinks(card.title, titleView);
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
      this.debouncedSave();
    });

    const insertBtn = topRow.createEl("button", { cls: "ref-card-insert-btn", text: "+" });
    insertBtn.title = "Insert reference at cursor";
    insertBtn.addEventListener("click", () => this.insertReference(card.id));

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

  private resizeTextarea(textarea: HTMLTextAreaElement): void {
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + "px";
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

        const newContent = content.replace(/\{(\d+)\}/g, (_m, idStr) => {
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
        const restoredContent = content.replace(/\{(\d+)\}/g, (_m, idStr) => {
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
    this.renderHeader();
    this.renderCards();
  }

  async reindex(): Promise<void> {
    const mdView = this.getLastMarkdownView();
    if (!mdView) return;

    const editor = mdView.editor;
    const content = editor.getValue();
    const refRegex = /\{(\d+)\}/g;

    // Collect ids in order of first appearance
    const seen = new Set<number>();
    const orderedIds: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = refRegex.exec(content)) !== null) {
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
    const newContent = content.replace(/\{(\d+)\}/g, (_m, idStr) => {
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

    // Build reverse map: new_id -> old_id
    const reverseMap = new Map<number, number>();
    for (const [oldId, newId] of this.reindexSnapshot.idMap) {
      reverseMap.set(newId, oldId);
    }

    // Update markdown references back
    const editor = mdView.editor;
    const content = editor.getValue();
    const newContent = content.replace(/\{(\d+)\}/g, (_m, idStr) => {
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
