/**
 * Regression (real phones, 6–8/10): on VinaPhone mobile data `openstreetmap.org` does not resolve,
 * so every map was a pin on a grey box and "ghim theo địa chỉ" never worked. Tiles and address
 * lookup each need a second source on a different domain, and must actually switch to it.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { baseTilesScript, TILE_SOURCES } from "../services/mapTiles";
import { geocodeAddress, photonHit } from "../gymOwner/geocode";

/** Just enough of Leaflet to run the WebView script and fire tile events at it. */
function fakeLeaflet() {
  const layers: { url: string; handlers: Record<string, () => void>; onMap: boolean }[] = [];
  const L = {
    tileLayer(url: string) {
      const layer = {
        url,
        handlers: {} as Record<string, () => void>,
        onMap: false,
        on(event: string, handler: () => void) {
          layer.handlers[event] = handler;
          return layer;
        },
        addTo() {
          layer.onMap = true;
          return layer;
        },
      };
      layers.push(layer);
      return layer;
    },
  };
  const map = { removeLayer: (layer: { onMap: boolean }) => (layer.onMap = false) };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function("L", "map", baseTilesScript())(L, map);
  return { layers, shown: () => layers.filter((l) => l.onMap).map((l) => l.url) };
}

const hostOf = (url: string) => new URL(url.replace("{s}", "a").replace(/\{[zxy]\}/g, "0")).hostname.split(".").slice(-2).join(".");

test("the tile sources sit on more than one domain", () => {
  assert.ok(TILE_SOURCES.length >= 2);
  assert.equal(hostOf(TILE_SOURCES[0].url), "openstreetmap.org");
  assert.ok(TILE_SOURCES.slice(1).every((s) => hostOf(s.url) !== "openstreetmap.org"));
});

test("a source that fails before showing a tile is replaced by the next one", () => {
  const { layers, shown } = fakeLeaflet();
  assert.deepEqual(shown(), [TILE_SOURCES[0].url]);

  layers[0].handlers.tileerror();
  assert.deepEqual(shown(), [TILE_SOURCES[0].url], "one failed tile is not enough to give up on a source");
  layers[0].handlers.tileerror();
  assert.deepEqual(shown(), [TILE_SOURCES[1].url]);

  // Late errors from the layer that was already dropped must not skip a source.
  layers[0].handlers.tileerror();
  layers[0].handlers.tileerror();
  assert.deepEqual(shown(), [TILE_SOURCES[1].url]);
});

test("a source that has shown a tile is kept through later failures", () => {
  const { layers, shown } = fakeLeaflet();
  layers[0].handlers.tileload();
  for (let i = 0; i < 5; i++) layers[0].handlers.tileerror();
  assert.deepEqual(shown(), [TILE_SOURCES[0].url]);
});

test("the last source is never abandoned", () => {
  const { layers, shown } = fakeLeaflet();
  for (let n = 0; n < TILE_SOURCES.length; n++) {
    layers[n].handlers.tileerror();
    layers[n].handlers.tileerror();
  }
  assert.equal(layers.length, TILE_SOURCES.length);
  assert.deepEqual(shown(), [TILE_SOURCES[TILE_SOURCES.length - 1].url]);
});

test("a Photon result is read as coordinates plus a precision-bearing type", () => {
  const feature = (type: string, countrycode = "VN", housenumber?: string) => ({
    features: [{ geometry: { coordinates: [106.6996781, 10.7724246] }, properties: { type, countrycode, housenumber } }],
  });
  assert.deepEqual(photonHit(feature("house", "VN", "123")), { lat: 10.7724246, lon: 106.6996781, type: "house" });
  // A building matched by name only is not "your address" — it reads as street level.
  assert.equal(photonHit(feature("house"))?.type, "road");
  assert.equal(photonHit(feature("street"))?.type, "road");
  assert.equal(photonHit(feature("district"))?.type, "");
  assert.equal(photonHit(feature("house", "TH")), null);
  assert.equal(photonHit({ features: [] }), null);
});

test("address lookup falls back to Photon when Nominatim cannot be reached", async () => {
  const asked: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    asked.push(new URL(url).hostname);
    if (url.includes("nominatim.openstreetmap.org")) throw new TypeError("Network request failed");
    return new Response(
      JSON.stringify({ features: [{ geometry: { coordinates: [106.7, 10.77] }, properties: { type: "house", countrycode: "VN", housenumber: "123" } }] }),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    const loc = { street: "123 Lê Lợi", ward: "Phường Bến Thành", province: "Hồ Chí Minh" };
    const first = await geocodeAddress(loc, new AbortController().signal);
    assert.deepEqual(first, { latitude: 10.77, longitude: 106.7, precision: "ADDRESS" });
    assert.deepEqual(asked, ["nominatim.openstreetmap.org", "photon.komoot.io"]);

    // Once it has failed, the next lookup does not wait on it again.
    asked.length = 0;
    await geocodeAddress(loc, new AbortController().signal);
    assert.deepEqual(asked, ["photon.komoot.io"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
