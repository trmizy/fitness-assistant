// Read-only literature capture for E1. No application imports, ingestion or model clients.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const req = createRequire(path.join(root, 'backend/services/ai-service/package.json'));
const cheerio = req('cheerio');
const dir = path.join(root, 'data/knowledge/scientific-claim-map-v3');
if (fs.existsSync(path.join(dir, 'source-snapshots.json'))) throw new Error('CaptureAlreadyExists: keep pinned E1 sources; do not overwrite');
const review = JSON.parse(fs.readFileSync(path.join(root, 'data/eval/ai-coach-eval-prep/scientific-review-round1.json')));
const archivedPath = 'C:/D_Backup/project_personal/gymini-review-local/followup-evidence/abstracts-snapshot.json';
const archived = JSON.parse(fs.readFileSync(archivedPath));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const text = html => cheerio.load(html.replace(/<(?![A-Za-z/!?])/g, '&lt;'), { xmlMode: true }).root().text().normalize('NFC');
const records = [];
async function get(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Gymini-ClaimMapV3/1.0 (read-only cited-record capture)' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.text();
}
(async () => {
  for (const [pmid, value] of Object.entries(archived)) records.push({ id: 'PMID_' + pmid, pmid, kind: 'PRIMARY_SCIENTIFIC', title: value.title, url: 'https://pubmed.ncbi.nlm.nih.gov/' + pmid + '/',
    bodyText: text(value.abstract), readScope: 'ABSTRACT_ONLY', capturedAt: new Date().toISOString(), captureMethod: 'EXISTING_ASSISTANT_CHECKED_SNAPSHOT_NOT_INDEPENDENT_REVIEW',
    origin: archivedPath + '#/' + pmid, rawPayloadSha256: sha(JSON.stringify(value)), bodySha256: sha(text(value.abstract)) });
  const pmids = [...new Set(review.sources.flatMap(s => (s.pmid || '').split(';').map(x => x.trim()).filter(Boolean)))].filter(id => !archived[id]);
  const query = pmids.map(id => '(EXT_ID:' + id + ' AND SRC:MED)').join(' OR ');
  const url = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&pageSize=100&query=' + encodeURIComponent(query);
  try {
    const raw = await get(url), rows = JSON.parse(raw).resultList.result;
    for (const pmid of pmids) {
      const row = rows.find(r => r.id === pmid && r.source === 'MED');
      if (!row?.abstractText) { console.log('MISSING_ABSTRACT ' + pmid); continue; }
      const body = text(row.abstractText);
      records.push({ id: 'PMID_' + pmid, pmid, kind: 'PRIMARY_SCIENTIFIC', title: row.title, doi: row.doi || null, url: 'https://pubmed.ncbi.nlm.nih.gov/' + pmid + '/', bodyText: body,
        readScope: 'ABSTRACT_ONLY', capturedAt: new Date().toISOString(), captureMethod: 'PRIMARY_RECORD_RETRIEVAL_NOT_SCIENTIFIC_VALIDATION', origin: url,
        rawPayloadSha256: sha(raw), bodySha256: sha(body) });
    }
  } catch (e) { console.log('ABSTRACT_CAPTURE_UNAVAILABLE ' + e.message); }
  const fullUrl = 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC12965823/fullTextXML';
  try {
    const raw = await get(fullUrl), doc = cheerio.load(raw, { xmlMode: true });
    const body = doc('article').text().normalize('NFC');
    if (!body.includes('resistance') || body.length < 10000) throw new Error('Unexpected full text');
    records.push({ id: 'PMC12965823', pmid: '41843416', kind: 'PRIMARY_SCIENTIFIC', title: doc('article-title').first().text(), url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12965823/', bodyText: body,
      readScope: 'FULL_TEXT_PASSAGE_LOOKUP_NOT_FULL_SCIENTIFIC_REVIEW', capturedAt: new Date().toISOString(), captureMethod: 'OPEN_FULL_TEXT_PASSAGE_MATCH_NOT_INDEPENDENT_REVIEW',
      origin: fullUrl, rawPayloadSha256: sha(raw), bodySha256: sha(body), license: doc('permissions').first().text() });
  } catch (e) { console.log('FULL_TEXT_CAPTURE_UNAVAILABLE ' + e.message); }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'source-snapshots.json'), JSON.stringify({ version: 'scientific-source-snapshots-v3', authority: 'PRIMARY_TEXT_CAPTURE_NOT_INDEPENDENT_SCIENTIFIC_VALIDATION', records }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ records: records.length, ids: records.map(r => r.id), realModelCalls: 0, realEmbeddingCalls: 0, vectorDbCalls: 0 }));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
