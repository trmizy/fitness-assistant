import fs from "node:fs";
import path from "node:path";
import { KNOWLEDGE_PIPELINE } from "./config";
import { sha256 } from "./hash";
import type { RawKnowledgeDocument } from "./types";

type LocalEvidenceChunk = {
  id?: string;
  title?: string;
  source_type?: string;
  category?: string;
  content?: string;
  source_url?: string;
  evidence_level?: string;
  tags?: unknown;
  chunk_index?: number;
};

function repoDataRoot(): string {
  const candidates = [
    process.env.KNOWLEDGE_DATA_ROOT
      ? path.resolve(process.cwd(), process.env.KNOWLEDGE_DATA_ROOT)
      : null,
    path.resolve(process.cwd(), "data"),
    path.resolve(process.cwd(), "..", "..", "..", "data"),
    path.resolve(__dirname, "..", "..", "..", "..", "data"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const existing = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, "processed", "evidence")),
  );
  if (!existing) {
    throw new Error(
      `Cannot locate processed evidence directory. Checked: ${candidates.map((candidate) => path.join(candidate, "processed", "evidence")).join(", ")}`,
    );
  }
  return existing;
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function readJsonl(filePath: string): LocalEvidenceChunk[] {
  return fs
    .readFileSync(filePath, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LocalEvidenceChunk);
}

export function listLocalEvidenceDocuments(
  limit?: number,
): RawKnowledgeDocument[] {
  const dataRoot = repoDataRoot();
  const evidenceDir = path.join(dataRoot, "processed", "evidence");
  if (!fs.existsSync(evidenceDir)) return [];

  const docs: RawKnowledgeDocument[] = [];
  const files = fs
    .readdirSync(evidenceDir)
    .filter((file) => file.endsWith(".jsonl"))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const absolutePath = path.join(evidenceDir, file);
    const relativePath = path
      .relative(dataRoot, absolutePath)
      .replace(/\\/g, "/");
    const chunks = readJsonl(absolutePath);

    for (const chunk of chunks) {
      const title = String(chunk.title || file.replace(/\.jsonl$/i, ""));
      const cleanText = String(chunk.content || "").trim();
      if (cleanText.length < 80) continue;

      const chunkId = String(
        chunk.id || `${file}:${chunk.chunk_index ?? docs.length}`,
      );
      const url = String(
        chunk.source_url ||
          `${KNOWLEDGE_PIPELINE.localEvidenceBaseUrl}/${file}#${chunkId}`,
      );
      const contentHash = sha256([title, url, cleanText].join("\n"));

      docs.push({
        sourceId: KNOWLEDGE_PIPELINE.localEvidenceSourceId,
        url,
        title,
        author: null,
        language: "en",
        contentHash,
        rawObjectKey: `${relativePath}#${chunkId}`,
        cleanText,
        sourceFile: `data/${relativePath}`,
        sourceType: chunk.source_type,
        evidenceLevel: chunk.evidence_level,
        tags: parseTags(chunk.tags),
        publishedAt: null,
      });

      if (limit && docs.length >= limit) return docs;
    }
  }

  return docs;
}
