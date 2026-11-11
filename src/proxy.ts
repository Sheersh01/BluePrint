import { NextResponse, type NextRequest } from "next/server";
import { navigation, hrefFor } from "@/content/navigation";

// Every sidebar entry has a real article, so anything else under /learn/system-design is a 404.
const known = new Set(navigation.flatMap((s) => s.items.map((i) => hrefFor(s.section, i.slug))));

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname.replace(/\/$/, "");
  if (!known.has(path)) {
    // Rewriting to a route that doesn't exist renders not-found.tsx with a proper 404 status.
    return NextResponse.rewrite(new URL("/__not-found", request.url));
  }
}

export const config = { matcher: "/learn/system-design/:section/:slug" };
