import { redirect } from "react-router";

export async function loader() {
  return redirect("/my-naia", { status: 301 });
}

export default function AccountRedirect() {
  return null;
}
