export async function loader() {
  return Response.json({ ok: true, sentinel: "v1" });
}
