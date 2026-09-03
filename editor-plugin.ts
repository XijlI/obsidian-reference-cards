import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

const REF_REGEX = /\{(\d+)\}/g;

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    let match: RegExpExecArray | null;
    REF_REGEX.lastIndex = 0;
    while ((match = REF_REGEX.exec(text)) !== null) {
      const start = from + match.index;
      const end = start + match[0].length;
      builder.add(start, end, Decoration.mark({ class: "ref-card-link" }));
    }
  }

  return builder.finish();
}

export function createEditorPlugin(onNavigate: (id: number) => void) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      clickHandler: (e: MouseEvent) => void;
      editorDom: HTMLElement;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
        this.editorDom = view.dom;
        this.clickHandler = (e: MouseEvent) => {
          const el = (e.target as HTMLElement).closest(".ref-card-link") as HTMLElement | null;
          if (!el) return;
          const m = (el.textContent || "").match(/\{(\d+)\}/);
          if (m) onNavigate(parseInt(m[1], 10));
        };
        this.editorDom.addEventListener("click", this.clickHandler);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view);
        }
      }

      destroy() {
        this.editorDom.removeEventListener("click", this.clickHandler);
      }
    },
    { decorations: (v) => v.decorations }
  );
}
