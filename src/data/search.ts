import { EVENTS } from "@/data/events";
import { type Product } from "@/data/products";
import {
  SEARCH_GROUPS,
  type SearchGroup,
  type SearchResponse,
  type SearchResult,
} from "@/data/search-contract";

type SearchDocument = SearchResult & {
  searchable: string;
  priority: number;
};

const PAGES: SearchDocument[] = [
  {
    id: "walk",
    group: "pages",
    title: "Explore the Walk",
    description: "Move through the Lobby, Store, Artifacts, About, and Community.",
    meta: "Experience",
    href: "/#top",
    searchable: "home journey explore walk lobby store work about events rooms experience",
    priority: 100,
  },
  {
    id: "shop",
    group: "pages",
    title: "Store",
    description: "View available garments, objects, and current preorder dispatch dates.",
    meta: "Catalogue",
    href: "/store",
    searchable: "store shop catalogue catalog garments clothing objects pieces preorder",
    priority: 95,
  },
  {
    id: "work",
    group: "pages",
    title: "Artifacts",
    description: "Objects, spaces, garments, and systems from the project archive.",
    meta: "Project archive",
    href: "/#work",
    searchable: "artifacts work projects archive portfolio objects spaces garments systems design",
    priority: 90,
  },
  {
    id: "about",
    group: "pages",
    title: "About Ruined",
    description: "The independent multidisciplinary studio and the thinking behind it.",
    meta: "Studio",
    href: "/#about",
    searchable: "about ruined studio philosophy company practice multidisciplinary utah",
    priority: 85,
  },
  {
    id: "events",
    group: "pages",
    title: "Community",
    description: "Open studios, conversations, installations, and late sessions.",
    meta: "Programme",
    href: "/#events",
    searchable: "community events programme calendar open studio conversations installations sessions fireside",
    priority: 80,
  },
  {
    id: "contact",
    group: "pages",
    title: "Contact",
    description: "General questions and messages for The Ruined Project.",
    meta: "Questions",
    href: "/contact",
    searchable: "contact email question questions message messages general location",
    priority: 75,
  },
  {
    id: "privacy",
    group: "pages",
    title: "Privacy",
    description: "How Ruined handles personal information.",
    meta: "Policy",
    href: "/privacy",
    searchable: "privacy policy personal information data",
    priority: 20,
  },
];

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function productDocuments(products: Product[]): SearchDocument[] {
  return products.map((product, index) => ({
    id: product.id,
    group: "pieces",
    title: product.name,
    description: product.description,
    meta: `${product.code} · ${product.price}`,
    href: `/store/${product.id}`,
    searchable: [
      product.name,
      product.code,
      product.subtitle,
      product.description,
      product.material,
      product.origin,
      product.care,
      "piece product garment clothing shop store",
    ].join(" "),
    priority: 100 - index,
  }));
}

const PROJECT_DOCUMENTS: SearchDocument[] = [];

const EVENT_DOCUMENTS: SearchDocument[] = EVENTS.map((event, index) => ({
  id: event.id,
  group: "events",
  title: event.title,
  description: event.summary,
  meta: `${event.date} · ${event.location}`,
  href: `/community#${event.id}`,
  searchable: [
    event.title,
    event.eyebrow,
    event.summary,
    event.date,
    event.time,
    event.location,
    event.admission,
    event.status,
    "community event programme calendar",
  ].join(" "),
  priority: event.status === "Upcoming" ? 100 - index : 60 - index,
}));

function emptyGroups(): Record<SearchGroup, SearchResult[]> {
  return { pieces: [], projects: [], events: [], pages: [] };
}

function toResult(document: SearchDocument): SearchResult {
  const { searchable: _searchable, priority: _priority, ...result } = document;
  void _searchable;
  void _priority;
  return result;
}

function suggestionResponse(documents: SearchDocument[]): SearchResponse {
  const limits: Record<SearchGroup, number> = {
    pieces: 3,
    projects: 2,
    events: 2,
    pages: 3,
  };
  const groups = emptyGroups();
  for (const group of SEARCH_GROUPS) {
    groups[group] = documents
      .filter((document) => document.group === group)
      .sort((a, b) => b.priority - a.priority)
      .slice(0, limits[group])
      .map(toResult);
  }
  return {
    query: "",
    total: SEARCH_GROUPS.reduce((total, group) => total + groups[group].length, 0),
    groups,
  };
}

function scoreDocument(document: SearchDocument, query: string, tokens: string[]) {
  const title = normalize(document.title);
  const searchable = normalize(`${document.title} ${document.meta} ${document.searchable}`);
  if (!tokens.every((token) => searchable.includes(token))) return -1;

  let score = document.priority;
  if (title === query) score += 1_000;
  else if (title.startsWith(query)) score += 500;
  else if (title.includes(query)) score += 250;
  for (const token of tokens) {
    if (title.split(" ").some((word) => word.startsWith(token))) score += 80;
    else if (title.includes(token)) score += 40;
  }
  return score;
}

export function searchSite(products: Product[] = [], rawQuery = ""): SearchResponse {
  const documents = [
    ...productDocuments(products),
    ...PROJECT_DOCUMENTS,
    ...EVENT_DOCUMENTS,
    ...PAGES,
  ];
  const query = normalize(rawQuery).slice(0, 80);
  if (!query) return suggestionResponse(documents);

  const tokens = query.split(" ").filter(Boolean);
  const groups = emptyGroups();
  for (const group of SEARCH_GROUPS) {
    groups[group] = documents
      .filter((document) => document.group === group)
      .map((document) => ({ document, score: scoreDocument(document, query, tokens) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((entry) => toResult(entry.document));
  }

  return {
    query: rawQuery.trim().slice(0, 80),
    total: SEARCH_GROUPS.reduce((total, group) => total + groups[group].length, 0),
    groups,
  };
}
