import { ItemView, WorkspaceLeaf, App, MarkdownView } from "obsidian";
import { ReferenceCard, PluginData, createEmptyCard, getAllTags } from "./data";
import { ReferenceCardsSettings } from "./settings";

export const VIEW_TYPE = "reference-cards-view";

export class ReferenceCardView extends ItemView {
  private data: PluginData;
  private saveData: () => Promise<void>;
  private getLastMarkdownView: () => MarkdownView | null;
  private settings: ReferenceCardsSettings;
  private filterTag: string = "";
  private searchQuery: string = "";
  private cardContainer: HTMLElement;
  private headerEl: HTMLElement;

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

    const addBtn = this.headerEl.createEl("button", { cls: "ref-cards-add-btn", text: "+" });
    addBtn.addEventListener("click", () => this.addCard());

    const filterSelect = this.headerEl.createEl("select", { cls: "ref-cards-filter" });
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

    for (const card of filtered) {
      this.renderCard(card);
    }
  }

  private renderCard(card: ReferenceCard): void {
    const cardEl = this.cardContainer.createDiv({ cls: "ref-card", attr: { "data-card-id": String(card.id) } });

    const topRow = cardEl.createDiv({ cls: "ref-card-top" });

    const idBadge = topRow.createSpan({ cls: "ref-card-id", text: `[${card.id}]` });

    const titleInput = topRow.createDiv({
      cls: "ref-card-title-input" + (this.settings.titleSoftWrap ? " ref-card-title-softwrap" : ""),
      attr: { "data-placeholder": "Title..." },
    });
    titleInput.contentEditable = "true";
    titleInput.textContent = card.title;
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

    const notesArea = cardEl.createEl("textarea", {
      cls: "ref-card-notes",
      attr: { placeholder: "Notes..." },
    });
    notesArea.value = card.notes;
    notesArea.addEventListener("input", () => {
      card.notes = notesArea.value;
      this.resizeTextarea(notesArea);
      this.debouncedSave();
    });
    this.resizeTextarea(notesArea);
  }

  private resizeTextarea(textarea: HTMLTextAreaElement): void {
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + "px";
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
    this.data.cards = this.data.cards.filter((c) => c.id !== id);
    await this.saveData();
    this.renderCards();
    this.renderHeader();
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
}
