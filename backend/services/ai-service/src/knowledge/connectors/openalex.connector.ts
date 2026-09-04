import axios from "axios";
import type {
  NormalizedResearchRecord,
  ResearchConnector,
  ResearchConnectorFetchOptions,
} from "./connector.interface";

function reconstructAbstract(
  index: Record<string, number[]> | undefined,
): string {
  if (!index) return "";
  const words: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words.push([position, word]);
  }
  return words
    .sort((a, b) => a[0] - b[0])
    .map(([, word]) => word)
    .join(" ");
}

export const openAlexConnector: ResearchConnector = {
  id: "openalex",
  async fetch(
    options: ResearchConnectorFetchOptions,
  ): Promise<NormalizedResearchRecord[]> {
    const response = await axios.get(`${options.source.base_url}/works`, {
      timeout: options.timeoutMs,
      headers: { "User-Agent": options.userAgent },
      params: {
        search: options.topic.query,
        per_page: options.maxResults,
        ...(options.topic.min_year
          ? { filter: `from_publication_date:${options.topic.min_year}-01-01` }
          : {}),
        ...(options.contactEmail ? { mailto: options.contactEmail } : {}),
      },
    });
    const fetchedAt = new Date().toISOString();
    const items: any[] = response.data?.results ?? [];
    const records: Array<NormalizedResearchRecord | null> = items.map(
      (item) => {
        const title = item.title || item.display_name || "";
        const abstractText = reconstructAbstract(item.abstract_inverted_index);
        if (!title) return null;
        const doi =
          typeof item.doi === "string"
            ? item.doi.replace(/^https?:\/\/doi.org\//, "")
            : undefined;
        return {
          external_id: item.id || (doi ? `doi:${doi}` : `openalex:${title}`),
          title,
          abstract_or_summary: abstractText || title,
          source: "OpenAlex",
          source_url: item.id || item.primary_location?.landing_page_url || "",
          doi,
          authors: Array.isArray(item.authorships)
            ? item.authorships
                .slice(0, 8)
                .map((entry: any) => entry.author?.display_name)
                .filter(Boolean)
            : [],
          journal: item.primary_location?.source?.display_name,
          publisher: item.primary_location?.source?.host_organization_name,
          year: item.publication_year,
          date: item.publication_date,
          license: item.primary_location?.license,
          access_status: item.open_access?.oa_status || "metadata",
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
