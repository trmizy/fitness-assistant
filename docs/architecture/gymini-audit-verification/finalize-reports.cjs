/* Consolidate report phases and check artifact consistency; no source writes. */
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const out=__dirname,root=path.resolve(out,'../../..');
const get=p=>JSON.parse(fs.readFileSync(path.join(out,p),'utf8'));
const put=(p,v)=>fs.writeFileSync(path.join(out,p),typeof v==='string'?v:JSON.stringify(v,null,2)+'\n');
const table=(h,rows)=>'| '+h.join(' | ')+' |\n| '+h.map(()=> '---').join(' | ')+' |\n'+rows.map(r=>'| '+r.map(s=>String(s??'NOT_VERIFIED').replaceAll('|','/').replaceAll('\n',' ')).join(' | ')+' |').join('\n')+'\n';
const caps=get('verified-capabilities.json'),gaps=get('verified-gaps.json'),evidence=get('source-evidence.json'),manifest=get('verification-manifest.json');
const refs=ids=>ids.map(id=>`${id}: \`${evidence[id].path}:${evidence[id].line_start}\``).join('; ');
const n=caps.capabilities.filter(c=>c.evidence_refs.length).length;
// Replace phase-one matrix rather than shipping stale rows contradicted by an appendix.
let p='03-capability-verification-matrix.md';
let t=fs.readFileSync(path.join(out,p),'utf8');
const start=t.indexOf('| ID | Claimed status');const end=t.indexOf('\nCác sửa phân loại',start);
if(start>=0&&end>=0)t=t.slice(0,start)+table(['ID','Claimed status','Kết luận độc lập','Nguồn / giới hạn'],caps.capabilities.map(c=>[c.id,c.claimed_status,c.independent_verdict,c.evidence_refs.length?refs(c.evidence_refs):'Inventory-only; NOT_VERIFIED']))+t.slice(end);
put(p,t.replaceAll('32/101',`${n}/101`));
// Regenerate current gap tables from final JSON.
p='04-verified-gap-register.md';t=fs.readFileSync(path.join(out,p),'utf8');
const a=t.indexOf('| ID | Claim');const b=t.indexOf('\nMỗi BDG',a);
if(a>=0&&b>=0)t=t.slice(0,a)+table(['ID','Claim audit gốc','Status độc lập','Loại / mức','Phát hiện và bằng chứng'],gaps.business_gaps.map(g=>[g.id,g.claude_audit_claim,g.verification_status,g.type+' / '+g.severity,g.codex_independent_finding+' '+refs(g.evidence_refs)]))+t.slice(b);
put(p,t);
p='08-production-readiness-reconciliation.md';t=fs.readFileSync(path.join(out,p),'utf8');
const c=t.indexOf('| ID / mức lịch sử');const d=t.indexOf('\nP0 có cơ chế',c);
if(c>=0&&d>=0)t=t.slice(0,c)+table(['ID / mức lịch sử','Status','Bằng chứng và kết luận'],gaps.production_gaps.map(g=>[g.id+' / '+g.original_severity,g.verification_status,g.current_finding+' '+refs(g.evidence_refs)]))+t.slice(d);
put(p,t);
for(const f of fs.readdirSync(out).filter(x=>x.endsWith('.md'))){let s=fs.readFileSync(path.join(out,f),'utf8');s=s.replaceAll('32/101',`${n}/101`).replaceAll('31.7%',`${(n*100/101).toFixed(1)}%`).replace('Hai NEW-GAP source-supported:','Ba NEW-GAP source-supported (gồm NEW-GAP-003 bổ sung phía dưới):').replace('2 NEW-GAP','3 NEW-GAP').replace('New: NEW-GAP-001/002.','New: NEW-GAP-001/002/003.');put(f,s);}
// Do not use test existence as a passing test result.
const expected=new Set([...caps.capabilities.map(x=>x.id),...gaps.business_gaps.map(x=>x.id),...gaps.production_gaps.map(x=>x.id),...gaps.new_gaps.map(x=>x.id)]);
const errors=[];
for(const group of [caps.capabilities,gaps.business_gaps,gaps.production_gaps,gaps.new_gaps])if(new Set(group.map(x=>x.id)).size!==group.length)errors.push('duplicate ID');
for(const row of [...caps.capabilities,...caps.ai_capabilities,...gaps.business_gaps,...gaps.production_gaps,...gaps.new_gaps])for(const ref of row.evidence_refs||[])if(!evidence[ref])errors.push('unknown evidence '+ref);
for(const e of Object.values(evidence)){const text=fs.readFileSync(path.join(root,e.path),'utf8');const len=text.split(/\r?\n/).length;if(e.line_start>len)errors.push(e.id+' invalid start');if(!e.excerpt)errors.push(e.id+' empty excerpt');}
const originalDir='docs/architecture/gymini-full-business-audit';
const originalInputs={};
for(const f of fs.readdirSync(path.join(root,originalDir)).filter(x=>x.endsWith('.json'))){const j=JSON.parse(fs.readFileSync(path.join(root,originalDir,f),'utf8'));const collections=Object.entries(j).filter(([k,v])=>Array.isArray(v)&&v.every(x=>x&&typeof x==='object'&&'id'in x));originalInputs[f]={parse_ok:true,collections:collections.map(([key,values])=>({key,count:values.length,duplicate_ids:values.filter((v,i)=>values.findIndex(x=>x.id===v.id)!==i).map(v=>v.id)}))};}
const checks={artifact_json_validation:errors.length===0,errors,original_inputs:originalInputs,capabilities:101,scoped_traces:n,unverified:caps.unverified_ids.length,ai_scoped:16,bdg:20,g:36,new_gaps:gaps.new_gaps.length,evidence_records:Object.keys(evidence).length,original_record_counts_sum:Object.values(caps.original_status_counts).reduce((a,b)=>a+b,0),note:'Artifact structure checks only, not application regression or correctness tests.'};
put('artifact-validation.json',checks);
const baseline=get('baseline-integrity.json');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const excludedIntegrityPath=p=>/heldout|sealed/i.test(p)||/^(training|data\/eval)\//i.test(p);
const skipped=Object.keys(baseline.initial_file_sha256).filter(excludedIntegrityPath);
const changed=[];for(const [p,h]of Object.entries(baseline.initial_file_sha256)){if(excludedIntegrityPath(p))continue;if(!fs.existsSync(path.join(root,p)))changed.push({path:p,change:'removed'});else if(sha(p)!==h)changed.push({path:p,change:'changed; possible concurrent writer, audit did not write outside report directory'});}
const git=(...args)=>cp.execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
put('integrity-check.json',{start_head:baseline.start_head,end_head:git('rev-parse','HEAD'),existing_files_compared:Object.keys(baseline.initial_file_sha256).length-skipped.length,excluded_from_further_hashing:skipped,changed_existing_files:changed,initial_status:baseline.initial_status,final_status:git('status','--porcelain=v1'),audit_writes:'Only new files under docs/architecture/gymini-audit-verification',integrity_incident:'Initial broad hashing read heldout-named file bytes; see AUDIT_BOUNDARY_INCIDENT.md. No further hashes of heldout/training/data-eval files.'});
manifest.end_head=git('rev-parse','HEAD');manifest.integrity_existing_files_changed=changed.length;manifest.artifact_checks=checks.artifact_json_validation;put('verification-manifest.json',manifest);
const incident={status:'DISCLOSED',heldout_named_file_bytes_read_for_hashing:true,heldout_named_paths:Object.keys(baseline.initial_file_sha256).filter(p=>/heldout|sealed/i.test(p)),content_displayed:false,content_semantically_inspected:false,training_or_evaluation_run:false,modified:false,corrective_action:'Exclude heldout/sealed and all training/data-eval paths from subsequent integrity reads. Do not assert heldout untouched.'};
manifest.sealed_heldout_opened='CANNOT_ASSERT_UNTOUCHED: bytes of Qwen heldout-named files were read by hash-only integrity script';manifest.heldout_integrity_incident=incident;put('verification-manifest.json',manifest);put('boundary-incident.json',incident);
put('AUDIT_BOUNDARY_INCIDENT.md','# Sự cố giới hạn audit\n\nScript fingerprint ban đầu đọc bytes tất cả file tracked/untracked để tính SHA-256. Trong đó có 13 đường dẫn tên heldout, gồm training/semantic-qwen3-4b/datasets/processed/v0, v1, v2/heldout.jsonl. Các lượt đối chiếu ban đầu cũng rehash danh sách này. Đây là lỗi phạm vi thao tác, vượt yêu cầu không mở heldout; không được gọi heldout untouched.\n\nKhông hiển thị, trích nội dung, phân tích câu hỏi/đáp án, train, evaluate hoặc sửa các file này. Bằng chứng nghiệp vụ không dựa trên heldout. Việc đọc bytes để hash vẫn là đọc file và đã được thông báo cho người dùng.\n\nKhắc phục: các script report được sửa để loại heldout/sealed và toàn bộ training/, data/eval/ khỏi integrity reads tiếp theo. Hash lịch sử giữ trong baseline làm provenance của sự cố; không mở lại nội dung để xác minh. source/config/original-audit checks vẫn thực hiện trên tập được phép.\n');
for(const f of ['01-independent-verification-summary.md','11-evidence-and-coverage-manifest.md','VERIFICATION_PROGRESS.md']){let s=fs.readFileSync(path.join(out,f),'utf8');if(!s.includes('AUDIT_BOUNDARY_INCIDENT.md'))s+='\n\n**Sự cố phạm vi:** hashing ban đầu đọc bytes các file tên heldout (gồm Qwen datasets); không hiển thị/dùng nội dung, không train/eval/sửa. Không thể khẳng định heldout untouched. Đã loại khỏi đọc tiếp; xem AUDIT_BOUNDARY_INCIDENT.md.\n';put(f,s);}
if(errors.length)process.exitCode=1;console.log(JSON.stringify({artifact_checks:checks.artifact_json_validation,errors,existing_files_changed:changed.length,start_head:baseline.start_head,end_head:manifest.end_head,source_traces:n,unverified:caps.unverified_ids.length}));
