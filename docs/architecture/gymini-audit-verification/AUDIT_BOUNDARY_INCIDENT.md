# Sự cố giới hạn audit

Script fingerprint ban đầu đọc bytes tất cả file tracked/untracked để tính SHA-256. Trong đó có 13 đường dẫn tên heldout, gồm training/semantic-qwen3-4b/datasets/processed/v0, v1, v2/heldout.jsonl. Các lượt đối chiếu ban đầu cũng rehash danh sách này. Đây là lỗi phạm vi thao tác, vượt yêu cầu không mở heldout; không được gọi heldout untouched.

Không hiển thị, trích nội dung, phân tích câu hỏi/đáp án, train, evaluate hoặc sửa các file này. Bằng chứng nghiệp vụ không dựa trên heldout. Việc đọc bytes để hash vẫn là đọc file và đã được thông báo cho người dùng.

Khắc phục: các script report được sửa để loại heldout/sealed và toàn bộ training/, data/eval/ khỏi integrity reads tiếp theo. Hash lịch sử giữ trong baseline làm provenance của sự cố; không mở lại nội dung để xác minh. source/config/original-audit checks vẫn thực hiện trên tập được phép.
