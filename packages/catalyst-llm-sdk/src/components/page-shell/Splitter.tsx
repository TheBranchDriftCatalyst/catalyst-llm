/**
 * Resizable splitter — port of langgraph-dev/web/src/components/shared/Splitter.tsx
 *
 * Used inside LangGraphEnginePanel to let the operator resize the three
 * columns + bottom Terminal pane. Persists size to localStorage by
 * `storageKey`; writes a CSS custom property by `cssVar` so the parent
 * grid template can read it.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

type Orientation = "vertical" | "horizontal";

interface Props {
  orientation: Orientation;
  /** CSS variable to update on the document root, e.g. `--engine-col-left`.
   * The parent grid template reads this var. */
  cssVar: string;
  /** localStorage key to persist the resized size across sessions. */
  storageKey: string;
  defaultPx: number;
  minPx?: number;
  maxPx?: number;
  /** Set when the drag direction is opposite to the panel-edge direction
   * (right-side panel + bottom panel — drag LEFT/UP grows the panel). */
  invert?: boolean;
  style?: CSSProperties;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function readStored(
  key: string,
  fallback: number,
  lo: number,
  hi: number,
): number {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(v)) return clamp(v, lo, hi);
  } catch {
    /* localStorage may be blocked */
  }
  return fallback;
}

export function Splitter({
  orientation,
  cssVar,
  storageKey,
  defaultPx,
  minPx = 160,
  maxPx = 1200,
  invert = false,
  style,
}: Props) {
  const [size, setSize] = useState(() =>
    readStored(storageKey, defaultPx, minPx, maxPx),
  );
  const dragging = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(size);

  useEffect(() => {
    document.documentElement.style.setProperty(cssVar, `${size}px`);
    try {
      localStorage.setItem(storageKey, String(size));
    } catch {
      /* ignore */
    }
  }, [size, cssVar, storageKey]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragging.current = true;
      startPos.current = orientation === "vertical" ? e.clientX : e.clientY;
      startSize.current = size;
      document.body.style.cursor =
        orientation === "vertical" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
      e.preventDefault();
    },
    [orientation, size],
  );

  const onDoubleClick = useCallback(() => {
    setSize(defaultPx);
  }, [defaultPx]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const cur = orientation === "vertical" ? e.clientX : e.clientY;
      const delta = (cur - startPos.current) * (invert ? -1 : 1);
      setSize(clamp(startSize.current + delta, minPx, maxPx));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [orientation, invert, minPx, maxPx]);

  return (
    <div
      className={`lg-splitter lg-splitter-${orientation}`}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      role="separator"
      aria-orientation={orientation}
      title="drag to resize · double-click to reset"
      style={style}
    />
  );
}
