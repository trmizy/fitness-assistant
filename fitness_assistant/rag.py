import json
import os
from time import time
import requests

import ingest


# Configure Ollama (local LLM)
OLLAMA_BASE_URL = os.getenv('OLLAMA_BASE_URL', 'http://host.docker.internal:11434')
index = ingest.load_index()


def search(query):
    boost = {
        'exercise_name': 2.11,
        'type_of_activity': 1.46,
        'type_of_equipment': 0.65,
        'body_part': 2.65,
        'type': 1.31,
        'muscle_groups_activated': 2.54,
        'instructions': 0.74
    }

    results = index.search(
        query=query, filter_dict={}, boost_dict=boost, num_results=10
    )

    return results


prompt_template = """
You're a fitness insrtuctor. Answer the QUESTION based on the CONTEXT from our exercises database.
Use only the facts from the CONTEXT when answering the QUESTION.

QUESTION: {question}

CONTEXT:
{context}
""".strip()


entry_template = """
exercise_name: {exercise_name}
type_of_activity: {type_of_activity}
type_of_equipment: {type_of_equipment}
body_part: {body_part}
type: {type}
muscle_groups_activated: {muscle_groups_activated}
instructions: {instructions}
""".strip()


def build_prompt(query, search_results):
    context = ""

    for doc in search_results:
        context = context + entry_template.format(**doc) + "\n\n"

    prompt = prompt_template.format(question=query, context=context).strip()
    return prompt


def llm(prompt, model="llama3.2:3b"):
    # Map model names to Ollama models
    if model in ["gpt-4o-mini", "gemini-1.5-flash", "gemini-2.5-flash"]:
        model = "llama3.2:3b"  # Fast, lightweight
    elif model in ["gpt-4o", "gemini-1.5-pro", "gemini-2.5-pro"]:
        model = "llama3.2:3b"  # Can use llama3.1:8b if you have more RAM
    
    # Call Ollama API
    try:
        url = f"{OLLAMA_BASE_URL}/api/generate"
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": False
        }
        print(f"[DEBUG] Calling Ollama at: {url}")
        print(f"[DEBUG] Model: {model}")
        print(f"[DEBUG] Prompt length: {len(prompt)} chars")
        
        response = requests.post(url, json=payload, timeout=120)
        
        print(f"[DEBUG] Response status: {response.status_code}")
        print(f"[DEBUG] Response headers: {dict(response.headers)}")
        
        response.raise_for_status()
        result = response.json()
        answer = result.get('response', '')
        
        # Get actual token counts from Ollama
        prompt_tokens = result.get('prompt_eval_count', 0)
        completion_tokens = result.get('eval_count', 0)
        
    except Exception as e:
        print(f"[DEBUG] Ollama error: {type(e).__name__}: {e}")
        answer = f"Error calling Ollama: {str(e)}. Make sure Ollama is running with 'ollama serve'."
        prompt_tokens = 0
        completion_tokens = 0
    
    token_stats = {
        "prompt_tokens": int(prompt_tokens),
        "completion_tokens": int(completion_tokens),
        "total_tokens": int(prompt_tokens + completion_tokens),
    }

    return answer, token_stats


evaluation_prompt_template = """
You are an expert evaluator for a RAG system.
Your task is to analyze the relevance of the generated answer to the given question.
Based on the relevance of the generated answer, you will classify it
as "NON_RELEVANT", "PARTLY_RELEVANT", or "RELEVANT".

Here is the data for evaluation:

Question: {question}
Generated Answer: {answer}

Please analyze the content and context of the generated answer in relation to the question
and provide your evaluation in parsable JSON without using code blocks:

{{
  "Relevance": "NON_RELEVANT" | "PARTLY_RELEVANT" | "RELEVANT",
  "Explanation": "[Provide a brief explanation for your evaluation]"
}}
""".strip()


def evaluate_relevance(question, answer):
    prompt = evaluation_prompt_template.format(question=question, answer=answer)
    evaluation, tokens = llm(prompt, model="gpt-4o-mini")

    try:
        json_eval = json.loads(evaluation)
        return json_eval, tokens
    except json.JSONDecodeError:
        result = {"Relevance": "UNKNOWN", "Explanation": "Failed to parse evaluation"}
        return result, tokens


def calculate_openai_cost(model, tokens):
    # Google Gemini pricing (as of 2024)
    gemini_cost = 0

    if "gemini-1.5-flash" in model or "gpt-4o-mini" in model:
        # Gemini 1.5 Flash: $0.075 per 1M input tokens, $0.30 per 1M output tokens
        gemini_cost = (
            tokens["prompt_tokens"] * 0.000075 + tokens["completion_tokens"] * 0.0003
        ) / 1000
    elif "gemini-1.5-pro" in model or "gpt-4o" in model:
        # Gemini 1.5 Pro: $1.25 per 1M input tokens, $5.00 per 1M output tokens
        gemini_cost = (
            tokens["prompt_tokens"] * 0.00125 + tokens["completion_tokens"] * 0.005
        ) / 1000
    else:
        print("Model not recognized. Cost calculation failed.")

    return gemini_cost


def rag(query, model="gemini-1.5-flash"):
    t0 = time()

    search_results = search(query)
    prompt = build_prompt(query, search_results)
    answer, token_stats = llm(prompt, model=model)

    relevance, rel_token_stats = evaluate_relevance(query, answer)

    t1 = time()
    took = t1 - t0

    openai_cost_rag = calculate_openai_cost(model, token_stats)
    openai_cost_eval = calculate_openai_cost(model, rel_token_stats)

    openai_cost = openai_cost_rag + openai_cost_eval

    answer_data = {
        "answer": answer,
        "model_used": model,
        "response_time": took,
        "relevance": relevance.get("Relevance", "UNKNOWN"),
        "relevance_explanation": relevance.get(
            "Explanation", "Failed to parse evaluation"
        ),
        "prompt_tokens": token_stats["prompt_tokens"],
        "completion_tokens": token_stats["completion_tokens"],
        "total_tokens": token_stats["total_tokens"],
        "eval_prompt_tokens": rel_token_stats["prompt_tokens"],
        "eval_completion_tokens": rel_token_stats["completion_tokens"],
        "eval_total_tokens": rel_token_stats["total_tokens"],
        "openai_cost": openai_cost,
    }

    return answer_data
