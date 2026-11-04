import { redirect } from "next/navigation";

/** Existing member and email links continue into the account-backed Practice home. */
export default function MyFoundationsPage() {
  redirect("/my/practice?area=foundations");
}
