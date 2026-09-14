// app/routes/admin._index.tsx
//
// Workspace selector — the landing page after login.
// Auth is inherited from the admin.tsx parent layout loader.

import { Link } from "react-router";

export default function AdminIndex() {
  return (
    <div className="adm-page">
      <h1 className="adm-page-heading">nAia Internal Portal</h1>
      <p className="adm-page-sub">Choose a workspace to continue.</p>

      <div className="adm-workspace-grid">
        <Link to="/admin/naia" className="adm-workspace-tile">
          <div className="adm-workspace-tile__name">nAia Admin</div>
          <div className="adm-workspace-tile__desc">
            Closet Intelligence, customer Passports, StyleMe QA, feedback, and usage.
          </div>
          <div className="adm-workspace-tile__arrow">→</div>
        </Link>

        <Link to="/admin/nadine" className="adm-workspace-tile">
          <div className="adm-workspace-tile__name">NADINE Designer Intelligence</div>
          <div className="adm-workspace-tile__desc">
            Product performance, recommendations, conversion, collection intelligence.
          </div>
          <div className="adm-workspace-tile__arrow">→</div>
        </Link>
      </div>
    </div>
  );
}
