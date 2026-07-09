import { enabledResearchSources, validateSourceRegistry } from '../knowledge/source_registry';
import { selectedResearchTopics } from '../knowledge/research_topics';

function readLimit(name: string, fallback: number): number {
  const value = Number(process.env[name] || '');
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function main(): Promise<void> {
  const registryErrors = validateSourceRegistry();
  if (registryErrors.length > 0) {
    throw new Error(`Invalid research source registry: ${registryErrors.join(', ')}`);
  }

  const maxResults = readLimit('RESEARCH_MAX_RESULTS_PER_TOPIC', 5);
  const topicLimit = readLimit('RESEARCH_TOPIC_LIMIT', 5);
  const topics = selectedResearchTopics(topicLimit);
  const sources = enabledResearchSources();

  console.log(JSON.stringify({
    status: 'PASS',
    mode: 'dry-run',
    writes: false,
    qdrantWrites: false,
    env: {
      researchContactEmailSet: Boolean(process.env.RESEARCH_CONTACT_EMAIL),
      pubmedApiKeySet: Boolean(process.env.PUBMED_API_KEY),
      crossrefMailtoSet: Boolean(process.env.CROSSREF_MAILTO),
      webAllowlistSet: Boolean(process.env.RESEARCH_WEB_ALLOWLIST),
    },
    topics: topics.map((topic) => ({
      id: topic.id,
      query: topic.query,
      maxResults: Math.min(topic.max_results, maxResults),
      sourcePreferences: topic.source_preferences,
    })),
    enabledSources: sources.map((source) => ({
      id: source.id,
      type: source.type,
      trustLevel: source.trust_level,
      allowedContent: source.allowed_content,
      robotsPolicyRequired: source.robots_policy_required,
      rateLimitPerMinute: source.rate_limit_per_minute,
    })),
  }, null, 2));
}

main().catch((err) => {
  console.error('FAIL knowledge:research:dry-run');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
