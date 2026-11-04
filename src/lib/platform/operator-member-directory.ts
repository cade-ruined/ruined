import { operatorMemberJourney } from "@/lib/membership/operator-registration-progress";
import type { OperatorMemberSummary } from "@/lib/platform/model";

export type OperatorMemberDirectorySort = "alphabetical" | "status" | "newest" | "oldest";
export type OperatorMemberArchiveView = "current" | "archived" | "all";

export const OPERATOR_MEMBER_SORTS: Array<{ label: string; value: OperatorMemberDirectorySort }> = [
  { label: "Alphabetical", value: "alphabetical" },
  { label: "Status (boxes filled)", value: "status" },
  { label: "New to old", value: "newest" },
  { label: "Old to new", value: "oldest" },
];

export function normalizeOperatorMemberSort(value: string | undefined): OperatorMemberDirectorySort {
  return value === "status" || value === "newest" || value === "oldest" ? value : "alphabetical";
}

export function normalizeOperatorMemberArchive(value: string | undefined): OperatorMemberArchiveView {
  return value === "archived" || value === "all" ? value : "current";
}

export function completedMemberCheckpoints(member: OperatorMemberSummary): number {
  if (!member.registration) return 0;
  return operatorMemberJourney(member.registration).checkpoints
    .filter(checkpoint => checkpoint.state === "complete" || checkpoint.state === "not_required").length;
}

/** Sort the whole authorized roster, after its real registration checkpoints have loaded. */
export function sortOperatorMembers(members: OperatorMemberSummary[], sort: OperatorMemberDirectorySort): OperatorMemberSummary[] {
  const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  const nameOrder = (left: OperatorMemberSummary, right: OperatorMemberSummary) =>
    collator.compare(left.name, right.name) || left.memberId.localeCompare(right.memberId);
  const timestamp = (member: OperatorMemberSummary) => {
    const value = member.createdAt ? Date.parse(member.createdAt) : Number.NaN;
    return Number.isFinite(value) ? value : null;
  };
  const scored = members.map(member => ({ member, completed: sort === "status" ? completedMemberCheckpoints(member) : 0 }));
  scored.sort((left, right) => {
    if (sort === "status") return right.completed - left.completed || nameOrder(left.member, right.member);
    if (sort === "newest" || sort === "oldest") {
      const a = timestamp(left.member), b = timestamp(right.member);
      if (a === null || b === null) return a === b ? nameOrder(left.member, right.member) : a === null ? 1 : -1;
      return (sort === "newest" ? b - a : a - b) || nameOrder(left.member, right.member);
    }
    return nameOrder(left.member, right.member);
  });
  return scored.map(({ member }) => member);
}
