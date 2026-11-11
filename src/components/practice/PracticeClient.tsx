"use client";

import dynamic from "next/dynamic";
import type { WorkspaceProps } from "./PracticeWorkspace";

// The workspace reads saved progress from localStorage and hosts the canvas, so it renders in the browser only.
const PracticeWorkspace = dynamic(() => import("./PracticeWorkspace"), {
  ssr: false,
  loading: () => <WorkspaceSkeleton />,
});

export function PracticeClient(props: WorkspaceProps) {
  return <PracticeWorkspace {...props} />;
}

export function WorkspaceSkeleton() {
  return (
    <div className="flex h-dvh animate-pulse bg-bg">
      <div className="w-full space-y-4 border-r border-line p-6 lg:w-[440px]">
        <div className="h-4 w-24 rounded-sm bg-surface-muted" />
        <div className="h-8 w-80 max-w-full rounded-sm bg-surface-muted" />
        <div className="h-32 w-full rounded-sm bg-surface-muted" />
      </div>
      <div className="hidden flex-1 lg:block" />
    </div>
  );
}
