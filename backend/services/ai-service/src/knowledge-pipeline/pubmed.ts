import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import { KNOWLEDGE_PIPELINE } from "./config";
import { sha256 } from "./hash";
import type { RawKnowledgeDocument } from "./types";

type PubMedFetchOptions = {
  query: string;
  limit: number;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text",
  trimValues: true,
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function nodeText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (Array.isArray(value))
    return value.map(nodeText).filter(Boolean).join(" ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return nodeText(
      record.text ?? record["#text"] ?? Object.values(record).join(" "),
    );
  }
  return "";
}

function firstNonEmpty(values: Array<unknown>): string | null {
  for (const value of values) {
    const text = nodeText(value).trim();
    if (text) return text;
  }
  return null;
}

async function searchPubMedIds(
  query: string,
  limit: number,
): Promise<string[]> {
  const response = await axios.get(
    `${KNOWLEDGE_PIPELINE.pubMedBaseUrl}/esearch.fcgi`,
    {
      params: {
        db: "pubmed",
        term: query,
        sort: "pub+date",
        retmode: "json",
        retmax: limit,
      },
      timeout: 20000,
      headers: { "User-Agent": "fitness-assistant-knowledge-pipeline/1.0" },
    },
  );

  const ids = response.data?.esearchresult?.idlist;
  return Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
}

async function fetchPubMedXml(ids: string[]): Promise<string> {
  const response = await axios.get(
    `${KNOWLEDGE_PIPELINE.pubMedBaseUrl}/efetch.fcgi`,
    {
      params: {
        db: "pubmed",
        id: ids.join(","),
        retmode: "xml",
      },
      timeout: 30000,
      headers: { "User-Agent": "fitness-assistant-knowledge-pipeline/1.0" },
    },
  );
  return String(response.data ?? "");
}

function extractArticleIds(
  article: Record<string, unknown>,
): Record<string, string> {
  const articleIdList = (article.PubmedData as any)?.ArticleIdList?.ArticleId;
  const ids: Record<string, string> = {};
  for (const item of asArray(articleIdList)) {
    if (typeof item === "object" && item !== null) {
      const record = item as Record<string, unknown>;
      const type = String(record.IdType || "").toLowerCase();
      const value = nodeText(record).trim();
      if (type && value) ids[type] = value;
    }
  }
  return ids;
}

function extractTags(
  medline: Record<string, unknown>,
  article: Record<string, unknown>,
): string[] {
  const meshList = (medline.MeshHeadingList as any)?.MeshHeading;
  const meshTags = asArray(meshList)
    .map((item) => nodeText((item as any)?.DescriptorName))
    .filter(Boolean);

  const pubTypes = asArray(
    (article.PublicationTypeList as any)?.PublicationType,
  )
    .map(nodeText)
    .filter(Boolean);

  return Array.from(new Set([...meshTags, ...pubTypes])).slice(0, 12);
}

function extractAuthors(article: Record<string, unknown>): string | null {
  const authors = asArray((article.AuthorList as any)?.Author)
    .map((author) => {
      const record = author as Record<string, unknown>;
      const last = nodeText(record.LastName);
      const initials = nodeText(record.Initials);
      return [last, initials].filter(Boolean).join(" ");
    })
    .filter(Boolean);
  return authors.slice(0, 3).join(", ") || null;
}

function extractPubDate(article: Record<string, unknown>): Date | null {
  const pubDate = (article.Journal as any)?.JournalIssue?.PubDate;
  const year = Number.parseInt(nodeText(pubDate?.Year), 10);
  if (!Number.isFinite(year)) return null;
  const monthRaw = nodeText(pubDate?.Month);
  const day = Number.parseInt(nodeText(pubDate?.Day), 10) || 1;
  const monthNames = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  const monthNumber = Number.parseInt(monthRaw, 10);
  const month = Number.isFinite(monthNumber)
    ? monthNumber - 1
    : Math.max(
        0,
        monthNames.findIndex((name) => monthRaw.toLowerCase().startsWith(name)),
      );
  return new Date(Date.UTC(year, month >= 0 ? month : 0, day));
}

export function parsePubMedDocumentsFromXml(
  xml: string,
): RawKnowledgeDocument[] {
  const parsed = parser.parse(xml);
  const articles = asArray(parsed?.PubmedArticleSet?.PubmedArticle);

  return articles.flatMap((entry): RawKnowledgeDocument[] => {
    const articleRoot = entry as Record<string, unknown>;
    const medline = (articleRoot.MedlineCitation || {}) as Record<
      string,
      unknown
    >;
    const article = (medline.Article || {}) as Record<string, unknown>;
    const pmid = nodeText(medline.PMID).trim();
    const title =
      firstNonEmpty([article.ArticleTitle]) ?? `PubMed article ${pmid}`;
    const abstract = nodeText((article.Abstract as any)?.AbstractText).trim();
    if (!pmid || abstract.length < 120) return [];

    const articleIds = extractArticleIds(articleRoot);
    const doi = articleIds.doi;
    const pubmedUrl = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
    const url = doi ? `https://doi.org/${doi}` : pubmedUrl;
    const journal = nodeText((article.Journal as any)?.Title);
    const cleanText = [title, journal ? `Journal: ${journal}` : "", abstract]
      .filter(Boolean)
      .join("\n");
    const tags = extractTags(medline, article);

    return [
      {
        sourceId: KNOWLEDGE_PIPELINE.pubMedSourceId,
        url,
        title,
        author: extractAuthors(article),
        language: "en",
        contentHash: sha256([pmid, title, abstract].join("\n")),
        rawObjectKey: `pubmed:${pmid}`,
        cleanText,
        sourceFile: "pubmed:eutils",
        sourceType: "paper",
        evidenceLevel: "peer_reviewed",
        tags,
        publishedAt: extractPubDate(article),
      },
    ];
  });
}

export async function fetchPubMedDocuments(
  options: PubMedFetchOptions,
): Promise<RawKnowledgeDocument[]> {
  const ids = await searchPubMedIds(options.query, options.limit);
  if (ids.length === 0) return [];
  const xml = await fetchPubMedXml(ids);
  return parsePubMedDocumentsFromXml(xml);
}
