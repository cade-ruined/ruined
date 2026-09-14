/** Keep directory state without accepting an arbitrary return URL. */
export function operatorMemberReturnLocation(value: unknown): string {
  if (typeof value !== "string" || value.length > 1600 || !/^\/ops\/members(?:\?|$)/.test(value)) return "/ops/members";
  const url = new URL(value, "https://operator.invalid");
  if (url.pathname !== "/ops/members" || url.origin !== "https://operator.invalid") return "/ops/members";
  const params = new URLSearchParams();
  const query = url.searchParams.get("q")?.trim().slice(0, 120);
  const filter = url.searchParams.get("filter");
  const page = url.searchParams.get("page");
  if (query) params.set("q", query);
  if (filter && ["attention", "foundations", "unassigned"].includes(filter)) params.set("filter", filter);
  if (page && /^\d{1,6}$/.test(page) && Number(page) > 1) params.set("page", String(Number(page)));
  return params.size ? `/ops/members?${params}` : "/ops/members";
}
