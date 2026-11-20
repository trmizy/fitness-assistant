# Bảo trì và phân loại tài liệu

Đợt đầu: 2026-10-27. Phạm vi: Markdown trong `docs/`; không dọn runtime code,
training artifacts, dữ liệu, secrets hoặc file của workstream đang dở.

## Quy tắc

- Tuổi file, ít inbound link hoặc tên có chữ report không đủ để xóa.
- Giữ runbook, scientific/license provenance, design được code/tests tham
  chiếu và lịch sử nghiệm thu; lịch sử không phải chứng nhận runtime hiện tại.
- Có thể bỏ bản copy trùng byte hoặc snapshot là tiền tố nguyên văn của bản
  chính đã bổ sung addendum, sau khi kiểm tra tham chiếu và Git status.
- Không sửa checksum manifest lịch sử để giả lập một baseline mới.
- File modified/untracked trước lượt dọn được bảo vệ. Kiểm tra lại Git status
  ngay trước mutation. Không tự commit.

## Danh mục có thể chạy lại

Chạy từ repository root:

```sh
node scripts/docs/audit-markdown.mjs
```

Đầu ra: [markdown-inventory.json](markdown-inventory.json). Đây là scan metadata,
hash và tham chiếu bằng chuỗi path/basename (kể cả URL-encoded spaces), không
phải đánh giá nội dung của toàn bộ tài liệu hoặc bằng chứng file không dùng.
Manifest checksum lịch sử được thống kê riêng, không coi là runtime dependency.
Script chỉ tạo inventory; không tự xóa, sửa hay chuyển file tài liệu.
Biên nhận hash và quan hệ copy/bản chính: [removed-copies.json](removed-copies.json).

`review_no_reference` chỉ có nghĩa chưa thấy tham chiếu trong tập file đã scan.
`review_copy` là ứng viên so sánh; `referenced` không chứng minh nội dung còn
đúng. `protected_worktree` không được tự dọn trong đợt này. `entrypoint` là
README/STATUS. JSON ghi lại giới hạn scan và số file nguồn đọc được.

## Các quyết định đợt 1

| File bỏ | Bản giữ | Bằng chứng |
| --- | --- | --- |
| `docs/ai-agent-evaluation-report - Copy.md` | [evaluation](../ai-agent-evaluation-report.md) | SHA-256 trùng byte |
| `docs/ai-agent-implementation-report - Copy.md` | [implementation](../ai-agent-implementation-report.md) | SHA-256 trùng byte |
| `docs/ai-product/phase4-7r-rag-generalization-remediation - Copy.md` | [remediation](../ai-product/phase4-7r-rag-generalization-remediation.md) | SHA-256 trùng byte |
| `docs/ai-agent-system-meeting-summary - Copy.md` | [meeting summary](../ai-agent-system-meeting-summary.md) | Toàn bộ nội dung là tiền tố của bản chính; bản chính giữ các addendum mới hơn |
| `docs/ai-product/phase4-7-evidence-grounded-coach - Copy.md` | [Phase 4.7](../ai-product/phase4-7-evidence-grounded-coach.md) | Toàn bộ nội dung là tiền tố của bản chính; bản chính giữ addendum R2–R6 |

Cả 5 file được Git theo dõi và không có thay đổi local trước khi bỏ. Scan
trước thay đổi chỉ thấy tham chiếu tới tên copy trong
`docs/architecture/gymini-audit-verification/baseline-integrity.json` (checksum
lịch sử); file đó được giữ nguyên. Nội dung đầy đủ vẫn ở bản chính và Git.

## Nội dung lỗi thời cần review tiếp, chưa xóa

| Tài liệu | Căn cứ / hướng xử lý |
| --- | --- |
| [AI RAG architecture](../ai-rag-architecture.md) | Runtime overview chỉ nói Ollama/Qdrant, model 1.5B; code có provider/embedding/vector-store abstraction. Đã gắn cảnh báo tại chỗ; cần cập nhật guide theo từng môi trường |
| [AI service operations](../ai-service-operations.md) | Bảng model/embedding cũ không đại diện mọi provider. Đã gắn cảnh báo; chưa chứng nhận lại toàn runbook |
| [STATUS](../STATUS.md) | Nội dung chính là snapshot 2026-09-07; giữ follow-ups và thêm đầu việc mới, không coi số test cũ là kết quả hiện tại |
| [Deep research report](../research/deep-research-report.md) | User-supplied/untracked; giữ nguyên. Nhiều claim là static audit, citation `turn…`/`sandbox:` không tự kiểm tra lại được |

Các báo cáo deployment, training, nghiệm thu và workstream architecture chưa
được review nội dung toàn bộ; inventory không cấp quyền xóa các nhóm này.
