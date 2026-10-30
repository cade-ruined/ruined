import { redirect } from "next/navigation";

// Foundations and the profile share one public Timeline. Existing private
// moments remain drafts until their author explicitly publishes them.
export default function MyTimelinePage() { redirect("/my/timeline"); }
