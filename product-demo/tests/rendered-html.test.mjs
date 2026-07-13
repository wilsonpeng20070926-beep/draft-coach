import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders the Draft Coach product demonstration", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Draft Coach/);
  assert.match(html, /Understand the draft/);
  assert.match(html, /Interactive product demonstration/);
  assert.match(html, /Synthetic demo data/);
  assert.match(html, /Read-only by design/);
  assert.match(html, /OP\.GG public MCP/);
  assert.match(html, /Leaguepedia snapshot/);
  assert.match(html, /Approval pending/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/);
});
