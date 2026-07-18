import { Form, Link, useLoaderData } from "react-router";
import { data, redirect, type ActionFunctionArgs, type LoaderFunctionArgs, type LinksFunction } from "react-router";
import { useState } from "react";
import { commitSession, getSession } from "~/lib/session.server";
import { getAllCatalogProducts } from "~/lib/ai/naia-catalog";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

const VALID_SOURCE_IDS = new Set(["naia-piece", "my-closet", "both"]);

const V8_HANDLES = new Set(getAllCatalogProducts().map((p) => p.handle));

const sourceOptions = [
  { id: "naia-piece", label: "A nAia piece", description: "Style one of our pieces as the anchor" },
  { id: "my-closet", label: "Something from my closet", description: "Build the look around what you own" },
  { id: "both", label: "nAia + my closet", description: "Pair a nAia piece with something you already have" },
];

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request.headers.get("Cookie"));
  const mood = session.get("styleMeMood");
  const feelings = session.get("styleMeFeelings");
  const bodyNeeds = session.get("styleMeBodyNeeds") as string[] | undefined;
  const occasion = session.get("styleMeOccasion") as string | undefined;

  if (!mood || !feelings || !bodyNeeds || !occasion) {
    return redirect("/style-me/mood");
  }

  const source = session.get("styleMeSource") as string | undefined;

  // Step 2a — naia-piece anchor selection
  if (source === "naia-piece") {
    const products = getAllCatalogProducts().map((p) => ({
      handle: p.handle,
      title: p.parsed.identity.verifiedTitle,
      itemType: p.parsed.identity.itemType,
      featuredImageUrl: p.parsed.identity.featuredImageUrl ?? null,
    }));
    const selectedHandle = session.get("styleMeNadineAnchorHandle") as string | undefined ?? null;
    return data({
      step: "nadine-anchor" as const,
      source,
      products,
      closetItems: null,
      selectedHandle,
      selectedClosetId: null,
      requiresLogin: false,
    });
  }

  // Step 2b — closet anchor selection
  if (source === "my-closet" || source === "both") {
    const naiaCustomer = await getCurrentNaiaCustomer(request);
    const selectedClosetId = session.get("styleMeClosetAnchorId") as string | undefined ?? null;

    if (!naiaCustomer) {
      return data({
        step: "closet-anchor" as const,
        source,
        products: null,
        closetItems: null,
        selectedHandle: null,
        selectedClosetId,
        requiresLogin: true,
      });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: naiaCustomer.id },
      include: { closetItems: { orderBy: { createdAt: "desc" }, take: 50 } },
    });

    const closetItems = (customer?.closetItems ?? []).map((item) => ({
      id: item.id,
      name: item.name ?? null,
      category: item.category as string,
      imageUrl: item.imageUrl,
      primaryColor: item.primaryColor ?? null,
    }));

    return data({
      step: "closet-anchor" as const,
      source,
      products: null,
      closetItems,
      selectedHandle: null,
      selectedClosetId,
      requiresLogin: false,
    });
  }

  // Step 1 — source selection
  return data({
    step: "source" as const,
    source: null,
    products: null,
    closetItems: null,
    selectedHandle: null,
    selectedClosetId: null,
    requiresLogin: false,
  });
}

// ── Action ────────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get("_action") as string;
  const session = await getSession(request.headers.get("Cookie"));

  if (intent === "set-source") {
    const source = formData.get("source") as string;
    if (!source || !VALID_SOURCE_IDS.has(source)) {
      return data({ error: "Please select what we're styling" }, { status: 400 });
    }
    session.set("styleMeSource", source);
    // Clear stale anchor keys whenever source changes
    session.unset("styleMeNadineAnchorHandle");
    session.unset("styleMeClosetAnchorId");
    return redirect("/style-me/source", {
      headers: { "Set-Cookie": await commitSession(session) },
    });
  }

  if (intent === "set-anchor") {
    const source = session.get("styleMeSource") as string | undefined;
    if (!source || !VALID_SOURCE_IDS.has(source)) {
      return redirect("/style-me/source");
    }

    if (source === "naia-piece") {
      const handle = formData.get("nadineHandle") as string;
      if (!handle || !V8_HANDLES.has(handle)) {
        return data({ error: "Please select a nAia piece" }, { status: 400 });
      }
      session.set("styleMeNadineAnchorHandle", handle);
      session.unset("styleMeClosetAnchorId");
    } else {
      // my-closet or both — ownership verified in result action via resolveClosetAnchor
      const closetItemId = formData.get("closetItemId") as string;
      if (!closetItemId) {
        return data({ error: "Please select an item from your closet" }, { status: 400 });
      }
      session.set("styleMeClosetAnchorId", closetItemId);
      session.unset("styleMeNadineAnchorHandle");
    }

    return redirect("/style-me/result", {
      headers: { "Set-Cookie": await commitSession(session) },
    });
  }

  return data({ error: "Invalid action" }, { status: 400 });
}

// ── UI ────────────────────────────────────────────────────────────────────────

export default function StyleMeSource() {
  const loaderData = useLoaderData<typeof loader>();
  const { step } = loaderData;

  return (
    <div className="sm-page">
      <div className="sm-inner sm-inner--wide">
        <Link to="/style-me/occasion" className="sm-back">← Back</Link>

        {step === "source" && <SourceStep />}
        {step === "nadine-anchor" && loaderData.products !== null && (
          <NadineAnchorStep
            products={loaderData.products}
            initialHandle={loaderData.selectedHandle}
            source={loaderData.source!}
          />
        )}
        {step === "closet-anchor" && (
          <ClosetAnchorStep
            closetItems={loaderData.closetItems}
            initialId={loaderData.selectedClosetId}
            requiresLogin={loaderData.requiresLogin}
            source={loaderData.source!}
          />
        )}
      </div>
    </div>
  );
}

// ── Step 1: source selection ──────────────────────────────────────────────────

function SourceStep() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <>
      <h1 className="sm-heading">What are we building the look around?</h1>
      <p className="sm-sub" style={{ marginBottom: "32px" }}>Choose your anchor for today</p>
      <Form method="post">
        <input type="hidden" name="_action" value="set-source" />
        <div className="sm-grid sm-grid--card" style={{ marginBottom: "32px" }}>
          {sourceOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setSelected(option.id)}
              className={`sm-chip-card${selected === option.id ? " sm-chip--on" : ""}`}
            >
              <div className="sm-chip-body">
                <span className="sm-chip-label">{option.label}</span>
                <span className="sm-chip-desc">{option.description}</span>
              </div>
            </button>
          ))}
        </div>
        <input type="hidden" name="source" value={selected ?? ""} />
        <button
          type="submit"
          disabled={!selected}
          className="sm-continue"
        >
          Continue
        </button>
      </Form>
    </>
  );
}

// ── Step 2a: nAia piece selection ─────────────────────────────────────────────

type NadineProduct = { handle: string; title: string; itemType: string; featuredImageUrl: string | null };

function NadineAnchorStep({
  products,
  initialHandle,
  source,
}: {
  products: NadineProduct[];
  initialHandle: string | null;
  source: string;
}) {
  const [selected, setSelected] = useState<string | null>(initialHandle);

  return (
    <>
      <p className="sm-eyebrow sm-eyebrow--muted" style={{ marginBottom: "8px" }}>
        {source === "both" ? "nAia + My Closet" : "nAia Piece"}
      </p>
      <h1 className="sm-heading">Which piece are we building around?</h1>
      <p className="sm-sub" style={{ marginBottom: "28px" }}>Select the nAia piece you'd like to style.</p>

      <Form method="post">
        <input type="hidden" name="_action" value="set-anchor" />
        <input type="hidden" name="nadineHandle" value={selected ?? ""} />

        <div className="sm-product-grid">
          {products.map((product) => (
            <button
              key={product.handle}
              type="button"
              onClick={() => setSelected(product.handle)}
              className={`sm-product-card${selected === product.handle ? " sm-chip--on" : ""}`}
            >
              {product.featuredImageUrl && (
                <img
                  src={product.featuredImageUrl}
                  alt={product.title}
                  className="sm-product-img"
                />
              )}
              <div className="sm-product-name">{product.title}</div>
              <div className="sm-product-type">{product.itemType.toLowerCase()}</div>
            </button>
          ))}
        </div>

        <button
          type="submit"
          disabled={!selected}
          className="sm-continue"
        >
          Get My Look
        </button>
      </Form>
    </>
  );
}

// ── Step 2b: closet item selection ────────────────────────────────────────────

type ClosetItem = { id: string; name: string | null; category: string; imageUrl: string; primaryColor: string | null };

function ClosetAnchorStep({
  closetItems,
  initialId,
  requiresLogin,
  source,
}: {
  closetItems: ClosetItem[] | null;
  initialId: string | null;
  requiresLogin: boolean;
  source: string;
}) {
  const [selected, setSelected] = useState<string | null>(initialId);

  if (requiresLogin) {
    return (
      <>
        <h1 className="sm-heading">Sign in to access your closet</h1>
        <p className="sm-sub" style={{ marginBottom: "28px" }}>
          Your closet is stored in your nAia account. Sign in to choose an item to build your look around.
        </p>
        <Link to="/login" className="sm-source-btn">Sign In</Link>
      </>
    );
  }

  if (!closetItems || closetItems.length === 0) {
    return (
      <>
        <h1 className="sm-heading">Your closet is empty</h1>
        <p className="sm-sub" style={{ marginBottom: "28px" }}>
          Add items to your closet first, then come back to build a look around them.
        </p>
        <Link to="/closet" className="sm-source-btn">Add to My Closet</Link>
      </>
    );
  }

  return (
    <>
      <p className="sm-eyebrow sm-eyebrow--muted" style={{ marginBottom: "8px" }}>
        {source === "both" ? "nAia + My Closet" : "My Closet"}
      </p>
      <h1 className="sm-heading">Which piece are we building around?</h1>
      <p className="sm-sub" style={{ marginBottom: "28px" }}>Select an item from your closet to anchor the look.</p>

      <Form method="post">
        <input type="hidden" name="_action" value="set-anchor" />
        <input type="hidden" name="closetItemId" value={selected ?? ""} />

        <div className="sm-product-grid">
          {closetItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelected(item.id)}
              className={`sm-product-card${selected === item.id ? " sm-chip--on" : ""}`}
            >
              <img
                src={item.imageUrl}
                alt={item.name ?? item.category}
                className="sm-product-img"
              />
              <div className="sm-product-name">
                {item.name ?? item.category.charAt(0) + item.category.slice(1).toLowerCase()}
              </div>
              {item.primaryColor && (
                <div className="sm-product-type">{item.primaryColor}</div>
              )}
            </button>
          ))}
        </div>

        <button
          type="submit"
          disabled={!selected}
          className="sm-continue"
        >
          Get My Look
        </button>
      </Form>
    </>
  );
}
