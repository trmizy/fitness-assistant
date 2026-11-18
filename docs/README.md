# Tài liệu Gymini — mục lục

Mọi tài liệu `.md` của dự án nằm trong thư mục này (ngoại lệ: các `README.md` cạnh mã và vài file
mà script/test đọc theo đường dẫn — xem bảng cuối). **Mã nguồn luôn có thẩm quyền cao hơn tài liệu.**

## Agent / người mới nên đọc gì trước

| Việc sắp làm | Đọc trước | Rồi đọc |
| --- | --- | --- |
| Bất kỳ việc nào | `../README.md` (chạy local), `CLAUDE.md` / `AGENTS.md` ở gốc repo trên máy dự án (không đẩy lên Git) | [`HANDBOOK.md` §1](HANDBOOK.md#1-cách-dùng-sổ-tay) |
| Luật nghiệp vụ: vai trò, hợp đồng PT, lịch, check-in | [`HANDBOOK.md` §2.1–2.5](HANDBOOK.md#2-luật-nghiệp-vụ) | mã `backend/services/user-service`, `gym-service` |
| Tiền: ví, escrow, phí, hoàn tiền, rút tiền, khiếu nại | [`HANDBOOK.md` §2.6–2.7](HANDBOOK.md#2-luật-nghiệp-vụ) | `backend/services/payment-service/src/services/reconcile.service.ts` |
| Mô hình nào sở hữu dữ liệu nào (source of truth) | [`HANDBOOK.md` §2.2](HANDBOOK.md#22-mô-hình-nào-sở-hữu-dữ-liệu-nào) | |
| Đối tác gym, tin đăng, kiểm duyệt | [`HANDBOOK.md` §2.9–2.10](HANDBOOK.md#2-luật-nghiệp-vụ) | |
| AI coach, RAG, agent | [`HANDBOOK.md` §3.3](HANDBOOK.md#3-kiến-trúc--vận-hành) | `ai-training/`, `backend/services/ai-service/DATASETS.md` |
| Tập luyện, dinh dưỡng, roadmap | [`HANDBOOK.md` §3.5](HANDBOOK.md#3-kiến-trúc--vận-hành) | |
| Mobile (Expo) | [`HANDBOOK.md` §3.6](HANDBOOK.md#3-kiến-trúc--vận-hành) | `frontend/mobile/` |
| Chạy local, bẫy dev, kiểm thử, seed | [`HANDBOOK.md` §3.7–3.10](HANDBOOK.md#3-kiến-trúc--vận-hành) | |
| Triển khai / vận hành AWS dev | `deployment/AWS_DEPLOYMENT_RUNBOOK.md`, `deployment/AWS_DEV_DAILY_START_STOP_RUNBOOK.md` | `HANDBOOK.md` §3.11–3.12, `deployment/AWS_DEV_THAY_DOI_17-18-11-2026.md` |
| Lỗi/việc còn mở, quyết định đang chờ | [`HANDBOOK.md` §4](HANDBOOK.md#4-việc-còn-mở-cập-nhật-17112026) | |
| Nghiên cứu khoa học, nguồn dữ liệu, giấy phép | `research/`, `legal/` | |
| Tìm báo cáo của một đợt đã đóng | mục "Đã lưu trữ" cuối trang | |

Tra nhanh: tìm theo mã lỗi/nhãn (`N13G-01`, `GAP-14`, `CLIENT_PT_LIMIT_REACHED`…) hoặc tên file mã trong `HANDBOOK.md`.

## Cấu trúc thư mục

```text
docs/
├─ README.md                     mục lục (file này)
├─ HANDBOOK.md                   sổ tay chính: luật nghiệp vụ, kiến trúc & vận hành, việc còn mở
├─ deployment/                   triển khai AWS dev
│  ├─ AWS_DEPLOYMENT_RUNBOOK.md            runbook triển khai từng service
│  ├─ AWS_DEV_DAILY_START_STOP_RUNBOOK.md  bật/tắt môi trường dev theo ngày (scripts/aws/dev-start|dev-stop.ps1)
│  ├─ AWS_DEV_THAY_DOI_17-18-11-2026.md    lịch sử thay đổi + cấu hình đặt tay đợt 17–18/11
│  ├─ terraform-requirements-v2.md         yêu cầu hạ tầng Terraform
│  ├─ AWS_DEV_*_2026-10-0*.md              vài ghi chú vận hành đầu 10/2026 mà JSON bằng chứng còn trỏ tới (giữ nguyên)
│  └─ generated/                           JSON sinh cho IaC API Gateway (CI đọc — không sửa tay)
├─ ai-training/                  huấn luyện mô hình (RUNPOD_RUNBOOK, các audit mà training/*.json trỏ tới)
├─ research/                     nghiên cứu khoa học (workout-plan-bpm — test đọc trực tiếp; nckh-pt-matching; nguồn dữ liệu)
├─ legal/                        ghi công thư viện/tài nguyên của web
└─ *.md ở gốc docs/, ai-product/, production-readiness/, setup/, audit/…
                                 tài liệu thiết kế/kế hoạch/đánh giá còn giữ (xem ghi chú dưới)
```

Các file thiết kế/kế hoạch/đánh giá còn nằm phẳng ở `docs/*.md` (và `ai-product/`, `production-readiness/`…) là phần **chưa đủ bằng chứng để lưu trữ** khi dọn ngày 18/11/2026.
Ưu tiên đọc `HANDBOOK.md` trước; coi các file này là tham khảo (mã luôn đúng hơn tài liệu).

## Tài liệu buộc nằm cạnh mã (không di chuyển)

Script hoặc test đọc/ghi các file này theo đường dẫn, nên chúng ở lại chỗ cũ:

| File | Ai dùng |
| --- | --- |
| `docs/deployment/generated/*.json` | `pr-validation.yml`, `ci/service-impact-map.json`, `scripts/aws/api-gateway/*` |
| `backend/services/ai-service/DATASETS.md` | Provider dataset của ai-service tham chiếu |
| `data/eval/query-routing-independent/*.md`, `data/eval/model/*.md` | Test ai-service và `scripts/run-ai-gym-100-review.mjs` đọc/ghi |
| `scripts/seed-marketplace/SEED.md`, `scripts/seed-marketplace/assets/ATTRIBUTION.md` | Seed marketplace, Maestro; `generate-assets.mjs` sinh ATTRIBUTION |
| `tools/db-migrator/reports/*.md`, `reports/data/existing-catalog-audit.md` | Script/test ghi hoặc đọc |
| `results/**`, `test/conversational-intelligence/results/*.md` | Kết quả chạy thực nghiệm/test |
| `README.md` các thành phần (`docker/test`, `scripts/*`, `tools/db-migrator`, `training`, `infra/terraform`, `data/*`, test setup của service) | Hướng dẫn thành phần |

## Quy ước

- Thêm tài liệu mới vào `docs/` (hook pre-commit chặn `.md` ở nơi khác, trừ `README.md`).
- Cập nhật `HANDBOOK.md` thay vì viết báo cáo riêng cho mỗi phiên; việc đã sửa và xác minh thì xoá khỏi §4.
- Ghi chú chỉ dùng local đặt tên `*.local.md` (bị `.gitignore`). Repo công khai: không ghi secret, credential,
  chi tiết lỗ hổng chưa vá, dữ liệu người dùng thật.
- Nhãn bằng chứng đúng loại: `REAL BROWSER` · `REAL HTTP/API` · `BACKEND INTEGRATION` · `TEST FIXTURE` · `CODE AUDIT`.
- Quy tắc làm việc cho agent: `CLAUDE.md` / `AGENTS.md` ở gốc repo trên máy dự án (không đẩy lên Git).

## Đã lưu trữ

Ngày 18/11/2026 khoảng 295 file `.md` đã được đóng gói **ngoài repo** trên máy chủ dự án: báo cáo IMPLEMENTATION / VERIFICATION / E2E / audit của các đợt đã đóng
(báo cáo AWS dev theo ngày, roadmap/PT/AI coach, `docs/features/`…), 5 bản ` - Copy.md`, và các file `GYM_*.md`, `MOBILE_*.md`, `PERFORMANCE_BASELINE.md` ở thư mục gốc cũ
(sau khi gộp phần luật còn hiệu lực vào `HANDBOOK.md`). Gói: `C:\D_Backup\md-cleanup-20261118\md-archive-20261118.zip`
(kèm `md-archive-20261118.manifest.csv` có SHA256 từng file và `.zip.sha256`). Hỏi chủ dự án để lấy lại.
Mã nguồn còn vài chú thích trỏ tới tên các file cũ; nội dung còn hiệu lực của chúng nằm trong `HANDBOOK.md`.
