import "@supabase/functions-js/edge-runtime.d.ts";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,HEAD,OPTIONS",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: jsonHeaders });
  }

  if (!["GET", "POST", "HEAD"].includes(req.method)) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Method Not Allowed",
      }),
      { status: 405, headers: jsonHeaders }
    );
  }

  if (req.method === "HEAD") {
    return new Response(null, { status: 200, headers: jsonHeaders });
  }

  console.log(`healthz invoked with method=${req.method}`);

  return new Response(
    JSON.stringify({
      ok: true,
      service: "edge-functions",
      function: "healthz",
      timestamp: new Date().toISOString(),
    }),
    { status: 200, headers: jsonHeaders }
  );
});
