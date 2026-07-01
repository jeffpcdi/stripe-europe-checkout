export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    console.log('WayMB webhook recebido:', JSON.stringify(body));
  } catch (_) {}

  return new Response(JSON.stringify({ status: 'ok' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
