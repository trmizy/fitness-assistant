# AI Coach — final pilot infrastructure hardening

Ngày 2026-11-01. Review base `06ed544c`; branch `feat/advisory-content-v3`, worktree `fitness-assistant-worktrees/advisory-content-v3`. Evidence: **CODE AUDIT / TEST FIXTURE**. Không chạy model, embedding hoặc vector DB thật.

**PREPARED_FOR_FINAL_INFRASTRUCTURE_AUDIT — LIVE_EXECUTION_LOCKED.** Hoàn thiện runner là bằng chứng plumbing, chưa chứng minh RAG hoặc LLM reasoning tốt hơn. Không triển khai production hoặc merge.

## Năm finding

| Finding | Trạng thái trong phạm vi đã triển khai | Giới hạn |
| --- | --- | --- |
| Pricing fail-closed | FIXED | Hai đơn giá bắt buộc dương/hữu hạn; pin model/profile/region, USD per million tokens, source/version/evidence hash và thời hạn. Kiểm tra cumulative worst-case spend trước inference. Chưa có giá thật được phê duyệt. |
| Global ledger / one-time approval | FIXED cho một trusted host/local filesystem | Ed25519 approval gắn issuer, approvalId/configHash/expiry; LIVE yêu cầu trust root và ledger được owner cấp sẵn. Một approval chỉ claim một run. Lock liên process, journal fsync, reservation giữ lại khi outcome không rõ. Owner trust bootstrap/ACL/issuer chưa được cài hoặc xác minh thực tế. |
| Verify all pins | FIXED | Tính lại HEAD, clean status, tracked code/lock/config bytes, corpus, case file thật và prompts dựng lại từ released inputs. Receipt nội bộ không thể thay bằng caller JSON; recheck trước count/attempt. Không dùng caller hash làm bằng chứng. |
| CountTokens / Converse identity | FIXED bằng policy hạn chế | Cùng identifier/model/region/pricingVersion trong manifest và journal. LIVE profile bị từ chối; không count bằng base model rồi infer bằng profile. Direct model cần owner xác nhận hỗ trợ/permission thực tế. |
| Controlled runner | FIXED cho FAKE-only execution | Prepare → pins/budget → preview → evaluate → verify → atomic result → blind packets. Resume dùng ledger/journal cũ; không lặp attempt đã reserve. CLI và runner không có nhánh LIVE thực thi. |

Independent scientific review, corpus 15–20 nguồn, independent held-out labels, model evaluation và production integration vẫn chưa hoàn thành/không thuộc lần triển khai này.

## Commits và files

Paths dưới đây tương đối với `backend/services/ai-service/src/`.

1. `fd85a431` — pricing/global approval: `evaluation/bedrock-pilot/{config,ledger,storage,session}.ts`; cập nhật Bedrock evaluation tests; thêm hardening tests và fake/crash fixtures.
2. `52ae46be` — pin verification/target identity: `bedrock-pilot/pins.ts`, session/storage và pin tests; fixture git repository + owner-released synthetic input.
3. `6e969d1f` — controlled runner: `bedrock-pilot/{runner,run}.ts`, config/ledger/session; đổi `placeboPadding` thành `contextPadding` trong DEV pipeline, cập nhật ablation test; runner failure/resume tests.
4. Commit tests/protocol/docs chứa report này: bổ sung drift/timeout/ledger controls, approval protocol/pilot plan, cập nhật historical banners và bằng chứng cuối. Hash trong `git log -4` và phản hồi bàn giao.

Không sửa production provider `services/bedrock.client.ts`, routes/flags/config thật, DB/schema hoặc vector index. Frozen V2 source/data/answers/historical scores giữ nguyên.

## Approval và ledger

LIVE API không tin `approvedBy` hoặc JSON tự tạo. Chữ ký Ed25519 phải xác minh với public key do admin pin ở vị trí cố định: Windows `C:/ProgramData/Gymini/Evaluation/trust.json`, POSIX `/etc/gymini-evaluation/trust.json`; không lấy từ env hoặc config artifact. Chữ ký bao gồm approvalId, issuer, scope, configHash và expiry. Config hash bao phủ model/target, pricing version/rates, budgets, source paths và tất cả pins, loại riêng approval để tránh vòng hash.

[Owner approval protocol](../../data/eval/ai-coach-dev/owner-approval-protocol.json) mô tả bootstrap và preissued ledger. Runner không sinh key, không cài trust root, không cấp approval và không tự tạo ledger LIVE khi file bị thiếu. `issueFixtureLedger` chỉ ghi authority `FAKE_TEST_ONLY`, không qua gate LIVE. Admin/owner phải bảo vệ trust root, private key và ledger bằng OS identity/ACL; cơ chế này không tự xác thực một con người hoặc chống được admin độc hại/rollback storage. Chưa có thực nghiệm với trust store thật.

Ledger đặt ngoài run artifact và ngoài worktree LIVE. File theo approvalId giữ configHash/approvalHash và run directory đã claim. Session giữ exclusive `wx` lock suốt vòng đời; process khác bị từ chối, không tranh cùng ngân sách. Hash-chain journal được fsync trước khi state thay đổi; kiểm tra file identity/content trước append. Count call cap cũng được lưu trước API request. Inference reserve trước dispatch toàn bộ input count + output cap và call attempt; reconcile chỉ khi usage khớp và raw response đã có bản sao bền vững.

Một approval đã claim không mở run mới, kể cả khác artifact directory; thay config không giữ được binding. Clean resume chỉ cùng run/config/approval và dùng totals/count cache/attempt keys cũ. Lock sau crash không được tự xóa hoặc coi hết hạn; không auto refund/retry. Missing/partial/replaced journal, missing lock hoặc unknown reservation yêu cầu owner audit. Đã dùng approval không được tái cấp bằng cách xóa ledger. Không có lệnh reset ledger trong runner.

Đây là ngân sách của approval trên **một host/local filesystem**, không phải trần account AWS hoặc distributed ledger nhiều máy. Không thử NFS/network filesystem, power-loss/fsync hardware semantics hay ACL deployment. File fsync/hard-link atomic publication và OS process crash là phạm vi fixture; backup/anti-rollback và vận hành owner reconciliation còn cần review.

## Pins và target

`calculatePilotPins` đọc actual git HEAD/working tree, các file tracked của AI-service cùng lock/package/tsconfig gốc; hash bằng relative path + SHA256 bytes. Corpus hash bao gồm pack, claim map, supplement và registry bytes. Case hash dùng bytes của owner-released file, không phải một hash caller tự khai. Prompt hashes được dựng lại bằng `prepareReleasedPilot` từ released requests/manifests/receipt hashes và corpus đó. Config sources phải là absolute paths.

`verifySessionPins` so từng pin và phát một receipt nằm trong WeakMap nội bộ. LIVE chỉ nhận đúng implementation root đang chạy, clean tree và receipt hợp lệ. `assertVerifiedPins` kiểm tra lại config binding, files/HEAD/clean state trước admission và trước inference; prompt khác pin bị từ chối. Placeholder toàn số 0 bị schema chặn. Hash đủ dài nhưng sai nội dung vẫn bị mismatch. Runtime artifacts/owner case file đặt ngoài git hoặc ignored; không bỏ qua untracked source khi kiểm tra clean.

Tracked code hash không xác minh một hệ điều hành, dependency binary hoặc process bị compromise. Owner cần khởi động process mới từ reviewed clean checkout/dependency lock. Giả định local trusted process/filesystem được ghi rõ, không gọi hash là remote attestation.

Theo [CountTokens API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_CountTokens.html), identifier được mô tả là foundation model ID/ARN; [Converse](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html) còn nhận inference profile. Vì chưa có căn cứ xác nhận profile với CountTokens, LIVE từ chối profile thay vì tự đổi identifier. Fake profile test chỉ xác nhận hai input giống nhau, không chứng minh AWS hỗ trợ profile. Direct model count lỗi/unsupported cũng dừng trước inference; region phải trùng existing client. Không gửi seed hoặc thay production Bedrock config.

## Runner, durability và reviewer output

Entry point: `evaluation/bedrock-pilot/run.ts`. Không có nhánh unlock bằng environment variable; `--live` luôn exit 1. `runControlledPilot` cũng từ chối mode LIVE. Mặc định dùng fake transport có count/response đánh dấu fixture; không fallback sang network.

```powershell
# cwd: advisory-content-v3/backend/services/ai-service
pnpm exec tsx src/evaluation/bedrock-pilot/run.ts --fake <owner-prepared-fake-config.json> <new-run-directory>
pnpm exec tsx src/evaluation/bedrock-pilot/run.ts --fake <same-config.json> <same-run-directory> --resume
```

`sources.casesFile` chứa `released-pilot-input-v1`, `scope=OWNER_REVIEWED_NON_SAFETY_CASES_ONLY`, released bundles, expected manifests và owner receipt hashes; không chứa labels/private salts. Owner approval cuối cùng phải duyệt các bytes đó; scope string tự nó không chứng minh independent review. Public helper tạo pins không gọi model và không cấp quyền LIVE.

Preview báo target, tất cả hashes, call caps, input/output/cost ceilings, stop conditions và count deltas cho context/placebo. Field trung tính `contextPadding` vẫn giữ matched character length; đổi key có thể đổi tokenizer behavior. FAKE counts không phải exact model tokens, token-match và tolerance owner duyệt vẫn pending. Sau này cần model-specific preflight cùng target trước inference; đổi padding phải repin/reapprove. Không gọi API thật để đo trong lượt này.

Persistence gồm immutable `manifest.json`, hash-chained append-only `results.jsonl` và `pilot.jsonl`, atomic `preview.json`, `answer-<attemptKey>.json`, `summary.json`. Atomic publication dùng fsynced temp file + exclusive hard link; không overwrite output cũ. Mỗi response ghi `RAW_RESPONSE` trước parse/verification/refund/final row. Parse/schema-invalid candidates, refusal/error category, usage, latency, stop reason và target được giữ; known secret patterns được redact, không lưu exception stack/message. Redaction không phải bảo đảm phát hiện mọi PII.

Lỗi ghi summary/result sau bản raw không mất bản raw trong journal. Crash trước bản raw đầu tiên vẫn có reservation, có thể không giữ được text chỉ còn trong RAM; không tuyên bố khôi phục được response chưa persist. Nếu raw có mà final attempt row thiếu, runner không gọi lại: `UNRESOLVED_RESERVATION_REQUIRES_OWNER_AUDIT`. Với attempt đã hoàn tất, clean resume có thể viết lại phần review còn thiếu từ journal, không inference lại. Journal bị hỏng/partial không được truncate tự động. Sau khi summary đã có nhưng commit journal bị lỗi, fail-closed/manual audit thay vì overwrite.

Reviewer packets gồm hai slots mù, claims/conclusion/questions, facts và exact excerpts; không đưa expected labels, source-control trace hoặc arm/policy metadata vào provider input. Verification offline giữ cùng parsed candidate và scientificPass=null. Summary tách scheduled/routed/generation-eligible/reserved inference attempts/finished outputs/provider-or-parse failures/post-gate eligible/blocked/not attempted. Ledger inferenceAttempts là conservative reserved/possibly dispatched attempts khi có crash, không phải bằng chứng tất cả request đã tới provider. Không đếm blocked là correct; raw/post correctness vẫn null.

Initial pilot chỉ nhận fitness cases đã được owner review ngoài safety/crisis. Recognized safety/self-harm/out-of-domain route bỏ generation cho mọi arm; không nới regex hoặc coi classifier hiện có là đầy đủ. Các case chưa được safety-owner duyệt nằm ngoài pilot ban đầu.

## Verification

**TEST FIXTURE:** scoped regression có **298 pass / 0 fail / 0 skip trong 29 file**; ai-service `pnpm exec tsc --noEmit` **exit 0**. Scope gồm 12 advisory files, 11 ai-coach files, bốn RAG files và hai Bedrock SDK/STS fixture files. Không phải full repository regression, REAL HTTP/API, REAL BROWSER hoặc model evaluation. SDK calls của existing Bedrock suites được fake; Qdrant HTTP stub không phải vector DB thật.

```powershell
# cwd: advisory-content-v3/backend/services/ai-service
$env:ADVISORY_V2_ARTIFACT_DIR='C:/D_Backup/project_personal/fitness-assistant/artifacts/ai-advisory-progress/bedrock-guarded-v2'
$a=@(rg --files src/__tests__ -g 'advisory-*.test.ts')
$c=@(rg --files src/__tests__ -g 'ai-coach-*.test.ts')
pnpm exec tsx --test @a @c `
  src/__tests__/rag-retrieval-v2.test.ts src/__tests__/rag-remediation-4-7r.test.ts `
  src/__tests__/rag-ood-safety-4-7r2.test.ts src/__tests__/rag-safety-signals-4-7r3.test.ts `
  src/__tests__/bedrock-provider.test.ts src/__tests__/bedrock-cross-account.test.ts
pnpm exec tsc --noEmit
```

Các probes mới nằm trong `ai-coach-pilot-{hardening,pins,runner}.test.ts`, chạy child process với `--import tsx`; chỉ fake transport:

| Probe | Output/assertion đã chạy |
| --- | --- |
| Hai process cùng approval | Exit codes `[0, 23]`: đúng một process acquire lock |
| New directory / changed config | `APPROVAL_ALREADY_USED` / `APPROVAL_LEDGER_BINDING_MISMATCH`; không inference |
| Crash sau reserve, chưa response | Child exit 73; ledger giữ input=12/output=2,048 fixture tokens và orphan lock |
| Crash có response nhưng trước raw write | Child exit 74; reservation/lock giữ nguyên, chưa có raw record |
| Crash sau raw journal fsync, trước reconcile | Child exit 74; raw record còn, output cap chưa refund |
| Timeout rồi clean restart | Giữ reservation/call attempt; restart không vượt maxCalls, không cấp lại ngân sách |
| Lỗi ở sáu stage runner | Dừng ở stage; có response thì raw journal còn; các known-finished attempts resume không lặp inference |
| Lỗi final attempt-row write | Có raw copy; resume trả `UNRESOLVED_RESERVATION_REQUIRES_OWNER_AUDIT`, tổng fake invokes vẫn 1 |
| Lỗi atomic summary write | Sáu raw copies còn; resume hoàn tất với tổng fake invokes vẫn 6 |
| Pricing/pins/count/budget/usage | Invalid pricing, forged/changed pins, unsupported count, too-small preview cap và parse failures bị chặn/dừng theo contract |
| Safety/crisis / LIVE env flags | Sáu arm routed, zero inference; CLI `--live` exit 1 kể cả đặt env opt-in |

Fake CLI có một lượt hoàn chỉnh sáu arm trong temporary fixture directory; không commit artifacts, private labels hoặc key fixtures. Fake Ed25519 keys chỉ sinh trong RAM để kiểm chứng signature tampering/expiry; không phải approval thật. All-pins probes dùng actual files/git trong temporary fixture repository và kiểm tra actual implementation-root dirty/mismatch boundary; không tuyên bố đã admit một LIVE session.

**Actual Bedrock/model calls = 0; embedding calls = 0; vector DB calls = 0.** Scoped frozen integrity suites đã đọc local preserved V2 artifacts. Manual SHA256 giữ nguyên: evidence pack `4251adb6c9aa0d88d54d6b69a88824b60e37ce33a74467b822bf042483e1b8ea`; frozen results `4f3f376ac81a93f645ba86a49a241f2d761e2bdf29388dcb44f79530e16c857a`. Protected V2 experiment/scenarios/run/guarded source và existing `services/bedrock.client.ts` diff bằng 0 so với `06ed544c`.

## External dependencies và final audit

Chưa có scientific approval cho hai nguồn abstract lịch sử hoặc corpus 15–20 nguồn; protein/creatine/nutrition/current guideline/conflict pair vẫn pending. Chưa có independent held-out case/labels thật; synthetic fixtures ở tests không trở thành independent dataset.

Trước pilot thật: Claude Code audit code/ledger race/crash behavior và trust bootstrap; owner/admin cấp trust/ledger bằng kênh độc lập; reviewer duyệt non-safety cases/corpus và đóng labels; pin reviewed clean code/prompt/corpus/cases; xác nhận direct target/region/CountTokens support và positive pricing/version; người dùng duyệt riêng maximum USD/calls và config hash. Runner LIVE vẫn cần một thay đổi executable được review/ủy quyền riêng, không tự unlock vì thấy approval JSON.

Claude Code cần kiểm tra đặc biệt: one-time claim và missing-ledger behavior; stale-lock/manual recovery; hash-chain/raw-before-reconcile ordering; key bootstrap/ACL assumptions; all-pin drift và code-hash scope; conservative profile rejection; no-gold provider boundary; resume denominator và failure artifacts. Chưa có production authorization từ kết quả fixture.
