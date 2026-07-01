/**
 * Resizable, collapsible split pane.
 *
 * Two panels with a draggable gutter between them. Sizes are persisted to
 * localStorage (keyed by `storageKey`) so the layout survives reloads, just like
 * a desktop editor. Each gutter also carries two collapse chevrons.
 *
 * Nest multiple SplitViews to build 2D layouts (rows of columns, etc.).
 */

import { createSignal, createEffect, JSX } from "solid-js";

export type Direction = "horizontal" | "vertical";

export type SplitViewProps = {
  direction: Direction;
  first: JSX.Element;
  second: JSX.Element;
  storageKey: string;
  /** default size of the first panel in percent (1..99) */
  defaultSize?: number;
  /** minimum size of either panel in percent */
  minSize?: number;
};

type Collapse = "none" | "first" | "second";

type Saved = { size: number; collapsed: Collapse };

function load(key: string, fallback: number): Saved {
  try {
    const raw = localStorage.getItem(`misp:split:${key}`);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Saved>;
      const size = typeof parsed.size === "number" ? parsed.size : fallback;
      const collapsed = parsed.collapsed ?? "none";
      return { size, collapsed };
    }
  } catch {
    /* ignore corrupt storage */
  }
  return { size: fallback, collapsed: "none" };
}

function save(key: string, value: Saved): void {
  try {
    localStorage.setItem(`misp:split:${key}`, JSON.stringify(value));
  } catch {
    /* storage may be unavailable */
  }
}

export function SplitView(props: SplitViewProps) {
  const min = () => props.minSize ?? 12;
  const initial = load(props.storageKey, clamp(props.defaultSize ?? 50, min(), 100 - min()));
  const [size, setSize] = createSignal(initial.size);
  const [collapsed, setCollapsed] = createSignal<Collapse>(initial.collapsed);
  const [dragging, setDragging] = createSignal(false);
  let container!: HTMLDivElement;

  createEffect(() => {
    save(props.storageKey, { size: size(), collapsed: collapsed() });
  });

  function startDrag(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (collapsed() !== "none") setCollapsed("none");
    const rect = container.getBoundingClientRect();
    const total = props.direction === "horizontal" ? rect.width : rect.height;
    setDragging(true);
    document.body.style.cursor = props.direction === "horizontal" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";

    const move = (ev: PointerEvent) => {
      if (total <= 0) return;
      const offset = props.direction === "horizontal" ? ev.clientX - rect.left : ev.clientY - rect.top;
      setSize(clamp((offset / total) * 100, min(), 100 - min()));
    };
    const up = () => {
      setDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const firstBasis = () => {
    const c = collapsed();
    if (c === "first") return "0%";
    if (c === "second") return "100%";
    return `${size()}%`;
  };

  const toggleFirst = () => setCollapsed((c) => (c === "first" ? "none" : "first"));
  const toggleSecond = () => setCollapsed((c) => (c === "second" ? "none" : "second"));

  // chevrons: the glyph indicates the direction the panel will move when clicked
  const firstGlyph = () => {
    const open = collapsed() === "first";
    return props.direction === "horizontal" ? (open ? "›" : "‹") : open ? "˅" : "˄";
  };
  const secondGlyph = () => {
    const open = collapsed() === "second";
    return props.direction === "horizontal" ? (open ? "‹" : "›") : open ? "˄" : "˅";
  };

  return (
    <div class="splitview" classList={{ vertical: props.direction === "vertical", dragging: dragging() }} ref={container}>
      <div
        class="split-panel"
        style={{ "flex-basis": firstBasis(), display: collapsed() === "first" ? "none" : "flex" }}
      >
        {props.first}
      </div>

      <div
        class="split-gutter"
        classList={{ vertical: props.direction === "vertical", hidden: collapsed() !== "none" }}
        onPointerDown={startDrag}
        onDblClick={() => setSize(props.defaultSize ?? 50)}
      >
        <button class="gutter-chevron" onClick={toggleFirst} onPointerDown={(e) => e.stopPropagation()} title="Toggle panel">
          {firstGlyph()}
        </button>
        <div class="gutter-handle" />
        <button class="gutter-chevron" onClick={toggleSecond} onPointerDown={(e) => e.stopPropagation()} title="Toggle panel">
          {secondGlyph()}
        </button>
      </div>

      <div
        class="split-panel grow"
        style={{ display: collapsed() === "second" ? "none" : "flex" }}
      >
        {props.second}
      </div>
    </div>
  );
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}
