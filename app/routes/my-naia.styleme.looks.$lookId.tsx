import { Link, Outlet } from "react-router";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { prisma } from "~/lib/prisma.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";
import type { LookData } from "~/components/my-naia/LookDetail";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

function fmtDate(d: string | Date): string {
  const date = new Date(d);
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const sessionId = params.lookId!;

  const session = await prisma.stylingSession.findFirst({
    where: { id: sessionId, customerId: customer.id },
    select: {
      id: true,
      createdAt: true,
      currentMood: true,
      desiredFeeling: true,
      occasion: true,
      styleFrom: true,
      review: { select: { id: true } },
      suggestions: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          outfitName: true,
          whyThisWorks: true,
          hairstyleRec: true,
          savedAsLook: true,
          items: {
            select: {
              itemType: true,
              productTitle: true,
              productUrl: true,
              closetItemId: true,
              closetItem: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  if (!session) {
    throw new Response("Look not found", { status: 404 });
  }

  const sug = session.suggestions[0] ?? null;
  const items = sug?.items ?? [];

  const nadineItems = items
    .filter((i) => !i.closetItemId && i.productTitle)
    .map((i) => i.productTitle!);

  const closetItems = items
    .filter((i) => i.closetItemId)
    .map((i) => i.closetItem?.name ?? "Closet piece");

  const shoesItem = items.find((i) => i.itemType === "SHOES");
  const bagItem = items.find((i) => i.itemType === "BAG");
  const accessoryItems = items.filter((i) => i.itemType === "ACCESSORY");

  const sourcing = nadineItems.length && closetItems.length
    ? "NADINE + My Closet"
    : nadineItems.length
    ? "NADINE"
    : "My Closet";

  const look: LookData = {
    id: session.id,
    title: sug?.outfitName ?? "nAia Look",
    date: fmtDate(session.createdAt),
    occasion: session.occasion ?? "",
    mood: session.currentMood ?? "",
    feeling: session.desiredFeeling ?? "",
    sourcing,
    canTryOn: false,
    tryOnReason: "Virtual Try-On is available for selected looks that include an eligible NADINE piece.",
    saved: sug?.savedAsLook ?? false,
    feedback: session.review ? "reviewed" : null,
    nadinePiece: nadineItems[0] ?? null,
    closetPieces: closetItems,
    shoes: shoesItem?.productTitle ?? shoesItem?.closetItem?.name ?? "",
    bag: bagItem?.productTitle ?? bagItem?.closetItem?.name ?? "",
    accessories: accessoryItems.map((i) => i.productTitle ?? i.closetItem?.name ?? "").filter(Boolean).join(", "),
    hair: sug?.hairstyleRec ?? "",
    colour: "",
    whyItWorks: sug?.whyThisWorks ?? "",
    shopHref: sug?.items.find((i) => i.productUrl)?.productUrl ?? undefined,
  };

  return { look };
}

export default function LookLayout() {
  return (
    <MyNaiaLayout>
      <div className="mn-page-sections">
        <Link to="/my-naia/styleme/looks" className="mn-back-link">
          <span aria-hidden="true">←</span> Back to Looks
        </Link>
        <Outlet />
      </div>
    </MyNaiaLayout>
  );
}
