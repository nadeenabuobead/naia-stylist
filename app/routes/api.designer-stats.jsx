import { requireStaffAccess } from "../lib/staff-auth.server";
import { getDesignerStats } from "../lib/designer-stats.server";

export async function loader({ request }) {
  await requireStaffAccess(request);

  const url = new URL(request.url);
  const dateRangeDays = parseInt(url.searchParams.get("dateRange") || "30", 10);
  const stats = await getDesignerStats(dateRangeDays);
  return Response.json(stats, stats.error ? { status: 500 } : undefined);
}
