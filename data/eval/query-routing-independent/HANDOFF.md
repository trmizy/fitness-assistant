# Hướng dẫn bàn giao cho người thực hiện (không cần đọc mã nguồn)

Mục tiêu: có được dữ liệu câu hỏi **do người thật viết** và **do người thật gán nhãn độc lập** để kiểm tra bộ định tuyến an toàn / Programming của Gymini. Đây mới là **PILOT 30–50 câu**; chưa phải bộ đánh giá cuối.

## Vai trò

| Vai trò | Số người | Việc |
|---|---|---|
| Người viết (nhóm A) | ≥ 1, khuyến nghị 2 | viết câu tự nhiên từ `pilot_scenario_cards.csv` |
| Người gán nhãn (nhóm B) | **2, độc lập** | gán nhãn mù theo `ANNOTATION_GUIDELINES_V1.md` |
| Người phân xử | 1 (khuyến nghị bên thứ ba) | giải quyết bất đồng; nếu không có, chủ chính sách sản phẩm — ghi rõ giới hạn |

Một người **không** được gán nhãn các câu do chính mình viết. Dùng mã bút danh (A01, A02, J01), không dùng tên/email.

Người viết/gán nhãn **không** được xem: kết quả classifier/bộ luật, các câu held-out cũ, ID lỗi, điểm số. LLM **không** được tính là người viết độc lập hay người gán nhãn.

## Bước 1 — Người viết

1. Mở `pilot_scenario_cards.csv`. Mỗi thẻ là một tình huống; viết đúng 1 câu như bạn sẽ gõ cho trợ lý thể hình (có dấu/không dấu/xen tiếng Anh tuỳ thói quen).
2. Không ghi tên, SĐT, email, ID, chi tiết hồ sơ bệnh án.
3. Tạo `pilot_candidates.csv` với cột `id,familyId,text` (`id`: `PIL-001`…; `familyId`: tên mô tả tình huống, ví dụ `PERSONAL_POST_PROCEDURE_RETURN`, không đặt theo số câu). Đặt tệp **ngoài Git** nếu có thể.

## Bước 2 — Curator kiểm tra chất lượng và xuất file mù

```
cd backend/services/ai-service
npx tsx src/scripts/routingAnnotationTool.ts audit --in=pilot_candidates.csv --refs-dir=../../../data/eval/retrieval
npx tsx src/scripts/routingAnnotationTool.ts export-blind --in=pilot_candidates.csv --out=pilot_batch.csv
```

`audit` báo PII, trùng/gần trùng và rò rỉ so với các tập V1–V5; sửa rồi chạy lại. File mù chỉ có `id,text`.

## Bước 3 — Hai người gán nhãn (độc lập, không trao đổi)

```
npx tsx src/scripts/routingAnnotationTool.ts annotate --in=pilot_batch.csv --annotator=A01 --out=pilot_A01.csv
npx tsx src/scripts/routingAnnotationTool.ts annotate --in=pilot_batch.csv --annotator=A02 --out=pilot_A02.csv
```

Có thể ngắt và chạy lại (tiếp tục từ chỗ dừng). Đánh dấu `uncertain` khi không chắc.

## Bước 4 — Độ đồng thuận và phân xử

```
npx tsx src/scripts/routingAnnotationTool.ts agreement --a=pilot_A01.csv --b=pilot_A02.csv --column=safetyLabel
npx tsx src/scripts/routingAnnotationTool.ts agreement --a=pilot_A01.csv --b=pilot_A02.csv --column=programmingLabel
```

Đọc **từng** bất đồng và phân loại: `GUIDELINE_AMBIGUITY`, `GENUINE_QUERY_AMBIGUITY`, `ANNOTATOR_ERROR`, `DOMAIN_OVERLAP`, `SAFETY_POLICY_UNCLEAR`, `OTHER` (mẫu `adjudication_template.csv`). Không có ngưỡng kappa "đạt/không đạt" — pilot dùng để gỡ lỗi chính sách. Nếu lộ vấn đề chính sách thật → tạo `ANNOTATION_GUIDELINES_V1_1_DRAFT` (không sửa V1 âm thầm).

## Dữ liệu pilot

Là **dữ liệu phát triển** (`ANNOTATION_DEVELOPMENT`); không bao giờ vào tập đánh giá độc lập cuối.
