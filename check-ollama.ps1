Write-Host "==================================" -ForegroundColor Cyan
Write-Host "  Kiểm tra Ollama Setup" -ForegroundColor Green
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

# Check if Ollama is installed
Write-Host "[1/4] Checking if Ollama is installed..." -ForegroundColor Yellow
$ollamaExists = Get-Command ollama -ErrorAction SilentlyContinue
if ($ollamaExists) {
    Write-Host "  ✅ Ollama đã được cài đặt!" -ForegroundColor Green
} else {
    Write-Host "  ❌ Ollama chưa được cài đặt!" -ForegroundColor Red
    Write-Host "  📥 Tải tại: https://ollama.com/download/windows" -ForegroundColor Cyan
    exit
}

# Check if Ollama is running
Write-Host ""
Write-Host "[2/4] Checking if Ollama service is running..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -Method Get -ErrorAction Stop
    Write-Host "  ✅ Ollama service đang chạy!" -ForegroundColor Green
} catch {
    Write-Host "  ❌ Ollama service KHÔNG chạy!" -ForegroundColor Red
    Write-Host "  💡 Mở Ollama app từ Start Menu để khởi động" -ForegroundColor Yellow
    exit
}

# List available models
Write-Host ""
Write-Host "[3/4] Checking available models..." -ForegroundColor Yellow
$models = ollama list 2>$null
if ($models) {
    Write-Host $models -ForegroundColor Cyan
    
    # Check for recommended model
    if ($models -match "llama3.2:3b") {
        Write-Host "  ✅ Model llama3.2:3b đã có sẵn!" -ForegroundColor Green
    } elseif ($models -match "llama3.2") {
        Write-Host "  ⚠️  Có llama3.2 nhưng không phải 3b version" -ForegroundColor Yellow
        Write-Host "  💡 Tải model khuyên dùng: ollama pull llama3.2:3b" -ForegroundColor Cyan
    } else {
        Write-Host "  ❌ Chưa có model nào!" -ForegroundColor Red
        Write-Host "  📥 Tải model: ollama pull llama3.2:3b" -ForegroundColor Yellow
        Write-Host ""
        $confirm = Read-Host "Bạn có muốn tải model llama3.2:3b ngay không? (y/n)"
        if ($confirm -eq 'y') {
            Write-Host "  ⏳ Đang tải model (có thể mất vài phút)..." -ForegroundColor Yellow
            ollama pull llama3.2:3b
            Write-Host "  ✅ Đã tải xong!" -ForegroundColor Green
        }
    }
} else {
    Write-Host "  ❌ Không thể lấy danh sách models" -ForegroundColor Red
}

# Test model
Write-Host ""
Write-Host "[4/4] Testing model response..." -ForegroundColor Yellow
try {
    $testPrompt = "Hi, say 'Hello from Ollama!' in one short sentence."
    Write-Host "  ⏳ Gửi test request..." -ForegroundColor Cyan
    
    $body = @{
        model = "llama3.2:3b"
        prompt = $testPrompt
        stream = $false
    } | ConvertTo-Json
    
    $response = Invoke-RestMethod -Uri "http://localhost:11434/api/generate" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 30
    
    if ($response.response) {
        Write-Host "  ✅ Model response:" -ForegroundColor Green
        Write-Host "     $($response.response)" -ForegroundColor White
    } else {
        Write-Host "  ❌ Model không trả về response" -ForegroundColor Red
    }
} catch {
    Write-Host "  ❌ Lỗi khi test model: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  💡 Đảm bảo model đã được tải: ollama pull llama3.2:3b" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "  🎉 Setup hoàn tất!" -ForegroundColor Green
Write-Host "  🚀 Giờ bạn có thể dùng app tại: http://localhost" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""
