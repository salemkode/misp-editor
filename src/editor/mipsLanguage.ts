/**
 * MIPS assembly syntax highlighting for CodeMirror 6.
 *
 * Implemented as a StreamLanguage: the `token` function returns tag *names*
 * (strings) that CodeMirror maps to highlight styles via the default token
 * table — keyword, number, string, variableName, labelName, etc.
 */

import { StreamLanguage, type StringStream } from "@codemirror/language";

const DIRECTIVES = new Set([
  ".data", ".text", ".globl", ".global", ".align", ".space", ".word",
  ".half", ".byte", ".asciiz", ".ascii", ".extern", ".eqv",
]);

interface MipsState {
  inString: boolean;
}

export const mipsLanguage = StreamLanguage.define<MipsState>({
  name: "mips",
  startState(): MipsState {
    return { inString: false };
  },
  token(stream: StringStream, state: MipsState): string | null {
    if (state.inString) {
      if (stream.match(/^[^"\\]+/)) return "string";
      if (stream.match(/^\\./)) return "string.escape";
      if (stream.match(/^"/)) {
        state.inString = false;
        return "string";
      }
      stream.next();
      return "string";
    }

    if (stream.eatSpace()) return null;

    if (stream.match(/^#.*/)) return "comment";
    if (stream.match(/^"/)) {
      state.inString = true;
      return "string";
    }
    if (stream.match(/^'(?:\\.|[^'])'/)) return "character";

    if (stream.match(/^\$[A-Za-z0-9]+/)) return "variableName";

    if (stream.match(/^\.[A-Za-z_]+/)) {
      return DIRECTIVES.has(stream.current().toLowerCase()) ? "meta" : "name";
    }

    if (stream.match(/^-?0x[0-9A-Fa-f]+/)) return "number";
    if (stream.match(/^-?\d+/)) return "number";

    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*(?=\s*:)/)) return "labelName";
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)) return "keyword";

    if (stream.match(/^[(),:]/)) return "punctuation";

    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: "#" },
  },
});
