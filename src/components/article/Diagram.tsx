"use client";

import { Minus, Plus, RotateCcw, X, ZoomIn } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function Diagram({ svg, caption, maxWidth }: { svg: string; caption: string; maxWidth?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <figure className="my-8">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Enlarge diagram: ${caption}`}
        className="group relative mx-auto block w-full cursor-zoom-in"
        style={maxWidth ? { maxWidth } : undefined}
      >
        <div className="diagram-svg" dangerouslySetInnerHTML={{ __html: svg }} />
        <span className="absolute right-1 bottom-1 rounded-[4px] p-1 text-faint opacity-0 transition group-hover:opacity-100 group-hover:text-ink">
          <ZoomIn className="h-4 w-4" />
        </span>
      </button>
      <figcaption className="mt-3 text-center font-serif text-[14px] text-muted italic">{caption}</figcaption>
      {open && <Lightbox svg={svg} caption={caption} onClose={() => setOpen(false)} />}
    </figure>
  );
}

function Lightbox({ svg, caption, onClose }: { svg: string; caption: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const zoom = useCallback((d: number) => setScale((s) => Math.min(4, Math.max(0.5, +(s + d).toFixed(2)))), []);
  const reset = () => {
    setScale(1);
    setPos({ x: 0, y: 0 });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") zoom(0.25);
      if (e.key === "-") zoom(-0.25);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, zoom]);

  return createPortal(
    <div className="animate-fade-in fixed inset-0 z-[70] flex flex-col bg-[#0b1220]/85" onClick={onClose}>
      <div className="flex items-center justify-between px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <p className="truncate text-sm font-medium">{caption}</p>
        <div className="flex items-center gap-1">
          <IconBtn label="Zoom out" onClick={() => zoom(-0.25)}>
            <Minus className="h-4 w-4" />
          </IconBtn>
          <span className="w-12 text-center text-xs tabular-nums">{Math.round(scale * 100)}%</span>
          <IconBtn label="Zoom in" onClick={() => zoom(0.25)}>
            <Plus className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Reset" onClick={reset}>
            <RotateCcw className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Close" onClick={onClose}>
            <X className="h-5 w-5" />
          </IconBtn>
        </div>
      </div>
      <div
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 sm:p-10"
        onWheel={(e) => zoom(e.deltaY < 0 ? 0.15 : -0.15)}
      >
        <div
          className="animate-pop-in w-full max-w-[1400px] cursor-grab touch-none rounded-[5px] bg-bg p-6 select-none active:cursor-grabbing"
          style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`, transition: dragging ? "none" : "transform 120ms" }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
            setDragging(true);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            setPos({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y });
          }}
          onPointerUp={() => {
            drag.current = null;
            setDragging(false);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDragging(false);
          }}
        >
          <div className="diagram-svg" dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} onClick={onClick} className="rounded-md p-2 transition-colors hover:bg-white/15">
      {children}
    </button>
  );
}
