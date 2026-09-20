/**
 * Phase 6 — service/API tests for the InBody domain.
 *
 * Same purpose as the nutrition suite: the seam against the real backend, not the arithmetic
 * (inbodyMath has its own tests). The contracts here were observed against the running gateway:
 *
 *  - `GET /inbody` answers a bare array in no particular order, so the newest-first ordering is
 *    ours to do — the dashboard's "latest sheet" and every delta on the InBody screen depend on it,
 *    and the tie-break on `createdAt` is what keeps two sheets measured the same day stable;
 *  - `POST /inbody` returns 500, not 400, when `muscleMass` is missing (GAP-9), which is why the
 *    form makes that field required rather than optional;
 *  - `POST /inbody/upload` only EXTRACTS a sheet — it never saves one — so a screen that uploads
 *    must still post the result afterwards;
 *  - there is no `DELETE /inbody/:id` at all (GAP-9), so no screen may offer deletion.
 */
import { inbodyService } from "../../api";
import { buildEntryPayload, formErrors } from "../../../features/inbody/inbodyMath";
import { stubHttp, type HttpStub } from "./httpStub";

let http: HttpStub;

afterEach(() => http?.restore());

describe("GET /inbody", () => {
  it("orders the history newest first by measurement date, whatever order it arrives in", async () => {
    http = stubHttp(() => ({
      data: [
        { id: "b", date: "2026-07-02T00:00:00.000Z", weight: 71, createdAt: "2026-07-02T08:00:00.000Z" },
        { id: "d", date: "2026-09-10T00:00:00.000Z", weight: 69, createdAt: "2026-09-10T08:00:00.000Z" },
        { id: "a", date: "2026-05-20T00:00:00.000Z", weight: 73, createdAt: "2026-05-20T08:00:00.000Z" },
        { id: "c", date: "2026-08-01T00:00:00.000Z", weight: 70, createdAt: "2026-08-01T08:00:00.000Z" },
      ],
    }));

    const history = await inbodyService.getHistory();
    expect(http.last().method).toBe("GET");
    expect(http.last().path).toBe("/inbody");
    expect(history.map((row: any) => row.id)).toEqual(["d", "c", "b", "a"]);
  });

  it("breaks a same-day tie by when the sheet was recorded", async () => {
    http = stubHttp(() => ({
      data: [
        { id: "morning", date: "2026-09-10T00:00:00.000Z", createdAt: "2026-09-10T06:00:00.000Z" },
        { id: "evening", date: "2026-09-10T00:00:00.000Z", createdAt: "2026-09-10T19:00:00.000Z" },
      ],
    }));

    const history = await inbodyService.getHistory();
    expect(history.map((row: any) => row.id)).toEqual(["evening", "morning"]);
  });

  it("passes a non-array body straight through instead of pretending it sorted something", async () => {
    http = stubHttp(() => ({ data: { message: "no data" } }));
    expect(await inbodyService.getHistory()).toEqual({ message: "no data" });
  });

  it("reads the latest sheet from its own endpoint", async () => {
    http = stubHttp(() => ({ data: { id: "latest", weight: 69 } }));
    const latest = await inbodyService.getLatest();
    expect(http.last().path).toBe("/inbody/latest");
    expect(latest.id).toBe("latest");
  });
});

describe("POST /inbody", () => {
  it("posts the derived body, fat in kg included", async () => {
    http = stubHttp(() => ({ status: 201, data: { id: "saved" } }));

    const payload = buildEntryPayload({
      date: "2026-09-17",
      weight: "70",
      muscleMass: "32",
      bodyFatPct: "20",
      height: "175",
      bmr: "1600",
      visceralFat: "",
      notes: "",
    } as any);
    await inbodyService.create(payload);

    const sent = http.last();
    expect(sent.method).toBe("POST");
    expect(sent.path).toBe("/inbody");
    expect(sent.body).toMatchObject({
      weight: 70,
      muscleMass: 32,
      bodyFatPct: 20,
      // 20 % of 70 kg — the server stores kg, the sheet shows a percentage.
      bodyFat: 14,
      height: 175,
      bmr: 1600,
    });
    // Empty optional fields are left out rather than sent as zeros.
    expect("visceralFat" in sent.body).toBe(false);
  });

  it("refuses a sheet with no muscle mass before the request, because the server 500s on it", async () => {
    const errors = formErrors({
      date: "2026-09-17",
      weight: "70",
      muscleMass: "",
      bodyFatPct: "20",
      height: "",
      bmr: "",
      visceralFat: "",
      notes: "",
    } as any);
    expect(errors.muscleMass).toBeTruthy();

    // And if one ever gets through, the 500 reaches the caller rather than reading as a save.
    http = stubHttp(() => ({ status: 500, data: { message: "Internal server error" } }));
    await expect(
      inbodyService.create({ weight: 70, bodyFatPct: 20, bodyFat: 14 }),
    ).rejects.toMatchObject({ response: { status: 500 } });
  });
});

describe("POST /inbody/upload", () => {
  it("uploads the picked image as multipart, with the field name the route reads", async () => {
    // The multipart part itself cannot be read back here: under Jest the global FormData is the
    // WHATWG one, which stringifies a file descriptor to "[object Object]", while on the device it
    // is React Native's, which carries {uri, name, type} through to the request. Watching the
    // append call asserts what our code puts in, independently of which implementation is in scope.
    const append = jest.spyOn(FormData.prototype, "append");

    http = stubHttp(() => ({
      data: { extracted: { weight: 70, muscleMass: 32, bodyFatPct: 20 } },
    }));

    const result = await inbodyService.upload({
      uri: "file:///tmp/inbody.jpg",
      name: "inbody.jpg",
      type: "image/jpeg",
    } as any);

    const sent = http.last();
    expect(sent.method).toBe("POST");
    expect(sent.path).toBe("/inbody/upload");
    expect(String(sent.headers["Content-Type"])).toBe("multipart/form-data");
    // OCR on a photographed sheet runs far longer than a normal call.
    expect(sent.timeout).toBe(180000);

    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith("image", {
      uri: "file:///tmp/inbody.jpg",
      name: "inbody.jpg",
      type: "image/jpeg",
    });

    // The route EXTRACTS only: nothing is stored, so the screen still has to post the sheet.
    expect(result.extracted.weight).toBe(70);
    expect(result.id).toBeUndefined();

    append.mockRestore();
  });

  it("lets a rejected file (too large, wrong type) reach the caller with its message", async () => {
    http = stubHttp(() => ({ status: 400, data: { message: "File too large (max 5MB)" } }));

    await expect(
      inbodyService.upload({ uri: "file:///tmp/big.pdf", name: "big.pdf", type: "application/pdf" } as any),
    ).rejects.toMatchObject({ response: { status: 400, data: { message: "File too large (max 5MB)" } } });
  });
});

describe("what the domain deliberately cannot do", () => {
  it("offers no delete, because the backend has no route for one (GAP-9)", () => {
    // A guard, not a wish: if this ever starts failing it means someone added a call for a route
    // the gateway does not serve, and the screen would 404 on the device.
    expect(Object.keys(inbodyService).sort()).toEqual(["create", "getHistory", "getLatest", "upload"]);
  });
});
