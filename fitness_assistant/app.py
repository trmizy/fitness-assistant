import uuid
import time

from flask import Flask, request, jsonify
from flask_cors import CORS

from rag import rag

import db

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend


@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({"status": "ok"})


@app.route("/ask", methods=["POST"])
def handle_question():
    data = request.json
    question = data.get("question")

    if not question:
        return jsonify({"error": "No question provided"}), 400

    conversation_id = str(uuid.uuid4())
    start_time = time.time()

    answer_data = rag(question)
    response_time = time.time() - start_time

    result = {
        "conversation_id": conversation_id,
        "question": question,
        "answer": answer_data.get("answer"),
        "model_used": answer_data.get("model_used", "unknown"),
        "response_time": round(response_time, 2),
        "relevance": answer_data.get("relevance", "RELEVANT"),
        "relevance_explanation": answer_data.get("relevance_explanation", ""),
        "prompt_tokens": answer_data.get("prompt_tokens", 0),
        "completion_tokens": answer_data.get("completion_tokens", 0),
        "total_tokens": answer_data.get("total_tokens", 0),
        "openai_cost": answer_data.get("openai_cost", 0),
    }

    db.save_conversation(
        conversation_id=conversation_id,
        question=question,
        answer_data=answer_data,
    )

    return jsonify(result)


@app.route("/conversations", methods=["GET"])
def get_conversations():
    limit = request.args.get("limit", 10, type=int)

    conversations = db.get_recent_conversations(limit=limit)

    return jsonify({"conversations": conversations})


@app.route("/feedback", methods=["POST"])
def handle_feedback():
    data = request.json
    conversation_id = data.get("conversation_id")
    feedback = data.get("feedback")

    if not conversation_id or feedback not in [1, -1]:
        return jsonify({"error": "Invalid input"}), 400

    db.save_feedback(
        conversation_id=conversation_id,
        feedback=feedback,
    )

    result = {
        "message": f"Feedback received for conversation {conversation_id}: {feedback}"
    }
    return jsonify(result)


@app.route("/feedback/stats", methods=["GET"])
def get_feedback_stats():
    stats = db.get_feedback_stats()

    return jsonify(stats)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
