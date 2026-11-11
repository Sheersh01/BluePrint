"use client";

import "@excalidraw/excalidraw/index.css";
import {
  CaptureUpdateAction,
  Excalidraw,
  exportToBlob,
  getSceneVersion,
  newElementWith,
  restoreElements,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  FRAMES,
  FRAME_ACTIVE,
  FRAME_IDS,
  FRAME_STROKE,
  buildInitialScene,
  frameElementId,
  isSeeded,
} from "@/lib/practice/initialScene";
import { clearScene, loadScene, saveScene } from "@/lib/practice/storage";
import type { FrameId } from "@/lib/practice/steps";

/** What the workspace can ask the board for. */
export interface CanvasController {
  /**
   * Text and (optionally) a PNG of everything drawn in a step's region of the board.
   * `version` changes whenever anything in that region changes.
   */
  snapshot: (frame: FrameId, opts?: { image?: boolean }) => Promise<{ text: string; image?: string; version: string }>;
}

type Bounds = [number, number, number, number];

/** Matches the app's paper background (Excalidraw inverts it for dark mode). */
const PAPER = "#f5f7fb";

const frameBounds = (id: FrameId): Bounds => {
  const f = FRAMES[id];
  return [f.x, f.y, f.x + f.w, f.y + f.h];
};

function elementBounds(el: ExcalidrawElement): Bounds {
  if ("points" in el && el.points.length) {
    const xs = el.points.map((p) => el.x + p[0]);
    const ys = el.points.map((p) => el.y + p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  return [el.x, el.y, el.x + el.width, el.y + el.height];
}

const overlaps = (a: Bounds, b: Bounds) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** Which seeded region an element belongs to (the one it overlaps most), or null if it's outside all of them. */
function regionOf(el: ExcalidrawElement): FrameId | null {
  const eb = elementBounds(el);
  let best: FrameId | null = null;
  let bestArea = 0;
  for (const id of FRAME_IDS) {
    const fb = frameBounds(id);
    const w = Math.min(eb[2], fb[2]) - Math.max(eb[0], fb[0]);
    const h = Math.min(eb[3], fb[3]) - Math.max(eb[1], fb[1]);
    const area = Math.max(w, 0.5) * Math.max(h, 0.5);
    if (overlaps(eb, fb) && area > bestArea) {
      best = id;
      bestArea = area;
    }
  }
  return best;
}

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

function useDarkMode() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setDark(el.classList.contains("dark")));
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export default function PracticeCanvas({
  slug,
  title,
  summary,
  activeFrame,
  onReady,
}: {
  slug: string;
  title: string;
  summary: string;
  activeFrame: FrameId;
  onReady: (c: CanvasController) => void;
}) {
  const dark = useDarkMode();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const lastVersion = useRef(-1);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [boardKey, setBoardKey] = useState(0);

  const initialData = useMemo(() => {
    const saved = loadScene(slug);
    const appState = { viewBackgroundColor: PAPER };
    if (saved?.elements?.length) {
      return {
        elements: saved.elements as ExcalidrawElement[],
        files: (saved.files ?? {}) as BinaryFiles,
        appState,
      };
    }
    return { elements: buildInitialScene(title, summary), appState };
    // boardKey forces a fresh scene after "Reset board"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, title, summary, boardKey]);

  // Highlight and pan to the region for the current step.
  useEffect(() => {
    if (!api) return;
    const activeId = frameElementId(activeFrame);
    const elements = api.getSceneElementsIncludingDeleted().map((el) => {
      if (!el.id.startsWith("bp-frame-")) return el;
      const active = el.id === activeId;
      const strokeColor = active ? FRAME_ACTIVE : FRAME_STROKE;
      const strokeWidth = active ? 2 : 1;
      return el.strokeColor === strokeColor && el.strokeWidth === strokeWidth
        ? el
        : newElementWith(el, { strokeColor, strokeWidth });
    });
    api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });

    // On first mount the scene may not be populated yet, so retry briefly before falling back to the whole board.
    let t: ReturnType<typeof setTimeout>;
    let tries = 0;
    const pan = () => {
      const target = api.getSceneElements().find((el) => el.id === activeId);
      if (!target && tries++ < 15) {
        t = setTimeout(pan, 100);
        return;
      }
      api.scrollToContent(target ?? undefined, {
        fitToViewport: true,
        viewportZoomFactor: activeFrame === "hld" ? 0.9 : 0.7,
        animate: tries === 0,
        duration: 350,
      });
    };
    t = setTimeout(pan, 60);
    return () => clearTimeout(t);
  }, [api, activeFrame, boardKey]);

  // The board's labels are measured before Excalidraw's fonts finish loading, which clips them.
  // Re-measure the seeded labels whenever a font finishes loading.
  useEffect(() => {
    if (!api) return;
    const refresh = () => {
      const all = api.getSceneElementsIncludingDeleted();
      const fixed = new Map(
        restoreElements(
          all.filter((el) => isSeeded(el.id) && el.type === "text"),
          null,
          // (Excalidraw only applies refreshDimensions together with repairBindings.)
          { refreshDimensions: true, repairBindings: true },
        ).map((el) => [el.id, el]),
      );
      if (fixed.size === 0) return;
      api.updateScene({
        elements: all.map((el) => fixed.get(el.id) ?? el),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    };
    void document.fonts.ready.then(refresh);
    document.fonts.addEventListener("loadingdone", refresh);
    return () => document.fonts.removeEventListener("loadingdone", refresh);
  }, [api]);

  // Hand the workspace a way to read the board.
  useEffect(() => {
    if (!api) return;
    onReady({
      snapshot: async (frame, opts) => {
        const all = api.getSceneElements();
        const inRegion = all.filter((el) => {
          const r = regionOf(el);
          // The design region also collects anything drawn outside the labelled boxes.
          return frame === "hld" ? r === "hld" || r === null : r === frame;
        });
        const drawn = inRegion.filter((el) => !isSeeded(el.id));
        const version = drawn
          .map((el) => `${el.id}:${el.version}`)
          .sort()
          .join(",");
        if (drawn.length === 0) return { text: "", version };

        const text = drawn
          .filter((el) => el.type === "text")
          .sort((a, b) => a.y - b.y || a.x - b.x)
          .map((el) => (el as Extract<NonDeletedExcalidrawElement, { type: "text" }>).text.trim())
          .filter(Boolean)
          .join("\n");
        if (opts?.image === false) return { text, version };

        // When the region holds only typed text, that text says everything an image would,
        // so skip the image and save the request's tokens. Shapes, arrows, pen strokes or
        // pasted images always go along as a picture.
        const hasDrawing = drawn.some((el) => el.type !== "text" || el.containerId);
        if (!hasDrawing) return { text, version };

        let image: string | undefined;
        try {
          const elements = inRegion.filter((el) => !el.id.startsWith("bp-hint-"));
          const blob = await exportToBlob({
            elements,
            files: api.getFiles(),
            mimeType: "image/png",
            // The design area holds full diagrams; the smaller boxes hold short notes.
            maxWidthOrHeight: frame === "hld" ? 1400 : 1024,
            exportPadding: 24,
            appState: { exportBackground: true, viewBackgroundColor: "#ffffff", exportWithDarkMode: false },
          });
          image = await blobToBase64(blob);
        } catch (err) {
          console.warn("[practice] couldn't export the board image", err);
        }
        return { text, image, version };
      },
    });
  }, [api, onReady]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const onChange = (elements: readonly ExcalidrawElement[], _state: unknown, files: BinaryFiles) => {
    const version = getSceneVersion(elements);
    if (version === lastVersion.current) return;
    lastVersion.current = version;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const live = elements.filter((el) => !el.isDeleted);
      const used = new Set(live.flatMap((el) => ("fileId" in el && el.fileId ? [el.fileId] : [])));
      const keptFiles = Object.fromEntries(Object.entries(files).filter(([id]) => used.has(id as never)));
      saveScene(slug, { elements: live, files: keptFiles });
    }, 600);
  };

  const reset = () => {
    if (!window.confirm("Clear the whiteboard and start from a blank board? Your written answers are kept.")) return;
    clearScene(slug);
    lastVersion.current = -1;
    setApi(null);
    setBoardKey((k) => k + 1);
  };

  return (
    <div className="practice-canvas absolute inset-0">
      <Excalidraw
        key={boardKey}
        excalidrawAPI={setApi}
        initialData={initialData}
        onChange={onChange}
        theme={dark ? "dark" : "light"}
        name={`${title} — practice`}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            export: false,
            toggleTheme: false,
            clearCanvas: false,
          },
        }}
        renderTopRightUI={() => (
          <button
            type="button"
            onClick={reset}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] text-body shadow-sm transition-colors hover:text-ink"
            title="Reset the whiteboard"
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
            <span className="hidden xl:inline">Reset board</span>
          </button>
        )}
      />
    </div>
  );
}
