// app/routes/style-me/_index.tsx
import { Link, useLoaderData } from "react-router";
import { data, type LoaderFunctionArgs } from "react-router";
import { getCustomerId } from "~/lib/auth.server";
import { prisma } from "~/lib/prisma.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const customerId = await getCustomerId(request);

  if (!customerId) {
    return data({ hasProfile: false, hasClosetItems: false, recentSessions: [] });
  }

  const [profile, closetCount, recentSessions] = await Promise.all([
    prisma.onboardingProfile.findUnique({
      where: { customerId },
      select: { stylePersonalities: true }
    }),
    prisma.closetItem.count({ where: { customerId } }),
    prisma.stylingSession.findMany({
      where: { customerId },
      take: 3,
      orderBy: { createdAt: "desc" },
      include: {
        suggestions: {
          take: 1,
          select: {
            heroImageUrl: true,
            outfitName: true
          }
        }
      }
    })
  ]);

  return data({
    hasProfile: !!profile,
    stylePersonalities: profile?.stylePersonality,
    hasClosetItems: closetCount > 0,
    closetCount,
    recentSessions
  });
}

const css = `
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--c-bg);color:var(--c-ink);font-family:var(--ff-body);-webkit-font-smoothing:antialiased}
  .sm-topbar{display:flex;justify-content:space-between;align-items:center;padding:20px 40px;border-bottom:1px solid var(--c-border)}
  .sm-topbar-logo{font-family:var(--ff-display);font-size:22px;font-style:italic;letter-spacing:3px;color:var(--c-ink)}
  .sm-topbar-link{font-family:var(--ff-ui);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--c-burg);text-decoration:none}
  .sm-wrap{max-width:680px;margin:0 auto;padding:60px 40px}
  .sm-headline{font-family:var(--ff-display);font-size:clamp(40px,5vw,64px);font-weight:900;line-height:1;margin-bottom:12px}
  .sm-sub{font-family:var(--ff-body);font-size:18px;font-style:italic;color:var(--c-muted);margin-bottom:48px;line-height:1.6}
  .sm-cards{display:flex;flex-direction:column;gap:12px;margin-bottom:32px}
  .sm-card{background:var(--c-surface);border:1px solid var(--c-border);padding:20px 24px;display:flex;align-items:center;gap:20px}
  .sm-card-icon{width:40px;height:40px;background:var(--c-tint);display:flex;align-items:center;justify-content:center;font-family:var(--ff-ui);font-size:14px;font-weight:700;color:var(--c-burg);flex-shrink:0}
  .sm-card-title{font-family:var(--ff-ui);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--c-ink);margin-bottom:4px}
  .sm-card-body{font-family:var(--ff-body);font-size:15px;font-style:italic;color:var(--c-muted)}
  .sm-card-action{font-family:var(--ff-ui);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--c-burg);text-decoration:none;white-space:nowrap;flex-shrink:0}
  .sm-cta{display:block;width:100%;padding:18px;background:var(--c-burg);color:#FAF6F1;text-align:center;font-family:var(--ff-ui);font-size:10px;letter-spacing:4px;text-transform:uppercase;text-decoration:none;margin-bottom:16px}
  .sm-hint{font-family:var(--ff-body);font-size:14px;font-style:italic;color:var(--c-muted);text-align:center;margin-bottom:60px}
  .sm-section-title{font-family:var(--ff-display);font-size:28px;font-weight:700;font-style:italic;margin-bottom:24px}
  .sm-looks{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:60px}
  .sm-look{text-decoration:none;display:block}
  .sm-look-img{aspect-ratio:3/4;background:var(--c-muted-bg);border:1px solid var(--c-border);overflow:hidden;display:flex;align-items:center;justify-content:center;margin-bottom:8px}
  .sm-look-img img{width:100%;height:100%;object-fit:cover}
  .sm-look-meta{font-family:var(--ff-ui);font-size:8px;letter-spacing:1px;text-transform:uppercase;color:var(--c-muted)}
  .sm-how{background:var(--c-surface);border:1px solid var(--c-border);padding:40px}
  .sm-step{display:flex;align-items:flex-start;gap:16px;margin-bottom:20px}
  .sm-step:last-child{margin-bottom:0}
  .sm-step-num{width:32px;height:32px;background:var(--c-tint);display:flex;align-items:center;justify-content:center;font-family:var(--ff-ui);font-size:10px;font-weight:700;color:var(--c-burg);flex-shrink:0}
  .sm-step-text{font-family:var(--ff-body);font-size:16px;font-style:italic;color:var(--c-ink);line-height:1.5;padding-top:6px}
`;

export default function StyleMeIndex() {
  const { hasProfile, stylePersonality, hasClosetItems, closetCount, recentSessions } =
    useLoaderData<typeof loader>();

  return (
    <div style={{ minHeight: "100vh", background: "var(--c-bg)" }}>
      <style>{css}</style>

      <div className="sm-topbar">
        <div className="sm-topbar-logo">nAia</div>
        <Link to="/" className="sm-topbar-link">← Dashboard</Link>
      </div>

      <main className="sm-wrap">
        <h1 className="sm-headline">STYLE ME</h1>
        <p className="sm-sub">Tell nAia how you want to feel, where you are going, and what feels right today.</p>

        {/* Status Cards */}
        <div className="sm-cards">
          <div className="sm-card">
            <div className="sm-card-icon">{hasProfile ? "✓" : "!"}</div>
            <div style={{ flex: 1 }}>
              <div className="sm-card-title">
                {hasProfile ? "Style Profile Complete" : "Complete Your Style Profile"}
              </div>
              <div className="sm-card-body">
                {hasProfile
                  ? `Your style: ${stylePersonality || "Discovering..."}`
                  : "Help nAia understand your style better"
                }
              </div>
            </div>
            {!hasProfile && (
              <Link to="/apps/naia-stylist/onboarding/step/1" className="sm-card-action">
                Start →
              </Link>
            )}
          </div>

          <div className="sm-card">
            <div className="sm-card-icon">{hasClosetItems ? "✓" : "+"}</div>
            <div style={{ flex: 1 }}>
              <div className="sm-card-title">
                {hasClosetItems ? `${closetCount} items in closet` : "Add Your Wardrobe"}
              </div>
              <div className="sm-card-body">
                {hasClosetItems
                  ? "Ready to create outfits from your pieces"
                  : "Upload items to style from your own closet"
                }
              </div>
            </div>
            <Link to="/closet/upload" className="sm-card-action">
              {hasClosetItems ? "Add more →" : "Upload →"}
            </Link>
          </div>
        </div>

        <Link to="/style-me/mood" className="sm-cta">START STYLING →</Link>
        <p className="sm-hint">Works best with your closet items, but nAia can also suggest new pieces.</p>

        {recentSessions.length > 0 && (
          <div>
            <h2 className="sm-section-title">Recent Looks</h2>
            <div className="sm-looks">
              {recentSessions.map((session) => (
                <Link
                  key={session.id}
                  to={`/style-me/result?sessionId=${session.id}`}
                  className="sm-look"
                >
                  <div className="sm-look-img">
                    {session.suggestions[0]?.heroImageUrl && (
                      <img
                        src={session.suggestions[0].heroImageUrl}
                        alt={session.suggestions[0].outfitName || "Recent outfit"}
                      />
                    )}
                  </div>
                  <div className="sm-look-meta">{session.mood} · {session.occasion}</div>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="sm-how">
          <h2 className="sm-section-title">How It Works</h2>
          {[
            { step: "1", text: "Tell nAia your mood" },
            { step: "2", text: "Share how you want to feel" },
            { step: "3", text: "Pick the occasion" },
            { step: "4", text: "Choose your source — closet, nAia, or both" },
            { step: "5", text: "Get your complete look with styling notes" },
          ].map(({ step, text }) => (
            <div key={step} className="sm-step">
              <div className="sm-step-num">{step}</div>
              <div className="sm-step-text">{text}</div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
