import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta
          httpEquiv="Content-Security-Policy"
          content="frame-ancestors https://admin.shopify.com https://*.myshopify.com;"
        />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400;1,600&family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700;1,900&display=swap"
        />
        <style>{`
          :root {
            --c-bg:       #F6EFE8;
            --c-surface:  #FAF6F1;
            --c-panel:    rgba(252,249,245,0.76);
            --c-ink:      #4A322B;
            --c-muted:    #64544C;
            --c-burg:     #6B1D26;
            --c-taupe:    #E3D4C9;
            --c-muted-bg: #EBE3DB;
            --c-border:   #CEC1B8;
            --c-error:    #831922;
            --c-tint:     rgba(107,29,38,0.08);
            --c-tint-med: rgba(107,29,38,0.2);
            --ff-display: 'Playfair Display', Georgia, serif;
            --ff-body:    'Cormorant Garamond', Garamond, serif;
            --ff-ui:      'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          }
        `}</style>
        <Meta />
        <Links />
        <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
      </head>
      <script dangerouslySetInnerHTML={{ __html: `
  if (window.self !== window.top) {
    // We're in an iframe - intercept all link clicks
    document.addEventListener('click', function(e) {
      var a = e.target.closest('a');
      if (a && a.href && a.href.startsWith(window.location.origin)) {
        e.preventDefault();
        window.location.href = a.href;
      }
    });
  }
` }} />
      <body>
        <Outlet />
        <script dangerouslySetInnerHTML={{ __html: `
  (function() {
    var params = new URLSearchParams(window.location.search);
    var token = params.get('naia_token');
    if (token) {
      sessionStorage.setItem('naia_token', token);
      document.cookie = 'naia_customer_data=' + token + '; path=/; max-age=2592000; SameSite=Lax';
    }
  })();
` }} />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}