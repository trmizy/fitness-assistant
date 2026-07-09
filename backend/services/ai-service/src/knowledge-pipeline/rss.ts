import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { sha256 } from './hash';
import type { KnowledgeSource, RawKnowledgeDocument } from './types';

type RssFetchOptions = {
  source: KnowledgeSource;
  limit: number;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: 'text',
  trimValues: true,
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function nodeText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(nodeText).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return nodeText(record.text ?? record['#text'] ?? '');
  }
  return '';
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDate(value: unknown): Date | null {
  const text = nodeText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseRssItems(xml: string, source: KnowledgeSource, limit: number): RawKnowledgeDocument[] {
  const parsed = parser.parse(xml);
  const rssItems = asArray(parsed?.rss?.channel?.item);
  const atomItems = asArray(parsed?.feed?.entry);
  const items = rssItems.length > 0 ? rssItems : atomItems;

  return items.slice(0, limit).flatMap((item): RawKnowledgeDocument[] => {
    const record = item as Record<string, unknown>;
    const title = stripHtml(nodeText(record.title));
    const rawLink = nodeText(record.link);
    const atomHref = typeof record.link === 'object' && record.link !== null ? nodeText((record.link as Record<string, unknown>).href) : '';
    const url = rawLink || atomHref;
    const description = stripHtml([
      nodeText(record.description),
      nodeText(record.summary),
      nodeText(record.content),
      nodeText(record['content:encoded']),
    ].filter(Boolean).join('\n'));

    if (!title || !url || description.length < 80) return [];

    const categories = asArray(record.category).map(nodeText).filter(Boolean);
    const publishedAt = parseDate(record.pubDate ?? record.published ?? record.updated);
    const cleanText = [title, description].join('\n');

    return [{
      sourceId: source.id,
      url,
      title,
      author: nodeText(record.author) || null,
      language: 'en',
      contentHash: sha256([source.id, url, title, description].join('\n')),
      rawObjectKey: `${source.baseUrl}#${url}`,
      cleanText,
      sourceFile: source.baseUrl,
      sourceType: 'rss',
      evidenceLevel: source.trustTier <= 2 ? 'professional_source' : 'general_web',
      tags: categories,
      publishedAt,
    }];
  });
}

export async function fetchRssDocuments(options: RssFetchOptions): Promise<RawKnowledgeDocument[]> {
  const response = await axios.get(options.source.baseUrl, {
    timeout: 20000,
    headers: { 'User-Agent': 'fitness-assistant-knowledge-pipeline/1.0' },
  });
  return parseRssItems(String(response.data ?? ''), options.source, options.limit);
}

export function parseRssDocumentsFromXml(xml: string, source: KnowledgeSource, limit = 20): RawKnowledgeDocument[] {
  return parseRssItems(xml, source, limit);
}
