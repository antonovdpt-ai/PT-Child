import test from 'node:test';import assert from 'node:assert/strict';
const id='10000000-0000-4000-8000-000000000001';const media='20000000-0000-4000-8000-000000000002';
const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
const request=body=>new Request('https://edge.invalid',{method:'POST',headers:{origin:'https://app.fizira.com',authorization:'Bearer token','content-type':'application/json'},body:JSON.stringify(body)});
async function fixture(options={}){
 const calls=[];const {parentPublicationHandler,digestBytes}=await import('./parent-publication.ts');const digest=await digestBytes(png);
 const path=`${id}/parent-reports/session/${id}/1/${media}.png`;
 const sdkUrl=options.internalHttp?'http://api-gw:8000':'https://storage.invalid';
 const publicUrl=options.publicUrl||(options.internalHttp?'https://auth.fizira.com':'https://storage.invalid');
 const claim={publication_status:'publishing',claim_id:media,revision:1,snapshot:{schema_version:1,report_kind:'session',revision:1,what_did:'Frozen'},media:[{id:media,storage_path:`${id}/source.png`,source_object:{metadata:{eTag:'"frozen-A"'}}}]};
 let published=false;let objects=new Map([[`${id}/source.png`,png],[path,png]]);
 const deps={fetch:async(url,init)=>{calls.push(['source-http',url,init]);return new Response(options.etagRace?new Uint8Array([...png,66]):png,{headers:{ETag:options.missingEtag?'':options.etagRace?'"new-B"':'"frozen-A"','content-type':'image/png'}});},env:n=>({SUPABASE_URL:sdkUrl,SUPABASE_PUBLIC_URL:publicUrl,SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'})[n],render:async s=>{calls.push(['render',s]);if(options.renderFail)throw Error('private');return new Uint8Array([37,80,68,70,45]);},createClient:(_u,k)=>({
  auth:{getUser:async()=>({data:{user:options.noUser?null:{id}}})},
  from:table=>{calls.push(['from',k,table]);const q={select:()=>q,eq:()=>q,single:async()=>({data:options.denied?null:{id,therapist_id:id}})};return q;},
  rpc:async(name,args)=>{calls.push([name,args]);return {error:options.rpcFail&&name==='complete_parent_publication'?Error('unknown'):null,data:name==='account_is_active'?true:name==='current_app_roles'?[{role:options.parent?'parent':'specialist'}]:name==='parent_portal_report'?{report:options.denied?null:{id,media_ids:[media]}}:name==='claim_parent_publication'?(published?{publication_status:'published',generated_at:'2026-10-03T00:00:00Z'}:claim):name==='resolve_parent_publication_file'?{storage_path:path,sha256:digest,content_type:'image/png'}:name==='complete_parent_publication'?(published=true):name==='fail_parent_publication'?!options.ambiguous:true};},
  storage:{from:()=>({download:async path=>{calls.push(['download',path]);return {data:new Blob([options.corrupt?new Uint8Array([1]):objects.get(path)])};},upload:async(path,bytes,opts)=>{calls.push(['upload',path,opts]);objects.set(path,bytes);return {error:options.uploadFail?Error('private'):null};},remove:async paths=>{calls.push(['remove',paths]);return {};},createSignedUrl:async(path,ttl)=>{calls.push(['sign',path,ttl]);return {data:{signedUrl:`${options.evilUrl?'https://evil.invalid':sdkUrl}/storage/v1/object/sign/patient-media/${path}?token=opaque`}};}})}
 })};return {calls,handler:parentPublicationHandler(options.file?'file':'generate',deps)};
}
test('publication renders frozen claim, copies selected bytes and publishes after all uploads',async()=>{
 const f=await fixture();const r=await f.handler(request({report_id:id,report_kind:'session'}));assert.equal(r.status,200);const b=await r.json();assert.equal(b.publication_status,'published');
 const names=f.calls.map(x=>x[0]);assert.ok(names.indexOf('claim_parent_publication')<names.indexOf('upload'));assert.ok(names.lastIndexOf('upload')<names.indexOf('complete_parent_publication'));
 assert.ok(f.calls.filter(x=>x[0]==='upload').every(x=>x[2].upsert===false));
 const complete=f.calls.find(x=>x[0]==='complete_parent_publication')[1];assert.match(complete.p_media[0].sha256,/^[a-f0-9]{64}$/);
});
test('upload/render failures mark error; ambiguous complete never deletes published/newer claim keys',async()=>{
 for(const options of [{renderFail:true},{uploadFail:true},{rpcFail:true,ambiguous:true}]){
  const f=await fixture(options);assert.equal((await f.handler(request({report_id:id,report_kind:'session'}))).status,503);assert.ok(f.calls.some(x=>x[0]==='fail_parent_publication'));
  if(options.ambiguous)assert.ok(!f.calls.some(x=>x[0]==='remove'));
 }
});
test('parent handoff checks visibility/selection before service, verifies bytes, then signs 300s',async()=>{
 const f=await fixture({file:true,parent:true});const r=await f.handler(request({kind:'photo',report_id:id,media_id:media}));assert.equal(r.status,200);const b=await r.json();assert.deepEqual(Object.keys(b).sort(),['expires_at','url']);assert.equal(f.calls.find(x=>x[0]==='sign')[2],300);
 assert.ok(f.calls.findIndex(x=>x[0]==='parent_portal_report')<f.calls.findIndex(x=>x[0]==='resolve_parent_publication_file'));
 for(const opts of [{denied:true},{corrupt:true},{evilUrl:true}]){const x=await fixture({file:true,parent:true,...opts});assert.notEqual((await x.handler(request({kind:'photo',report_id:id,media_id:media}))).status,200);assert.ok(!x.calls.some(c=>c[0]==='sign')||opts.evilUrl);}
});
test('self-hosted internal signed URLs are mapped only to configured public HTTPS origin',async()=>{
 const f=await fixture({file:true,parent:true,internalHttp:true});const r=await f.handler(request({kind:'photo',report_id:id,media_id:media}));assert.equal(r.status,200);const b=await r.json();
 const u=new URL(b.url);assert.equal(u.origin,'https://auth.fizira.com');assert.ok(u.pathname.startsWith('/storage/v1/object/sign/patient-media/'));assert.equal(u.searchParams.get('token'),'opaque');assert.ok(!b.url.includes('api-gw:8000'));
 for(const publicUrl of ['http://auth.fizira.com','https://auth.fizira.com/base']){const x=await fixture({file:true,parent:true,internalHttp:true,publicUrl});assert.equal((await x.handler(request({kind:'photo',report_id:id,media_id:media}))).status,503);}
});
test('strict browser contracts reject paths/body/kind/oversize and parent generate',async()=>{
 for(const body of [{report_id:id,report_kind:'session',pdf_path:'injected'},{report_id:id,report_kind:'wrong'},{report_id:id,report_kind:'initial',body:'x'.repeat(2000)}]){const f=await fixture();assert.equal((await f.handler(request(body))).status,400);assert.equal(f.calls.length,0);}
 const f=await fixture({parent:true});assert.equal((await f.handler(request({report_id:id,report_kind:'session'}))).status,403);assert.ok(!f.calls.some(x=>x[0]==='claim_parent_publication'));
});
test('network response cap cancels oversized downloads before Blob allocation',async()=>{
 const {boundedResponse}=await import('./parent-publication.ts');assert.equal(typeof boundedResponse,'function');
 await assert.rejects(boundedResponse(new Response('x',{headers:{'content-length':String(11*1024*1024)}})));
 let cancelled=false;
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(6*1024*1024));c.enqueue(new Uint8Array(6*1024*1024));},cancel(){cancelled=true;}});
 const response=await boundedResponse(new Response(stream));await assert.rejects(response.blob());assert.equal(cancelled,true);
});

test('unchanged DB claim A with changed HTTP ETag/bytes B fails before any upload/publication',async()=>{
 for(const options of [{etagRace:true},{missingEtag:true}]){
  const f=await fixture(options);const r=await f.handler(request({report_id:id,report_kind:'session'}));assert.equal(r.status,503);
  assert.ok(f.calls.some(x=>x[0]==='fail_parent_publication'));assert.ok(!f.calls.some(x=>['upload','complete_parent_publication'].includes(x[0])));
 }
});
