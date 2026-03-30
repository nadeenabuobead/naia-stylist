export function loader() {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://static.aiuta.com/sdk/2.0.2/index.umd.js"></script>
</head>
<body style="margin:0;padding:0;">
  <div id="tryon-root"></div>
  <script>
    window.addEventListener('load', async function() {
      var params = new URLSearchParams(window.location.search);
      var productId = params.get('product_id');
      var res = await fetch('/api/aiuta-jwt');
      var data = await res.json();
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