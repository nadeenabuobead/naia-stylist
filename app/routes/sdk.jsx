export async function loader() {
  const response = await fetch('https://static.aiuta.com/sdk/2.0.2/index.umd.js');
  const code = await response.text();
  
  return new Response(code, {
    headers: {
      'Content-Type': 'application/javascript',
      'Access-Control-Allow-Origin': '*',
    },
  });
}