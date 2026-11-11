import { FONT_FAMILY, ROUNDNESS, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { FrameId } from "./steps";

/** Fixed regions of the practice whiteboard (scene coordinates). */
export const FRAMES: Record<FrameId, { x: number; y: number; w: number; h: number; title: string; hint?: string }> = {
  fr: {
    x: 0,
    y: 0,
    w: 640,
    h: 300,
    title: "Functional Requirements",
    hint: "e.g.\n1. Users can publish a post\n2. Users can follow people\n3. Users can read a feed",
  },
  nfr: {
    x: 0,
    y: 330,
    w: 640,
    h: 240,
    title: "Non-Functional Requirements",
    hint: "e.g.\n- availability > consistency\n- feed loads in < 200 ms\n- 100M daily users",
  },
  entities: {
    x: 0,
    y: 600,
    w: 640,
    h: 220,
    title: "Core Entities",
    hint: "e.g.\nUser\nPost\nFollow",
  },
  api: {
    x: 0,
    y: 850,
    w: 640,
    h: 340,
    title: "API",
    hint: "e.g.\nPOST /posts -> Post\n  { content }\nGET /feed?cursor -> Post[]\nPOST /follows -> 200\n  { userId }",
  },
  hld: { x: 700, y: 0, w: 1500, h: 1190, title: "High-Level Design" },
};

export const FRAME_IDS = Object.keys(FRAMES) as FrameId[];
export const frameElementId = (id: FrameId) => `bp-frame-${id}`;
export const isSeeded = (id: string) => id.startsWith("bp-");

export const FRAME_STROKE = "#94a3b8";
export const FRAME_ACTIVE = "#2563eb";

function wrap(text: string, width: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) {
      lines.push(line.trim());
      line = w;
    } else line += " " + w;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join("\n");
}

/** The starting board: title, problem summary, and one labelled region per interview phase. */
export function buildInitialScene(title: string, summary: string) {
  const mono = FONT_FAMILY.Cascadia;
  const skeleton: ExcalidrawElementSkeleton[] = [
    {
      type: "text",
      id: "bp-heading",
      x: 0,
      y: -170,
      text: title,
      fontSize: 32,
      fontFamily: mono,
      strokeColor: "#0f172a",
      locked: true,
    },
    {
      type: "text",
      id: "bp-summary",
      x: 0,
      y: -118,
      text: wrap(summary, 150),
      fontSize: 16,
      fontFamily: mono,
      strokeColor: "#64748b",
      locked: true,
    },
  ];

  for (const id of FRAME_IDS) {
    const f = FRAMES[id];
    skeleton.push(
      {
        type: "rectangle",
        id: frameElementId(id),
        x: f.x,
        y: f.y,
        width: f.w,
        height: f.h,
        strokeColor: FRAME_STROKE,
        backgroundColor: "transparent",
        strokeWidth: 1,
        roughness: 1,
        roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
        locked: true,
      },
      {
        type: "text",
        id: `bp-title-${id}`,
        x: f.x + 22,
        y: f.y + 18,
        text: f.title,
        fontSize: 20,
        fontFamily: mono,
        strokeColor: "#334155",
        locked: true,
      },
    );
    if (f.hint) {
      // A faint worked example in the box's top-right corner (from a different problem, so it doesn't give answers away).
      skeleton.push({
        type: "text",
        id: `bp-hint-${id}`,
        x: f.x + f.w - 250,
        y: f.y + 20,
        text: f.hint,
        fontSize: 14,
        fontFamily: mono,
        strokeColor: FRAME_STROKE,
        opacity: 55,
        locked: true,
      });
    }
  }
  return convertToExcalidrawElements(skeleton, { regenerateIds: false });
}
