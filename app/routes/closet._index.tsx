import { data } from "react-router";

export async function loader() {
  return data({ maintenance: true });
}

export async function action() {
  return data({ error: "Temporarily unavailable" }, { status: 403 });
}

const css = `
  :root{--cream:#f4f4f1;--deep:#221516;--accent:#8b2035;--muted:#7a6f6a;--ff-display:'Playfair Display',Georgia,serif;--ff-body:'Cormorant Garamond',Garamond,serif;--ff-mono:'Space Mono','Courier New',monospace}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--cream);color:var(--deep);font-family:var(--ff-body);-webkit-font-smoothing:antialiased}
  .cl-topbar{display:flex;align-items:center;padding:20px 40px;border-bottom:1px solid rgba(59,5,16,.06)}
  .cl-topbar-logo{font-family:var(--ff-display);font-size:22px;font-style:italic;letter-spacing:3px;color:var(--deep)}
  .cl-wrap{max-width:1200px;margin:0 auto;padding:60px 40px}
  .cl-maintenance{text-align:center;padding:120px 40px}
  .cl-headline{font-family:var(--ff-display);font-size:clamp(40px,5vw,64px);font-weight:900;line-height:1;margin-bottom:24px;color:var(--deep)}
  .cl-body{font-family:var(--ff-body);font-size:22px;font-style:italic;color:var(--muted);line-height:1.6;max-width:480px;margin:0 auto}
`;

export default function Closet() {
  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f1" }}>
      <style>{css}</style>
      <div className="cl-topbar">
        <div className="cl-topbar-logo">nAia</div>
      </div>
      <div className="cl-wrap">
        <div className="cl-maintenance">
          <h1 className="cl-headline">Digital Wardrobe</h1>
          <p className="cl-body">
            This space is being refined. Your wardrobe will be available again soon.
          </p>
        </div>
      </div>
    </div>
  );
}
