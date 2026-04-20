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
        <Meta />
        <Links />
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
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}