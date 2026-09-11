import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { createRefRegex, maskProtectedRegions } from "./refs";

function buildDecorations(
  view: EditorView,
  maskedDoc: string,
  getColor: () => string | undefined
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const color = getColor();
  const spec: { class: string; attributes?: Record<string, string> } = { class: "ref-card-link" };
  if (color) {
    spec.attributes = { style: `color: ${color}` };
  }

  for (const { from, to } of view.visibleRanges) {
    // `maskedDoc` has math/code blanked out (same length), so matches here are
    // real references and the offsets still line up with the document.
    const text = maskedDoc.slice(from, to);
    const regex = createRefRegex();
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const start = from + match.index;
      const end = start + match[0].length;
      builder.add(start, end, Decoration.mark(spec));
    }
  }

  return builder.finish();
}

export function createEditorPlugin(
  onNavigate: (id: string) => void,
  getColor: () => string | undefined
) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      clickHandler: (e: MouseEvent) => void;
      editorDom: HTMLElement;
      private maskedDoc: string;

      constructor(view: EditorView) {
        this.editorDom = view.dom;
        this.maskedDoc = maskProtectedRegions(view.state.doc.toString());
        this.decorations = buildDecorations(view, this.maskedDoc, getColor);
        this.clickHandler = (e: MouseEvent) => {
          const el = (e.target as HTMLElement).closest(".ref-card-link") as HTMLElement | null;
          if (!el) return;
          const m = (el.textContent || "").match(/\{([a-z0-9]{1,3})\}/);
          if (m) onNavigate(m[1]);
        };
        this.editorDom.addEventListener("click", this.clickHandler);
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.maskedDoc = maskProtectedRegions(update.state.doc.toString());
        }
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, this.maskedDoc, getColor);
        }
      }

      destroy() {
        this.editorDom.removeEventListener("click", this.clickHandler);
      }
    },
    { decorations: (v) => v.decorations }
  );
}
