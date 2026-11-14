import { getStats } from "@/lib/stats";
import { Dashboard } from "./dashboard";

export const dynamic = "force-dynamic"; // always live from the DB

export default async function Page() {
  return <Dashboard s={await getStats()} />;
}
