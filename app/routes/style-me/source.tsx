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

// Rev 3 UI source options — 2 options only for fresh Rev 3 flow.
const REV3_SOURCE_OPTIONS = [
  {
    id: "my-closet",
    label: "ONLY MY CLOSET",
    description: "Build the look using pieces I already own.",
  },
  {
    id: "both",
    label: "MY CLOSET + BRANDS",
    description: "Start with what I own, and bring in brand pieces only if they genuinely add something.",
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

  // Rev3: standalone StyleMe is closet-only — bypass source selection entirely.
  if (isRev3 && (!source || !VALID_SOURCE_IDS.has(source) || source === "naia-piece")) {
    session.set("styleMeSource", "my-closet");
    return redirect("/style-me/source", {
      headers: { "Set-Cookie": await commitSession(session) },
    });
  }

  // Legacy: show source selection screen when no valid source is set.
  if (!isRev3 && (!source || !VALID_SOURCE_IDS.has(source) || source === "naia-piece")) {
    const prevSource = (session.get("styleMeSourcePrev") as string | undefined) ?? null;
    return data({ step: "source" as const, isRev3, prevSource });
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

  const anchorMethodPrev = (session.get("styleMeAnchorMethodPrev") as string | undefined) ?? null;
  return data({ step: "anchor-method" as const, source, prevMethod: anchorMethodPrev });
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
    // Clear stale anchor keys and hydration keys whenever source changes.
    session.unset("styleMeNadineAnchorHandle");
    session.unset("styleMeClosetAnchorId");
    session.unset("styleMeAnchorMode");
    session.unset("styleMeSourcePrev");
    session.unset("styleMeAnchorMethodPrev");

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
    // Clear hydration key — a new method is being committed.
    session.unset("styleMeAnchorMethodPrev");
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
      const isRev3Back = !!session.get("styleMeState");
      if (isRev3Back) {
        // Rev3 has no source-selection screen — go back to the previous flow step.
        session.unset("styleMeSource");
        session.unset("styleMeAnchorMode");
        session.unset("styleMeClosetAnchorId");
        return redirect("/style-me/occasion", {
          headers: { "Set-Cookie": await commitSession(session) },
        });
      }
      // Legacy: save source for hydration before clearing.
      const prevSrc = session.get("styleMeSource") as string | undefined;
      if (prevSrc) session.set("styleMeSourcePrev", prevSrc);
      session.unset("styleMeSource");
      session.unset("styleMeAnchorMode");
      session.unset("styleMeClosetAnchorId");
    } else if (from === "closet-anchor") {
      // Save anchor method for hydration before clearing (so AnchorMethodStep restores selection).
      const prevAnchorMode = session.get("styleMeAnchorMode") as string | undefined;
      if (prevAnchorMode) session.set("styleMeAnchorMethodPrev", prevAnchorMode);
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
          <AnchorMethodStep
            source={(loaderData as { source: string }).source}
            prevMethod={(loaderData as { prevMethod?: string | null }).prevMethod ?? null}
          />
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
  const loaderData = useLoaderData<typeof loader>();
  const isRev3 = "isRev3" in loaderData ? (loaderData as { isRev3?: boolean }).isRev3 : false;
  const prevSource = "prevSource" in loaderData ? (loaderData as { prevSource?: string | null }).prevSource : null;
  const [selected, setSelected] = useState<string | null>(prevSource ?? null);
  const options = isRev3 ? REV3_SOURCE_OPTIONS : sourceOptions;

  return (
    <>
      <p className="sm-step-label">Your Anchor</p>
      <h1 className="sm-heading">What should nAia work with today?</h1>
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

// ── Step: anchor method choice (YES — I HAVE A PIECE IN MIND / NO — LET nAia CHOOSE) ───
// Two-step picker: customer selects, then presses Continue.
// prevMethod hydrates the selection when returning from the Closet picker (Back).

function AnchorMethodStep({ source, prevMethod }: { source: string; prevMethod: string | null }) {
  const [selected, setSelected] = useState<string | null>(prevMethod);
  const label = source === "both" ? "NADINE + My Closet" : "My Closet";
  return (
    <>
      <p className="sm-step-label">{label}</p>
      <h1 className="sm-heading">Do you already have a piece in mind?</h1>
      <p className="sm-sub">Your anchor is the piece everything else gets styled around.</p>
      <Form method="post">
        <input type="hidden" name="_action" value="set-anchor-method" />
        <input type="hidden" name="method" value={selected ?? ""} />
        <div className="sm-source-pills">
          <button
            type="button"
            onClick={() => setSelected("manual")}
            className={`sm-source-pill${selected === "manual" ? " sm-pill--on" : ""}`}
          >
            <span className="sm-source-pill-name">YES — I HAVE A PIECE IN MIND</span>
            <span className="sm-source-pill-desc">Let me choose what I want the look built around.</span>
          </button>
          <button
            type="button"
            onClick={() => setSelected("auto")}
            className={`sm-source-pill${selected === "auto" ? " sm-pill--on" : ""}`}
          >
            <span className="sm-source-pill-name">NO — LET nAia CHOOSE</span>
            <span className="sm-source-pill-desc">Choose the best starting point for this look.</span>
          </button>
        </div>
        <div className="sm-step-buttons">
          <button type="submit" disabled={!selected} className="sm-continue">Continue</button>
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
