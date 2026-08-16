import type { ResearchSource } from "./types";

export const researchSources: ResearchSource[] = [
  {
    id: "pubmed",
    name: "PubMed metadata and abstracts",
    type: "api",
    enabled: true,
    base_url: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils",
    topics: [
      "training",
      "nutrition",
      "recovery",
      "body_composition",
      "supplements",
    ],
    trust_level: "high",
    rate_limit_per_minute: 30,
    requires_api_key: false,
    robots_policy_required: false,
    allowed_content: "abstract",
    notes:
      "Uses NCBI E-utilities metadata and abstracts. API key optional via PUBMED_API_KEY.",
  },
  {
    id: "pmc",
    name: "PubMed Central open access metadata",
    type: "api",
    enabled: true,
    base_url: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils",
    topics: ["training", "nutrition", "recovery", "body_composition"],
    trust_level: "high",
    rate_limit_per_minute: 20,
    requires_api_key: false,
    robots_policy_required: false,
    allowed_content: "open_full_text",
    notes:
      "Only open access content should be used. Connector stores metadata/abstract unless license is clear.",
  },
  {
    id: "crossref",
    name: "Crossref metadata",
    type: "api",
    enabled: true,
    base_url: "https://api.crossref.org",
    topics: ["training", "nutrition", "recovery", "supplements"],
    trust_level: "medium",
    rate_limit_per_minute: 30,
    requires_api_key: false,
    robots_policy_required: false,
    allowed_content: "metadata_only",
    notes: "Metadata only. Set CROSSREF_MAILTO for polite pool access.",
  },
  {
    id: "openalex",
    name: "OpenAlex metadata",
    type: "api",
    enabled: true,
    base_url: "https://api.openalex.org",
    topics: [
      "training",
      "nutrition",
      "recovery",
      "body_composition",
      "supplements",
    ],
    trust_level: "medium",
    rate_limit_per_minute: 30,
    requires_api_key: false,
    robots_policy_required: false,
    allowed_content: "metadata_only",
    notes:
      "Metadata and abstract inverted index when available. Set RESEARCH_CONTACT_EMAIL for polite pool.",
  },
  {
    id: "issn_position_stands",
    name: "ISSN (International Society of Sports Nutrition) Position Stands",
    // No dedicated ISSN API exists — JISSN (the society's journal) is a
    // fully open-access, PMC-indexed journal, so its Position Stand
    // articles (protein, creatine, caffeine, diets/body composition, etc.)
    // are actually retrieved through the existing pmc/pubmed connectors
    // above by PMID/DOI, not a separate scraper. This entry exists so the
    // allowlist explicitly documents ISSN as an in-scope publisher/topic
    // (see docs/TRAINING_KNOWLEDGE_BASE_PLAN.md §2.1), rather than relying
    // on an implicit assumption that "PubMed already covers everything".
    type: "manual_dataset",
    enabled: true,
    base_url: "manual://issn-jissn-position-stands",
    topics: ["nutrition", "supplements", "body_composition", "training"],
    trust_level: "high",
    rate_limit_per_minute: 0,
    requires_api_key: false,
    robots_policy_required: false,
    allowed_content: "manual_summary",
    notes:
      "Position stands are peer-reviewed JISSN articles retrieved via the pubmed/pmc connectors by PMID/DOI. Manual summaries only when full text isn't open access.",
  },
  {
    id: "official_guidelines_manual",
    name: "Official guideline pages and manual curated sources",
    type: "manual_dataset",
    enabled: true,
    base_url: "manual://official-guidelines",
    topics: ["guidelines", "safety", "public_health"],
    trust_level: "high",
    rate_limit_per_minute: 0,
    requires_api_key: false,
    robots_policy_required: false,
    allowed_content: "manual_summary",
    notes: "Manual summaries only. Do not copy copyrighted full text.",
  },
  {
    id: "allowlisted_webpage",
    name: "Allowlisted webpages",
    type: "webpage",
    enabled: false,
    base_url: "https://example.org",
    topics: ["guidelines"],
    trust_level: "low",
    rate_limit_per_minute: 10,
    requires_api_key: false,
    robots_policy_required: true,
    allowed_content: "metadata_only",
    notes:
      "Disabled by default. Requires explicit allowlist and robots.txt check.",
  },
];

export function enabledResearchSources(): ResearchSource[] {
  return researchSources.filter((source) => source.enabled);
}

export function validateSourceRegistry(
  sources: ResearchSource[] = researchSources,
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const source of sources) {
    if (!source.id) errors.push("source_missing_id");
    if (ids.has(source.id)) errors.push(`duplicate_source_id:${source.id}`);
    ids.add(source.id);
    if (!source.name) errors.push(`source_missing_name:${source.id}`);
    if (!source.base_url) errors.push(`source_missing_base_url:${source.id}`);
    if (source.type === "webpage" && !source.robots_policy_required)
      errors.push(`webpage_requires_robots_policy:${source.id}`);
    if (source.rate_limit_per_minute < 0)
      errors.push(`negative_rate_limit:${source.id}`);
  }
  return errors;
}
