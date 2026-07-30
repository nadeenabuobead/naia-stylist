import { redirect } from "react-router";

export async function loader() {
  return redirect("/", { status: 301 });
}

export default function StylistPopupRedirect() {
  return null;
}
