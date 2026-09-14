import { NextResponse } from "next/server";
import { searchSite } from "@/data/search";
import { getProducts } from "@/lib/shopify";
import { getPublicCommunityEvents } from "@/lib/events/community-event-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").slice(0, 80);
  const products = await getProducts();
  const events = await getPublicCommunityEvents().catch((error) => {
    console.error("Community search unavailable", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return [];
  });
  const response = NextResponse.json(searchSite(products, query, events));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
