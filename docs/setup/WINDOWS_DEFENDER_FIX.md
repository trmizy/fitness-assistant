# Windows Defender - Cách khắc phục Block App

## Vấn đề
Windows Defender block app khi chạy nhiều Node processes và Docker containers.

## Giải pháp (CHỌN 1 TRONG 3)

### Option 1: Thêm Exclusion cho Folder (KHUYẾN NGHỊ)
1. Mở **Windows Security** → **Virus & threat protection**
2. Click **Manage settings** (dưới Virus & threat protection settings)
3. Scroll xuống **Exclusions** → Click **Add or remove exclusions**
4. Click **Add an exclusion** → **Folder**
5. Chọn folder: `D:\dự án tương lai cần đạt được\fitness-assistant`

### Option 2: Thêm Exclusion cho Node.exe
1. Tìm đường dẫn Node: `where.exe node` (trong PowerShell)
2. Thêm exclusion cho file: `C:\Program Files\nodejs\node.exe`

### Option 3: Thêm Exclusion cho Docker
1. Thêm exclusion cho Docker Desktop
2. Path thường là: `C:\Program Files\Docker`

## Lưu ý bảo mật
- Chỉ thêm exclusion cho folder dự án của bạn
- KHÔNG tắt Windows Defender hoàn toàn
- Scan folder định kỳ để đảm bảo không có malware

## Sau khi thêm exclusion
```powershell
# Restart Docker
docker-compose down
docker-compose up -d

# Restart services
.\START_ALL.ps1
```

## Nếu vẫn bị block
Check Event Viewer để xem file cụ thể nào bị block:
- Mở **Event Viewer**
- **Windows Logs** → **System**
- Tìm warning từ "Windows Defender"
