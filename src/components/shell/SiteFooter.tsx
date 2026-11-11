import { site } from "@/config/site";
import { BlueprintMark } from "@/components/icons";

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-2 px-5 py-8 text-[13px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-10">
        <span className="flex items-center gap-2">
          <BlueprintMark className="h-4 w-4 text-ink" />
          <span className="font-serif text-[15px] text-ink">{site.name}</span>
          <span className="text-faint">—</span>
          <span>{site.tagline}</span>
        </span>
        <span className="font-serif italic">Read slowly. Draw boxes. Defend trade-offs.</span>
      </div>
    </footer>
  );
}
