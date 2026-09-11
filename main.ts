import { Plugin, WorkspaceLeaf, MarkdownView } from "obsidian";
import { Compartment } from "@codemirror/state";
import { PluginData, DEFAULT_DATA } from "./data";
import { ReferenceCardView, VIEW_TYPE } from "./view";
import { createEditorPlugin } from "./editor-plugin";
import { ReferenceCardsSettings, DEFAULT_SETTINGS, ReferenceCardsSettingTab } from "./settings";

export default class ReferenceCardsPlugin extends Plugin {
  private data: PluginData;
  private view: ReferenceCardView | null = null;
  private lastMarkdownView: MarkdownView | null = null;
  private editorCompartment = new Compartment();
  settings: ReferenceCardsSettings;

  async onload(): Promise<void> {
    this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadSettings());

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

    const editorPlugin = createEditorPlugin((id: number) => {
      this.activateView().then(() => {
        if (this.view) {
          this.view.scrollToCard(id);
        }
      });
    }, this.settings.refIdColor || undefined);
    this.registerEditorExtension(this.editorCompartment.of(editorPlugin));
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
    const newPlugin = createEditorPlugin((id: number) => {
      this.activateView().then(() => {
        if (this.view) {
          this.view.scrollToCard(id);
        }
      });
    }, this.settings.refIdColor || undefined);
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

  async loadSettings(): Promise<ReferenceCardsSettings> {
    return Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async savePluginData(): Promise<void> {
    await this.saveData(this.data);
  }
}
