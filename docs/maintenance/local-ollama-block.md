# Local Ollama block — owner request 2026-11-02

Owner yêu cầu tắt hoàn toàn Ollama local và giữ block cho đến khi owner yêu cầu bật lại. Không tự khôi phục Ollama để sửa healthcheck, chạy test, fallback hay ingestion.

Trạng thái và recovery map: `.dev/local-ollama-block.json` trong checkout chính. File ghi đường dẫn launcher/shortcut Windows đã đổi đuôi `.gymini-blocked`, không xóa model. Docker Ollama đã dừng và runtime restart policy là `no`. Hai service `ollama` và `ollama-model-puller` trong dev Compose bị đặt `scale: 0`, kể cả khi chọn profile local-ollama. Không sửa production Compose, DB, Qdrant hoặc cấu hình Bedrock.

Kiểm tra: `powershell -ExecutionPolicy Bypass -File scripts/dev/local-ollama-control.ps1 -Action Status`.

Chỉ sau yêu cầu mở lại của owner: chạy cùng script với `-Action Unblock`. Lệnh này khôi phục các launcher/shortcut, gỡ đúng marker scale-zero và phục hồi restart policy đã biết; không tự khởi động dịch vụ hoặc ingestion. Có thể bật Ollama riêng theo yêu cầu tiếp theo.

Đây là block vận hành cho bản cài Windows hiện tại và dev Compose của dự án, không phải chính sách bảo mật toàn máy: một người có quyền Docker vẫn có thể cố ý ghi đè scale, start container thủ công hoặc tạo container mới. Không tự làm các thao tác đó khi block đang bật. Cài lại/update Ollama có thể tạo executable mới; cần kiểm tra lại block khi owner làm việc đó.

Các dịch vụ local còn cấu hình provider Ollama sẽ không gọi model/embedding thành công khi block đang bật. Không tự chuyển chúng sang Bedrock vì điều đó có thể phát sinh chi phí hoặc ghi index khác.
