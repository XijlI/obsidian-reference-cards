export interface ReferenceCard {
  id: number;
  title: string;
  tags: string[];
  year: string;
  notes: string;
}

export interface PluginData {
  cards: ReferenceCard[];
  nextId: number;
}

export const DEFAULT_DATA: PluginData = {
  cards: [],
  nextId: 1,
};

export function createEmptyCard(id: number): ReferenceCard {
  return {
    id,
    title: "",
    tags: [],
    year: "",
    notes: "",
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
