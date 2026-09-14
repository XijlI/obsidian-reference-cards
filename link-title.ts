/**
 * Page-title lookup for links pasted into the card Title field.
 *
 * When the clipboard holds a bare URL, or a single link copied from a browser
 * page, we fetch the page and turn it into a `[title](url)` markdown link so
 * card titles stay readable and clickable. Everything here fails soft: network
 * errors, timeouts, non-HTML responses and missing `<title>` tags all resolve
 * to `null`, and the caller keeps the text that was on the clipboard.
 *
 * Uses Obsidian's `requestUrl` (Electron main process) so cross-origin fetches
 * work without CORS restrictions.
 */

import { requestUrl } from "obsidian";

const URL_PATTERN = /^https?:\/\/\S+$/i;
const MARKDOWN_LINK_PATTERN = /^\[[^\]]+\]\(https?:\/\/[^)\s]+\)$/i;
const HTML_CONTENT_TYPE = /(?:html|xml)/i;
const FETCH_TIMEOUT_MS = 10000;
const MAX_TITLE_LENGTH = 300;

export interface PastedLink {
  url: string;
  /** Label supplied by the clipboard (anchor text), if any. */
  label: string | null;
}

/** True when the clipboard text is already a complete markdown link. */
export function isMarkdownLink(text: string): boolean {
  return MARKDOWN_LINK_PATTERN.test(text.trim());
}

/**
 * Extracts a single web link from pasted clipboard content. A lone `<a>` in the
 * HTML flavour wins (it carries the real href even when the visible text is
 * just a label); otherwise a bare `text/plain` URL is used. Returns `null` for
 * any paste that is not exactly one link, so normal pasting is left alone.
 */
export function extractPastedLink(text: string, html: string | null): PastedLink | null {
  const anchor = anchorFromHtml(html);
  if (anchor) return anchor;

  const plain = text.trim();
  if (!plain || /\s/.test(plain) || !URL_PATTERN.test(plain)) return null;
  return { url: plain, label: null };
}

/** Builds a markdown link the card renderer can parse back out. */
export function buildMarkdownLink(label: string, url: string): string {
  const safeLabel = sanitizeLinkLabel(label) || sanitizeLinkLabel(url);
  // The card renderer matches `[label](url)` with `[^)]+`, so a literal `)` in
  // the destination would truncate the link. Percent-encoding is equivalent.
  const safeUrl = url.replace(/\)/g, "%29");
  return `[${safeLabel}](${safeUrl})`;
}

export function sanitizeLinkLabel(label: string): string {
  return label
    .replace(/[[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetches the page title for `url`, or `null` when it cannot be determined.
 * Non-2xx/3xx responses, non-HTML content types and pages titled with the URL
 * itself are treated as failures.
 */
export async function fetchLinkTitle(url: string): Promise<string | null> {
  let response: Awaited<ReturnType<typeof requestUrl>> | null;
  try {
    response = await withTimeout(requestUrl({ url, method: "GET", throw: false }));
  } catch {
    return null;
  }
  if (!response) return null;
  if (response.status < 200 || response.status >= 400) return null;

  const contentType = getHeader(response.headers, "content-type");
  if (contentType && !HTML_CONTENT_TYPE.test(contentType)) return null;

  const title = extractTitle(response.text || "");
  if (!title) return null;
  if (title.toLowerCase() === url.toLowerCase()) return null;
  return title;
}

/** Reads `<title>`, falling back to `og:title`, and normalises the result. */
export function extractTitle(html: string): string | null {
  if (!html) return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }

  const title = cleanTitle(doc.querySelector("title")?.textContent ?? null);
  if (title) return title;
  return cleanTitle(
    doc.querySelector('meta[property="og:title"], meta[name="og:title"]')?.getAttribute("content") ?? null
  );
}

function anchorFromHtml(html: string | null): PastedLink | null {
  if (!html) return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }

  const anchors = Array.from(doc.querySelectorAll("a[href]"));
  if (anchors.length !== 1) return null;

  const href = (anchors[0].getAttribute("href") || "").trim();
  if (!URL_PATTERN.test(href)) return null;

  const label = cleanTitle(anchors[0].textContent ?? null);
  // Only act when the paste is this link and nothing else, so copying a
  // paragraph that happens to contain a link keeps the default paste.
  const bodyText = cleanTitle(doc.body?.textContent ?? null);
  if (bodyText && bodyText !== label) return null;

  return { url: href, label };
}

function cleanTitle(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_TITLE_LENGTH);
}

function getHeader(headers: Record<string, string>, name: string): string | null {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : null;
}

function withTimeout<T>(promise: Promise<T>): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), FETCH_TIMEOUT_MS);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      }
    );
  });
}
