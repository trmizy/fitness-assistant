import fs from 'fs';
import path from 'path';
import type { NormalizedResearchRecord } from '../types';
import { pubmedConnector } from './pubmed.connector';
import { crossrefConnector } from './crossref.connector';
import { openAlexConnector } from './openalex.connector';
import { webpageConnector } from './webpage.connector';
import type { ResearchConnector } from './connector.interface';

export const connectorRegistry: Record<string, ResearchConnector> = {
  pubmed: pubmedConnector,
  pmc: pubmedConnector,
  crossref: crossrefConnector,
  openalex: openAlexConnector,
  allowlisted_webpage: webpageConnector,
};

export function writeJsonl(filePath: string, records: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''), 'utf8');
}

export function readNormalizedJsonl(filePath: string): NormalizedResearchRecord[] {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as NormalizedResearchRecord);
}
