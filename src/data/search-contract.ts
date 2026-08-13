export const SEARCH_GROUPS = ["pieces", "projects", "events", "pages"] as const;

export type SearchGroup = (typeof SEARCH_GROUPS)[number];

export type SearchResult = {
  id: string;
  group: SearchGroup;
  title: string;
  description: string;
  meta: string;
  href: string;
};

export type SearchResponse = {
  query: string;
  total: number;
  groups: Record<SearchGroup, SearchResult[]>;
};
