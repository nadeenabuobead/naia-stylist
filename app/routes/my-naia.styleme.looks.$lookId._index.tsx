import { useRouteLoaderData } from "react-router";
import { LookDetailView } from "~/components/my-naia/LookDetail";
import type { loader as parentLoader } from "~/routes/my-naia.styleme.looks.$lookId";

export default function LookIndex() {
  const { look } = useRouteLoaderData<typeof parentLoader>("routes/my-naia.styleme.looks.$lookId")!;
  return <LookDetailView look={look} />;
}
