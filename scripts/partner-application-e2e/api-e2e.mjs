// W3 — REAL HTTP/API checks against the live dev stack through the gateway (http://localhost:3000).
import { execSync } from "node:child_process";

const GW = "http://localhost:3000";
const PASSWORD = "Partner-W3-Pass-1";
const secrets = [PASSWORD];
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? "  " + extra : ""}`);
};

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(GW + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}
const data = (r) => r.json?.data ?? r.json;
const code = (r) => r.json?.error?.code ?? r.json?.code;

const sql = (db, q) =>
  execSync(`docker exec gymcoach-postgres psql -U gymcoach -d ${db} -tAc "${q.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

async function putToStorage(auth, bytes, contentType) {
  const form = new FormData();
  Object.entries(auth.fields).forEach(([k, v]) => form.append(k, v));
  form.append("file", new Blob([bytes], { type: contentType }), "f");
  const res = await fetch(auth.url, { method: "POST", body: form });
  return res.status;
}
async function upload(tok, kind, extra, bytes, contentType) {
  const p = await call("POST", "/owner/application/uploads/presign", { token: tok, body: { kind, contentType, sizeBytes: bytes.length, ...extra } });
  if (p.status !== 201 && p.status !== 200) return { presign: p };
  const auth = data(p);
  const storage = await putToStorage(auth, bytes, contentType);
  const c = await call("POST", "/owner/application/uploads/confirm", { token: tok, body: { uploadId: auth.uploadId } });
  return { presign: p, storage, confirm: c, uploadId: auth.uploadId };
}

async function newApplicant(label) {
  const email = `w3-${label}-${Date.now()}@partner-e2e.test`;
  const start = await call("POST", "/auth/partner-applications/start", { body: { email } });
  const link = start.json?.devVerifyLink;
  const raw = link?.split("#token=")[1];
  if (raw) secrets.push(raw);
  const ver = await call("POST", "/auth/partner-applications/verify", { body: { token: raw } });
  const setup = ver.json?.setupToken;
  if (setup) secrets.push(setup);
  const sp = await call("POST", "/auth/partner-applications/set-password", { body: { setupToken: setup, password: PASSWORD } });
  const token = sp.json?.accessToken;
  await call("POST", "/owner/application/bootstrap", { token });
  return { email, token, raw, setup, start, ver, sp };
}

async function fillAll(tok, brand) {
  const wards = await (await fetch(`${GW}/locations/provinces/92/wards`)).json();
  await call("PUT", "/owner/application/representative", { token: tok, body: { name: "Nguyen W3", phone: "0901234567", role: "GYM_OWNER" } });
  const b = await call("PUT", "/owner/application/brand", { token: tok, body: { name: brand } });
  await call("PUT", "/owner/application/business-scale", { token: tok, body: { scale: "ONE_BRANCH" } });
  await call("PUT", "/owner/application/branch", { token: tok, body: { name: "Chi nhanh W3", phone: "0281234567", address: "1 Le Loi" } });
  await call("PUT", "/owner/application/branch", { token: tok, body: { provinceCode: 92, wardCode: wards[0].code, latitude: 10.03, longitude: 105.78 } });
  await upload(tok, "PHOTO", { photoCategory: "EXTERIOR" }, PNG, "image/png");
  await call("PUT", "/owner/application/legal", { token: tok, body: { legalName: "Cong ty W3" } });
  await upload(tok, "DOCUMENT", { docType: "BUSINESS_LICENSE" }, PDF, "application/pdf");
  await upload(tok, "DOCUMENT", { docType: "REPRESENTATIVE_ID" }, PNG, "image/png");
  await upload(tok, "DOCUMENT", { docType: "PREMISES_PROOF" }, PDF, "application/pdf");
  return b;
}

(async () => {
  const startedAt = new Date();

  // ── Admin session ───────────────────────────────────────────────────────────────────────
  const adminLogin = await call("POST", "/auth/login", { body: { email: "admin@example.com", password: "password123" } });
  const admin = adminLogin.json.accessToken;
  const clientLogin = await call("POST", "/auth/login", { body: { email: "john.doe@example.com", password: "password123" } });
  const ptLogin = await call("POST", "/auth/login", { body: { email: "pt@example.com", password: "password123" } });
  check("regression: admin/client/PT login still work", !!admin && !!clientLogin.json?.accessToken && !!ptLogin.json?.accessToken);

  // ── Magic link edge cases ───────────────────────────────────────────────────────────────
  const bad = await call("POST", "/auth/partner-applications/verify", { body: { token: "x".repeat(40) } });
  check("magic link: garbage token -> INVALID", bad.json?.status === "INVALID");
  const malformed = await call("POST", "/auth/partner-applications/verify", { body: { token: "" } });
  check("magic link: empty token rejected (400)", malformed.status === 400, `status=${malformed.status}`);

  const emailA = `w3-cool-${Date.now()}@partner-e2e.test`;
  const s1 = await call("POST", "/auth/partner-applications/start", { body: { email: emailA } });
  const s2 = await call("POST", "/auth/partner-applications/start", { body: { email: emailA } });
  check("magic link: second start within cooldown -> 429 RESEND_COOLDOWN", s2.status === 429 && code(s2) === "RESEND_COOLDOWN", `status=${s2.status}`);
  const rawOld = s1.json.devVerifyLink.split("#token=")[1];
  secrets.push(rawOld);
  // resend after cooldown -> old link dies, new link works
  sql("gymcoach_auth", `update partner_application_tokens set created_at = now() - interval '5 minutes' where email = '${emailA}'`);
  const s3 = await call("POST", "/auth/partner-applications/start", { body: { email: emailA } });
  const rawNew = s3.json.devVerifyLink.split("#token=")[1];
  secrets.push(rawNew);
  const oldV = await call("POST", "/auth/partner-applications/verify", { body: { token: rawOld } });
  check("magic link: previous link invalid after resend", oldV.json?.status === "EXPIRED" || oldV.json?.status === "INVALID", `status=${oldV.json?.status}`);
  const newV = await call("POST", "/auth/partner-applications/verify", { body: { token: rawNew } });
  check("magic link: new link VALID after resend", newV.json?.status === "VALID");
  // verify twice: 2nd setupToken supersedes the 1st
  const newV2 = await call("POST", "/auth/partner-applications/verify", { body: { token: rawNew } });
  secrets.push(newV.json.setupToken, newV2.json.setupToken);
  check("magic link: GET-style re-verify does not consume the email token (still VALID)", newV2.json?.status === "VALID");
  const spOld = await call("POST", "/auth/partner-applications/set-password", { body: { setupToken: newV.json.setupToken, password: PASSWORD } });
  check("setupToken replaced by later verify -> old one rejected", spOld.status >= 400, `status=${spOld.status}`);
  const spShort = await call("POST", "/auth/partner-applications/set-password", { body: { setupToken: newV2.json.setupToken, password: "short" } });
  check("set-password: weak password rejected (400)", spShort.status === 400, `status=${spShort.status}`);
  const spOk = await call("POST", "/auth/partner-applications/set-password", { body: { setupToken: newV2.json.setupToken, password: PASSWORD } });
  check("set-password: valid setupToken creates account + session", spOk.status === 201 && !!spOk.json?.accessToken, `status=${spOk.status}`);
  const spReuse = await call("POST", "/auth/partner-applications/set-password", { body: { setupToken: newV2.json.setupToken, password: PASSWORD } });
  check("setupToken cannot be reused", spReuse.status >= 400, `status=${spReuse.status}`);
  const usedV = await call("POST", "/auth/partner-applications/verify", { body: { token: rawNew } });
  check("magic link: used link -> USED", usedV.json?.status === "USED", `status=${usedV.json?.status}`);
  const emailB = `w3-exp-${Date.now()}@partner-e2e.test`;
  const sb = await call("POST", "/auth/partner-applications/start", { body: { email: emailB } });
  const rawB = sb.json.devVerifyLink.split("#token=")[1];
  secrets.push(rawB);
  sql("gymcoach_auth", `update partner_application_tokens set expires_at = now() - interval '1 minute' where email = '${emailB}'`);
  const expV = await call("POST", "/auth/partner-applications/verify", { body: { token: rawB } });
  check("magic link: expired link -> EXPIRED", expV.json?.status === "EXPIRED", `status=${expV.json?.status}`);

  const dupClient = await call("POST", "/auth/partner-applications/start", { body: { email: "john.doe@example.com" } });
  check("existing Customer email blocked at start (409 EMAIL_IN_USE)", dupClient.status === 409 && code(dupClient) === "EMAIL_IN_USE", `status=${dupClient.status} code=${code(dupClient)}`);
  const dupPt = await call("POST", "/auth/partner-applications/start", { body: { email: "pt@example.com" } });
  const dupAdmin = await call("POST", "/auth/partner-applications/start", { body: { email: "admin@example.com" } });
  check("existing PT + Admin emails blocked at start", dupPt.status === 409 && dupAdmin.status === 409);
  const dupOwner = await call("POST", "/auth/partner-applications/start", { body: { email: emailA } });
  check("existing applicant email -> EMAIL_ALREADY_PARTNER", dupOwner.status === 409 && code(dupOwner) === "EMAIL_ALREADY_PARTNER", `code=${code(dupOwner)}`);
  const noRoleLeak = await call("POST", "/auth/login", { body: { email: "john.doe@example.com", password: "password123" } });
  check("no Client -> Gym Owner promotion (client role unchanged)", (noRoleLeak.json?.user?.role ?? "").toUpperCase() !== "GYM_OWNER");

  // ── Applicant A: permissions while ONBOARDING ───────────────────────────────────────────
  const A = await newApplicant("a");
  check("applicant account created with GYM_OWNER role", !!A.token);
  const st = await call("GET", "/owner/application/status", { token: A.token });
  check("accessState = ONBOARDING right after bootstrap", data(st)?.accessState === "ONBOARDING", `state=${data(st)?.accessState}`);

  const opRoutes = [
    ["GET", "/owner/gyms"],
    ["GET", "/owner/brands"],
    ["POST", "/owner/gyms", { name: "X", phone: "0281234567", address: "addr addr" }],
    ["GET", "/owner/partner-accounts"],
    ["GET", "/owner/partner-invitations"],
    ["GET", "/owner/collaborations"],
    ["GET", "/owner/gyms/00000000-0000-4000-8000-000000000000/memberships"],
    ["GET", "/owner/gyms/00000000-0000-4000-8000-000000000000/wallet"],
    ["GET", "/owner/brands/00000000-0000-4000-8000-000000000000/plans"],
  ];
  for (const [m, p, b] of opRoutes) {
    const r = await call(m, p, { token: A.token, body: b });
    check(`ONBOARDING applicant blocked from operational ${m} ${p.replace(/[0-9a-f-]{36}/, ":id")}`, r.status === 403 || r.status === 409, `status=${r.status} code=${code(r)}`);
  }
  const meCol = await call("GET", "/me/collaborations", { token: A.token });
  check("shared PT+OWNER route /me/collaborations not usable by applicant", meCol.status === 403, `status=${meCol.status} code=${code(meCol)}`);
  const ptPub = await call("GET", "/pt/00000000-0000-4000-8000-000000000000/gyms", { token: A.token });
  const ptPubAnon = await call("GET", "/pt/00000000-0000-4000-8000-000000000000/gyms");
  check("/pt/:id/gyms is a PUBLIC route (same answer with and without applicant token)", ptPub.status === ptPubAnon.status, `${ptPub.status}/${ptPubAnon.status}`);
  const adminRoutes = [
    ["GET", "/admin/partners/applications"],
    ["GET", `/admin/partners/${data(st)?.partnerId}/application`],
    ["POST", `/admin/partners/${data(st)?.partnerId}/application/approve`],
  ];
  for (const [m, p] of adminRoutes) {
    const r = await call(m, p, { token: A.token });
    check(`applicant blocked from admin ${m} ${p.replace(/[0-9a-f-]{36}/, ":id")}`, r.status === 403, `status=${r.status}`);
  }
  const clientAdmin = await call("GET", "/admin/partners/applications", { token: clientLogin.json.accessToken });
  check("client blocked from admin application list", clientAdmin.status === 403, `status=${clientAdmin.status}`);
  const noToken = await call("GET", "/owner/application/status");
  check("unauthenticated applicant route -> 401", noToken.status === 401, `status=${noToken.status}`);

  // brand / branch invariants
  const brandName = `W3 Brand ${Date.now()}`;
  const b1 = await call("PUT", "/owner/application/brand", { token: A.token, body: { name: brandName } });
  const [b2, b3] = await Promise.all([
    call("PUT", "/owner/application/brand", { token: A.token, body: { name: brandName + " x" } }),
    call("PUT", "/owner/application/brand", { token: A.token, body: { name: brandName + " y" } }),
  ]);
  const brandIds = new Set([data(b1)?.id, data(b2)?.id, data(b3)?.id].filter(Boolean));
  check("1 Owner = 1 Brand: concurrent PUT /brand yields a single brand id", brandIds.size === 1, `ids=${brandIds.size}`);
  const ob = await call("POST", "/owner/onboarding/brand", { token: A.token, body: { name: "Another Brand" } });
  const brandCount = Number(sql("gymcoach_gym", `select count(*) from gym_brands where owner_id = (select user_id from gym_partner_accounts where partner_id = '${data(st).partnerId}' and role='OWNER')`));
  check("second brand via /owner/onboarding/brand cannot create a 2nd brand", brandCount === 1, `brands=${brandCount} status=${ob.status}`);
  const fake = "11111111-1111-4111-8111-111111111111";
  const br = await call("PUT", "/owner/application/branch", { token: A.token, body: { name: "Branch Z", phone: "0281234567", address: "9 Tran Hung Dao", brandId: fake } });
  const gymRow = sql("gymcoach_gym", `select brand_id from gyms where owner_id = (select user_id from gym_partner_accounts where partner_id = '${data(st).partnerId}' and role='OWNER') and status='DRAFT'`);
  check("client-supplied brandId is ignored (branch takes owner's brand)", gymRow !== fake && (br.status === 200 || br.status === 201), `brand_id=${gymRow} status=${br.status}`);
  const draft2 = await call("POST", "/owner/gyms/draft", { token: A.token });
  check("applicant cannot create an extra branch draft via old route", draft2.status === 403 || draft2.status === 409, `status=${draft2.status} code=${code(draft2)}`);

  // upload hardening
  const badType = await call("POST", "/owner/application/uploads/presign", { token: A.token, body: { kind: "PHOTO", contentType: "image/svg+xml", sizeBytes: 100 } });
  check("upload: SVG rejected at presign (415)", badType.status === 415 || badType.status === 400, `status=${badType.status}`);
  const badHtml = await call("POST", "/owner/application/uploads/presign", { token: A.token, body: { kind: "DOCUMENT", docType: "BUSINESS_LICENSE", contentType: "text/html", sizeBytes: 100 } });
  check("upload: HTML rejected at presign (415)", badHtml.status === 415 || badHtml.status === 400, `status=${badHtml.status}`);
  const big = await call("POST", "/owner/application/uploads/presign", { token: A.token, body: { kind: "PHOTO", contentType: "image/png", sizeBytes: 50 * 1024 * 1024 } });
  check("upload: oversize rejected at presign (413)", big.status === 413 || big.status === 400, `status=${big.status}`);
  const spoof = await upload(A.token, "PHOTO", { photoCategory: "EXTERIOR" }, Buffer.from("<html><script>alert(1)</script></html>"), "image/png");
  check("upload: HTML bytes declared as PNG rejected at confirm (magic bytes)", spoof.confirm && spoof.confirm.status >= 400, `confirm=${spoof.confirm?.status} storage=${spoof.storage}`);
  const nonPhoto = await call("POST", "/owner/application/uploads/confirm", { token: A.token, body: { uploadId: "22222222-2222-4222-8222-222222222222" } });
  check("upload: unknown uploadId rejected", nonPhoto.status === 404 || nonPhoto.status === 403 || nonPhoto.status === 400, `status=${nonPhoto.status}`);
  const noFile = await call("POST", "/owner/application/uploads/presign", { token: A.token, body: { kind: "PHOTO", contentType: "image/png", sizeBytes: PNG.length } });
  const noFileAuth = data(noFile);
  const notUploaded = await call("POST", "/owner/application/uploads/confirm", { token: A.token, body: { uploadId: noFileAuth.uploadId } });
  check("upload: confirm without uploading the object rejected", notUploaded.status >= 400, `status=${notUploaded.status}`);

  // cross-user
  const B = await newApplicant("b");
  const good = await upload(A.token, "PHOTO", { photoCategory: "EXTERIOR" }, PNG, "image/png");
  const cross = await call("POST", "/owner/application/uploads/confirm", { token: B.token, body: { uploadId: good.uploadId } });
  check("cross-user: applicant B cannot confirm applicant A's uploadId", cross.status === 403 || cross.status === 404, `status=${cross.status}`);
  const photoA = data(await call("GET", "/owner/application", { token: A.token })).photos?.[0]?.id;
  const delCross = await call("DELETE", `/owner/application/photos/${photoA}`, { token: B.token });
  check("cross-user: applicant B cannot delete A's photo", delCross.status === 403 || delCross.status === 404, `status=${delCross.status}`);

  // ── Lifecycle on applicant A ────────────────────────────────────────────────────────────
  const early = await call("POST", "/owner/application/submit", { token: A.token, body: { acceptTerms: true } });
  check("submit incomplete -> 400 APPLICATION_INCOMPLETE with missing items", early.status === 400 && (code(early) === "APPLICATION_INCOMPLETE") && (early.json?.error?.issues || early.json?.error?.missing || early.json?.missing), `status=${early.status} code=${code(early)}`);
  await fillAll(A.token, brandName);
  const view0 = data(await call("GET", "/owner/application", { token: A.token }));
  check("application complete: missing list empty except terms", view0.missing.every((m) => m.section === "TERMS"), JSON.stringify(view0.missing.map((m) => m.section)));
  const [sub1, sub2] = await Promise.all([
    call("POST", "/owner/application/submit", { token: A.token, body: { acceptTerms: true } }),
    call("POST", "/owner/application/submit", { token: A.token, body: { acceptTerms: true } }),
  ]);
  check("double-submit (parallel) is idempotent, no 5xx", sub1.status < 500 && sub2.status < 500, `${sub1.status}/${sub2.status}`);
  const locked = await call("PUT", "/owner/application/representative", { token: A.token, body: { name: "Changed", phone: "0901234567", role: "GYM_OWNER" } });
  check("after submit: edits locked (409)", locked.status === 409, `status=${locked.status} code=${code(locked)}`);
  const stU = await call("GET", "/owner/application/status", { token: A.token });
  check("accessState = UNDER_REVIEW and still blocked from operational area", data(stU).accessState === "UNDER_REVIEW" && (await call("GET", "/owner/gyms", { token: A.token })).status >= 403);
  const tl = data(await call("GET", "/owner/application/timeline", { token: A.token }));
  check("timeline lists stored APPLICATION_SUBMITTED event", tl.events.some((e) => e.action === "APPLICATION_SUBMITTED"));

  // admin: doc lifecycle + blockers + rejection
  const pid = data(stU).partnerId;
  const detail0 = data(await call("GET", `/admin/partners/${pid}/application`, { token: admin }));
  check("admin: approve blocked while documents are not accepted", detail0.approve.canApprove === false && detail0.approve.blockers.some((b) => b.code === "DOCUMENT_NOT_VERIFIED"));
  const appr0 = await call("POST", `/admin/partners/${pid}/application/approve`, { token: admin });
  check("admin: approve refused with 409 APPROVE_BLOCKED", appr0.status === 409, `status=${appr0.status} code=${code(appr0)}`);
  const viewFile = await call("GET", `/admin/partners/${pid}/application/documents/BUSINESS_LICENSE/file`, { token: admin });
  check("admin: document read via short-lived signed URL", viewFile.status === 200 && /^https?:\/\//.test(data(viewFile)?.url ?? ""));
  const viewedAudit = sql("gymcoach_gym", `select count(*) from partner_audit_logs where partner_id='${pid}' and action='DOCUMENT_VIEWED'`);
  check("admin document view is audited (DOCUMENT_VIEWED)", Number(viewedAudit) >= 1, `rows=${viewedAudit}`);
  const docUrl = data(viewFile).url;
  const anonDoc = await fetch(docUrl.split("?")[0]);
  check("private document URL without signature is denied", anonDoc.status === 403 || anonDoc.status === 400 || anonDoc.status === 401, `status=${anonDoc.status}`);
  const key = sql("gymcoach_gym", `select file_key from gym_partner_documents where partner_id='${pid}' and doc_type='BUSINESS_LICENSE'`);
  const anonPublic = await fetch(`http://localhost:9000/gymini-partner-photos/${key}`);
  check("legal document never present in public bucket", anonPublic.status === 404 || anonPublic.status === 403, `status=${anonPublic.status}`);

  const rej = await call("POST", `/admin/partners/${pid}/application/reject`, { token: admin, body: { reason: "Thông tin chưa đủ tin cậy", adminNote: "internal" } });
  check("admin: reject -> REJECTED", rej.status === 200, `status=${rej.status}`);
  const stR = data(await call("GET", "/owner/application/status", { token: A.token }));
  check("applicant sees REJECTED and is not editable", stR.accessState === "REJECTED" && stR.editable === false);
  const rEdit = await call("PUT", "/owner/application/representative", { token: A.token, body: { name: "Again", phone: "0901234567", role: "GYM_OWNER" } });
  const rResub = await call("POST", "/owner/application/resubmit", { token: A.token });
  const rSub = await call("POST", "/owner/application/submit", { token: A.token, body: { acceptTerms: true } });
  check("REJECTED is final for applicant (edit/resubmit/submit all 409)", rEdit.status === 409 && rResub.status === 409 && rSub.status === 409, `${rEdit.status}/${rResub.status}/${rSub.status}`);
  const reopen = await call("POST", `/admin/partners/${pid}/application/reopen`, { token: admin });
  const stRe = data(await call("GET", "/owner/application/status", { token: A.token }));
  check("admin reopen -> applicant editable again", reopen.status === 200 && stRe.editable === true, `state=${stRe.accessState}`);
  const oldPathOwn = await call("POST", `/admin/partners/${pid}/reject`, { token: admin, body: { reason: "x" } });
  const oldPatch = await call("PATCH", `/admin/partners/${pid}`, { token: admin, body: { legalName: "hack" } });
  check("legacy admin mutations blocked on SELF_SERVICE partner (409)", oldPathOwn.status === 409 && oldPatch.status === 409, `${oldPathOwn.status}/${oldPatch.status}`);

  // resubmit -> request changes -> issue lifecycle -> parallel approve
  await call("POST", "/owner/application/submit", { token: A.token, body: { acceptTerms: true } });
  const rc = await call("POST", `/admin/partners/${pid}/application/request-changes`, {
    token: admin,
    body: { issues: [{ category: "PHOTOS", message: "Cần ảnh khu tập" }], documents: [{ docType: "PREMISES_PROOF", note: "Ảnh mờ, tải lại" }] },
  });
  check("admin request-changes (issue + document) -> 200", rc.status === 200, `status=${rc.status}`);
  const vRC = data(await call("GET", "/owner/application", { token: A.token }));
  const docRejected = vRC.documents.find((d) => d.docType === "PREMISES_PROOF");
  check("document flagged 'Cần cập nhật' with reason; issue OPEN", docRejected.status === "REJECTED" && docRejected.reviewNote && vRC.issues[0].status === "OPEN");
  const resub0 = await call("POST", "/owner/application/resubmit", { token: A.token });
  check("resubmit blocked while issue OPEN / document not replaced (409)", resub0.status === 409, `status=${resub0.status} code=${code(resub0)}`);
  await upload(A.token, "DOCUMENT", { docType: "PREMISES_PROOF" }, PNG, "image/png");
  const vRepl = data(await call("GET", "/owner/application", { token: A.token }));
  check("replacing the document -> RECEIVED with version+1", vRepl.documents.find((d) => d.docType === "PREMISES_PROOF").status === "RECEIVED" && vRepl.documents.find((d) => d.docType === "PREMISES_PROOF").version >= 2);
  const resub1 = await call("POST", "/owner/application/resubmit", { token: A.token });
  check("resubmit still blocked until the issue is marked updated", resub1.status === 409, `code=${code(resub1)}`);
  const mark = await call("POST", `/owner/application/issues/${vRC.issues[0].id}/mark-updated`, { token: A.token, body: { note: "đã thêm ảnh" } });
  const resub2 = await call("POST", "/owner/application/resubmit", { token: A.token });
  check("mark-updated then resubmit -> UNDER_REVIEW", mark.status === 200 && resub2.status === 200, `${mark.status}/${resub2.status}`);
  const detail1 = data(await call("GET", `/admin/partners/${pid}/application`, { token: admin }));
  check("resubmit did NOT close the issue (RESUBMITTED, admin must close)", detail1.issues[0].status === "RESUBMITTED");
  check("approve still blocked by RESUBMITTED issue", detail1.approve.blockers.some((b) => b.code === "ISSUES_UNRESOLVED"));

  for (const dt of ["BUSINESS_LICENSE", "REPRESENTATIVE_ID", "PREMISES_PROOF"]) {
    await call("POST", `/admin/partners/${pid}/application/documents/${dt}/accept`, { token: admin });
  }
  const auditBefore = Number(sql("gymcoach_gym", `select count(*) from partner_audit_logs where partner_id='${pid}' and action='APPLICATION_APPROVED'`));
  const resolve = await call("POST", `/admin/partners/${pid}/application/issues/${detail1.issues[0].id}/resolve`, { token: admin });
  check("only admin closes issues", resolve.status === 200);
  const [ap1, ap2] = await Promise.all([
    call("POST", `/admin/partners/${pid}/application/approve`, { token: admin }),
    call("POST", `/admin/partners/${pid}/application/approve`, { token: admin }),
  ]);
  const okCount = [ap1, ap2].filter((r) => r.status === 200).length;
  const conflictCount = [ap1, ap2].filter((r) => r.status === 409).length;
  check("parallel approve: exactly one wins, other gets 409", okCount === 1 && conflictCount === 1, `${ap1.status}/${ap2.status}`);
  const auditAfter = Number(sql("gymcoach_gym", `select count(*) from partner_audit_logs where partner_id='${pid}' and action='APPLICATION_APPROVED'`));
  check("exactly one APPLICATION_APPROVED audit row", auditAfter - auditBefore === 1, `rows=${auditAfter - auditBefore}`);
  const final = sql("gymcoach_gym", `select p.status||'/'||p.verification_status||'/'||g.status from gym_partners p join gym_partner_accounts a on a.partner_id=p.id and a.role='OWNER' join gyms g on g.owner_id=a.user_id where p.id='${pid}'`);
  check("approve atomic result: partner ACTIVE/VERIFIED and first branch APPROVED", final === "ACTIVE/VERIFIED/APPROVED", final);
  // Một bucket, mọi tệp riêng tư: duyệt xong ảnh KHÔNG được sao chép đi đâu cả.
  const photoRow = sql("gymcoach_gym", `select visibility::text||' '||s3_key from gym_photos where gym_id = (select g.id from gyms g join gym_partner_accounts a on a.user_id=g.owner_id and a.role='OWNER' where a.partner_id='${pid}') limit 1`);
  check("after approval photos stay PRIVATE, no public copy is made", photoRow.startsWith("PRIVATE partner-applications/"), photoRow);
  const detailAfter = data(await call("GET", `/admin/partners/${pid}/application`, { token: admin }));
  const photoUrl = detailAfter.photos?.[0]?.url ?? "";
  check("approved photos are served by short-lived signed URL, not a permanent public URL",
    /X-Amz-Signature=/i.test(photoUrl), photoUrl.slice(0, 80));
  const anonPhoto = await fetch(photoUrl.split("?")[0]);
  check("stripping the signature from a photo URL is denied", anonPhoto.status === 403 || anonPhoto.status === 401, `status=${anonPhoto.status}`);

  // post-approval owner
  const stA = data(await call("GET", "/owner/application/status", { token: A.token }));
  check("after approval accessState ACTIVE (or payout pending)", ["ACTIVE", "APPROVED_PAYOUT_PENDING"].includes(stA.accessState), `state=${stA.accessState}`);
  const wards2 = await (await fetch(`${GW}/locations/provinces/92/wards`)).json();
  const before = await call("GET", "/owner/gyms", { token: A.token });
  check("approved owner still gated until payout onboarding done (409 ONBOARDING_INCOMPLETE)", before.status === 409 && code(before) === "ONBOARDING_INCOMPLETE", `status=${before.status} code=${code(before)}`);
  await call("PATCH", "/owner/onboarding/contact", { token: A.token, body: { phone: "0901234567" } });
  await call("PATCH", "/owner/onboarding/payout", { token: A.token, body: { bankName: "TestBank", accountNumber: "0123456789", accountHolder: "NGUYEN W3" } });
  await call("POST", "/owner/onboarding/terms", { token: A.token, body: {} });
  const stA2 = data(await call("GET", "/owner/application/status", { token: A.token }));
  check("after payout onboarding accessState = ACTIVE", stA2.accessState === "ACTIVE", `state=${stA2.accessState}`);
  const gyms = await call("GET", "/owner/gyms", { token: A.token });
  check("active owner can list gyms (operational area open)", gyms.status === 200, `status=${gyms.status}`);
  const second = await call("POST", "/owner/gyms", { token: A.token, body: { name: "Chi nhanh so 2", phone: "0281234567", address: "2 Le Loi", provinceCode: 92, wardCode: wards2[0].code, latitude: 10.03, longitude: 105.78, brandId: fake } });
  const g2 = data(second);
  const ownerBrand = sql("gymcoach_gym", `select brand_id from gyms where id='${g2?.id}'`);
  const firstBrand = sql("gymcoach_gym", `select brand_id from gyms where owner_id=(select user_id from gym_partner_accounts where partner_id='${pid}' and role='OWNER') and name='Chi nhanh W3'`);
  check("branch #2 belongs to the SAME brand (client brandId ignored)", second.status === 201 && ownerBrand === firstBrand && ownerBrand !== fake, `status=${second.status} brand=${ownerBrand}`);
  const brandsAfter = Number(sql("gymcoach_gym", `select count(*) from gym_brands where owner_id=(select user_id from gym_partner_accounts where partner_id='${pid}' and role='OWNER')`));
  check("still exactly one brand after branch #2", brandsAfter === 1);
  const g2Status = sql("gymcoach_gym", `select status from gyms where id='${g2?.id}'`);
  check("branch #2 goes through the normal branch-approval path (not auto-approved)", g2Status !== "APPROVED", `status=${g2Status}`);

  // ── Retirement (W3.9) ────────────────────────────────────────────────────────────────────
  const r1 = await call("POST", "/admin/partners", { token: admin, body: { legalName: "X", contactEmail: "x@y.z" } });
  const r2 = await call("POST", `/admin/partners/${pid}/provision`, { token: admin });
  check("retired: POST /admin/partners -> 410 ENDPOINT_RETIRED", r1.status === 410 && code(r1) === "ENDPOINT_RETIRED", `status=${r1.status}`);
  check("retired: POST /admin/partners/:id/provision -> 410 ENDPOINT_RETIRED", r2.status === 410 && code(r2) === "ENDPOINT_RETIRED", `status=${r2.status}`);
  const r3 = await call("POST", "/admin/gym-owners", { token: admin, body: { email: "z@z.zz", firstName: "Z" } });
  const r4 = await call("GET", "/admin/gym-owners", { token: admin });
  check("dead code removed: gateway /admin/gym-owners (POST+GET) no longer exists", r3.status === 404 && r4.status === 404, `${r3.status}/${r4.status}`);
  const r5 = await fetch("http://localhost:3001/auth/admin/gym-owners", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${admin}` }, body: "{}" });
  check("dead code removed: auth-service /auth/admin/gym-owners no longer exists", r5.status === 404, `status=${r5.status}`);
  const stillList = await call("GET", "/admin/partners/applications", { token: admin });
  const stillPartners = await call("GET", "/admin/partners", { token: admin });
  check("admin partner list + application queue still work", stillList.status === 200 && stillPartners.status === 200, `${stillList.status}/${stillPartners.status}`);

  // ── Log hygiene: no raw tokens / passwords in service logs ─────────────────────────────
  const since = startedAt.toISOString();
  let leaked = [];
  for (const c of ["gymcoach-gateway-dev", "gymcoach-auth-dev", "gymcoach-gym-dev"]) {
    const logs = execSync(`docker logs --since ${since} ${c} 2>&1`, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    for (const s of secrets) if (s && logs.includes(s)) leaked.push(`${c}:${s.slice(0, 6)}…`);
  }
  check("logs (gateway/auth/gym) contain no raw magic token, setupToken or password", leaked.length === 0, leaked.join(","));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("SCRIPT ERROR:", e.stack?.split("\n").slice(0, 6).join("\n"));
  process.exit(2);
});
