import { redirect } from "react-router";

export async function loader() {
  return redirect("/style-me", { status: 301 });
}

export default function StylistRedirect() {
  return null;
}
