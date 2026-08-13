import { NextResponse } from "next/server";
import { searchSite } from "@/data/search";
import { getProducts } from "@/lib/shopify";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").slice(0, 80);
  const products = await getProducts();
  const response = NextResponse.json(searchSite(products, query));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
