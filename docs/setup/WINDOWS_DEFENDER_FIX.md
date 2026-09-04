# Windows Defender - Cach khac phuc block app

## Van de

Windows Defender co the block app khi chay nhieu Node processes va Docker containers.

## Giai phap (chon 1 trong 3)

### Option 1: Them exclusion cho folder

1. Mo **Windows Security** -> **Virus & threat protection**.
2. Click **Manage settings** trong **Virus & threat protection settings**.
3. Keo xuong **Exclusions** -> click **Add or remove exclusions**.
4. Click **Add an exclusion** -> **Folder**.
5. Chon folder project local cua ban, vi du `<repo-root>`.

### Option 2: Them exclusion cho Node.exe

1. Tim duong dan Node: `where.exe node` trong PowerShell.
2. Them exclusion cho file Node ma lenh tren tra ve.

### Option 3: Them exclusion cho Docker

1. Them exclusion cho Docker Desktop.
2. Dung duong dan Docker Desktop tren may local cua ban.

## Luu y bao mat

- Chi them exclusion cho folder project cua ban.
- Khong tat Windows Defender hoan toan.
- Scan folder dinh ky de dam bao khong co malware.

## Sau khi them exclusion

```powershell
# Restart Docker
docker-compose down
docker-compose up -d

# Restart services
.\START_ALL.ps1
```

## Neu van bi block

Check Event Viewer de xem file cu the nao bi block:

- Mo **Event Viewer**.
- Vao **Windows Logs** -> **System**.
- Tim warning tu "Windows Defender".
