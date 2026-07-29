// Temporary runtime verification endpoint — remove after deployment confirmed.
// Public, no auth. Returns JSON with build identity markers.
export async function loader() {
  return Response.json({
    marker: "BUILD 63bee13-RUNTIME-CHECK",
    commit: "63bee138de31928421145223524c5e6ef8ad9742",
    branch: "fix/staging-prisma-binary",
    built: new Date().toISOString(),
    env: process.env.VERCEL_ENV ?? "unknown",
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? "unknown",
    deploymentUrl: process.env.VERCEL_URL ?? "unknown",
  });
}

export default function NaiaBuildCheck() {
  return null;
}
