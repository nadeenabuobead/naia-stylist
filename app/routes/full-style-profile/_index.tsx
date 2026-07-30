import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

export async function loader(_: LoaderFunctionArgs) {
  return redirect("/passport", { status: 301 });
}

export default function FullStyleProfileRedirect() {
  return null;
}
