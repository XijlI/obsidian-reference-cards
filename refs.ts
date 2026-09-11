/**
 * Shared card-ID and `{id}` reference helpers.
 *
 * IDs are 3 lowercase alphanumeric characters (36^3 = 46,656 combinations),
 * generated randomly and never edited by the user. The matcher also accepts the
 * shorter 1-3 character form so references written before the switch to
 * 3-character IDs (e.g. `{1}`) keep resolving to their existing cards.
 */

export const ID_LENGTH = 3;
export const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Matches the body of a `{...}` reference. */
export const ID_PATTERN = "[a-z0-9]{1,3}";

const ID_EXACT = new RegExp("^" + ID_PATTERN + "$");

export function isValidCardId(id: string): boolean {
  return ID_EXACT.test(id);
}

/** Returns a fresh global regex; never share one across scans (lastIndex state). */
export function createRefRegex(): RegExp {
  return new RegExp("\\{(" + ID_PATTERN + ")\\}", "g");
}

export function generateCardId(existing: ReadonlySet<string>): string {
  let id: string;
  do {
    id = "";
    for (let i = 0; i < ID_LENGTH; i++) {
      id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
    }
  } while (existing.has(id));
  return id;
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PROTECTED_PATTERNS: RegExp[] = [
  /\$\$[\s\S]*?\$\$/g,
  /\$[^$\n]+?\$/g,
  /```[\s\S]*?```/g,
  /`[^`\n]+?`/g,
];

/** Spans of fenced/inline code and math where `{id}` must not be interpreted. */
export function getProtectedRanges(text: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  for (const pattern of PROTECTED_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
      if (match[0].length === 0) pattern.lastIndex++;
    }
  }
  return ranges;
}

/**
 * Replaces protected spans with spaces, preserving length and line breaks, so
 * `{id}` matching can skip math/code while original offsets stay valid. Used by
 * the editor decorations (offsets must map back to the document).
 */
export function maskProtectedRegions(text: string): string {
  const ranges = getProtectedRanges(text);
  if (ranges.length === 0) return text;
  const chars = text.split("");
  for (const range of ranges) {
    for (let i = range.start; i < range.end; i++) {
      if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
    }
  }
  return chars.join("");
}

/** Unique reference IDs in order of first appearance, ignoring math/code. */
export function collectRefIds(text: string): string[] {
  const masked = maskProtectedRegions(text);
  const regex = createRefRegex();
  const ids: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(masked)) !== null) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      ids.push(match[1]);
    }
  }
  return ids;
}
