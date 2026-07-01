/**
 * MIPS assembly lexer.
 *
 * Turns raw source text into a flat list of typed tokens carrying their source
 * line/column so the parser can produce precise errors. Comments (`#`) and
 * whitespace are skipped.
 */

export type TokenType =
  | "identifier"
  | "directive"
  | "register"
  | "number"
  | "string"
  | "char"
  | "comma"
  | "colon"
  | "lparen"
  | "rparen"
  | "newline";

export type Token = {
  type: TokenType;
  value: string;
  line: number; // 0-based
  column: number; // 0-based
};

export type LexError = {
  line: number;
  column: number;
  message: string;
};

export type LexResult = {
  tokens: Token[];
  errors: LexError[];
};

const REGISTER_RE = /^\$(?:[a-z0-9]+)$/i;
const DIRECTIVE_RE = /^\.[a-z][a-z0-9_]*$/i;
const NUMBER_RE = /^(?:0x[0-9a-fA-F]+|\d+)$/;
const IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/i;

export function lex(source: string): LexResult {
  const tokens: Token[] = [];
  const errors: LexError[] = [];

  const lines = source.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    let col = 0;

    while (col < line.length) {
      const ch = line[col];

      // end-of-line / whitespace
      if (ch === "\n") {
        tokens.push({ type: "newline", value: "\n", line: lineIndex, column: col });
        col++;
        continue;
      }
      if (/\s/.test(ch)) {
        col++;
        continue;
      }

      // comment
      if (ch === "#") {
        break; // rest of line is a comment
      }

      const start = col;

      // string literal
      if (ch === '"') {
        col++;
        let value = "";
        let terminated = false;
        while (col < line.length) {
          const c = line[col];
          if (c === "\\") {
            const next = line[col + 1];
            if (next === undefined) break;
            value += decodeEscape(next);
            col += 2;
            continue;
          }
          if (c === '"') {
            col++;
            terminated = true;
            break;
          }
          value += c;
          col++;
        }
        if (!terminated) {
          errors.push({ line: lineIndex, column: start, message: "Unterminated string literal" });
        }
        tokens.push({ type: "string", value, line: lineIndex, column: start });
        continue;
      }

      // char literal
      if (ch === "'") {
        col++;
        let value = "";
        let terminated = false;
        while (col < line.length) {
          const c = line[col];
          if (c === "\\") {
            const next = line[col + 1];
            if (next === undefined) break;
            value += decodeEscape(next);
            col += 2;
            continue;
          }
          if (c === "'") {
            col++;
            terminated = true;
            break;
          }
          value += c;
          col++;
        }
        if (!terminated) {
          errors.push({ line: lineIndex, column: start, message: "Unterminated char literal" });
        }
        tokens.push({ type: "char", value, line: lineIndex, column: start });
        continue;
      }

      // punctuation
      if (ch === ",") {
        tokens.push({ type: "comma", value: ",", line: lineIndex, column: start });
        col++;
        continue;
      }
      if (ch === ":") {
        tokens.push({ type: "colon", value: ":", line: lineIndex, column: start });
        col++;
        continue;
      }
      if (ch === "(") {
        tokens.push({ type: "lparen", value: "(", line: lineIndex, column: start });
        col++;
        continue;
      }
      if (ch === ")") {
        tokens.push({ type: "rparen", value: ")", line: lineIndex, column: start });
        col++;
        continue;
      }

      // word: register / directive / number / identifier
      let word = "";
      while (col < line.length && !/[\s,():#'"]/.test(line[col])) {
        word += line[col];
        col++;
      }

      const tokenColumn = start;

      if (REGISTER_RE.test(word)) {
        tokens.push({ type: "register", value: word.toLowerCase(), line: lineIndex, column: tokenColumn });
        continue;
      }
      if (DIRECTIVE_RE.test(word)) {
        tokens.push({ type: "directive", value: word.toLowerCase(), line: lineIndex, column: tokenColumn });
        continue;
      }
      if (NUMBER_RE.test(word)) {
        tokens.push({ type: "number", value: word, line: lineIndex, column: tokenColumn });
        continue;
      }

      // A token may begin with '-' for negative numbers.
      if (/^-?\d/.test(word) && /^-?(?:0x[0-9a-fA-F]+|\d+)$/.test(word)) {
        tokens.push({ type: "number", value: word, line: lineIndex, column: tokenColumn });
        continue;
      }

      if (IDENTIFIER_RE.test(word)) {
        tokens.push({ type: "identifier", value: word, line: lineIndex, column: tokenColumn });
        continue;
      }

      errors.push({
        line: lineIndex,
        column: tokenColumn,
        message: `Unexpected token "${word}"`,
      });
    }

    tokens.push({ type: "newline", value: "\n", line: lineIndex, column: line.length });
  }

  return { tokens, errors };
}

function decodeEscape(ch: string): string {
  switch (ch) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "r":
      return "\r";
    case "0":
      return "\0";
    case "\\":
      return "\\";
    case '"':
      return '"';
    case "'":
      return "'";
    default:
      return ch;
  }
}

/** Group tokens by source line, dropping newlines. */
export function groupByLine(tokens: Token[]): Token[][] {
  const lines: Token[][] = [];
  let current: Token[] = [];
  for (const token of tokens) {
    if (token.type === "newline") {
      lines.push(current);
      current = [];
      continue;
    }
    current.push(token);
  }
  if (current.length > 0) lines.push(current);
  return lines;
}
