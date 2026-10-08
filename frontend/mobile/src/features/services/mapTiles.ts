/**
 * Where the base map's tiles come from, in the order they are tried.
 *
 * One host is not enough: on VinaPhone mobile data the carrier's DNS does not resolve
 * `openstreetmap.org` at all, so every map in the app was a pin on an empty grey box (real
 * phones, 6–8/10). The two fallbacks are other free, key-less OpenStreetMap tile servers on
 * different domains, both measured reachable on that same network. All three are fair-use
 * community servers — fine at this app's volume, not for heavy traffic.
 */
export interface TileSource {
  url: string;
  subdomains?: string;
  maxNativeZoom: number;
  attribution: string;
}

const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export const TILE_SOURCES: TileSource[] = [
  { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maxNativeZoom: 19, attribution: OSM },
  // Germany before France on purpose: the French server draws `name:fr`, and central Hồ Chí Minh
  // City has French names for most streets ("Rue Lê Lợi", "Boulevard Hàm Nghi") — seen on a real
  // phone. The German style falls back to the local name, which is what a Vietnamese user reads.
  { url: "https://tile.openstreetmap.de/{z}/{x}/{y}.png", maxNativeZoom: 18, attribution: `${OSM} · OSM Deutschland` },
  {
    url: "https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png",
    subdomains: "abc",
    maxNativeZoom: 20,
    attribution: `${OSM} · OSM France`,
  },
];

/**
 * Leaflet code for inside a map WebView: adds the base layer to the variable `map`, and moves on
 * to the next source when the current one fails twice before showing a single tile. Once a source
 * has shown a tile it is kept — a stray failed tile later is not a reason to swap the whole map.
 *
 * A string, not a function passed through `toString()`: Hermes returns bytecode for that.
 */
export function baseTilesScript(sources: TileSource[] = TILE_SOURCES): string {
  return `(function(){
  var sources = ${JSON.stringify(sources)};
  var index = 0, layer = null;
  function use(n){
    var s = sources[n], loaded = false, errors = 0;
    if (layer) map.removeLayer(layer);
    layer = L.tileLayer(s.url,{maxZoom:19,maxNativeZoom:s.maxNativeZoom,subdomains:s.subdomains||"abc",attribution:s.attribution});
    layer.on("tileload",function(){ loaded = true; });
    layer.on("tileerror",function(){
      errors++;
      if (!loaded && errors >= 2 && n === index && index < sources.length - 1) { index++; use(index); }
    });
    layer.addTo(map);
  }
  use(0);
})();`;
}
