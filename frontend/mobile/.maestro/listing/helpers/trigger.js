// Maestro runScript helper: talks to h-package-trigger.mjs (localhost). Env from the flow: ACTION = state | change | restore.
// Exposes the answer to the flow as output.<field> (pkgRegex, oldPriceRegex, newPriceRegex, sessionMode, ...).
var base = typeof TRIGGER_URL !== 'undefined' && TRIGGER_URL ? TRIGGER_URL : 'http://127.0.0.1:8765';
var res = ACTION === 'state'
  ? http.get(base + '/state')
  : http.post(base + '/' + ACTION, { headers: { 'content-type': 'application/json' }, body: '{}' });
if (!res.ok) {
  throw new Error('trigger ' + ACTION + ' failed: HTTP ' + res.status + ' ' + res.body);
}
var data = json(res.body);
if (ACTION === 'change' && data.changed !== true) {
  throw new Error('package price was not changed - refusing to press buy');
}
for (var key in data) {
  output[key] = data[key];
}
