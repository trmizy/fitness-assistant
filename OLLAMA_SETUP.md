# 🦙 Hướng dẫn Setup Ollama cho Fitness Assistant

## 📥 Bước 1: Cài đặt Ollama

### Windows:
1. Tải Ollama installer: https://ollama.com/download/windows
2. Chạy file `.exe` và làm theo hướng dẫn
3. Sau khi cài xong, Ollama sẽ tự động chạy

## 🤖 Bước 2: Tải Model

Mở **PowerShell** hoặc **Command Prompt** và chạy:

```bash
# Model nhẹ, nhanh (khuyên dùng) - ~2GB RAM
ollama pull llama3.2:3b

# Model mạnh hơn nếu có RAM đủ - ~5GB RAM
ollama pull llama3.1:8b
```

## ✅ Bước 3: Kiểm tra

```bash
# Xem danh sách models đã tải
ollama list

# Test model
ollama run llama3.2:3b "Hello, how are you?"
```

## 🚀 Bước 4: Chạy hệ thống

Ollama đã tự động chạy ở background sau khi cài. Giờ chỉ cần:

```bash
# Mở frontend
http://localhost
```

Vào trang **Assistant** và hỏi câu hỏi về fitness!

## 🔧 Troubleshooting

### Lỗi: "Connection refused" hoặc "Ollama error"

**Giải pháp**: Đảm bảo Ollama đang chạy:

```bash
# Kiểm tra Ollama service
curl http://localhost:11434/api/tags

# Nếu không chạy, start lại:
# Windows: Tìm "Ollama" trong Start Menu và click
```

### Lỗi: Model không tìm thấy

```bash
# Xem models đã tải
ollama list

# Nếu chưa có llama3.2:3b, tải về:
ollama pull llama3.2:3b
```

### Lỗi: "Out of memory"

Model quá lớn cho RAM của bạn. Dùng model nhẹ hơn:

```bash
# Model siêu nhẹ - chỉ cần ~1GB RAM
ollama pull llama3.2:1b
```

Sau đó sửa file `fitness_assistant/rag.py`, dòng 66:
```python
model = "llama3.2:1b"  # Thay vì 3b
```

## 📊 So sánh Models

| Model | Size | RAM cần | Tốc độ | Chất lượng |
|-------|------|---------|--------|------------|
| llama3.2:1b | 1.3GB | ~2GB | ⚡⚡⚡⚡⚡ | ⭐⭐⭐ |
| llama3.2:3b | 2.0GB | ~4GB | ⚡⚡⚡⚡ | ⭐⭐⭐⭐ |
| llama3.1:8b | 4.7GB | ~8GB | ⚡⚡⚡ | ⭐⭐⭐⭐⭐ |

**Khuyên dùng**: `llama3.2:3b` - cân bằng tốt giữa tốc độ và chất lượng!

## 🎉 Lợi ích của Ollama

✅ **100% FREE** - không giới hạn requests  
✅ **Chạy offline** - không cần internet  
✅ **Riêng tư** - dữ liệu không gửi ra ngoài  
✅ **Nhanh** - không có network latency  
✅ **Ổn định** - không bị rate limit  

## 🔗 Links hữu ích

- Ollama Website: https://ollama.com
- Model Library: https://ollama.com/library
- Documentation: https://github.com/ollama/ollama

---

**Note**: Nếu gặp vấn đề, hãy kiểm tra:
1. Ollama đang chạy: `ollama list`
2. Model đã tải: `ollama list`
3. Port 11434 không bị chặn bởi firewall
