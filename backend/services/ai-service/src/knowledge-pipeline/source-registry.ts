import type { KnowledgeSource, KnowledgeSourceType } from './types';

type SourceSeed = {
  id: string;
  name: string;
  baseUrl: string;
  sourceType: KnowledgeSourceType;
  trustTier: number;
};

export const DEFAULT_KNOWLEDGE_SOURCES: SourceSeed[] = [
  {
    id: 'source-local-evidence',
    name: 'Curated Local Evidence JSONL',
    baseUrl: 'local://data/processed/evidence',
    sourceType: 'LOCAL',
    trustTier: 1,
  },
  {
    id: 'source-nhanes-local',
    name: 'NHANES Local Body Composition Summary',
    baseUrl: 'local://data/processed/nhanes',
    sourceType: 'LOCAL',
    trustTier: 1,
  },
  {
    id: 'source-pubmed-eutils',
    name: 'PubMed E-utilities',
    baseUrl: 'https://eutils.ncbi.nlm.nih.gov',
    sourceType: 'API',
    trustTier: 1,
  },
  {
    id: 'source-who-nutrition',
    name: 'WHO Nutrition',
    baseUrl: 'https://www.who.int/nutrition',
    sourceType: 'WEB',
    trustTier: 1,
  },
  {
    id: 'source-acsm-topics',
    name: 'ACSM Trending Topics',
    baseUrl: 'https://www.acsm.org/education-resources/trending-topics-resources',
    sourceType: 'WEB',
    trustTier: 2,
  },
  {
    id: 'source-nsca-feed',
    name: 'NSCA Articles Feed',
    baseUrl: 'https://www.nsca.com/articles/feed',
    sourceType: 'RSS',
    trustTier: 2,
  },
  {
    id: 'source-sciencedaily-fitness',
    name: 'ScienceDaily Fitness RSS',
    baseUrl: 'https://www.sciencedaily.com/rss/health_medicine/fitness.xml',
    sourceType: 'RSS',
    trustTier: 3,
  },
];

export function toKnowledgeSource(seed: SourceSeed): KnowledgeSource {
  return {
    id: seed.id,
    name: seed.name,
    baseUrl: seed.baseUrl,
    sourceType: seed.sourceType,
    trustTier: seed.trustTier,
    isActive: true,
  };
}
