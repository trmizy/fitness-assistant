// A small in-memory stand-in for the gateway: PT application + PT listing workflows, with the same state machines the real
// services enforce (status transitions, draftVersion check, one open revision, STALE on direct edit, child draft after
// request-changes). TEST FIXTURE only - it proves the Tier B flows are idempotent and reach the scenario states; it is NOT
// evidence that the real services accept the calls.
let seq = 0;
const id = (p) => `${p}-${String(++seq).padStart(6, "0")}`;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function createFakeGateway({ adminEmail = "admin@fake.test", password = "pw" } = {}) {
  const users = new Map(); // email -> { id, role }
  const apps = new Map(); // userId -> {id,status,docs}
  const listings = new Map(); // userId -> state
  const writes = []; // non-GET requests, to prove idempotency
  const storage = new Set();

  const userOf = (token) => [...users.entries()].find(([e]) => token === `tok:${e}`)?.[0];
  const listing = (uid) => {
    if (!listings.has(uid)) listings.set(uid, { version: 1, packages: [], photos: [], photosAll: new Map(), open: null, history: [], payload: { profile: {}, packages: [], photoIds: [], coverPhotoId: null } });
    return listings.get(uid);
  };
  const dto = (r, st) => r && { id: r.id, status: r.status, draftVersion: r.draftVersion, baseVersion: r.base, payload: r.payload, stale: r.base !== st.version };

  function publish(st, payload) {
    const pk = payload.packages.map((p) => ({ ...p, id: p.id ?? id("pkg"), version: 1 }));
    st.packages = pk;
    st.payload = { ...payload, packages: pk };
    st.photos = payload.photoIds.map((pid, i) => ({ id: pid, isCover: pid === payload.coverPhotoId, sortOrder: i }));
    st.version++;
  }
  function closeOpen(st, status, source = "OWNER") {
    st.history.unshift({ id: st.open.id, status, source });
    st.open = null;
  }
  function newDraft(st, payload) {
    st.open = { id: id("rev"), status: "DRAFT", draftVersion: 1, base: st.version, payload: payload ?? st.payload };
  }

  async function handler(url, init = {}) {
    const u = new URL(url);
    if (u.host === "storage.fake") {
      storage.add(u.pathname);
      return new Response(null, { status: 204 });
    }
    const method = (init.method ?? "GET").toUpperCase();
    const path = u.pathname;
    const token = (init.headers?.authorization ?? "").replace("Bearer ", "");
    const email = userOf(token);
    const body = init.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    if (method !== "GET" && path !== "/auth/login") writes.push(`${method} ${path}`);

    if (path === "/auth/login") {
      if (body.email !== adminEmail && !users.has(body.email)) return json(401, { error: "bad" });
      if (!users.has(body.email)) users.set(body.email, { id: `id-${body.email}`, role: "ADMIN" });
      return json(200, { accessToken: `tok:${body.email}` });
    }
    const me = email && users.get(email);
    if (!me) return json(401, { error: "unauth" });

    // ---- PT application
    if (path === "/pt-applications/me" && method === "GET") return apps.has(me.id) ? json(200, apps.get(me.id)) : json(404, { error: "none" });
    if (path === "/pt-applications/me/draft") {
      if (!apps.has(me.id)) apps.set(me.id, { id: id("app"), status: "DRAFT", docs: {} });
      const a = apps.get(me.id);
      if (!["DRAFT", "NEEDS_MORE_INFO"].includes(a.status)) return json(400, { error: "locked" });
      Object.assign(a.docs, Object.fromEntries(Object.entries(body).filter(([k]) => /Url$/.test(k))));
      return json(200, a);
    }
    if (path === "/pt-applications/me/upload/presign") return json(200, { uploadUrl: `http://storage.fake/${id("obj")}`, key: id("key"), url: "s3://x" });
    if (path === "/pt-applications/me/upload/confirm") return json(200, { key: body.key, url: `s3://${body.key}` });
    if (path === "/pt-applications/me/submit") {
      const a = apps.get(me.id);
      if (!a || !["DRAFT", "NEEDS_MORE_INFO"].includes(a.status)) return json(400, { error: "bad status" });
      if (!a.docs.idCardFrontUrl || !a.docs.portraitPhotoUrl) return json(400, { error: "docs missing" });
      a.status = "SUBMITTED";
      return json(200, a);
    }
    let m = path.match(/^\/pt-applications\/admin\/([^/]+)\/review\/([A-Z_]+)$/);
    if (m) {
      if (me.role !== "ADMIN") return json(403, {});
      const a = [...apps.values()].find((x) => x.id === m[1]);
      if (!a) return json(404, {});
      a.status = m[2];
      if (m[2] === "APPROVED") for (const [em, u2] of users) if (apps.get(u2.id) === a) u2.role = "PT";
      return json(200, a);
    }

    // ---- PT listing (owner)
    if (path.startsWith("/profile/me/listing")) {
      if (me.role !== "PT") return json(403, { code: "NOT_A_PT" });
      const st = listing(me.id);
      if (path === "/profile/me/listing" && method === "GET")
        return json(200, { listingVersion: st.version, published: { payload: st.payload, packages: st.packages, photos: st.photos }, openRevision: dto(st.open, st), photos: [...st.photosAll.values()], history: st.history });
      if (path === "/profile/me/listing/physique/presign") return json(200, { uploadId: id("up"), url: `http://storage.fake/${id("o")}`, fields: {} });
      if (path === "/profile/me/listing/physique/confirm") {
        const photo = { id: id("photo"), status: "STAGED" };
        st.photosAll.set(photo.id, photo);
        return json(201, { photo, deduplicated: false });
      }
      if (path === "/profile/me/listing/draft" && method === "POST") {
        if (st.open) return json(409, { code: "OPEN_REVISION_EXISTS", revision: dto(st.open, st) });
        newDraft(st);
        return json(201, { revision: dto(st.open, st) });
      }
      if (path === "/profile/me/listing/draft" && method === "PUT") {
        if (!st.open || st.open.status !== "DRAFT") return json(404, {});
        if (st.open.draftVersion !== body.expectedDraftVersion) return json(409, { code: "DRAFT_STALE" });
        st.open.payload = body.payload;
        st.open.draftVersion++;
        return json(200, { revision: dto(st.open, st) });
      }
      if (path === "/profile/me/listing/submit") {
        if (!st.open || st.open.status !== "DRAFT") return json(409, { code: "NOT_DRAFT" });
        if (st.open.draftVersion !== body.expectedDraftVersion) return json(409, { code: "DRAFT_STALE" });
        if (JSON.stringify(st.open.payload) === JSON.stringify(st.payload)) return json(422, { code: "NO_CHANGES" });
        st.open.status = "PENDING";
        return json(200, { revision: dto(st.open, st) });
      }
      if (path === "/profile/me/listing/discard") {
        if (!st.open) return json(404, {});
        closeOpen(st, "WITHDRAWN");
        return json(200, {});
      }
    }

    // ---- PT listing (admin)
    m = path.match(/^\/admin\/listings\/pts\/revisions\/([^/]+)\/(approve|reject|request-changes)$/);
    if (m) {
      if (me.role !== "ADMIN") return json(403, {});
      const owner = [...listings.entries()].find(([, st]) => st.open?.id === m[1]);
      if (!owner) return json(404, {});
      const st = owner[1];
      if (st.open.status !== "PENDING") return json(409, {});
      if (m[2] === "approve") {
        if (st.open.base !== st.version) return json(409, { code: "STALE" });
        publish(st, st.open.payload);
        closeOpen(st, "APPROVED");
      } else if (m[2] === "reject") closeOpen(st, "REJECTED");
      else {
        const payload = st.open.payload;
        closeOpen(st, "CHANGES_REQUESTED");
        newDraft(st, payload);
      }
      return json(200, {});
    }
    m = path.match(/^\/admin\/listings\/pts\/([^/]+)\/direct-edit$/);
    if (m) {
      if (me.role !== "ADMIN") return json(403, {});
      const st = listing(m[1]);
      if (body.expectedListingVersion !== st.version) return json(409, { code: "LISTING_STALE" });
      st.version++;
      st.history.unshift({ id: id("rev"), status: "APPROVED", source: "ADMIN_DIRECT" });
      if (st.open?.status === "PENDING") {
        const payload = st.open.payload;
        closeOpen(st, "STALE");
        newDraft(st, payload);
      }
      return json(200, {});
    }
    return json(404, { error: `fake gateway: ${method} ${path}` });
  }

  return {
    fetch: (url, init) => handler(url, init),
    users,
    apps,
    listings,
    writes,
    storage,
    addUser(email, role = "CUSTOMER", uid = `id-${email}`) {
      users.set(email, { id: uid, role });
    },
    writeCount: () => writes.length,
  };
}
