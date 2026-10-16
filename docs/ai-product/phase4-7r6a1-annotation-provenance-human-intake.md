# Phase 4.7R6A.1 — annotation provenance hardening + human pilot intake

Tiếp nối R6A. Không huấn luyện classifier, không đánh giá RAG, không tạo held-out V6, không tích hợp production, không đổi Qdrant.

Nhãn bằng chứng: `CODE AUDIT` · `TEST FIXTURE` (dữ liệu DUMMY). Không có nhãn của người thật.

## 0. Kết quả

| Hạng mục | Verdict |
|---|---|
| Dữ liệu người thật | **`REAL_HUMAN_ANNOTATION_REQUIRED`** |
| R6B | **`R6B_NOT_READY`** |
| Authority hiện có | **`SIMULATED_PIPELINE_SMOKE_ONLY`** |

## 1. Phát hiện

`pilot_A01.csv`, `pilot_A02.csv`, `pilot_batch.csv`, `pilot_candidates.csv`, `pilot_annotations_PROVENANCE.md` nằm ở `docs/ai-training/` (thư mục chưa được theo dõi bởi git; không phải vùng của R6A). Provenance trong chính file đó nêu: do Claude tạo, một mô hình đóng hai vai, và đã biết nhãn ý định của writer (149 câu). Kết luận: **không** phải hai người độc lập. Tên file không tạo ra thẩm quyền; provenance quyết định.

## 2. Cách ly (không xóa, không viết lại lịch sử)

Bản gốc ở `docs/ai-training/` **giữ nguyên** (băm đã ghi trong manifest). Bản sao có phiên bản trong `data/eval/query-routing-independent/pilot/`:

| Tệp | Vai trò |
|---|---|
| `simulated/pilot_A01_SIMULATED.csv`, `simulated/pilot_A02_SIMULATED.csv` | nhãn giả lập |
| `simulated/pilot_annotations_SIMULATED_PROVENANCE.md` | provenance gốc |
| `simulated/manifest.json` | `SIMULATED_PIPELINE_SMOKE_ONLY`, `independentHumanAnnotation:false`, allowed/forbidden uses, SHA256 |
| `pilot_batch.csv` + `pilot_batch.manifest.json` | batch mù (id,text; 149 dòng; canonical batch hash `da3a4789…078c`) |

`pilot_candidates.csv` chứa **nhãn ý định của writer** — không được sao chép vào thư mục này; chỉ ghi đường dẫn + băm + hạn chế "không cho annotator/reviewer xem".

Forbidden uses: classifier gold, bằng chứng agreement độc lập, policy sign-off, R6B sign-off, Heldout V6 readiness, huấn luyện/đánh giá classifier, tinh chỉnh alias/ngưỡng/envelope.

## 3. Chẩn đoán công cụ trên nhãn giả lập — `SIMULATED_TOOLING_DIAGNOSTIC`

Chỉ để chứng minh pipeline chạy; **không** phải inter-annotator agreement của người.

| Trục | n | raw | kappa | bất đồng |
|---|---|---|---|---|
| safetyLabel | 149 | 0,886 | 0,809 | 17 |
| programmingLabel | 149 | 0,946 | 0,885 | 8 |

Không dùng để đổi chính sách, thêm alias, huấn luyện hay chỉnh envelope.

## 4. Phân cấp thẩm quyền nhãn

1. `SIMULATED_LABELS` — hiện tại.
2. `INDEPENDENT_HUMAN_LABELS_ON_SYNTHETIC_UTTERANCES` — mục tiêu gần nhất (người thật gán nhãn các câu tổng hợp hiện có).
3. `HUMAN_WRITTEN_AND_HUMAN_LABELED`.
4. `REAL_USER_DEIDENTIFIED_HUMAN_LABELED`.

Văn bản hiện là `SYNTHETIC_UTTERANCES_WITH_FUTURE_HUMAN_LABELS`; dù người thật gán nhãn thì cũng **không** được gọi là corpus do người viết.

## 5. Intake cho người thật

Thư mục `pilot/human/` (hiện chỉ có README, `provenance_template.json`, `attestation_template.md` — **không** có file nhãn nào được tạo). Mỗi annotator cần `pilot_A0x.csv` + `pilot_A0x.provenance.json`.

Provenance bắt buộc: `annotatorId` (bút danh), `human=true`, `independent=true`, `usedLLMForLabels=false`, `sawOtherAnnotatorLabels=false`, `sawClassifierPredictions=false`, `sawGoldLabels=false`, `annotationGuidelineVersion`+`annotationGuidelineHash`, `batchHash`, `authority` (một thẩm quyền người), timestamp, ghi chú. Từ chối: trường danh tính (name/email/phone/user_id/…), trường lạ, email trong giá trị.

## 6. Cổng `human-intake` (fail closed)

`npx tsx src/scripts/routingAnnotationTool.ts human-intake --dir --batch --freeze [--out]`:

1. Thiếu file/provenance → `REAL_HUMAN_ANNOTATION_REQUIRED` (`INDEPENDENT_HUMAN_PROVENANCE_REQUIRED`), exit 3.
2. Băm file guideline ≠ freeze record, hoặc provenance dẫn guideline khác → `ANNOTATION_GUIDELINE_VERSION_MISMATCH`.
3. Provenance giả lập / có LLM / không độc lập / thấy nhãn → `INDEPENDENT_HUMAN_PROVENANCE_REQUIRED`.
4. batch hash khác, thiếu/thừa/trùng id, đổi text → `ANNOTATION_BATCH_MISMATCH`; thứ tự khác được join theo id.
5. Audit mỗi file: schema, PII/cột cấm, id duy nhất, enum, `annotator` đúng A01/A02, đủ batch.
6. Chỉ khi qua hết: agreement **riêng** cho `safetyLabel` và `programmingLabel` (raw, kappa, confusion matrix hàng=A01 cột=A02, bảng bất đồng có uncertain + comment của cả hai; không chứa nhãn ý định); xuất `safety_disagreements.csv`, `programming_disagreements.csv`. Adjudication `NOT_RUN (manual)`.

Lệnh `agreement` cũ vẫn dùng được nhưng luôn in `authority: SIMULATED_TOOLING_DIAGNOSTIC`.

Quy tắc riêng: bất đồng ở vùng "tiền sử xa đã giải quyết" mà cả hai cách hiểu đều hợp lý → ứng viên `SAFETY_POLICY_UNCLEAR`, trả product owner; không majority vote; không sửa V1 (nếu cần → `V1_1_DRAFT`).

## 7. Kiểm thử

`annotation-provenance-4-7r6a1.test.ts` — 12 test, toàn bộ fixture DUMMY: provenance hợp lệ A01/A02, các loại bị từ chối, sai hash guideline/batch, trường danh tính, thứ tự khác/thiếu/thừa/trùng/đổi text, audit, confusion matrix + trường bất đồng + hai trục tách rời, manifest cách ly (băm khớp, không có file người giả mạo), intake CLI end-to-end, nhãn `SIMULATED_TOOLING_DIAGNOSTIC`. Cùng R3/R4/R5/R6/R6A: **81/81**. `tsc --noEmit` sạch. Không claim full-repo regression.

## 8. Trạng thái bất biến

HEAD `187745350ab147003d030d4826c430e84dfe3e59`; Qdrant 187 / 7072 / 5946 / 207; `RAG_RETRIEVAL_V2` OFF; classifier training / RAG evaluation NOT_RUN; `HELDOUT_V6_NOT_CREATED`; envelope inert; Programming hybrid HYPOTHESIS_ONLY; `ANNOTATION_GUIDELINES_V1` FROZEN.

## 9. Bước thủ công tiếp theo

Hai người thật gán nhãn độc lập `pilot/pilot_batch.csv`, mỗi người điền provenance + attestation, đặt file vào `pilot/human/`, rồi chạy `human-intake`. Chỉ khi đó R6B (review bất đồng) mới bắt đầu.

## Addendum — Phase 4.7R6A.2 (2026-10-12)

Một annotator người thật (A01) đã được xác thực và nhập vào `pilot/human/` (`A01_HUMAN_INTAKE_PASS`, `SINGLE_HUMAN_ANNOTATOR_VALIDATED`). A02 vẫn chưa có: `human-intake` hai người giữ nguyên fail-closed (`REAL_HUMAN_ANNOTATION_REQUIRED`), `R6B_NOT_READY`, không có agreement. Chi tiết: `phase4-7r6a2-single-human-a01-intake.md`. Lưu ý: bản mô tả "thư mục human trống" ở trên là trạng thái tại thời điểm R6A.1.
