import { generateCardId, isValidCardId } from "./refs";

export interface ReferenceCard {
  id: string;
  title: string;
  tags: string[];
  year: string;
  notes: string;
  /** Epoch ms when the card was created (used by the "Added" sort). */
  createdAt: number;
}

export interface PluginData {
  cards: ReferenceCard[];
}

export const DEFAULT_DATA: PluginData = {
  cards: [],
};

export function createEmptyCard(id: string): ReferenceCard {
  return {
    id,
    title: "",
    tags: [],
    year: "",
    notes: "",
    createdAt: Date.now(),
  };
}

export function getAllTags(cards: ReferenceCard[]): string[] {
  const tagSet = new Set<string>();
  for (const card of cards) {
    for (const tag of card.tags) {
      tagSet.add(tag);
    }
  }
  return Array.from(tagSet).sort();
}

/**
 * Returns `cards` reordered to match `order`. Cards not named in `order` keep
 * their relative order at the end; unknown ids are ignored.
 */
export function orderCards(cards: ReferenceCard[], order: string[]): ReferenceCard[] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const reordered: ReferenceCard[] = [];
  for (const id of order) {
    const card = byId.get(id);
    if (card) {
      reordered.push(card);
      byId.delete(id);
    }
  }
  for (const card of cards) {
    if (byId.has(card.id)) reordered.push(card);
  }
  return reordered;
}

/**
 * Coerces whatever is in data.json into well-formed cards: string IDs, unique
 * IDs, string fields, and a creation timestamp. Legacy numeric IDs (1-3 digits)
 * are preserved so existing `{1}`-style references keep working; anything
 * unusable gets a fresh random ID. Cards saved before timestamps existed get a
 * fallback based on their order in the file, which keeps their current
 * oldest-first order and sorts them before any newly created card.
 */
export function normalizeCards(raw: unknown): ReferenceCard[] {
  if (!Array.isArray(raw)) return [];

  const cards: ReferenceCard[] = [];
  const used = new Set<string>();
  let fallbackCreatedAt = 0;

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;

    let id = String(source.id ?? "").trim().toLowerCase();
    if (!isValidCardId(id) || used.has(id)) {
      id = generateCardId(used);
    }
    used.add(id);

    const createdAt =
      typeof source.createdAt === "number" && Number.isFinite(source.createdAt)
        ? source.createdAt
        : fallbackCreatedAt++;

    cards.push({
      id,
      title: typeof source.title === "string" ? source.title : "",
      tags: Array.isArray(source.tags)
        ? source.tags.filter((tag): tag is string => typeof tag === "string")
        : [],
      year:
        typeof source.year === "string"
          ? source.year
          : source.year != null
            ? String(source.year)
            : "",
      notes: typeof source.notes === "string" ? source.notes : "",
      createdAt,
    });
  }

  return cards;
}
