import requests
import os

OLLAMA_BASE_URL = os.getenv('OLLAMA_BASE_URL', 'http://host.docker.internal:11434')

print(f"Testing Ollama at: {OLLAMA_BASE_URL}")

# Test /api/generate endpoint
try:
    response = requests.post(
        f"{OLLAMA_BASE_URL}/api/generate",
        json={
            "model": "llama3.2:3b",
            "prompt": "What is 2+2?",
            "stream": False
        },
        timeout=120
    )
    
    print(f"Status code: {response.status_code}")
    print(f"Response headers: {dict(response.headers)}")
    
    if response.ok:
        result = response.json()
        print(f"Success! Answer: {result.get('response', '')}")
        print(f"Tokens - prompt: {result.get('prompt_eval_count', 0)}, completion: {result.get('eval_count', 0)}")
    else:
        print(f"Error: {response.status_code} - {response.text}")
        
except Exception as e:
    print(f"Exception: {type(e).__name__}: {e}")
