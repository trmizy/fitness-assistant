# InBody Scan Extraction — Local Vision Model Migration

Date: 2026-09-01

## Summary

InBody scan photo extraction (`user-service`) defaulted to Claude's vision
API (`claude-sonnet-4-6`, forced tool-use) for every upload. Per request,
it now defaults to a **local** vision-capable model served by the same
Ollama instance `ai-service` already uses for chat/RAG — no InBody photo or
extracted body-composition data leaves the machine unless a caller
explicitly opts back into the Claude path.

## What changed

`backend/services/user-service/src/services/inbody-vision.service.ts`:

- New `INBODY_VISION_PROVIDER` env var (`ollama` default, `anthropic` opt-in).
  No cross-provider auto-fallback — if the configured provider fails, the
  error surfaces through the existing (already-working) "retry or enter
  manually" flow rather than silently spending Claude API budget the user
  asked to avoid.
- New `extractWithOllama()` — POSTs the base64 image + prompt to
  `${OLLAMA_BASE_URL}/api/chat` with `images: [base64]` and a structured
  `format` JSON schema (Ollama's own equivalent of Claude's forced
  tool-use, supported since Ollama ~0.5 — this deployment runs 0.30.5).
  Reuses the exact HTTP pattern already proven in
  `backend/services/ai-service/src/services/llm.service.ts` — no new HTTP
  client library added.
- **One JSON schema, shared** between Claude's `tool.input_schema` and
  Ollama's `format` — the two providers cannot silently drift into
  different output shapes.
- New `normalizeVisionResult()` — a local model is far more likely than
  Claude's server-validated tool-use to drop a key, return a number as a
  string, or wrap JSON in a markdown fence. Every response (from either
  provider) is now defensively coerced into the same `VisionResult` shape
  before it reaches `inbody.service.ts`, so nothing downstream (the
  bmi/bodyFatPct derivation, the review-before-save UI) needed to change.
- `extractWithClaude()` is unchanged behavior, just refactored out of the
  single exported function — still available via
  `INBODY_VISION_PROVIDER=anthropic`.

`.env.example` and `infra/compose/docker-compose.dev.yml` (user-service
block): new `INBODY_VISION_PROVIDER`, `INBODY_VISION_OLLAMA_MODEL`,
`OLLAMA_BASE_URL`/`LLM_BASE_URL` (user-service never talked to Ollama
before — these didn't exist on this container previously).

## Model choice

Default: **`qwen2.5vl:3b`**. Chosen after checking this environment's real
constraints, not assumed:

- `docker exec gymcoach-ollama nvidia-smi` fails — no GPU passthrough into
  the `ollama` container, so inference is CPU-only here.
- Host: 16 GB RAM, RTX 3050 Ti Laptop (4 GB VRAM, not currently passed to
  Docker). The `ollama` container itself is capped at 5 GB memory.
- The InBody report is not plain text — it's a numbers table *plus* a
  segmental-analysis body silhouette chart the model has to visually
  ground per body part. Qwen2.5-VL's document/chart understanding is
  meaningfully better than `llava`/`moondream` at a comparable size, which
  matters more here than for a generic image-captioning task.

Override via `INBODY_VISION_OLLAMA_MODEL` — `qwen2.5vl:7b`,
`llama3.2-vision:11b`, or `minicpm-v` are more accurate if the host has a
GPU passed into Docker or CPU-only latency isn't a concern. Pull whichever
model into the running container first:

```
docker exec gymcoach-ollama ollama pull qwen2.5vl:3b
```

## Verification

- `npx tsc --noEmit` on `user-service`: clean.
- Pulled `qwen2.5vl:3b` into the running `gymcoach-ollama` container
  (3.2 GB) and ran `inbody-vision-ollama.integration.test.ts` for real —
  passing, confirming the request/response round-trip, the structured
  `format` schema, and `normalizeVisionResult()` all work against a live
  Ollama call, not a mock.
- **Real measured latency on this environment** (CPU-only, no GPU
  passthrough): **~135s cold** (first call after the model isn't loaded —
  weights loading into RAM) vs **~15-16s warm** (model already resident).
  Added `keep_alive: "30m"` to the Ollama request so a user retrying a bad
  photo minutes apart doesn't pay the cold-start cost twice. Both numbers
  are comfortably under the frontend's existing 180s upload timeout and
  the service's own 150s `INBODY_VISION_OLLAMA_TIMEOUT_MS`.
- `docker exec gymcoach-user-dev printenv` confirmed after container
  recreation (`docker compose up -d --no-deps user-service` — a plain
  `docker restart` does NOT pick up new compose-file environment values,
  only code changes on the bind mount) that `INBODY_VISION_PROVIDER=ollama`,
  `INBODY_VISION_OLLAMA_MODEL=qwen2.5vl:3b`, and `OLLAMA_BASE_URL` all
  reached the container correctly.
- **Not yet verified**: extraction ACCURACY against a real InBody report
  photo — no such image exists in this repo (the integration test above
  deliberately uses a synthetic 1x1 pixel to prove the plumbing without
  fabricating fake medical-report test data). Upload a real InBody photo
  through the running app (`/client/inbody` → "Chụp ảnh phiếu InBody") to
  see actual field-by-field accuracy; the existing review-before-save
  screen will show exactly what qwen2.5vl:3b could and couldn't read, and
  the manual-entry fallback still works unchanged if it reads badly.

## Deliberately not done

- **No automatic fallback to Claude** if the local model fails/times out —
  would silently reintroduce the API cost/privacy tradeoff the user asked
  to remove. The existing manual-entry escape hatch
  (`InBodyModule.tsx`'s "failed" step) already covers this case.
- **No confidence-score UI added** — none existed for the Claude path
  either (verified against the code, despite an older audit doc describing
  an intended-but-never-built confidence-threshold design); out of scope
  for a provider swap.
- **The dormant `inbody_extractor/` Python Tesseract pipeline** was left
  untouched — it's classical OCR (text only), not vision-LLM, and would
  need real engineering to read the segmental silhouette chart at all;
  not revived here.
