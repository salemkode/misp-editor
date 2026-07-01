/**
 * MIPS code editor (CodeMirror 6).
 *
 * Two source-cursor concepts live here, mirroring the architecture spec:
 *   • the editor caret (native CodeMirror selection)
 *   • the execution cursor (the green `cm-executing-line` decoration, driven by
 *     the runtime's currentInstructionIndex)
 * Parse errors are shown via a red `cm-error-line` decoration.
 */

import { onCleanup, onMount, createEffect } from "solid-js";
import { StateEffect, StateField } from "@codemirror/state";
import { EditorView, lineNumbers, highlightActiveLine, keymap, drawSelection, highlightSpecialChars, hoverTooltip, Decoration, type DecorationSet } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, LanguageSupport } from "@codemirror/language";
import { dracula } from "thememirror";
import { mipsLanguage } from "./mipsLanguage";
import { wordAt, renderHoverHtml } from "./hoverDocs";
import { controller } from "~/state/runtimeStore";

const setExecLine = StateEffect.define<number | null>();
const setErrorLines = StateEffect.define<number[]>();

const execLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    const effect = tr.effects.find((e) => e.is(setExecLine));
    if (effect) {
      const line = effect.value;
      if (line === null || line < 0) return Decoration.none;
      const docLine = line + 1; // source lines are 0-based
      if (docLine < 1 || docLine > tr.state.doc.lines) return Decoration.none;
      return Decoration.set([Decoration.line({ attributes: { class: "cm-executing-line" } }).range(tr.state.doc.line(docLine).from)]);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const errorLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    const effect = tr.effects.find((e) => e.is(setErrorLines));
    if (effect) {
      const lines = effect.value;
      if (lines.length === 0) return Decoration.none;
      const decos = lines
        .filter((l) => l + 1 >= 1 && l + 1 <= tr.state.doc.lines)
        .map((l) => Decoration.line({ attributes: { class: "cm-error-line" } }).range(tr.state.doc.line(l + 1).from));
      return Decoration.set(decos);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Hover tooltip: explains the instruction / register / directive under the cursor. */
const hoverDocs = hoverTooltip((view, pos) => {
  const word = wordAt(view.state.doc, pos);
  if (!word) return null;
  const html = renderHoverHtml(word.text);
  if (!html) return null;
  return {
    pos: word.from,
    end: word.to,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-hover-doc";
      dom.innerHTML = html;
      return { dom };
    },
  };
});

export function MipsEditor() {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  const mipsLanguageExtension = new LanguageSupport(mipsLanguage);

  onMount(() => {
    view = new EditorView({
      parent: host,
      doc: controller.state.source,
      extensions: [
        history(),
        drawSelection(),
        highlightSpecialChars(),
        lineNumbers(),
        highlightActiveLine(),
        bracketMatching(),
        mipsLanguageExtension,
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        dracula,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        execLineField,
        errorLineField,
        hoverDocs,
        EditorView.lineWrapping,
        EditorView.theme({
          "&": { height: "100%", fontSize: "13px" },
          ".cm-scroller": { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" },
          ".cm-gutters": { backgroundColor: "transparent" },
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            controller.setSource(u.state.doc.toString());
          }
        }),
      ],
    });
  });

  onCleanup(() => view?.destroy());

  // execution cursor → editor
  createEffect(() => {
    const idx = controller.state.runtime.currentInstructionIndex;
    const program = controller.state.runtime.program;
    let line: number | null = null;
    if (idx !== null && program) {
      line = program.instructions[idx]?.sourceLine ?? null;
    }
    view?.dispatch({ effects: setExecLine.of(line) });
  });

  // parse errors → editor
  createEffect(() => {
    const errors = controller.state.parseErrors;
    view?.dispatch({ effects: setErrorLines.of(errors.map((e) => e.line)) });
  });

  // external source changes (e.g. loading a sample) → editor
  createEffect(() => {
    const source = controller.state.source;
    if (view && view.state.doc.toString() !== source) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: source },
      });
    }
  });

  return <div class="editor-host" ref={host} />;
}
