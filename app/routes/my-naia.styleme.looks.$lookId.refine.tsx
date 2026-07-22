import { useRouteLoaderData } from "react-router";
import { LookDetailView, RefinePanel } from "~/components/my-naia/LookDetail";
import type { loader as parentLoader } from "~/routes/my-naia.styleme.looks.$lookId";

export default function RefinePage() {
  const { look } = useRouteLoaderData<typeof parentLoader>("routes/my-naia.styleme.looks.$lookId")!;
  return (
    <>
      <LookDetailView look={look} />
      <RefinePanel look={look} />
    </>
  );
}
