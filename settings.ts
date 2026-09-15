import { App, PluginSettingTab, Setting } from "obsidian";
import type ReferenceCardsPlugin from "./main";

export type SortField = "added" | "citation" | "custom" | "title" | "year";

/** Stored in `cardBgPreset` when the user supplies their own two colours. */
export const CUSTOM_CARD_BG = -1;

/** Two alternating solid card backgrounds: `[colorA, colorB]`. */
export type CardBgPair = [string, string];

/**
 * Alternating card-background presets. Each entry holds the pair used by the
 * active theme, so picking "Preset 2" gives a dark pair in dark mode and a
 * light pair in light mode. The pair loops down the rendered list: the 1st,
 * 3rd, 5th… card uses colour A and the 2nd, 4th, 6th… uses colour B.
 */
export const CARD_BG_PRESETS: { dark: CardBgPair; light: CardBgPair }[] = [
  { dark: ["#1E1E2E", "#2A2A3C"], light: ["#FFFFFF", "#F3F4F6"] },
  { dark: ["#0F172A", "#1E293B"], light: ["#FAFAFA", "#F0F0F0"] },
  { dark: ["#1A1A2E", "#16213E"], light: ["#F8FAFC", "#EEF2F6"] },
  { dark: ["#18181B", "#27272A"], light: ["#FFF7ED", "#FFEDD5"] },
  { dark: ["#111827", "#1F2937"], light: ["#F0FDF4", "#DCFCE7"] },
];

export interface ReferenceCardsSettings {
  fetchLinkTitles: boolean;
  titleSoftWrap: boolean;
  cardFontSize: number;
  refIdColor: string;
  /** Whether cards get the alternating background colours at all. */
  cardBgEnabled: boolean;
  /** Index into `CARD_BG_PRESETS`, or `CUSTOM_CARD_BG` for the custom pair. */
  cardBgPreset: number;
  /** Custom colour A (1st, 3rd, 5th…); empty falls back to preset 1. */
  cardBgCustomA: string;
  /** Custom colour B (2nd, 4th, 6th…); empty falls back to preset 1. */
  cardBgCustomB: string;
  /**
   * Card list ordering. `custom` follows the persisted `cards` array order and
   * is the mode in which cards can be drag-reordered; `citation` follows the
   * first `{id}` appearance in the active note.
   */
  sortField: SortField;
  sortAscending: boolean;
}

export const DEFAULT_SETTINGS: ReferenceCardsSettings = {
  fetchLinkTitles: true,
  titleSoftWrap: true,
  cardFontSize: 13,
  refIdColor: "",
  cardBgEnabled: false,
  cardBgPreset: 0,
  cardBgCustomA: "",
  cardBgCustomB: "",
  sortField: "added",
  sortAscending: true,
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Accepts only `#rrggbb`; anything else (including empty) yields `fallback`. */
export function normalizeHexColor(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOR.test(value.trim()) ? value.trim() : fallback;
}

/** Coerces a loaded `cardBgPreset` into a preset index or `CUSTOM_CARD_BG`. */
export function normalizeCardBgPreset(value: unknown): number {
  if (value === CUSTOM_CARD_BG) return CUSTOM_CARD_BG;
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < CARD_BG_PRESETS.length
  ) {
    return value;
  }
  return DEFAULT_SETTINGS.cardBgPreset;
}

/** Obsidian marks the dark theme with `theme-dark` on `<body>`. */
export function isDarkTheme(): boolean {
  return typeof document !== "undefined" && document.body.classList.contains("theme-dark");
}

/** The `[A, B]` pair a preset resolves to for the given (or current) theme. */
export function presetColors(preset: number, dark: boolean = isDarkTheme()): CardBgPair {
  const entry = CARD_BG_PRESETS[preset] ?? CARD_BG_PRESETS[0];
  return dark ? entry.dark : entry.light;
}

/**
 * The two colours the panel should loop through right now. Resolves the
 * theme-specific preset, or the custom pair — seeding each custom colour from
 * preset 1 for its theme when it has not been chosen yet.
 */
export function getCardBackgroundColors(
  settings: ReferenceCardsSettings,
  dark: boolean = isDarkTheme()
): CardBgPair {
  if (settings.cardBgPreset === CUSTOM_CARD_BG) {
    const fallback = presetColors(0, dark);
    return [
      normalizeHexColor(settings.cardBgCustomA, fallback[0]),
      normalizeHexColor(settings.cardBgCustomB, fallback[1]),
    ];
  }
  return presetColors(settings.cardBgPreset, dark);
}

/**
 * Coerces a value loaded from `data.json` into a valid sort mode. The legacy
 * `manual` mode showed the persisted array order, which is exactly what
 * `custom` shows now, so those users keep their view (and gain drag-reorder).
 */
export function normalizeSortField(value: unknown): SortField {
  if (
    value === "added" ||
    value === "citation" ||
    value === "custom" ||
    value === "title" ||
    value === "year"
  ) {
    return value;
  }
  if (value === "manual") return "custom";
  return DEFAULT_SETTINGS.sortField;
}

export class ReferenceCardsSettingTab extends PluginSettingTab {
  plugin: ReferenceCardsPlugin;
  private bgPreviewColors: HTMLElement[] = [];
  private bgPreviewLabels: HTMLElement[] = [];
  /** Whether `display()` has run at least once (its containerEl exists). */
  private displayed = false;

  constructor(app: App, plugin: ReferenceCardsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Redraws the tab, but only once it has been shown at least once — the
   * preset labels are theme-specific and `main.ts` calls this on `css-change`.
   */
  refreshTheme(): void {
    if (this.displayed) this.display();
  }

  display(): void {
    const { containerEl } = this;
    this.displayed = true;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Fetch link titles on paste")
      .setDesc(
        "When a URL is pasted into a card title, fetch the page title and insert it as a markdown link. If the page can't be read, the pasted text is kept as-is."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.fetchLinkTitles)
          .onChange(async (value) => {
            this.plugin.settings.fetchLinkTitles = value;
            await this.plugin.saveSettings();
          })
      );

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

    new Setting(containerEl)
      .setName("Reference ID color")
      .setDesc("Color for {id} highlights in the editor and for the [id] badge on cards. Use reset to fall back to the default link color.")
      .addColorPicker((picker) =>
        picker
          .setValue(this.plugin.settings.refIdColor || "#ffffff")
          .onChange(async (value) => {
            this.plugin.settings.refIdColor = value;
            await this.plugin.saveSettings();
            this.plugin.reconfigureEditors();
            this.plugin.refreshView();
          })
      )
      .addExtraButton((button) =>
        button
          .setIcon("rotate-ccw")
          .setTooltip("Reset to default link color")
          .onClick(async () => {
            this.plugin.settings.refIdColor = "";
            await this.plugin.saveSettings();
            this.plugin.reconfigureEditors();
            this.plugin.refreshView();
            this.display();
          })
      );

    this.displayCardBackgroundSettings(containerEl);
  }

  /**
   * Alternating card backgrounds. The two colours are applied by rendered
   * position (A, B, A, B…), and the presets are grouped by theme: the dark
   * pairs are used in dark mode, the light pairs in light mode.
   */
  private displayCardBackgroundSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Card background colors")
      .setDesc(
        "Give cards alternating background colors. The 1st, 3rd, 5th… card uses color A and the 2nd, 4th, 6th… uses color B. Presets follow your Obsidian theme."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.cardBgEnabled)
          .onChange(async (value) => {
            this.plugin.settings.cardBgEnabled = value;
            await this.plugin.saveSettings();
            this.plugin.refreshView();
            this.display();
          })
      );

    if (!this.plugin.settings.cardBgEnabled) return;

    const dark = isDarkTheme();

    new Setting(containerEl)
      .setName("Background preset")
      .setDesc(
        `Presets for ${dark ? "dark" : "light"} mode. Switch your Obsidian theme to pick from the other set.`
      )
      .addDropdown((dropdown) => {
        CARD_BG_PRESETS.forEach((_preset, index) => {
          const [a, b] = presetColors(index, dark);
          dropdown.addOption(String(index), `Preset ${index + 1} — ${a} / ${b}`);
        });
        dropdown.addOption(String(CUSTOM_CARD_BG), "Custom");
        dropdown.setValue(String(this.plugin.settings.cardBgPreset)).onChange(async (value) => {
          const next = Number(value);
          const previous = this.plugin.settings.cardBgPreset;
          this.plugin.settings.cardBgPreset = next;
          // Seed an untouched custom pair from the preset being left, so
          // "Custom" starts from something visible instead of blank.
          if (
            next === CUSTOM_CARD_BG &&
            previous !== CUSTOM_CARD_BG &&
            !this.plugin.settings.cardBgCustomA &&
            !this.plugin.settings.cardBgCustomB
          ) {
            const [a, b] = presetColors(previous, dark);
            this.plugin.settings.cardBgCustomA = a;
            this.plugin.settings.cardBgCustomB = b;
          }
          await this.plugin.saveSettings();
          this.plugin.refreshView();
          this.display();
        });
      });

    if (this.plugin.settings.cardBgPreset === CUSTOM_CARD_BG) {
      const [a, b] = getCardBackgroundColors(this.plugin.settings, dark);
      new Setting(containerEl)
        .setName("Custom colors")
        .setDesc("Color A for the 1st, 3rd, 5th… card, color B for the 2nd, 4th, 6th…")
        .addColorPicker((picker) =>
          picker.setValue(a).onChange(async (value) => {
            this.plugin.settings.cardBgCustomA = value;
            await this.plugin.saveSettings();
            this.plugin.refreshView();
            this.updateBackgroundPreview();
          })
        )
        .addColorPicker((picker) =>
          picker.setValue(b).onChange(async (value) => {
            this.plugin.settings.cardBgCustomB = value;
            await this.plugin.saveSettings();
            this.plugin.refreshView();
            this.updateBackgroundPreview();
          })
        );
    }

    this.renderBackgroundPreview(containerEl);
  }

  /** Two sample swatches showing exactly what the cards will loop through. */
  private renderBackgroundPreview(containerEl: HTMLElement): void {
    this.bgPreviewColors = [];
    this.bgPreviewLabels = [];

    const preview = containerEl.createDiv({ cls: "ref-card-bg-preview" });
    for (let i = 0; i < 2; i++) {
      const item = preview.createDiv({ cls: "ref-card-bg-swatch" });
      this.bgPreviewColors.push(item.createDiv({ cls: "ref-card-bg-swatch-color" }));
      this.bgPreviewLabels.push(item.createDiv({ cls: "ref-card-bg-swatch-label" }));
    }

    this.updateBackgroundPreview();
  }

  private updateBackgroundPreview(): void {
    if (this.bgPreviewColors.length !== 2) return;

    const [a, b] = getCardBackgroundColors(this.plugin.settings);
    const colors = [a, b];
    const positions = ["1st, 3rd, 5th…", "2nd, 4th, 6th…"];
    for (let i = 0; i < 2; i++) {
      this.bgPreviewColors[i].style.backgroundColor = colors[i];
      this.bgPreviewLabels[i].textContent = `${positions[i]} · ${colors[i]}`;
    }
  }
}
