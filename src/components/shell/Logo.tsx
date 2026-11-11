import Link from "next/link";
import { BlueprintMark } from "@/components/icons";
import { site } from "@/config/site";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`group flex items-center gap-2 text-ink ${className}`} aria-label={`${site.name} home`}>
      <BlueprintMark className="h-[22px] w-[22px] shrink-0 transition-transform group-hover:-rotate-6" />
      <span className="font-serif text-[22px] leading-none font-semibold tracking-[-0.02em]">{site.name}</span>
    </Link>
  );
}
