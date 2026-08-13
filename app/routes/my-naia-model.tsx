// app/routes/my-naia-model.tsx
// Authenticated My nAia Model route.
// Loader: reads NaiaModel record from DB; generates per-request signed URLs (never stored).
// Actions: save-photo, delete-photo, save-consent, withdraw-consent, withdraw-photo-analysis-consent.
//
// Privacy contract:
//   - Photo URLs are signed per-request and never persisted or returned to the loader as-is.
//   - save-photo returns a signed previewUrl for immediate client display.
//   - Deletion is Cloudinary-first (see deleteNaiaModelPhoto).

import { data, type LinksFunction, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import {
  loadNaiaModel,
  saveNaiaModelPhoto,
  deleteNaiaModelPhoto,
  saveNaiaModelConsent,
  withdrawSaveModelConsent,
  withdrawPhotoAnalysisConsent,
  computeModelReadinessFromRecord,
  buildModelPreviewUrl,
  POLICY_VERSION,
} from "~/lib/ai/my-naia-model.server";
import NaiaModelPhotoUpload from "~/components/NaiaModelPhotoUpload";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

export function meta() {
  return [{ title: "My nAia Model | nAia" }];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const model = await loadNaiaModel(customer.id);
  const readiness = computeModelReadinessFromRecord(model);

  // Per-request time-limited private_download URLs — never persisted. Null if config missing.
  const faceDeliveryUrl = model?.facePublicId
    ? buildModelPreviewUrl(model.facePublicId, model.faceFormat ?? null, model.deliveryType ?? "private")
    : null;
  const bodyDeliveryUrl = model?.bodyPublicId
    ? buildModelPreviewUrl(model.bodyPublicId, model.bodyFormat ?? null, model.deliveryType ?? "private")
    : null;

  return data({
    customerId: customer.id,
    faceDeliveryUrl,
    bodyDeliveryUrl,
    photoAnalysisConsentGiven: !!model?.photoAnalysisConsentAt,
    saveModelConsentGiven: !!model?.saveModelConsentAt,
    readiness,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "save-photo") {
    const slot = formData.get("slot") as "face" | "body";
    const publicId = formData.get("publicId") as string;
    const version = (formData.get("version") as string) || null;    // browser-supplied; superseded by Admin API verification
    const format = (formData.get("format") as string) || null;      // browser-supplied; superseded by Admin API verification
    const deliveryType = "private"; // never read from browser — prevents delivery-type downgrade

    if (!slot || !publicId) {
      return data({ ok: false, error: "Missing required fields." }, { status: 400 });
    }

    const result = await saveNaiaModelPhoto(customer.id, slot, publicId, version, format, deliveryType);
    if (!result.ok) {
      return data({ ok: false, error: result.error }, { status: 422 });
    }

    if (result.orphanPublicId) {
      // Old Cloudinary asset could not be deleted — safe to ignore (stale ref to a replaced asset).
      // A background cleanup job can retry using model.deliveryType.
      console.warn("naia:orphan-asset", { customerId: customer.id, slot, orphanPublicId: result.orphanPublicId });
    }

    // Return a time-limited private_download URL for immediate client preview.
    // This URL expires in 10 minutes and is never persisted or logged.
    const previewUrl = buildModelPreviewUrl(publicId, format, deliveryType);
    return data({ ok: true, previewUrl });
  }

  if (intent === "delete-photo") {
    const slot = formData.get("slot") as "face" | "body";
    if (!slot) {
      return data({ ok: false, error: "Missing slot." }, { status: 400 });
    }

    const result = await deleteNaiaModelPhoto(customer.id, slot);
    if (result.staleReference) {
      // Cloudinary asset deleted but DB clear failed. DB still references deleted asset.
      // Any preview URL generated for it will 404 — no privacy risk.
      // Log for retry; return ok so the client clears its local state.
      console.warn("naia:stale-reference", { customerId: customer.id, slot });
    }
    if (!result.ok && !result.staleReference) {
      return data({ ok: false, error: "Could not delete photo. Please try again." }, { status: 500 });
    }
    return data({ ok: true });
  }

  if (intent === "save-consent") {
    const types: ("photoAnalysis" | "saveModel")[] = [];
    if (formData.get("photoAnalysis") === "true") types.push("photoAnalysis");
    if (formData.get("saveModel") === "true") types.push("saveModel");

    await saveNaiaModelConsent(customer.id, types, POLICY_VERSION);
    return data({ ok: true });
  }

  if (intent === "withdraw-consent") {
    // Withdraws save-model consent: deletes Cloudinary assets, clears DB references.
    const result = await withdrawSaveModelConsent(customer.id);
    if (!result.ok && result.failedAssets.length > 0) {
      console.warn("naia:partial-withdrawal", { customerId: customer.id, failedAssets: result.failedAssets });
    }
    return data({ ok: true });
  }

  if (intent === "withdraw-photo-analysis-consent") {
    // Withdraws photo-analysis consent only. Does not touch photos or save-model consent.
    await withdrawPhotoAnalysisConsent(customer.id);
    return data({ ok: true });
  }

  return data({ ok: false, error: "Unknown action." }, { status: 400 });
}

export default function MyNaiaModelRoute() {
  const loaderData = useLoaderData<typeof loader>();

  return (
    <MyNaiaLayout>
      <Link to="/my-naia" className="sp-back">← Overview</Link>

      <div className="sp-shell">
        <div className="sp-shell-eyebrow">Personalisation · Virtual Try-On</div>
        <h1 className="sp-shell-title">My nAia Model</h1>
        <p className="sp-shell-desc">
          Photos added to My nAia Model are stored privately so nAia can reuse them for your styling
          and try-on experiences. You can replace or remove them at any time.
        </p>
        <p style={{ fontFamily: "var(--naia-ff-body)", fontSize: "14px", fontStyle: "italic", color: "var(--naia-muted)", marginTop: "8px" }}>
          Virtual previews show styling direction and silhouette rather than exact physical fit.
        </p>
      </div>

      <NaiaModelPhotoUpload {...loaderData} />
    </MyNaiaLayout>
  );
}
