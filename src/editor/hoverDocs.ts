/**
 * Hover documentation source.
 *
 * Turns the word under the cursor into a documentation snippet by classifying it
 * (instruction / register / directive) and pulling text from the single sources
 * of truth: the instruction spec table, the register display table, and a small
 * directive dictionary. Returns sanitised HTML for the tooltip.
 */

import { INSTRUCTION_SPECS } from "~/core/instructions/instructions";
import { REGISTER_DISPLAY } from "~/core/registers";

const DIRECTIVE_DOCS: Record<string, string> = {
  ".data": "Start of the data segment — initialized variables live here.",
  ".text": "Start of the text segment — your instructions live here.",
  ".word": "Allocate one or more 32-bit (4-byte) words.",
  ".half": "Allocate one or more 16-bit (2-byte) halfwords.",
  ".byte": "Allocate one or more bytes.",
  ".space": "Reserve N bytes of uninitialized (zeroed) space.",
  ".asciiz": "Store a string followed by a null terminator (\\0).",
  ".ascii": "Store a string without a null terminator.",
  ".globl": "Declare a label as global (visible to the linker).",
  ".global": "Declare a label as global (visible to the linker).",
  ".align": "Align the next datum to a 2^n byte boundary.",
  ".extern": "Declare an externally-defined label and reserve space for it.",
  ".eqv": "Define a symbolic text substitution.",
};

export type HoverInfo = {
  kind: "instruction" | "register" | "directive";
  title: string;
  signature?: string;
  body: string;
  tag?: string;
};

export function getHoverInfo(word: string): HoverInfo | null {
  const lower = word.toLowerCase();

  if (lower.startsWith("$")) {
    const reg = REGISTER_DISPLAY.find((r) => r.name === lower);
    if (!reg) return null;
    return {
      kind: "register",
      title: `${reg.name}`,
      body: reg.description,
      tag: `register $${reg.alias}`,
    };
  }

  if (lower.startsWith(".")) {
    const doc = DIRECTIVE_DOCS[lower];
    if (!doc) return null;
    return { kind: "directive", title: lower, body: doc, tag: "directive" };
  }

  const spec = INSTRUCTION_SPECS[lower];
  if (spec) {
    return {
      kind: "instruction",
      title: lower,
      signature: spec.pattern,
      body: spec.description,
      tag: spec.category,
    };
  }

  return null;
}

export function renderHoverHtml(word: string): string | null {
  const info = getHoverInfo(word);
  if (!info) return null;
  const sig = info.signature ? `<div class="hd-signature">${escape(info.signature)}</div>` : "";
  return `
    <div class="hd-title">${escape(info.title)}</div>
    ${sig}
    <div class="hd-body">${escape(info.body)}</div>
    <div class="hd-tag hd-tag-${info.kind}">${escape(info.tag ?? info.kind)}</div>
  `;
}

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Extract the word (token) covering a given document position. */
export function wordAt(doc: { lineAt(pos: number): { from: number; text: string }; sliceString(from: number, to: number): string }, pos: number): { from: number; to: number; text: string } | null {
  const line = doc.lineAt(pos);
  const text = line.text;
  const isWordChar = (c: string) => /[A-Za-z0-9_$.]/.test(c);
  let from = pos - line.from;
  let to = from;
  while (from > 0 && isWordChar(text[from - 1])) from--;
  while (to < text.length && isWordChar(text[to])) to++;
  if (from === to) return null;
  return { from: line.from + from, to: line.from + to, text: text.slice(from, to) };
}
