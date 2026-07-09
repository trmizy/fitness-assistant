import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText } from '../knowledge-pipeline/chunking';
import { stableUuid } from '../knowledge-pipeline/hash';
import { DEFAULT_KNOWLEDGE_SOURCES } from '../knowledge-pipeline/source-registry';
import {
  classifyTopic,
  computeQualityScore,
  computeTrustScore,
  detectSafetyIssue,
  processKnowledgeDocument,
  statusForProcessedDocument,
} from '../knowledge-pipeline/scoring';
import { parsePubMedDocumentsFromXml } from '../knowledge-pipeline/pubmed';
import { parseRssDocumentsFromXml } from '../knowledge-pipeline/rss';
import { parseSafetyJudgeResponse } from '../knowledge-pipeline/safety-judge';
import { isAllowedByRobots, parseWebDocumentFromHtml } from '../knowledge-pipeline/web';
import type { RawKnowledgeDocument } from '../knowledge-pipeline/types';

function sampleDoc(overrides: Partial<RawKnowledgeDocument> = {}): RawKnowledgeDocument {
  return {
    sourceId: 'source-local-evidence',
    url: 'https://doi.org/10.1186/example',
    title: 'ISSN Protein Position Stand',
    author: null,
    language: 'en',
    contentHash: 'hash',
    rawObjectKey: 'data/processed/evidence/issn-protein.jsonl#chunk-1',
    cleanText: 'Protein intake for physically active individuals is commonly described in g/kg/day. Resistance training and total daily protein are key drivers of muscle gain.',
    sourceFile: 'data/processed/evidence/issn-protein.jsonl',
    sourceType: 'paper',
    evidenceLevel: 'expert_consensus',
    tags: ['protein', 'nutrition', 'ISSN'],
    publishedAt: null,
    ...overrides,
  };
}

describe('knowledge pipeline pure helpers', () => {
  it('creates stable UUIDs suitable for Qdrant point IDs', () => {
    const id = stableUuid('same-input');
    assert.equal(id, stableUuid('same-input'));
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('registers local evidence as a tier-1 source', () => {
    const local = DEFAULT_KNOWLEDGE_SOURCES.find((source) => source.id === 'source-local-evidence');
    assert.equal(local?.sourceType, 'LOCAL');
    assert.equal(local?.trustTier, 1);
  });

  it('chunks long text with overlap-friendly boundaries', () => {
    const text = Array.from({ length: 80 }, (_, i) => `Sentence ${i} about resistance training.`).join(' ');
    const chunks = chunkText(text, 300, 50);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((chunk) => chunk.text.length > 80));
    assert.ok(chunks.every((chunk) => chunk.tokenCount > 0));
  });

  it('classifies nutrition evidence from title, tags, and body text', () => {
    assert.equal(classifyTopic(sampleDoc()), 'NUTRITION');
  });

  it('classifies BIA and body composition guidelines without treating clinical as injury', () => {
    assert.equal(classifyTopic(sampleDoc({
      title: 'ESPEN BIA Guidelines Part I',
      cleanText: 'Clinical practice guideline for bioelectrical impedance analysis, body composition, fat-free mass, fat mass, and total body water measurement conditions.',
      tags: ['BIA', 'body composition'],
    })), 'BODY_COMPOSITION');
  });

  it('keeps trusted guideline-like local evidence above accept threshold', () => {
    const doc = sampleDoc();
    assert.ok(computeTrustScore(doc, 1) >= 0.9);
    assert.ok(computeQualityScore(doc) >= 0.6);
  });

  it('detects unsafe medical or PED advice', () => {
    const hit = detectSafetyIssue('Use clenbuterol and anabolic steroid cycles for fast fat loss.');
    assert.equal(hit.unsafe, true);
    assert.equal(hit.reason, 'unsafe_drug_or_ped_advice');
  });

  it('rejects unsafe processed documents', () => {
    const processed = processKnowledgeDocument(
      sampleDoc({ cleanText: 'Stop taking medication and use anabolic steroid cycles to cure disease.' }),
      1,
    );
    assert.equal(statusForProcessedDocument(processed), 'reject');
  });

  it('parses PubMed XML into raw knowledge documents', () => {
    const xml = `
      <PubmedArticleSet>
        <PubmedArticle>
          <MedlineCitation>
            <PMID>123456</PMID>
            <Article>
              <ArticleTitle>Resistance training and muscle hypertrophy</ArticleTitle>
              <Journal><Title>Journal of Strength Research</Title><JournalIssue><PubDate><Year>2024</Year><Month>Jan</Month><Day>15</Day></PubDate></JournalIssue></Journal>
              <AuthorList><Author><LastName>Smith</LastName><Initials>J</Initials></Author></AuthorList>
              <Abstract>
                <AbstractText>Resistance training volume and progressive overload are associated with muscle hypertrophy outcomes in trained adults. This abstract is intentionally long enough to pass the minimum parser threshold for ingestion.</AbstractText>
              </Abstract>
              <PublicationTypeList><PublicationType>Journal Article</PublicationType></PublicationTypeList>
            </Article>
            <MeshHeadingList><MeshHeading><DescriptorName>Resistance Training</DescriptorName></MeshHeading></MeshHeadingList>
          </MedlineCitation>
          <PubmedData><ArticleIdList><ArticleId IdType="doi">10.1000/example</ArticleId></ArticleIdList></PubmedData>
        </PubmedArticle>
      </PubmedArticleSet>
    `;

    const docs = parsePubMedDocumentsFromXml(xml);
    assert.equal(docs.length, 1);
    assert.equal(docs[0].sourceId, 'source-pubmed-eutils');
    assert.equal(docs[0].url, 'https://doi.org/10.1000/example');
    assert.equal(docs[0].title, 'Resistance training and muscle hypertrophy');
    assert.ok(docs[0].tags.includes('Resistance Training'));
  });

  it('parses RSS XML into raw knowledge documents', () => {
    const xml = `
      <rss><channel>
        <item>
          <title>Strength training for beginners</title>
          <link>https://example.com/strength-training-beginners</link>
          <description><![CDATA[<p>Beginner resistance training should start with manageable volume, progressive overload, and attention to technique. This description is long enough to become a candidate document for the knowledge pipeline.</p>]]></description>
          <category>Training</category>
          <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
        </item>
      </channel></rss>
    `;

    const docs = parseRssDocumentsFromXml(xml, {
      id: 'source-nsca-feed',
      name: 'NSCA Articles Feed',
      baseUrl: 'https://example.com/feed',
      sourceType: 'RSS',
      trustTier: 2,
      isActive: true,
    });

    assert.equal(docs.length, 1);
    assert.equal(docs[0].sourceId, 'source-nsca-feed');
    assert.equal(docs[0].title, 'Strength training for beginners');
    assert.equal(docs[0].tags[0], 'Training');
  });

  it('parses readable web HTML into a raw knowledge document', () => {
    const html = `
      <html>
        <head>
          <title>ACSM Strength Training Topic</title>
          <meta name="description" content="Evidence-informed strength training guidance." />
          <meta name="keywords" content="strength training, resistance exercise" />
        </head>
        <body>
          <nav>Navigation should be removed</nav>
          <main>
            <h1>Strength training for health</h1>
            <p>Adults can benefit from resistance training that targets major muscle groups with progressive overload and appropriate recovery between sessions.</p>
            <p>Training programs should consider experience level, safety, technique, and individual medical conditions before increasing load or volume.</p>
            <p>For beginners, starting with moderate volume and consistent practice is more useful than overly aggressive routines.</p>
          </main>
        </body>
      </html>
    `;

    const doc = parseWebDocumentFromHtml(html, {
      id: 'source-acsm-topics',
      name: 'ACSM',
      baseUrl: 'https://example.com/strength',
      sourceType: 'WEB',
      trustTier: 2,
      isActive: true,
    });

    assert.ok(doc);
    assert.equal(doc.sourceId, 'source-acsm-topics');
    assert.equal(doc.title, 'Strength training for health');
    assert.ok(doc.tags.includes('strength training'));
    assert.ok(doc.cleanText.includes('progressive overload'));
  });

  it('applies basic robots allow/disallow precedence', () => {
    assert.equal(isAllowedByRobots('https://example.com/private/page', { allow: [], disallow: ['/private'] }), false);
    assert.equal(isAllowedByRobots('https://example.com/private/public/page', { allow: ['/private/public'], disallow: ['/private'] }), true);
  });

  it('parses LLM safety judge JSON safely', () => {
    const parsed = parseSafetyJudgeResponse('{"safe":false,"reason":"unsafe supplement dosage","category":"supplement"}');
    assert.deepEqual(parsed, {
      safe: false,
      reason: 'unsafe supplement dosage',
      category: 'supplement',
    });
    assert.equal(parseSafetyJudgeResponse('not json'), null);
  });
});
