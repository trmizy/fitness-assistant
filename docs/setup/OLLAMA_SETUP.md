# Ollama Setup - Hướng dẫn chạy LLM

AI Service sử dụng **Ollama** để chạy LLM local (không cần API key, miễn phí).

## 📥 Cài đặt Ollama

### Windows
1. Download: https://ollama.com/download/windows
2. Chạy installer `OllamaSetup.exe`
3. Ollama sẽ tự động start như Windows service

### Verify Installation
```powershell
ollama --version
# Output: ollama version is 0.x.x
```

## 🚀 Pull Models

### 1. LLM Model (cho AI Coach)
```powershell
# Llama 3.2 3B (nhẹ, nhanh - RECOMMENDED)
ollama pull llama3.2:3b

# Hoặc các model khác:
ollama pull llama3.2:1b      # Nhẹ hơn (1GB)
ollama pull llama3.1:8b      # Mạnh hơn nhưng cần RAM nhiều (4.7GB)
ollama pull mistral:7b       # Alternative (4.1GB)
```

### 2. Embedding Model (cho RAG/Vector Search)
```powershell
ollama pull nomic-embed-text
```

## ✅ Verify Models Installed
```powershell
ollama list
```

Output:
```
NAME                    ID              SIZE    MODIFIED
llama3.2:3b            a80c4f17acd5    2.0 GB  2 hours ago
nomic-embed-text       0a109f422b47    274 MB  2 hours ago
```

## 🔧 Configuration

AI Service đã config sẵn trong `.env`:
```env
LLM_PROVIDER=ollama
LLM_BASE_URL=http://localhost:11434
LLM_MODEL=llama3.2:3b
EMBEDDING_MODEL=nomic-embed-text
```

### Đổi Model
Chỉnh file `services/ai-service/.env`:
```env
# Dùng model nhẹ hơn
LLM_MODEL=llama3.2:1b

# Hoặc mạnh hơn
LLM_MODEL=llama3.1:8b
```

## 🧪 Test Ollama

### 1. Test LLM
```powershell
ollama run llama3.2:3b
```
```
>>> How do I build muscle?
Focus on progressive overload, compound exercises...
>>> /bye
```

### 2. Test API
```powershell
$body = @{
  model = "llama3.2:3b"
  prompt = "What is progressive overload?"
  stream = $false
} | ConvertTo-Json

Invoke-RestMethod "http://localhost:11434/api/generate" `
  -Method POST `
  -Body $body `
  -ContentType "application/json"
```

### 3. Test Embeddings
```powershell
$body = @{
  model = "nomic-embed-text"
  prompt = "bench press"
} | ConvertTo-Json

Invoke-RestMethod "http://localhost:11434/api/embeddings" `
  -Method POST `
  -Body $body `
  -ContentType "application/json"
```

## 🔄 Ingest Exercise Data vào Qdrant

Sau khi pull models, phải ingest exercise data để RAG hoạt động:

```powershell
cd services\ai-service
pnpm run ingest
```

Output:
```
✓ Connected to Qdrant
✓ Loaded 207 exercises
✓ Generated embeddings for 207 exercises
✓ Ingested into collection 'exercises'
```

## 🎯 Test AI Coach

### Via API
```powershell
$headers = @{
  "Authorization" = "Bearer YOUR_ACCESS_TOKEN"
  "Content-Type" = "application/json"
}

$body = @{
  question = "How do I improve my bench press?"
  userId = "YOUR_USER_ID"
} | ConvertTo-Json

Invoke-RestMethod "http://localhost:3000/ai/ask" `
  -Method POST `
  -Headers $headers `
  -Body $body
```

### Via Web UI
1. Login: http://localhost:5173
2. Click "🤖 AI Coach" menu
3. Ask questions:
   - "How do I build muscle?"
   - "What exercises target chest?"
   - "Create a workout plan for beginners"

## 🐛 Troubleshooting

### Ollama not running
```powershell
# Check service
Get-Service Ollama*

# Start manually
ollama serve
```

### Model not found
```powershell
# List installed models
ollama list

# Pull missing model
ollama pull llama3.2:3b
ollama pull nomic-embed-text
```

### AI Service can't connect
```powershell
# Test Ollama API
curl http://localhost:11434

# Should return: "Ollama is running"

# Check AI service logs
# Look at "Starting AI Service" window for errors
```

### Embeddings not working
```powershell
# Re-ingest data
cd services\ai-service
pnpm run ingest
```

### Out of memory
Use lighter model:
```env
# In services/ai-service/.env
LLM_MODEL=llama3.2:1b  # Only 1.3GB RAM
```

## 📊 Model Comparison

| Model | Size | RAM Needed | Speed | Quality |
|-------|------|------------|-------|---------|
| llama3.2:1b | 1.3GB | 2GB | ⚡⚡⚡ | ⭐⭐ |
| llama3.2:3b | 2.0GB | 4GB | ⚡⚡ | ⭐⭐⭐ |
| llama3.1:8b | 4.7GB | 8GB | ⚡ | ⭐⭐⭐⭐ |
| mistral:7b | 4.1GB | 8GB | ⚡ | ⭐⭐⭐⭐ |

**Recommended**: `llama3.2:3b` - Cân bằng tốt giữa speed và quality

## 🔐 Security Notes

- Ollama chạy local → Không gửi data ra ngoài
- Không cần API key
- Free 100%
- Privacy-first

## 🚀 Advanced

### Custom System Prompt
Edit `services/ai-service/src/main.ts` line ~130:
```typescript
const systemPrompt = `You are an expert gym coach...`;
```

### Change Temperature
```typescript
// In callLLM() function
temperature: 0.7,  // Lower = more focused, Higher = more creative
```

### Enable Streaming
```typescript
// For real-time responses
stream: true
```

## 📚 More Info

- Ollama Docs: https://ollama.com/docs
- Model Library: https://ollama.com/library
- Qdrant Docs: https://qdrant.tech/documentation/

---

**Quick Start**:
```powershell
# 1. Install Ollama from ollama.com
# 2. Pull models
ollama pull llama3.2:3b
ollama pull nomic-embed-text

# 3. Ingest data
cd services\ai-service
pnpm run ingest

# 4. Start AI service
cd ..\..
start-ai.bat
```
