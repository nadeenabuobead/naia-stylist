export function loader() {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;">
  <div id="tryon-root"></div>
  <script>
    fetch('https://aiuta-sdk-proxy.vercel.app/?type=sdk')
      .then(r => r.text())
      .then(code => {
        eval(code);
        return fetch('/api/aiuta-jwt');
      })
      .then(r => r.json())
      .then(data => {
        var params = new URLSearchParams(window.location.search);
        var productId = params.get('product_id');
        var aiuta = new Aiuta({
          auth: {
            subscriptionId: 'dgF37u7BoZAx0qmXhEIyKUyToqOfRnnA',
            getJwt: async function() { return data.token; }
          }
        });
        aiuta.tryOn(productId);
      });
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html" },
  });
}