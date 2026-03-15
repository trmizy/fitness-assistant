@echo off
echo.
echo === Testing Ollama Installation ===
echo.

REM Check if Ollama is installed
where ollama >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Ollama not found!
    echo.
    echo Please install Ollama from: https://ollama.com/download/windows
    pause
    exit /b 1
)

echo [1/5] Ollama is installed
ollama --version
echo.

REM Check if Ollama service is running
echo [2/5] Testing Ollama API...
curl -s http://localhost:11434 >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Ollama is not running!
    echo.
    echo Starting Ollama service...
    start /B ollama serve
    timeout /t 5 /nobreak >nul
)
echo Ollama API: OK
echo.

REM Check models
echo [3/5] Checking installed models...
ollama list
echo.

REM Check if required models exist
ollama list | findstr "llama3.2:3b" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [WARN] llama3.2:3b not found!
    echo.
    set /p PULL="Pull llama3.2:3b now? (y/n): "
    if /i "%PULL%"=="y" (
        echo Pulling llama3.2:3b (2GB download)...
        ollama pull llama3.2:3b
    )
)

ollama list | findstr "nomic-embed-text" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [WARN] nomic-embed-text not found!
    echo.
    set /p PULL="Pull nomic-embed-text now? (y/n): "
    if /i "%PULL%"=="y" (
        echo Pulling nomic-embed-text (274MB download)...
        ollama pull nomic-embed-text
    )
)

echo.
echo [4/5] Testing LLM...
echo.
echo Prompt: "What is progressive overload in 1 sentence?"
echo.
curl -s http://localhost:11434/api/generate -d "{\"model\": \"llama3.2:3b\", \"prompt\": \"What is progressive overload in 1 sentence?\", \"stream\": false}" | findstr "response"
echo.

echo.
echo [5/5] Testing Embeddings...
curl -s http://localhost:11434/api/embeddings -d "{\"model\": \"nomic-embed-text\", \"prompt\": \"bench press\"}" | findstr "embedding" >nul
if %ERRORLEVEL% EQU 0 (
    echo Embeddings: OK
) else (
    echo Embeddings: FAILED
)
echo.

echo.
echo === Summary ===
echo.
echo Next steps:
echo 1. cd services\ai-service
echo 2. pnpm run ingest    (ingest exercise data to Qdrant)
echo 3. start-ai.bat       (start AI service)
echo.
pause
