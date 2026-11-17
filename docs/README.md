# Tài liệu Gymini — mục lục

Mọi tài liệu `.md` của dự án nằm trong thư mục này (ngoại lệ: các `README.md` cạnh mã và vài file
mà script/test đọc theo đường dẫn — xem bảng cuối). **Mã nguồn luôn có thẩm quyền cao hơn tài liệu.**

## Bắt đầu từ đâu

| Bạn cần | Đọc |
| --- | --- |
| Tổng quan dự án, cách chạy local | [`../README.md`](../README.md) |
| Luật nghiệp vụ: vai trò, hợp đồng PT, lịch, check-in, dòng tiền/ví/escrow, khiếu nại V2.1, đình chỉ PT, đối tác gym, tin đăng | [`HANDBOOK.md` §2](HANDBOOK.md#2-luật-nghiệp-vụ) |
| Mô hình nào sở hữu dữ liệu nào (source of truth) | [`HANDBOOK.md` §2.2](HANDBOOK.md#22-mô-hình-nào-sở-hữu-dữ-liệu-nào) |
| Kiến trúc, cổng, DB, AI, realtime, mobile, chạy dev, kiểm thử, seed, AWS | [`HANDBOOK.md` §3](HANDBOOK.md#3-kiến-trúc--vận-hành) |
| Bẫy thường gặp khi chạy dev | [`HANDBOOK.md` §3.8](HANDBOOK.md#38-bẫy-thường-gặp-khi-chạy-dev) |
| Lỗi/việc còn mở, việc của partner (ai-service, fitness-service), quyết định đang chờ | [`HANDBOOK.md` §4](HANDBOOK.md#4-việc-còn-mở-cập-nhật-17112026) |

Tra nhanh: tìm theo mã lỗi/nhãn (`N13G-01`, `GAP-14`, `CLIENT_PT_LIMIT_REACHED`…) hoặc tên file mã trong `HANDBOOK.md`.

## Cấu trúc thư mục

```text
docs/
├─ README.md                     mục lục (file này)
├─ HANDBOOK.md                   sổ tay chính: luật nghiệp vụ, kiến trúc & vận hành, việc còn mở
├─ deployment/                   triển khai AWS dev
│  ├─ AWS_DEPLOYMENT_RUNBOOK.md            runbook triển khai từng service
│  ├─ AWS_DEV_DAILY_START_STOP_RUNBOOK.md  bật/tắt môi trường dev theo ngày (scripts/aws/dev-start|dev-stop.ps1)
│  ├─ terraform-requirements-v2.md         yêu cầu hạ tầng Terraform
│  └─ generated/                           JSON sinh cho IaC API Gateway (CI đọc — không sửa tay)
├─ ai-training/                  huấn luyện mô hình
│  ├─ RUNPOD_RUNBOOK.md                    chạy QLoRA trên RunPod (lịch sử/tuỳ chọn)
│  └─ qwen4b-v2-3a3-…-audit.md             nguồn quyết định cho training/semantic-qwen3-4b
├─ research/                     nghiên cứu khoa học
│  ├─ fitness-nutrition-evidence.md        sổ nguồn khoa học tập luyện/dinh dưỡng (mã trích dẫn)
│  ├─ fitness-data-source-and-license-review.md  nguồn dữ liệu + giấy phép
│  ├─ workout-plan-bpm/                    nghiên cứu BPM sinh giáo án (test/research/workout-plan-bpm đọc trực tiếp — giữ nguyên tên)
│  └─ nckh-pt-matching/                    NCKH ghép nối PT (báo cáo, mã thực nghiệm, kết quả, hình)
└─ legal/
   └─ web-ATTRIBUTIONS.md                  ghi công thư viện/tài nguyên của web
```

## Tài liệu buộc nằm cạnh mã (không di chuyển)

Script hoặc test đọc/ghi các file này theo đường dẫn, nên chúng ở lại chỗ cũ:

| File | Ai dùng |
| --- | --- |
| `backend/services/ai-service/DATASETS.md` | Provider dataset của ai-service tham chiếu |
| `data/eval/query-routing-independent/*.md`, `data/eval/model/*.md` | Test ai-service và `scripts/run-ai-gym-100-review.mjs` đọc/ghi |
| `scripts/seed-marketplace/SEED.md`, `scripts/seed-marketplace/assets/ATTRIBUTION.md` | Seed marketplace, Maestro; `generate-assets.mjs` sinh ATTRIBUTION |
| `tools/db-migrator/reports/*.md` | Script của db-migrator ghi ra |
| `results/**`, `test/conversational-intelligence/results/*.md` | Kết quả chạy thực nghiệm/test |
| `README.md` các thành phần (`docker/test`, `scripts/*`, `tools/db-migrator`, `training`, `infra/terraform`, `data/*`, test setup của service) | Hướng dẫn thành phần |

## Quy ước

- Thêm tài liệu mới vào `docs/` (hook pre-commit chặn `.md` ở nơi khác, trừ `README.md`).
- Cập nhật `HANDBOOK.md` thay vì viết báo cáo riêng cho mỗi phiên; việc đã sửa và xác minh thì xoá khỏi §4.
- Ghi chú chỉ dùng local đặt tên `*.local.md` (bị `.gitignore`). Repo công khai: không ghi secret, credential,
  chi tiết lỗ hổng chưa vá.
- Quy tắc làm việc cho agent: `CLAUDE.md` / `AGENTS.md` ở gốc repo trên máy dự án (không đẩy lên Git).
