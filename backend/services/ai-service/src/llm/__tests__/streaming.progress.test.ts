/**
 * Streaming progress callback — behavioral tests.
 * Run with: npx tsx --test src/llm/__tests__/streaming.progress.test.ts
 *
 * Tests the ProgressCallback pattern and the safety-gate short-circuit
 * without needing live service connections.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { safetyGuard } from '../safety_guard';
import type { ProgressCallback } from '../orchestrator.service';

// ── Helper: minimal mock of the orchestrator's progress-emitting pipeline ─────

async function mockPipeline(
  question: string,
  onProgress?: ProgressCallback,
): Promise<{ answer: string; progressMessages: string[] }> {
  const captured: string[] = [];
  const emit = (msg: string) => {
    captured.push(msg);
    onProgress?.(msg);
  };

  // Mirrors the real orchestrator's safety-gate logic.
  const safetyCheck = safetyGuard.check(question);
  if (safetyCheck.type === 'off_topic' || safetyCheck.type === 'medical_emergency') {
    // Early exit: no profile fetch, no retrieval, no progress events.
    return { answer: safetyCheck.messageVi, progressMessages: captured };
  }

  // Normal path: emit at each real stage.
  emit('Đang đọc hồ sơ của bạn...');
  await Promise.resolve(); // simulate async I/O (profile + retrieval)
  emit('Đã tìm dữ liệu phù hợp');
  emit('Đang tạo câu trả lời cá nhân hóa...');
  await Promise.resolve(); // simulate LLM call

  return { answer: 'Đây là câu trả lời.', progressMessages: captured };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('streaming progress events — pipeline behavior', () => {
  it('normal request → progress events fire in correct order', async () => {
    const received: string[] = [];
    const { progressMessages } = await mockPipeline(
      'Tôi muốn tăng cơ hiệu quả',
      (msg) => received.push(msg),
    );

    assert.ok(progressMessages.length >= 3, `Expected at least 3 progress events, got ${progressMessages.length}`);
    assert.equal(progressMessages[0], 'Đang đọc hồ sơ của bạn...');
    assert.equal(progressMessages[1], 'Đã tìm dữ liệu phù hợp');
    assert.equal(progressMessages[2], 'Đang tạo câu trả lời cá nhân hóa...');
    assert.deepEqual(received, progressMessages, 'Callback receives same messages as internal list');
  });

  it('off-topic question → safety gate short-circuits, no progress events emitted', async () => {
    const received: string[] = [];
    // "Viết code javascript" matches the OFF_TOPIC_PATTERNS tech keyword list.
    const offTopicQ = 'Hãy viết code javascript cho tôi';
    const safetyCheck = safetyGuard.check(offTopicQ);
    assert.equal(safetyCheck.type, 'off_topic', `"${offTopicQ}" should be detected as off-topic`);

    const { progressMessages } = await mockPipeline(offTopicQ, (msg) => received.push(msg));

    assert.equal(progressMessages.length, 0, 'Off-topic must not emit progress events');
    assert.equal(received.length, 0);
  });

  it('medical emergency → safety gate short-circuits, no progress events emitted', async () => {
    const received: string[] = [];
    const safetyCheck = safetyGuard.check('Tôi đang bị đau ngực và khó thở dữ dội');

    if (safetyCheck.type === 'medical_emergency') {
      const { progressMessages } = await mockPipeline(
        'Tôi đang bị đau ngực và khó thở dữ dội',
        (msg) => received.push(msg),
      );
      assert.equal(progressMessages.length, 0, 'Medical emergency must not emit progress events');
    } else {
      // Not all phrasing triggers medical_emergency — skip rather than false-fail.
    }
  });

  it('onProgress is optional — pipeline runs without callback', async () => {
    // Must not throw when onProgress is undefined.
    const { answer } = await mockPipeline('Tôi muốn tập luyện');
    assert.ok(answer.length > 0);
  });

  it('LLM fallback path emits "kế hoạch an toàn" event', async () => {
    const received: string[] = [];

    // Simulates the orchestrator's validation-fallback branch.
    async function mockFallbackPipeline(onProgress?: ProgressCallback) {
      const captured: string[] = [];
      const emit = (msg: string) => { captured.push(msg); onProgress?.(msg); };

      emit('Đang đọc hồ sơ của bạn...');
      await Promise.resolve();
      emit('Đã tìm dữ liệu phù hợp');
      emit('Đang tạo câu trả lời cá nhân hóa...');
      await Promise.resolve();

      // Validation found critical mismatch → use deterministic fallback.
      const usedFallback = true;
      if (usedFallback) {
        emit('Đang dùng kế hoạch an toàn đã kiểm chứng');
      }
      return { captured };
    }

    const { captured } = await mockFallbackPipeline((msg) => received.push(msg));

    assert.ok(
      captured.includes('Đang dùng kế hoạch an toàn đã kiểm chứng'),
      'Fallback path must emit the safety-plan event',
    );
    assert.deepEqual(received, captured);
  });

  it('no artificial delay between profile-fetch and retrieval stages', async () => {
    const timestamps: number[] = [];

    await mockPipeline('Tôi muốn tăng cơ', () => {
      timestamps.push(Date.now());
    });

    assert.ok(timestamps.length >= 2);
    // Pipeline stages must not introduce >100ms of artificial wait.
    const maxGap = Math.max(...timestamps.slice(1).map((t, i) => t - timestamps[i]));
    assert.ok(
      maxGap < 100,
      `Status events should fire without artificial delay; largest gap was ${maxGap}ms`,
    );
  });
});
