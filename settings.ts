import { App, PluginSettingTab, Setting } from "obsidian";
import type ReferenceCardsPlugin from "./main";

export interface ReferenceCardsSettings {
  titleSoftWrap: boolean;
  cardFontSize: number;
}

export const DEFAULT_SETTINGS: ReferenceCardsSettings = {
  titleSoftWrap: true,
  cardFontSize: 13,
};

export class ReferenceCardsSettingTab extends PluginSettingTab {
  plugin: ReferenceCardsPlugin;

  constructor(app: App, plugin: ReferenceCardsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Title soft wrap")
      .setDesc("Allow long titles to wrap across multiple lines.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.titleSoftWrap)
          .onChange(async (value) => {
            this.plugin.settings.titleSoftWrap = value;
            await this.plugin.saveSettings();
            this.plugin.refreshView();
          })
      );

    new Setting(containerEl)
      .setName("Card font size")
      .setDesc("Adjust the font size of card content (10–20px).")
      .addSlider((slider) =>
        slider
          .setLimits(10, 20, 1)
          .setValue(this.plugin.settings.cardFontSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.cardFontSize = value;
            await this.plugin.saveSettings();
            this.plugin.refreshView();
          })
      );
  }
}
