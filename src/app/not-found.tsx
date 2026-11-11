import Link from "next/link";
import { SiteHeader } from "@/components/shell/SiteHeader";
import { SiteFooter } from "@/components/shell/SiteFooter";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1080px] flex-1 px-5 py-28 sm:px-10">
        <p className="label-caps">404</p>
        <h1 className="mt-4 font-serif text-[48px] leading-none font-medium tracking-[-0.03em] text-ink">Not in the library.</h1>
        <p className="mt-4 max-w-[48ch] text-[17px] text-body">
          That page doesn&apos;t exist — it may have been an empty section we retired.
        </p>
        <Link
          href="/"
          className="mt-8 inline-block text-[15px] text-primary underline underline-offset-4 hover:text-primary-hover"
        >
          Back to the index
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
