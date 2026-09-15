import assert from "node:assert/strict";
import test from "node:test";
import { createAmapClient } from "../server/amap.mjs";

function mockFetch(payloads, urls) {
  return async (url) => {
    urls.push(String(url));
    const payload = payloads.shift();
    if (!payload) throw new Error("Unexpected request");
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

test("AMap client geocodes, routes, and searches restaurants", async () => {
  const urls = [];
  const payloads = [
    { status: "1", geocodes: [{ location: "121.4737,31.2304" }] },
    {
      status: "1",
      route: {
        paths: [{
          distance: "12000",
          cost: { duration: "1800" },
          steps: [{ polyline: "121.47,31.23;121.48,31.24" }],
        }],
      },
    },
    {
      status: "1",
      pois: [{ id: "poi-1", name: "测试面馆", location: "121.48,31.24" }],
    },
  ];
  const client = createAmapClient("test-key", { fetchImpl: mockFetch(payloads, urls) });

  assert.equal(await client.resolvePlace("上海市人民广场"), "121.4737,31.2304");
  const route = await client.drivingRoute("121.47,31.23", "121.50,31.25");
  assert.equal(route.minutes, 30);
  assert.deepEqual(route.points, ["121.47,31.23", "121.48,31.24"]);
  const pois = await client.searchAround("121.48,31.24", 1500);
  assert.equal(pois[0].name, "测试面馆");
  assert.ok(urls.every((url) => url.includes("key=test-key")));
  assert.ok(urls[2].includes("types=050000"));
});

test("AMap client returns coordinates without a geocoding request", async () => {
  const client = createAmapClient("test-key", {
    fetchImpl: async () => { throw new Error("fetch should not be called"); },
  });
  assert.equal(await client.resolvePlace("121.4737,31.2304"), "121.4737,31.2304");
  assert.equal(await client.resolvePlace({ longitude: 121.4737, latitude: 31.2304 }), "121.4737,31.2304");
});

test("AMap errors are surfaced with provider context", async () => {
  const client = createAmapClient("test-key", {
    fetchImpl: async () => new Response(JSON.stringify({ status: "0", info: "INVALID_USER_KEY" }), { status: 200 }),
  });
  await assert.rejects(() => client.searchAround("121.48,31.24"), /restaurant search failed: INVALID_USER_KEY/);
});
