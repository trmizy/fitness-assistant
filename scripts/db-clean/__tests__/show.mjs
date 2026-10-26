import fs from 'node:fs';
const m = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const t of m.tables) console.log(t.db.replace('gymcoach_', '').replace(/_dbclean\w*_test/, ''), t.table, t.count, JSON.stringify(t.keys).slice(0, 110));
console.log(JSON.stringify(m.allowlist.keptGymIds), JSON.stringify(m.blockers));
console.log(m.allowlist.preservedRows.map((r) => `${r.table}:${r.entries.length}`).join(' '));
