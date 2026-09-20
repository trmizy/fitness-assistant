import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const dir = 'test/codex-ai-coach-release-readiness';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const all = [...new Set([...git('diff','--name-only').split('\n'), ...git('ls-files','--others','--exclude-standard').split('\n')])].filter(Boolean).sort();
const classify = f => /^docs\/codex-|^test\/codex-/.test(f) ? 'Codex evidence' : /^docs\/aws-|^scripts\/data-migration-|^infra\/data-migration-importer\/|^test\/inbody_duy\//.test(f) ? 'unrelated' : /^\.github\/|^scripts\/ci-/.test(f) ? 'CI' : f.startsWith('docs/') ? 'docs' : /__tests__|^test\//.test(f) ? 'tests' : f.includes('/results/') ? 'generated' : 'production';
const product = all.filter(f => !['Codex evidence','unrelated','CI','generated'].includes(classify(f)) && !f.startsWith('test/ai-coach-production-readiness/') && f !== 'docs/ai-coach-production-demo-readiness.md');
if (process.argv.includes('--tree')) {
  const index = path.join(tmpdir(), `codex-release-index-${Date.now()}`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  const g = (...args) => execFileSync('git', args, { env, encoding:'utf8' }).trim();
  g('read-tree','HEAD'); g('add','--',...product);
  const hash = createHash('sha256');
  for (const f of product) hash.update(f).update('\0').update(readFileSync(f)).update('\0');
  const manifest = { head: git('rev-parse','HEAD'), tree: g('write-tree'), contentSha256: hash.digest('hex'), algorithm: 'SHA256(sorted path + NUL + raw bytes + NUL)', productFileCount: product.length, product, classification: all.map(file => ({ file, class: classify(file) })) };
  writeFileSync(`${dir}/tree.json`, JSON.stringify(manifest,null,2));
  console.log(JSON.stringify({ ...manifest, product: undefined, classification: undefined }));
} else {
  const base = 'postgresql://gymcoach_test:gymcoach_test_password@localhost:55433';
  const env = { ...process.env, NODE_ENV:'test', LLM_PROVIDER:'mock', REDIS_HOST:'localhost', REDIS_PORT:'56379', FITNESS_DISABLE_REDIS:'true', DATABASE_URL:`${base}/gymcoach_ai_test?schema=public` };
  const gates = [
    ['workflow', ['backend/services/ai-service/src/__tests__/agent-workflow-*.test.ts','backend/services/ai-service/src/__tests__/nutrition-food-exclusion.test.ts','backend/services/ai-service/src/__tests__/slot-values-parsers.test.ts']],
    ['focused', ['backend/services/ai-service/src/__tests__/fitness-agent-*.test.ts','backend/services/ai-service/src/__tests__/training-program-scoring*.test.ts','backend/services/ai-service/src/__tests__/*plan-invariant.test.ts','backend/services/ai-service/src/llm/__tests__/memory*.test.ts','backend/services/ai-service/src/llm/__tests__/*claims.test.ts','backend/services/ai-service/src/llm/__tests__/recommendation_narrator.test.ts']],
    ['fitness', ['backend/services/fitness-service/src/__tests__/nutrition-target-resolution.integration.test.ts','backend/services/fitness-service/src/__tests__/nutrition-onboarding-bootstrap.integration.test.ts','backend/services/fitness-service/src/__tests__/nutrition-bootstrap.engine.test.ts','backend/services/fitness-service/src/__tests__/agent-program-equipment-semantics.test.ts','backend/services/fitness-service/src/__tests__/agent-program-apply-idempotency.test.ts']],
    ['user', ['backend/services/user-service/src/__tests__/agentic-contract-idempotency.test.ts','backend/services/user-service/src/__tests__/client-journey-derivation-idempotency.test.ts']],
  ];
  for (const [name, files] of gates) {
    const e = { ...env };
    if (name === 'fitness') e.DATABASE_URL = e.FITNESS_DATABASE_URL = `${base}/gymcoach_fitness_test?schema=public`;
    if (name === 'user') e.DATABASE_URL = `${base}/gymcoach_user_test?schema=public`;
    const r = spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','--test','--test-force-exit',...files],{env:e,encoding:'utf8',timeout:180000,maxBuffer:10000000});
    writeFileSync(`${dir}/${name}.txt`,`${r.stdout ?? ''}\n${r.stderr ?? ''}`);
    console.log(JSON.stringify({gate:name,exit:r.status,error:r.error?.message,summary:(r.stdout??'').split('\n').filter(l=>/^[ℹ#] (tests|pass|fail|skipped)/.test(l))}));
  }
  const r = spawnSync(process.execPath,['scripts/ci-check-foundation-evaluator.mjs'],{env,encoding:'utf8',timeout:120000});
  writeFileSync(`${dir}/foundation.txt`,`${r.stdout}\n${r.stderr}`); console.log({gate:'foundation',exit:r.status,output:r.stdout});
}
