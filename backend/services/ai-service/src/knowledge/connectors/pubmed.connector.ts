import axios from 'axios';
import type { NormalizedResearchRecord, ResearchConnector, ResearchConnectorFetchOptions } from './connector.interface';

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function extractArticle(item: any, topicId: string, fetchedAt: string): NormalizedResearchRecord | null {
  const medline = item?.MedlineCitation;
  const article = medline?.Article;
  const pmid = String(medline?.PMID?._ || medline?.PMID || '').trim();
  const title = readText(article?.ArticleTitle);
  const abstractParts = article?.Abstract?.AbstractText;
  const abstract = Array.isArray(abstractParts)
    ? abstractParts.map((part: any) => readText(part?._ || part)).filter(Boolean).join(' ')
    : readText(abstractParts?._ || abstractParts);
  if (!pmid || !title || !abstract) return null;

  const yearRaw = article?.Journal?.JournalIssue?.PubDate?.Year || article?.Journal?.JournalIssue?.PubDate?.MedlineDate;
  const yearMatch = String(yearRaw || '').match(/\b(19|20)\d{2}\b/);
  const doiItem = Array.isArray(article?.ELocationID)
    ? article.ELocationID.find((entry: any) => String(entry?.EIdType || '').toLowerCase() === 'doi')
    : undefined;
  const doi = readText(doiItem?._ || doiItem);
  const authors = Array.isArray(article?.AuthorList?.Author)
    ? article.AuthorList.Author.map((author: any) => [author.ForeName, author.LastName].filter(Boolean).join(' ')).filter(Boolean)
    : [];

  return {
    external_id: `pmid:${pmid}`,
    title,
    abstract_or_summary: abstract,
    source: 'PubMed',
    source_url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    doi: doi || undefined,
    pmid,
    authors,
    journal: readText(article?.Journal?.Title),
    publisher: 'NCBI PubMed',
    year: yearMatch ? Number(yearMatch[0]) : undefined,
    date: yearMatch ? yearMatch[0] : undefined,
    license: undefined,
    access_status: 'abstract',
    topic: topicId,
    raw_metadata: item,
    fetched_at: fetchedAt,
    retrieved_at: fetchedAt,
  };
}

export const pubmedConnector: ResearchConnector = {
  id: 'pubmed',
  async fetch(options: ResearchConnectorFetchOptions): Promise<NormalizedResearchRecord[]> {
    const apiKey = process.env.PUBMED_API_KEY;
    const email = options.contactEmail || process.env.RESEARCH_CONTACT_EMAIL;
    const term = [options.topic.query, options.topic.min_year ? `${options.topic.min_year}:3000[pdat]` : ''].filter(Boolean).join(' AND ');
    const search = await axios.get(`${options.source.base_url}/esearch.fcgi`, {
      timeout: options.timeoutMs,
      headers: { 'User-Agent': options.userAgent },
      params: {
        db: 'pubmed',
        retmode: 'json',
        retmax: options.maxResults,
        term,
        ...(apiKey ? { api_key: apiKey } : {}),
        ...(email ? { email } : {}),
      },
    });
    const ids: string[] = search.data?.esearchresult?.idlist ?? [];
    if (ids.length === 0) return [];

    const summary = await axios.get(`${options.source.base_url}/efetch.fcgi`, {
      timeout: options.timeoutMs,
      headers: { 'User-Agent': options.userAgent },
      params: {
        db: 'pubmed',
        retmode: 'xml',
        id: ids.join(','),
        ...(apiKey ? { api_key: apiKey } : {}),
        ...(email ? { email } : {}),
      },
    });

    const { XMLParser } = await import('fast-xml-parser');
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', textNodeName: '_' });
    const parsed = parser.parse(summary.data);
    const articles = parsed?.PubmedArticleSet?.PubmedArticle;
    const list = Array.isArray(articles) ? articles : articles ? [articles] : [];
    const fetchedAt = new Date().toISOString();
    return list.map((item) => extractArticle(item, options.topic.id, fetchedAt)).filter((item): item is NormalizedResearchRecord => Boolean(item));
  },
};
