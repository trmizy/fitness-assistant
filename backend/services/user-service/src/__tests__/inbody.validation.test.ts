import test from 'node:test';
import assert from 'node:assert/strict';
import { validateUploadFilename, validateUploadMime } from '../utils/upload-validation';

// ── validateUploadMime ────────────────────────────────────────────────────────

test('rejects .exe (application/x-msdownload)', () => {
  const err = validateUploadMime('application/x-msdownload', 'malware.exe');
  assert.ok(err !== null, 'Expected error for .exe upload');
  assert.match(err!, /not allowed/i);
});

test('accepts image/png + .png', () => {
  assert.strictEqual(validateUploadMime('image/png', 'photo.png'), null);
});

test('accepts image/jpeg + .jpg', () => {
  assert.strictEqual(validateUploadMime('image/jpeg', 'scan.jpg'), null);
});

test('accepts application/pdf + .pdf', () => {
  assert.strictEqual(validateUploadMime('application/pdf', 'report.pdf'), null);
});

test('rejects MIME/extension mismatch (image/png + .exe)', () => {
  const err = validateUploadMime('image/png', 'disguised.exe');
  assert.ok(err !== null, 'Expected error for extension mismatch');
  assert.match(err!, /not allowed/i);
});

// ── validateUploadFilename ────────────────────────────────────────────────────

test('rejects path traversal: ../evil.png', () => {
  const err = validateUploadFilename('../evil.png');
  assert.ok(err !== null, 'Expected error for path traversal');
  assert.match(err!, /path traversal/i);
});

test('rejects path traversal: ..\\evil.png (backslash)', () => {
  const err = validateUploadFilename('..\\.evil.png');
  assert.ok(err !== null, 'Expected error for backslash path traversal');
});

test('rejects absolute path', () => {
  const err = validateUploadFilename('/etc/passwd');
  assert.ok(err !== null, 'Expected error for absolute path');
});

test('rejects shell injection characters', () => {
  const err = validateUploadFilename('file;rm-rf.jpg');
  assert.ok(err !== null, 'Expected error for shell injection chars');
});

test('accepts normal filename', () => {
  assert.strictEqual(validateUploadFilename('inbody_scan_2024.jpg'), null);
});
