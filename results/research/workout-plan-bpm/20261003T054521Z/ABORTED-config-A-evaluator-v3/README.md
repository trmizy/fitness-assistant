# ABORTED — Config A (evaluator v3). Not benchmark evidence.

Stopped by the protocol stop rule: "Config A: LLM off, verify Qwen not invoked, stop if invoked."
Three Ollama `/api/chat` calls were observed in the raw access log (`gymcoach-ollama`), each returning HTTP 500 after
the 170 000 ms server LLM timeout:

1. Ended 06:23:20 UTC. This belongs to the **warmup** turn W3 "Hủy kế hoạch này nhé." (route WRITE_ACTION, 172.7 s HTTP).
2. Ended 06:27:03 UTC (started about 06:24:13). Attributed to W018 attempt 1 by timing. Inferred, not directly logged:
   it is the in-flight request of the runner process that was killed at about 06:24:05 mid-turn.
3. Ended 06:27:13 UTC (started about 06:24:23). W018 attempt 2, turn T1 "Tôi muốn tập luyện theo lịch." (route UNKNOWN,
   171.6 s HTTP). The user-facing answer was the degraded message "Tạm thời AI chưa sẵn sàng để phân tích chi tiết…".

None of the three produced a typed CI semantic-fallback event (`llmCalled = false` on the trace; no
`ci_global_llm_route`; no `ci_v2_llm_interpretation`). They came from the orchestrator's own non-CI LLM generation path for
UNKNOWN and WRITE_ACTION turns. Under evaluator v3 the stop did not fire for these calls, because of defects (1) and (2)
recorded in `../evaluator-changelog.md`.

Archived unchanged: `evaluator-manifest.v3.json`, `warmup-config-A.json`, and `config-A/` (18-case checkpoint, plus an
attempts log showing one interruption at W018 that was correctly discarded and re-run).
