const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const repo = path.resolve(__dirname, '../..');
const store = path.join(repo, 'node_modules/.pnpm');
const yaml = require(path.join(store, fs.readdirSync(store).find(p => p.startsWith('js-yaml@4.')), 'node_modules/js-yaml'));
for (const name of ['infra-plan', 'infra-deploy']) {
  const workflow = yaml.load(fs.readFileSync(path.join(repo, '.github/workflows', name + '.yml'), 'utf8'));
  for (const [label, ref, adoption, code, marker] of [
    ['missing adoption blocks before AWS', 'refs/heads/aws-deploy', '', 1, 'CI_ACTIVATION_BLOCKED'],
    ['default branch cannot deploy', 'refs/heads/master', 'true', 1, 'DEPLOY_BRANCH_BLOCKED'],
    ['verified adoption and deployment branch pass preflight', 'refs/heads/aws-deploy', 'true', 0, ''],
  ]) {
    test(name + ': ' + label, () => {
      assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
      const job = workflow.jobs[name === 'infra-plan' ? 'plan' : 'apply'];
      assert.equal(job.needs, 'gate');
      assert.equal(workflow.jobs.gate.environment, undefined);
      assert.equal(workflow.jobs.gate.permissions?.['id-token'], undefined);
      const result = spawnSync('docker', ['run', '--rm', '-e', 'DEPLOY_REF=' + ref, '-e', 'DONE=' + adoption, 'node:20-alpine', 'sh', '-c', workflow.jobs.gate.steps[0].run], { encoding: 'utf8' });
      assert.ifError(result.error);
      assert.equal(result.status, code, result.stdout + result.stderr);
      if (marker) assert.match(result.stdout, new RegExp(marker));
    });
  }
}
