import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export default async function OperationsSyncPage() {
  redirect("/ops/access-billing");
}
