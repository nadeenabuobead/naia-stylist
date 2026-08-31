import { Form, Link, useLoaderData } from "react-router";
import { data, redirect, type ActionFunctionArgs, type LoaderFunctionArgs, type LinksFunction } from "react-router";

export function meta() {
  return [{ title: "Build the look around | nAia Style Me" }];
}
import { useState } from "react";
import { commitSession, getSession } from "~/lib/session.server";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import prisma from "~/db.server";
import { autoSelectClosetAnchor } from "~/lib/ai/styleme-anchor.server";
import { buildPrivateDownloadUrl, getCloudinaryConfig } from "~/lib/cloudinary-admin.server";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

const VALID_SOURCE_IDS = new Set(["naia-piece", "my-closet", "both"]);

// Rev 3 UI source options — "specific-piece" maps to source=both + anchorMode=manual in action.
const REV3_SOURCE_OPTIONS = [
  {
    id: "my-closet",
    label: "Only My Closet",
    description: "Style a look from what I already own.",
  },
  {
    id: "both",
    label: "My Closet + suggestions if genuinely useful",
    description: "Start with my closet; let nAia add a NADINE piece if it really adds something.",
  },
  {
    id: "specific-piece",
    label: "Style one specific piece",
    description: "Choose a piece and build the look around it.",
  },
  {
    id: "naia-piece",
    label: "Start with something new",
    description: "Build the look around a NADINE piece nAia selects for me.",
  },
];

const sourceOptions = [
  {
    id: "naia-piece",
    label: "The NADINE collection",
    description: "Build the look around the NADINE piece nAia selects for me.",
  },
  {
    id: "my-closet",
    label: "My Closet",
    description: "Create a look using something I already own.",
  },
  {
    id: "both",
    label: "NADINE + My Closet",
    description: "Combine a NADINE piece selected by nAia with my existing wardrobe.",
  },
];

type PickerItem = {
  id: string;
  name: string | null;
  category: string;
  imageUrl: string | null;
};

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getSession(request.headers.get("Cookie"));
  const isRev3 = !!session.get("styleMeState");
  const mood = session.get("styleMeMood");
  const feelings = session.get("styleMeFeelings");
  const bodyNeeds = session.get("styleMeBodyNeeds") as string[] | undefined;
  const occasion = session.get("styleMeOccasion") as string | undefined;

  // Accept Rev 3 path (styleMeState) or legacy path (mood + feelings)
  if (!isRev3 && (!mood || !feelings)) {
    return redirect("/style-me/mood");
  }
  if (!bodyNeeds || !occasion) {
    return redirect(isRev3 ? "/style-me/physical-need" : "/style-me/comfort");
  }

  const source = session.get("styleMeSource") as string | undefined;

  // No source chosen, or source is NADINE-only (which redirects to result in the action) —
  // show the source selection screen.
  if (!source || !VALID_SOURCE_IDS.has(source) || source === "naia-piece") {
    return data({ step: "source" as const, isRev3 });
  }

  // Source is a closet type — check prerequisites before showing the anchor step.
  const naiaCustomer = await getCurrentNaiaCustomer(request);
  if (!naiaCustomer) {
    return data({ step: "requires-login" as const, source });
  }

  const anchorMode = session.get("styleMeAnchorMode") as string | undefined;

  if (anchorMode === "manual") {
    const rawItems = await prisma.closetItem.findMany({
      where: { customerId: naiaCustomer.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, category: true, imageUrl: true, imagePublicId: true, imageFormat: true },
    });
    if (rawItems.length === 0) {
      return data({ step: "empty-closet" as const, source });
    }
    const cfg = getCloudinaryConfig();
    const items: PickerItem[] = rawItems.map((item) => {
      let imageUrl: string | null = null;
      if (item.imagePublicId && item.imageFormat && cfg) {
        imageUrl = buildPrivateDownloadUrl(cfg, item.imagePublicId, item.imageFormat, "private");
      } else if (item.imageUrl) {
        imageUrl = item.imageUrl;
      }
      return { id: item.id, name: item.name, category: item.category, imageUrl };
    });
    return data({ step: "closet-anchor" as const, source, items });
  }

  // No anchorMode yet — check closet has items, then show the method choice.
  const itemCount = await prisma.closetItem.count({
    where: { customerId: naiaCustomer.id },
  });
  if (itemCount === 0) {
    return data({ step: "empty-closet" as const, source });
  }

  return data({ step: "anchor-method" as const, source });
}

// ── Action ────────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get("_action") as string;
  const session = await getSession(request.headers.get("Cookie"));

  // ── Select source ────────────────────────────────────────────────────────────
  if (intent === "set-source") {
    const rawSource = formData.get("source") as string;

    // Rev 3 "specific-piece" → source=both + anchorMode=manual (bypasses anchor-method step).
    if (rawSource === "specific-piece") {
      session.set("styleMeSource", "both");
      session.set("styleMeAnchorMode", "manual");
      session.unset("styleMeNadineAnchorHandle");
      session.unset("styleMeClosetAnchorId");
      return redirect("/style-me/source", {
        headers: { "Set-Cookie": await commitSession(session) },
      });
    }

    const source = rawSource;
    if (!source || !VALID_SOURCE_IDS.has(source)) {
      return data({ error: "Please select what we're styling" }, { status: 400 });
    }
    session.set("styleMeSource", source);
    // Clear stale anchor keys whenever source changes.
    session.unset("styleMeNadineAnchorHandle");
    session.unset("styleMeClosetAnchorId");
    session.unset("styleMeAnchorMode");

    // NADINE-only: engine auto-selects the best piece from session signals.
    if (source === "naia-piece") {
      return redirect("/style-me/result", {
        headers: { "Set-Cookie": await commitSession(session) },
      });
    }

    // MY CLOSET / NADINE + MY CLOSET: redirect back; loader will show anchor-method step.
    return redirect("/style-me/source", {
      headers: { "Set-Cookie": await commitSession(session) },
    });
  }

  // ── Choose anchor method (auto vs manual) ────────────────────────────────────
  if (intent === "set-anchor-method") {
    const method = formData.get("method") as string;

    if (method === "auto") {
      const mood = session.get("styleMeMood") as string | undefined;
      const feelings = session.get("styleMeFeelings") as string[] | undefined;
      const occasion = session.get("styleMeOccasion") as string | undefined;

      const naiaCustomer = await getCurrentNaiaCustomer(request);
      if (!naiaCustomer) {
        return redirect("/style-me/source", {
          headers: { "Set-Cookie": await commitSession(session) },
        });
      }

      const selected = await autoSelectClosetAnchor(naiaCustomer.id, {
        occasion: occasion ?? "everyday",
        moods: mood ? [mood] : [],
        desiredFeelings: feelings ?? [],
      });

      if (!selected) {
        return redirect("/style-me/source", {
          headers: { "Set-Cookie": await commitSession(session) },
        });
      }

      session.set("styleMeClosetAnchorId", selected.id);
      return redirect("/style-me/result", {
        headers: { "Set-Cookie": await commitSession(session) },
      });
    }

    if (method === "manual") {
      session.set("styleMeAnchorMode", "manual");
      return redirect("/style-me/source", {
        headers: { "Set-Cookie": await commitSession(session) },
      });
    }

    return data({ error: "Invalid anchor method" }, { status: 400 });
  }

  // ── Manual closet item selection ─────────────────────────────────────────────
  if (intent === "set-anchor") {
    const closetItemId = formData.get("closetItemId") as string;
    if (!closetItemId) {
      return data({ error: "Please select a Closet item" }, { status: 400 });
    }

    const naiaCustomer = await getCurrentNaiaCustomer(request);
    if (!naiaCustomer) {
      return data({ error: "Not authenticated" }, { status: 401 });
    }

    const item = await prisma.closetItem.findFirst({
      where: { id: closetItemId, customerId: naiaCustomer.id },
    });
    if (!item) {
      return data({ error: "Item not found or access denied" }, { status: 403 });
    }

    session.set("styleMeClosetAnchorId", closetItemId);
    session.unset("styleMeAnchorMode");
    return redirect("/style-me/result", {
      headers: { "Set-Cookie": await commitSession(session) },
    });
  }

  // ── Back navigation (clears step-specific session state) ─────────────────────
  if (intent === "back") {
    const from = formData.get("from") as string;
    if (from === "anchor-method") {
      // Going back to source selection — clear source and anchorMode.
      session.unset("styleMeSource");
      session.unset("styleMeAnchorMode");
      session.unset("styleMeClosetAnchorId");
    } else if (from === "closet-anchor") {
      // Going back to anchor method — clear anchorMode only.
      session.unset("styleMeAnchorMode");
    }
    return redirect("/style-me/source", {
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
    <div className="sm-page sm-page--qs">
      <div className="sm-topbar">
        <span className="sm-topbar-wordmark">nAia</span>
        <Link to="/style-me" className="sm-topbar-exit">Exit</Link>
      </div>
      <div className="sm-progress">
        <div className="sm-progress-dots">
          <div className="sm-progress-dot sm-progress-dot--done" />
          <div className="sm-progress-dot sm-progress-dot--done" />
          <div className="sm-progress-dot sm-progress-dot--done" />
          <div className="sm-progress-dot sm-progress-dot--done" />
          <div className="sm-progress-dot sm-progress-dot--active" />
        </div>
        <div className="sm-progress-label">Step 5 of 5</div>
      </div>

      <div className="sm-inner sm-inner--wide">
        {step === "source" && <SourceStep />}
        {step === "anchor-method" && (
          <AnchorMethodStep source={(loaderData as { source: string }).source} />
        )}
        {step === "closet-anchor" && (
          <ClosetAnchorStep
            source={(loaderData as { source: string }).source}
            items={(loaderData as { items: PickerItem[] }).items}
          />
        )}
        {step === "requires-login" && (
          <RequiresLoginStep source={(loaderData as { source: string }).source} />
        )}
        {step === "empty-closet" && (
          <EmptyClosetStep source={(loaderData as { source: string }).source} />
        )}
      </div>
    </div>
  );
}

// ── Step: source selection ────────────────────────────────────────────────────

function SourceStep() {
  const [selected, setSelected] = useState<string | null>(null);
  const loaderData = useLoaderData<typeof loader>();
  const isRev3 = "isRev3" in loaderData ? (loaderData as { isRev3?: boolean }).isRev3 : false;
  const options = isRev3 ? REV3_SOURCE_OPTIONS : sourceOptions;

  return (
    <>
      <p className="sm-step-label">Your Anchor</p>
      <h1 className="sm-heading">What are we building the look around?</h1>
      <p className="sm-sub">Choose your anchor for today.</p>
      <Form method="post">
        <input type="hidden" name="_action" value="set-source" />
        <div className="sm-source-pills">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setSelected(option.id)}
              className={`sm-source-pill${selected === option.id ? " sm-pill--on" : ""}`}
            >
              <span className="sm-source-pill-name">{option.label}</span>
              <span className="sm-source-pill-desc">{option.description}</span>
            </button>
          ))}
        </div>
        <input type="hidden" name="source" value={selected ?? ""} />
        <div className="sm-step-buttons">
          <Link to="/style-me/occasion" className="sm-btn-back">← Back</Link>
          <button type="submit" disabled={!selected} className="sm-continue">
            Continue
          </button>
        </div>
      </Form>
    </>
  );
}

// ── Step: anchor method choice (LET nAia CHOOSE vs I HAVE A PIECE IN MIND) ───

function AnchorMethodStep({ source }: { source: string }) {
  const label = source === "both" ? "NADINE + My Closet" : "My Closet";
  return (
    <>
      <p className="sm-step-label">{label}</p>
      <h1 className="sm-heading">How should nAia choose your anchor piece?</h1>
      <p className="sm-sub">Your anchor is the piece everything else gets styled around.</p>
      <Form method="post">
        <input type="hidden" name="_action" value="set-anchor-method" />
        <div className="sm-source-pills">
          <button type="submit" name="method" value="auto" className="sm-source-pill">
            <span className="sm-source-pill-name">LET nAia CHOOSE</span>
            <span className="sm-source-pill-desc">Choose the best piece from my Closet for today.</span>
          </button>
          <button type="submit" name="method" value="manual" className="sm-source-pill">
            <span className="sm-source-pill-name">I HAVE A PIECE IN MIND</span>
            <span className="sm-source-pill-desc">I know what I want to wear — help me style it.</span>
          </button>
        </div>
      </Form>
      <Form method="post" style={{ marginTop: "4px" }}>
        <input type="hidden" name="_action" value="back" />
        <input type="hidden" name="from" value="anchor-method" />
        <button type="submit" className="sm-btn-back">← Back</button>
      </Form>
    </>
  );
}

// ── Step: manual closet picker (ClosetAnchorStep) ────────────────────────────

function ClosetAnchorStep({ source, items }: { source: string; items: PickerItem[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const label = source === "both" ? "NADINE + My Closet" : "My Closet";

  return (
    <>
      <p className="sm-step-label">{label}</p>
      <h1 className="sm-heading">Which piece are we building around?</h1>
      <p className="sm-sub">Select the item you want nAia to style.</p>
      <Form method="post">
        <input type="hidden" name="_action" value="set-anchor" />
        <div className="sm-item-picker">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelected(item.id)}
              className={`sm-item-pick-btn${selected === item.id ? " sm-pill--on" : ""}`}
            >
              {item.imageUrl ? (
                <img src={item.imageUrl} alt={item.name ?? item.category} className="sm-item-pick-img" />
              ) : (
                <div className="sm-item-pick-img" aria-hidden />
              )}
              <span className="sm-item-pick-label">
                <span className="sm-item-pick-name">{item.name ?? item.category}</span>
                <span className="sm-item-pick-cat">{item.category}</span>
              </span>
            </button>
          ))}
        </div>
        <input type="hidden" name="closetItemId" value={selected ?? ""} />
        <div className="sm-step-buttons">
          <button type="submit" disabled={!selected} className="sm-continue">
            Continue
          </button>
        </div>
      </Form>
      <Form method="post" style={{ marginTop: "8px" }}>
        <input type="hidden" name="_action" value="back" />
        <input type="hidden" name="from" value="closet-anchor" />
        <button type="submit" className="sm-btn-back">← Back</button>
      </Form>
    </>
  );
}

// ── Edge case: not logged in ──────────────────────────────────────────────────

function RequiresLoginStep({ source }: { source: string }) {
  return (
    <>
      <Link to="/style-me/occasion" className="sm-back">← Back</Link>
      <p className="sm-eyebrow sm-eyebrow--muted" style={{ marginTop: "16px", marginBottom: "8px" }}>
        {source === "both" ? "NADINE + My Closet" : "My Closet"}
      </p>
      <h1 className="sm-heading">Sign in to access your closet</h1>
      <p className="sm-sub" style={{ marginBottom: "28px" }}>
        Your closet is stored in your nAia account. Sign in so nAia can choose the strongest piece for this session.
      </p>
      <Link to="/auth/shopify/login" className="sm-source-btn">Sign In</Link>
    </>
  );
}

// ── Edge case: closet is empty ────────────────────────────────────────────────

function EmptyClosetStep({ source }: { source: string }) {
  return (
    <>
      <Link to="/style-me/occasion" className="sm-back">← Back</Link>
      <p className="sm-eyebrow sm-eyebrow--muted" style={{ marginTop: "16px", marginBottom: "8px" }}>
        {source === "both" ? "NADINE + My Closet" : "My Closet"}
      </p>
      <h1 className="sm-heading">Your closet is empty</h1>
      <p className="sm-sub" style={{ marginBottom: "28px" }}>
        Add items to your closet first, then come back so nAia can build a look around them.
      </p>
      <Link to="/closet" className="sm-source-btn">Add to My Closet</Link>
    </>
  );
}
