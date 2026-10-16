# Phase 4.7R6A.2 — single human annotator A01 intake

Tiếp nối R6A.1. Phạm vi tạm thời: **A01 đã có, A02 cố ý hoãn**. Task này chỉ xác thực, nhập và đóng băng artifact của A01; **không** tính agreement/kappa, không adjudicate, không train, không tạo Heldout V6, không đổi RAG/guideline.

Nhãn bằng chứng: `CODE AUDIT` (xác thực cấu trúc/provenance) · `TEST FIXTURE` (test dùng dữ liệu DUMMY).

## 0. Kết quả

| Hạng mục | Kết quả |
|---|---|
| A01 verdict | **`A01_HUMAN_INTAKE_PASS`** |
| Trạng thái dự án | **`A01_HUMAN_VALIDATED_AWAITING_A02`** (authority `SINGLE_HUMAN_ANNOTATOR_VALIDATED`) |
| Agreement / kappa / bảng bất đồng | `NOT_AVAILABLE` |
| Adjudication | `NOT_RUN` |
| R6B | `R6B_NOT_READY` |
| Bước tiếp | `OBTAIN_INDEPENDENT_HUMAN_A02` |

Một annotator **không** phải bằng chứng liên-annotator. Authority của cả dự án **không** được nâng lên "corpus độc lập hoàn chỉnh" cho đến khi có A02.

## 1. Nguồn và đích

Tìm thấy ở `docs/ai-product/` (chưa theo dõi bởi git): `pilot_A01_fixed.csv`, `pilot_A01.provenance.json`, `attestation.md` (tên tệp attestation là `attestation.md`, không phải `attestation_A01.md`). Sao chép (bản gốc giữ nguyên) vào `data/eval/query-routing-independent/pilot/human/` với tên chuẩn:

| Đích | SHA256 |
|---|---|
| `pilot_A01.csv` | `2dfe21535850ed16f9a1e26a9a6ed9413986c49f7b815e43670182f9bbe0b45d` |
| `pilot_A01.provenance.json` | `398e0aedad0fe15bde782c2beba5522b2bcfb0a041409230846270f5be056a1c` |
| `attestation_A01.md` | `b80fad0c16cf8dc2774ff82cfa6d623b0f5ae69e6defdeff001c9fe6141d064d` |

Băm bản sao trùng băm nguồn (byte-identical). Không dùng: `docs/ai-product/pilot_A01.csv` (bản thô trước chuẩn hóa), các file `*_SIMULATED*`, `pilot_candidates.csv`. Trước đó không có A01 người nào ở đích (không có xung đột).

## 2. Xác thực

| Kiểm tra | Kết quả |
|---|---|
| Guideline V1 hash = freeze record | PASS (`c4d4c5f5…49b3`) |
| Batch canonical hash | `da3a4789…078c`, khớp provenance |
| Số dòng / id duy nhất / annotator | 149 / 149 / chỉ `A01` |
| Batch integrity (id + text đúng từng ký tự) | PASS |
| Provenance (human, independent, không LLM chọn nhãn, không thấy nhãn/gold/classifier) | PASS |
| Attestation (5 mục đều tick, id = A01) | PASS |
| Cột cấm / PII | PASS |
| `safetyLabel`, `programmingLabel` enum | PASS |
| `domain` / `tags` / `uncertain` / `timestamp` | PASS |
| Nhãn chính bị task này sửa? | **KHÔNG** (chỉ đọc; băm không đổi) |

### Công bố chuẩn hóa kỹ thuật
Provenance nêu rõ một trợ lý (ChatGPT/OpenAI) chỉ chuẩn hóa kỹ thuật sau khi gán nhãn: `A1→A01`, `ODD→OOD`, xóa tag không hợp lệ/mâu thuẫn mà không suy diễn thay thế, chuẩn hóa boolean/timestamp, chuyển phân tách `;`→`,`, điền hash — và **nêu rõ không giá trị `safetyLabel`/`programmingLabel` nào bị đổi**. Công cụ chấp nhận ghi chú loại này chỉ khi có câu khẳng định đó (test riêng). Tôi không có cách tự xác minh khẳng định; nó dựa trên khai báo.

### Cảnh báo (ghi nhận, không sửa)
`annotationTimestampRange.start = 2020-10-02…` đứng trước ngày tạo batch/guideline (2026-10-11) — nhiều khả năng là gõ nhầm năm. Giữ nguyên như khai báo; không ảnh hưởng nhãn.

## 3. Đếm mô tả (không phải chất lượng mô hình)

- safetyLabel: NORMAL_FITNESS 111 · GENERAL_INFORMATION_ONLY 26 · SAFE_ABSTAIN 12.
- programmingLabel: PROGRAMMING 72 · NOT_PROGRAMMING 77.

## 4. Công cụ

`src/scripts/routingSingleAudit.ts` (lệnh single-annotator) + `src/llm/query-routing-data/routing-single-intake.ts`. Chạy:

    npx tsx src/scripts/routingSingleAudit.ts --annotator=A01 --annotation=… --provenance=… --attestation=… --batch=… --freeze=… [--manifest=…]

Đầu ra không có agreement / kappa / confusion matrix / disagreement. Lệnh `human-intake` hai người **không đổi** và vẫn fail-closed: với chỉ A01 nó trả `REAL_HUMAN_ANNOTATION_REQUIRED` (thiếu `pilot_A02.csv`, `pilot_A02.provenance.json`) — có test.

Manifest: `pilot/human/pilot_A01.manifest.json` (rowCount, hash, auditStatus, trạng thái dự án, không PII).

## 5. Bất biến sau chấp nhận

Nhãn chính của A01 là bằng chứng thô bất biến. Bất kỳ gold adjudicated nào sau này phải lưu riêng và giữ nguyên nhãn A01 gốc.

## 6. Kiểm thử

`single-human-a01-intake-4-7r6a2.test.ts` — 9 test (DUMMY): A01 hợp lệ qua và không có agreement; provenance giả lập / LLM / thấy nhãn / không độc lập bị từ chối; sai batch hash / guideline hash; text đổi / id trùng / thiếu id / annotator `A1`; enum sai (kể cả `ODD`, uncertain không boolean); attestation thiếu/không tick/sai id + khẳng định chuẩn hóa; trường phụ; **human-intake vẫn fail-closed khi chỉ có A01**; manifest repo thật. Chạy cùng R3/R4/R5/R6/R6A/R6A.1: **90/90**; `tsc --noEmit` sạch. Không claim full-repo regression.

## 7. Trạng thái bất biến

HEAD `187745350ab147003d030d4826c430e84dfe3e59`; classifier training NOT_RUN; `HELDOUT_V6_NOT_CREATED`; `RAG_RETRIEVAL_V2` OFF; envelope inert; `ANNOTATION_GUIDELINES_V1` FROZEN.
