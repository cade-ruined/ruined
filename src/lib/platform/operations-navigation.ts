export type OperatorNavigationRole = "circle_leader" | "guide" | "ops_admin";

export type OperationsDestination = {
  adminOnly?: boolean;
  href: string;
  label: string;
  task: string;
};

export type OperationsNavigationGroup = {
  id: string;
  label: string;
  items: OperationsDestination[];
};

const OPERATIONS_NAVIGATION: OperationsNavigationGroup[] = [
  { id: "overview", label: "Overview", items: [
    { href: "/ops", label: "Overview", task: "See today's activity" },
  ] },
  { id: "people", label: "People", items: [
    { href: "/ops/members", label: "Members", task: "Find a member" },
    { href: "/ops/circles", label: "Circles", task: "Open a Circle roster" },
    { href: "/ops/blocks", label: "Blocks", task: "Organize Circles into Blocks", adminOnly: true },
    { href: "/ops/operators", label: "Operators", task: "Add or manage operators", adminOnly: true },
  ] },
  { id: "programme", label: "Learning & events", items: [
    { href: "/ops/foundations", label: "Foundations", task: "Review Foundations progress" },
    { href: "/ops/experiences", label: "Experiences", task: "Plan events and take attendance" },
    { href: "/ops/academy", label: "Academy", task: "Organize training videos", adminOnly: true },
    { href: "/ops/artifacts", label: "Artifacts", task: "Manage awards and fulfillment", adminOnly: true },
  ] },
  { id: "communication", label: "Messages", items: [
    { href: "/ops/support", label: "Support", task: "Reply to support requests", adminOnly: true },
    { href: "/ops/announcements", label: "Announcements", task: "Publish an announcement", adminOnly: true },
    { href: "/ops/notifications", label: "Notifications", task: "Send a notification", adminOnly: true },
  ] },
  { id: "workspace", label: "Tasks & tools", items: [
    { href: "/ops/work", label: "Work queue", task: "Review open work" },
    { href: "/ops/system", label: "System", task: "Check services and delivery", adminOnly: true },
  ] },
];

export function getOperationsNavigation(role: OperatorNavigationRole | null | undefined): OperationsNavigationGroup[] {
  if (role !== "ops_admin" && role !== "circle_leader" && role !== "guide") return [];
  return OPERATIONS_NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.adminOnly || role === "ops_admin"),
  })).filter((group) => group.items.length > 0);
}

export function isOperationsPathCurrent(pathname: string, href: string): boolean {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/$/, "");
  return path === href || (href !== "/ops" && path.startsWith(`${href}/`));
}

export function getOperationsLocation(pathname: string, groups: OperationsNavigationGroup[]) {
  for (const group of groups) {
    const item = group.items.find((candidate) => isOperationsPathCurrent(pathname, candidate.href));
    if (item) return { group, item };
  }
  return null;
}
