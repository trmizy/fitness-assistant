import { QdrantVectorStore } from "./qdrant-vector-store";
import { OpenSearchVectorStore } from "./opensearch-vector-store";
import { resolveVectorStoreProvider, type VectorStore } from "./types";

let cachedStore: VectorStore | null = null;

export function getVectorStore(): VectorStore {
  if (!cachedStore) {
    const provider = resolveVectorStoreProvider();
    cachedStore =
      provider === "opensearch"
        ? new OpenSearchVectorStore()
        : new QdrantVectorStore();
  }
  return cachedStore;
}

export function resetVectorStoreForTests(): void {
  cachedStore = null;
}

