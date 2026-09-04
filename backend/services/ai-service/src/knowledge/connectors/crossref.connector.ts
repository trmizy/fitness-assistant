import axios from "axios";
import type {
  NormalizedResearchRecord,
  ResearchConnector,
  ResearchConnectorFetchOptions,
} from "./connector.interface";

function first(value: unknown): string | undefined {
  if (Array.isArray(value))
    return typeof value[0] === "string" ? value[0] : undefined;
  return typeof value === "string" ? value : undefined;
}

export const crossrefConnector: ResearchConnector = {
  id: "crossref",
  async fetch(
    options: ResearchConnectorFetchOptions,
  ): Promise<NormalizedResearchRecord[]> {
    const mailto = process.env.CROSSREF_MAILTO || options.contactEmail;
    const response = await axios.get(`${options.source.base_url}/works`, {
      timeout: options.timeoutMs,
      headers: { "User-Agent": options.userAgent },
      params: {
        query: options.topic.query,
        rows: options.maxResults,
        ...(options.topic.min_year
          ? { filter: `from-pub-date:${options.topic.min_year}` }
          : {}),
        ...(mailto ? { mailto } : {}),
      },
    });
    const fetchedAt = new Date().toISOString();
    const items: any[] = response.data?.message?.items ?? [];
    const records: Array<NormalizedResearchRecord | null> = items.map(
      (item) => {
        const doi = typeof item.DOI === "string" ? item.DOI : undefined;
        const title = first(item.title) || "";
        const year =
          item.published?.["date-parts"]?.[0]?.[0] ||
          item.issued?.["date-parts"]?.[0]?.[0];
        const abstractText =
          typeof item.abstract === "string"
            ? item.abstract.replace(/<[^>]+>/g, " ")
            : "";
        if (!title) return null;
        return {
          external_id: doi ? `doi:${doi}` : `crossref:${item.URL || title}`,
          title,
          abstract_or_summary: abstractText || title,
          source: "Crossref",
          source_url: item.URL || (doi ? `https://doi.org/${doi}` : ""),
          doi,
          authors: Array.isArray(item.author)
            ? item.author
                .slice(0, 8)
                .map((author: any) =>
                  [author.given, author.family].filter(Boolean).join(" "),
                )
                .filter(Boolean)
            : [],
          journal: first(item["container-title"]),
          publisher: item.publisher,
          year: typeof year === "number" ? year : undefined,
          date: typeof year === "number" ? String(year) : undefined,
          license: Array.isArray(item.license)
            ? item.license[0]?.URL
            : undefined,
          access_status: "metadata",
          topic: options.topic.id,
          raw_metadata: item,
          fetched_at: fetchedAt,
          retrieved_at: fetchedAt,
        } satisfies NormalizedResearchRecord;
      },
    );
    return records.filter(
      (item): item is NormalizedResearchRecord => item !== null,
    );
  },
};
