// app/routes/admin.naia._index.tsx
//
// nAia Admin workspace index — redirects to Closet Intelligence (M2A).

import { redirect } from "react-router";

export function loader() {
  throw redirect("/admin/naia/closet");
}

export default function NaiaAdminIndex() {
  return null;
}
