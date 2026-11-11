# AWS DEV — Bedrock Access Root-Cause Audit

Date: 2026-09-30. Account `191798898985`, region `ap-southeast-1`. **Read-only investigation only — no Bedrock invocation, no new AI job, no IAM/agreement change made.**

## 1. Identity

`aws sts get-caller-identity` → Account `191798898985` ✅. All subsequent CLI calls in this audit ran as `arn:aws:iam::191798898985:user/vmimport-admin`.

## 2. Current model configuration (source + live Lambda env, values are model IDs only — safe to show; all other env values withheld)

Identical on both `fitness-assistant-dev-ai` and `fitness-assistant-dev-ai-worker`:

| Variable | Value |
|---|---|
| `LLM_PROVIDER` | `bedrock` |
| `BEDROCK_CHAT_MODEL` | `apac.amazon.nova-pro-v1:0` |
| `EMBEDDING_PROVIDER` | `bedrock` |
| `BEDROCK_EMBEDDING_MODEL` | `cohere.embed-multilingual-v3` |
| `BEDROCK_REGION` | `ap-southeast-1` |
| `QUEUE_PROVIDER` | `sqs` |

Confirmed: LLM model is the APAC Nova Pro inference profile, embedding model is Cohere Embed Multilingual v3, exactly as expected.

## 3. Nova Pro inference profile

```
aws bedrock get-inference-profile --inference-profile-identifier apac.amazon.nova-pro-v1:0 --region ap-southeast-1
```

- ARN: `arn:aws:bedrock:ap-southeast-1:191798898985:inference-profile/apac.amazon.nova-pro-v1:0`
- Status: **ACTIVE**, Type: `SYSTEM_DEFINED`
- Destination model ARNs (6 regions): `ap-southeast-2`, `ap-northeast-1`, `ap-south-1`, `ap-northeast-2`, `ap-southeast-1`, `ap-northeast-3` — all `foundation-model/amazon.nova-pro-v1:0`

**The profile itself is valid and correctly configured.** Not invoked.

## 4. AI Worker execution role audit

Execution role: `arn:aws:iam::191798898985:role/fitness-assistant-dev-ai-worker-role` (distinct from the HTTP Lambda's `fitness-assistant-dev-ai-lambda-role`, same policy shape).

Attached managed policies: `AWSLambdaVPCAccessExecutionRole`, `AWSLambdaBasicExecutionRole` only — **no `AmazonBedrockFullAccess`, confirmed not assumed.**

Inline policy `fitness-assistant-dev-ai-worker-runtime-policy`, Bedrock-relevant statements:

| Statement | Effect | Action | Resource | Condition |
|---|---|---|---|---|
| `InvokeNovaProApacInferenceProfile` | Allow | `bedrock:InvokeModel` | `arn:...:inference-profile/apac.amazon.nova-pro-v1:0` | — |
| `InvokeNovaProOnlyThroughApacProfile` | Allow | `bedrock:InvokeModel` | `arn:aws:bedrock:*::foundation-model/amazon.nova-pro-v1:0` | `bedrock:InferenceProfileArn` StringLike the profile ARN |
| `InvokeCohereEmbedMultilingualV3` | Allow | `bedrock:InvokeModel` | `arn:aws:bedrock:ap-southeast-1::foundation-model/cohere.embed-multilingual-v3` | — |

**A** (profile resource): ALLOWed. **B** (every destination foundation-model resource the profile can route to): ALLOWed — the wildcard-region + `InferenceProfileArn` condition is exactly AWS's documented pattern for cross-region inference profile permissions, and it correctly matches all 6 destination regions from step 3. **C** (Cohere in ap-southeast-1): ALLOWed.

No `bedrock:InvokeModelWithResponseStream` statement exists — not used by this codebase (confirmed: `callLLM`/embedding code paths use non-streaming `InvokeModel`, not streaming Bedrock calls; `/ai/ask/stream`'s SSE streaming to the browser is implemented at the ai-service HTTP layer, not via a Bedrock streaming API call).

No explicit `Deny` statement exists anywhere in this role (2 inline policies — the second, `fitness-assistant-dev-opensearch-access`, is OpenSearch-only, unrelated to Bedrock). No permissions boundary on this role (`get-role` → `PermissionsBoundary: null`).

**IAM is not the blocker for either model.**

## 5. Organization / SCP

```
aws organizations describe-organization
→ AWSOrganizationsNotInUseException: Your account is not a member of an organization.
```

This is a **definitive, positive result, not a visibility gap**: SCPs only exist within AWS Organizations. This account is standalone — **no SCP can apply, to any region, to any action.** Cross-region inference to any of the profile's 6 destination regions cannot be blocked by an SCP because none exists.

## 6. Cohere Marketplace prerequisites

Caller identity `vmimport-admin` has `AdministratorAccess` attached (confirmed via `list-attached-user-policies`) — this already includes `aws-marketplace:Subscribe`, `aws-marketplace:Unsubscribe`, `aws-marketplace:ViewSubscriptions`, and `bedrock:CreateFoundationModelAgreement` implicitly. **No permission gap exists for accepting the Cohere agreement with this identity.**

```
aws bedrock get-foundation-model-availability --model-id cohere.embed-multilingual-v3 --region ap-southeast-1
  authorizationStatus:        NOT_AUTHORIZED
  entitlementAvailability:    AVAILABLE
  agreementAvailability.status: NOT_AVAILABLE
  regionAvailability:         AVAILABLE
```

`agreementAvailability.status: NOT_AVAILABLE` here means "no agreement has been created/accepted yet" — not "unavailable to create." Confirmed by directly listing the real, current offer:

```
aws bedrock list-foundation-model-agreement-offers --model-id cohere.embed-multilingual-v3 --region ap-southeast-1
```

returned one real, live offer (`offerId: 3d9erkgsks1ebtlsm5j442rot`, with a real `offerToken` and usage-based rate card — Cohere's actual per-token/per-image pricing across regions, a real legal-terms document, and a no-refund support policy). **This confirms the "Model Access console is retired" premise precisely**: it has been replaced by this offer-listing + agreement-creation API pair. Nothing has called `create-foundation-model-agreement` with this offer yet — that is the entire, exact, fixable gap for Cohere.

## 7. Nova Pro availability, correctly framed around the inference profile

Per instruction, not relying solely on the flat `get-foundation-model-availability` call for the underlying model ID — cross-checked against the inference profile and IAM (steps 3-4 above), both clean.

```
aws bedrock get-foundation-model-availability --model-id amazon.nova-pro-v1:0 --region ap-southeast-1
  authorizationStatus:        NOT_AUTHORIZED
  entitlementAvailability:    AVAILABLE
  agreementAvailability.status: AVAILABLE
  regionAvailability:         AVAILABLE
```

Unlike Cohere, Nova Pro has **no agreement-offer mechanism at all**:

```
aws bedrock list-foundation-model-agreement-offers --model-id amazon.nova-pro-v1:0 --region ap-southeast-1
→ ValidationException: Agreement not supported for this model
```

This is the expected shape for a first-party Amazon model (no EULA/marketplace terms to accept) — but it also means **the Cohere-style fix does not apply to Nova**. With the inference profile valid (step 3), IAM fully correct on both the profile and every destination model ARN (step 4), and no SCP possible at all (step 5), **no further self-service, API-reachable remediation path for Nova Pro's `NOT_AUTHORIZED` status was found** within this audit's read-only tooling. This looks like a pure account-level Bedrock entitlement flag with no CLI-equivalent of the retired console toggle for this specific (first-party, no-agreement) model class.

## 8. Root-cause matrix

### NOVA_PRO
- Inference profile valid? **Yes** — ACTIVE, correct ARN, correct 6-region destination set.
- IAM allows profile? **Yes** — `InvokeNovaProApacInferenceProfile` statement, exact ARN match.
- IAM allows destination models? **Yes** — `InvokeNovaProOnlyThroughApacProfile`, wildcard-region + correct `InferenceProfileArn` condition, covers all 6 destination regions.
- SCP permits destination regions? **N/A — no SCP possible (account is not in an AWS Organization).**
- **ROOT_CAUSE: Account-level Bedrock model-authorization entitlement (`authorizationStatus: NOT_AUTHORIZED`) with no agreement-offer mechanism for this model and no other self-service API path discovered. Not IAM, not SCP, not the inference profile.**

### COHERE_EMBED
- Region available? **Yes** (`regionAvailability: AVAILABLE`).
- Authorization status? **NOT_AUTHORIZED.**
- Entitlement available? **Yes** (`entitlementAvailability: AVAILABLE`).
- Agreement available? **A real, live agreement offer exists** (`offerId 3d9erkgsks1ebtlsm5j442rot`) — simply never accepted.
- Marketplace permissions sufficient? **Yes** — current identity (`vmimport-admin`) has `AdministratorAccess`, covers every `aws-marketplace:*`/`bedrock:CreateFoundationModelAgreement` action needed.
- IAM InvokeModel sufficient? **Yes** — confirmed correctly scoped on the worker role (step 4).
- **ROOT_CAUSE: No foundation-model agreement has been created yet. This is the entire, complete, and only gap. Fully self-service, no owner/console action needed — accepting the offer via `create-foundation-model-agreement` is sufficient once explicitly approved.**

## 9. Fix plan (prepared only — NOT applied)

### Cohere Embed Multilingual v3 — fully self-service, one CLI call

```bash
aws bedrock create-foundation-model-agreement \
  --region ap-southeast-1 \
  --model-id cohere.embed-multilingual-v3 \
  --offer-token "AQICAHgzEVRg86gICmCZSMkfOOI...<see step 6's full offerToken>"
```

No IAM change needed (current admin identity already has everything required). No new AWS resource created — this accepts a usage-based agreement (Cohere's own per-token/per-image pricing shown in step 6); real usage after acceptance will incur real Bedrock/Marketplace charges, same as any Bedrock model invocation. The `offerToken` is single-use-ish and time-limited (it is a signed token embedded with an expiry) — must be re-fetched via `list-foundation-model-agreement-offers` immediately before use if this is applied in a later session, not copy-pasted from this report after significant time has passed.

### Nova Pro — no IAM/agreement fix exists to prepare

Nothing to fix on the IAM, profile, or agreement side — all three are already correct. The blocker is purely the account-level `authorizationStatus` flag itself. **Recommended owner action**: open an AWS Support case (or check AWS Billing/Account settings for a pending verification step, e.g., unconfirmed payment method — a documented cause of blanket Bedrock model authorization failures on some accounts) referencing this exact finding: `get-inference-profile` valid, IAM fully permissive on both the profile and destination model ARNs, no SCP possible, yet `get-foundation-model-availability` still reports `authorizationStatus: NOT_AUTHORIZED`. No fabricated console path is offered here, per instruction that the old Model Access page is retired and should not be cited.

## Final response

**NOVA PRO: OTHER** (không phải IAM_BLOCKED, không phải SCP_BLOCKED, không phải PROFILE_INVALID — cả 3 đều đã xác nhận đúng/sạch; bị chặn bởi cờ authorization cấp tài khoản AWS, không có API tự-phục-vụ nào tìm thấy để tự sửa)

**COHERE EMBED: OTHER** (không phải MARKETPLACE_BLOCKED — quyền marketplace đã đủ; không phải IAM_BLOCKED — IAM đã đúng; không phải ENTITLEMENT_BLOCKED theo nghĩa bị từ chối — entitlement AVAILABLE, chỉ đơn giản là **chưa từng chấp nhận agreement**, một hành động tự-phục-vụ hoàn toàn bằng CLI, đã chuẩn bị sẵn lệnh chính xác ở trên, chưa thực thi)

- Role chính xác: `fitness-assistant-dev-ai-worker-role` (và `fitness-assistant-dev-ai-lambda-role` cho HTTP Lambda, cùng policy).
- Quyền thiếu chính xác: **Không có quyền IAM nào bị thiếu** cho cả 2 model.
- ARN tài nguyên chính xác: profile `arn:aws:bedrock:ap-southeast-1:191798898985:inference-profile/apac.amazon.nova-pro-v1:0`; Nova destination `arn:aws:bedrock:*::foundation-model/amazon.nova-pro-v1:0`; Cohere `arn:aws:bedrock:ap-southeast-1::foundation-model/cohere.embed-multilingual-v3`.
- Vấn đề SCP: **Không áp dụng — tài khoản không thuộc AWS Organization, không có SCP nào tồn tại.**
- Lệnh fix tối thiểu: Cohere — 1 lệnh `create-foundation-model-agreement` (đã chuẩn bị, xem mục 9), không cần IAM mới. Nova Pro — không có lệnh CLI nào tự sửa được; cần AWS Support.
- Có cần thao tác Console thật không: **Cohere — không cần**, hoàn toàn CLI. **Nova Pro — không có trang Console để dùng nữa (đã retired) và không tìm thấy API thay thế; cần liên hệ AWS Support.**

## Final verdict

```
BEDROCK_ACCESS:
OWNER_ACTION_REQUIRED
```

(Cohere is `READY_TO_FIX` on its own — a single unapplied CLI command; Nova Pro remains a genuine `OWNER_ACTION_REQUIRED`/AWS Support matter with no self-service path found. Overall verdict reflects the stricter of the two, since both models are required for a real end-to-end AI test.)

No Bedrock invocation was made. No AI job was created. No IAM policy or agreement was modified.
