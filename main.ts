import { Plugin, WorkspaceLeaf, MarkdownView } from "obsidian";
import { Compartment } from "@codemirror/state";
import { DEFAULT_DATA, normalizeCards, PluginData } from "./data";
import { ReferenceCardView, VIEW_TYPE } from "./view";
import { createEditorPlugin } from "./editor-plugin";
import { ReferenceCardsSettings, DEFAULT_SETTINGS, ReferenceCardsSettingTab } from "./settings";

export default class ReferenceCardsPlugin extends Plugin {
  private data: PluginData = { ...DEFAULT_DATA };
  private view: ReferenceCardView | null = null;
  private lastMarkdownView: MarkdownView | null = null;
  private editorCompartment = new Compartment();
  settings: ReferenceCardsSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    // Cards and settings share data.json; load them from one read so a later
    // save of either can never resurrect a stale snapshot of the other.
    const loaded = (await this.loadData()) ?? {};

    this.data = { cards: normalizeCards(loaded.cards) };
    this.settings = {
      titleSoftWrap:
        typeof loaded.titleSoftWrap === "boolean"
          ? loaded.titleSoftWrap
          : DEFAULT_SETTINGS.titleSoftWrap,
      cardFontSize:
        typeof loaded.cardFontSize === "number"
          ? loaded.cardFontSize
          : DEFAULT_SETTINGS.cardFontSize,
      refIdColor:
        typeof loaded.refIdColor === "string" ? loaded.refIdColor : DEFAULT_SETTINGS.refIdColor,
    };

    this.addSettingTab(new ReferenceCardsSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view instanceof MarkdownView) {
          this.lastMarkdownView = leaf.view;
        }
      })
    );

    this.registerView(VIEW_TYPE, (leaf) => {
      this.view = new ReferenceCardView(
        leaf,
        this.app,
        this.data,
        () => this.savePluginData(),
        () => this.lastMarkdownView,
        this.settings
      );
      return this.view;
    });

    this.addRibbonIcon("file-text", "Reference Cards", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-reference-cards",
      name: "Open Reference Cards",
      callback: () => this.activateView(),
    });

    this.registerEditorExtension(this.editorCompartment.of(this.buildEditorPlugin()));
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  refreshView(): void {
    if (this.view) {
      this.view.renderAll();
    }
  }

  reconfigureEditors(): void {
    const newPlugin = this.buildEditorPlugin();
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) {
        const editor = (leaf.view.editor as any);
        if (editor?.cm) {
          editor.cm.dispatch({
            effects: this.editorCompartment.reconfigure(newPlugin),
          });
        }
      }
    });
  }

  async saveSettings(): Promise<void> {
    await this.saveAll();
  }

  private async savePluginData(): Promise<void> {
    await this.saveAll();
  }

  /** Writes the live card list and the live settings together. */
  private async saveAll(): Promise<void> {
    await this.saveData({ cards: this.data.cards, ...this.settings });
  }

  /**
   * Reads the current colour at decoration-build time rather than capturing it
   * once, so editors opened after a colour change use the new value too.
   */
  private buildEditorPlugin() {
    return createEditorPlugin(
      (id: string) => {
        this.activateView().then(() => {
          this.view?.scrollToCard(id);
        });
      },
      () => this.settings.refIdColor || undefined
    );
  }
}
