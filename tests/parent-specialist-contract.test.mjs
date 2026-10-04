import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { createParentDatabaseFixture } from './parent-database-fixture.mjs';
import { renderParentPortalSpecialist, renderParentSessionReportEditor } from '../parent-specialist.js';

// Execute real SQL for every selected/filtered/ordered column, including empty tables.
// Serial role changes avoid mixing PostgreSQL session identity in concurrent UI reads.
function databaseClient(h) {
  const calls=[];let chain=Promise.resolve(),delay;
  const serial=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p;};
  const identifier=v=>{assert.match(v,/^[a-z_]+$/);return '"'+v+'"';};
  const sb={from(table){let op='select',columns='*',payload,one=false,orders=[],filters=[];
    const q={select(v){columns=v;return q},eq(k,v){filters.push([k,v]);return q},order(k,{ascending=true}={}){orders.push([k,ascending]);return q},insert(v){op='insert';payload=v;return q},update(v){op='update';payload=v;return q},delete(){op='delete';return q},single(){one=true;return q},then(resolve,reject){return serial(async()=>{
      const args=[],value=v=>{args.push(v);return '$'+args.length;};const selected=columns==='*'?'*':columns.split(',').map(identifier).join(',');
      const where=()=>filters.length?' where '+filters.map(([k,v])=>identifier(k)+'='+value(v)).join(' and '):'';
      let sql;
      if(op==='select')sql='select '+selected+' from '+identifier(table)+where()+(orders.length?' order by '+orders.map(([k,a])=>identifier(k)+(a?' asc':' desc')).join(','):'');
      if(op==='delete')sql='delete from '+identifier(table)+where()+' returning '+selected;
      if(op==='update')sql='update '+identifier(table)+' set '+Object.entries(payload).map(([k,v])=>identifier(k)+'='+value(v)).join(',')+where()+' returning '+selected;
      if(op==='insert'){const rows=Array.isArray(payload)?payload:[payload],keys=Object.keys(rows[0]);sql='insert into '+identifier(table)+'('+keys.map(identifier).join(',')+') values '+rows.map(r=>'('+keys.map(k=>value(r[k])).join(',')+')').join(',')+' returning '+selected;}
      calls.push({table,op,columns,orders,filters,payload,sql});
      try {const rows=await h.as('authenticated',h.specialist,()=>h.query(sql,args));if(one&&rows.length!==1)throw Error('Expected one owned row');return {data:one?rows[0]:rows,error:null};} catch(error){calls.at(-1).error=error;return {data:null,error};}
    }).then(resolve,reject);}};return q;},functions:{async invoke(name,{body}){
      calls.push({name,body});if(delay)return delay(name,body);
      try {
        if(name==='revoke-parent-access') {
          assert.deepEqual(Object.keys(body),['access_id']);
          assert.equal((await serial(()=>h.as('authenticated',h.specialist,()=>h.query('select id from parent_child_access where id=$1 and therapist_id=$2',[body.access_id,h.specialist])))).length,1);
          await serial(()=>h.as('service_role',null,()=>h.scalar('select revoke_parent_access_record($1,$2)',[h.specialist,body.access_id])));
          return {data:{ok:true},error:null};
        }
        assert.equal(name,'generate-parent-report-pdf');assert.deepEqual(Object.keys(body).sort(),['report_id','report_kind']);
        const claim=await serial(()=>h.as('service_role',null,()=>h.scalar('select claim_parent_publication($1,$2,$3)',[h.specialist,body.report_id,body.report_kind])));
        if(claim.publication_status==='published')return {data:{publication_status:'published'}};
        const path=`${h.specialist}/parent-reports/${body.report_kind}/${body.report_id}/${claim.revision}.pdf`;
        await serial(()=>h.query("insert into storage.objects(bucket_id,name,version,metadata) values('patient-media',$1,'v1','{}')",[path]));
        await serial(()=>h.as('service_role',null,()=>h.scalar('select complete_parent_publication($1,$2,$3,$4,$5,$6,$7)',[h.specialist,body.report_id,body.report_kind,claim.claim_id,claim.revision,'a'.repeat(64),'[]'])));
        return {data:{publication_status:'published'},error:null};
      } catch(error){return {error};}
    }}};
  return {sb,calls,idle:()=>chain,setDelay(fn){delay=fn}};
}
function surface(h,client) {
 const window=new Window();window.document.body.innerHTML='<main></main>';window.confirm=()=>true;
 let current=true,refreshes=0;
 const root=window.document.querySelector('main');
 const options={root,sb:client.sb,user:{id:h.specialist},patient:{id:h.childA,therapist_id:h.specialist},contacts:[],isCurrent:()=>current,refresh:async()=>{refreshes++}};
 return {root,window,options,setCurrent(v){current=v},get refreshes(){return refreshes}};
}
async function act(root,selector){const button=root.querySelector(selector);assert.ok(button,selector);await button.onclick();}

test('specialist UI executes migrated schema and retained-access/version/lease contracts',async t=>{
 const h=await createParentDatabaseFixture();
 try {
  // Complete only source columns omitted by the minimal shared fixture, using001 declarations verbatim.
  const baseline=await readFile(new URL('../supabase/migrations/20260920_001_app_schema.sql',import.meta.url),'utf8');
  for(const [table,names] of [['goals',['created_at']],['sessions',['created_at','session_date']],['patient_media',['captured_at','created_at']]]) {
   const body=baseline.split('CREATE TABLE public.'+table+' (')[1].split('\n);')[0];
   for(const name of names){const declaration=body.split('\n').find(line=>line.trim().startsWith(name+' ')).trim().replace(/,$/,'');await h.db.exec('alter table '+table+' add column '+declaration);}
  }
  for(const name of ['20261003_011_parent_role_boundaries.sql','20261003_012_parent_publication_archive.sql'])await h.db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
  const client=databaseClient(h);
  await t.test('every portal query compiles against actual schema even with empty access and reports',async()=>{
   await h.query('delete from parent_child_access');const v=surface(h,client);await renderParentPortalSpecialist(v.options);await client.idle();
   assert.match(v.root.textContent,/Кабинет родителя/);assert.doesNotMatch(v.root.textContent,/Не удалось загрузить/);
   assert.deepEqual(client.calls.filter(x=>x.error).map(x=>[x.sql,x.error.code]),[]);
   assert.deepEqual(client.calls.find(x=>x.table==='parent_child_access').orders,[['granted_at',false]]);
  });
  await t.test('actual deleted contact retains active access, visible confirmed revoke, and stale revoke cannot refresh',async()=>{
   const [{id:contact}]=await h.query("insert into patient_contacts(id,patient_id,therapist_id,full_name,email) values(gen_random_uuid(),$1,$2,'Анна Смирнова','anna@example.test') returning id",[h.childA,h.specialist]);
   const [{id:access}]=await h.query('insert into parent_child_access(parent_user_id,patient_id,therapist_id,contact_id) values($1,$2,$3,$4) returning id',[h.parentA,h.childA,h.specialist,contact]);
   await h.as('authenticated',h.specialist,()=>h.query('delete from patient_contacts where id=$1',[contact]));
   assert.deepEqual(await h.query('select contact_id,status from parent_child_access where id=$1',[access]),[{contact_id:null,status:'active'}]);
   assert.equal(await h.as('authenticated',h.parentA,()=>h.scalar('select parent_has_active_access($1,$2)',[h.parentA,h.childA])),true);
   const v=surface(h,client);await renderParentPortalSpecialist(v.options);await client.idle();assert.match(v.root.textContent,/Контакт удалён/);assert.match(v.root.textContent,/Активирован/);
   v.window.confirm=()=>false;await act(v.root,'[data-revoke]');assert.equal((await h.query('select status from parent_child_access where id=$1',[access]))[0].status,'active');
   v.window.confirm=()=>true;await act(v.root,'[data-revoke]');assert.equal((await h.query('select status from parent_child_access where id=$1',[access]))[0].status,'revoked');
   assert.deepEqual(client.calls.find(x=>x.name==='revoke-parent-access').body,{access_id:access});
   await h.query("update parent_child_access set status='active',revoked_at=null,revoked_by=null where id=$1",[access]);
   const stale=surface(h,client);await renderParentPortalSpecialist(stale.options);let finish;client.setDelay(()=>new Promise(r=>finish=r));const pending=stale.root.querySelector('[data-revoke]').onclick();await Promise.resolve();stale.setCurrent(false);stale.root.textContent='new child';finish({data:{ok:true}});await pending;assert.equal(stale.refreshes,0);assert.equal(stale.root.textContent,'new child');client.setDelay(null);
  });
  const [{id:sessionId}]=await h.query("insert into sessions(patient_id,therapist_id,note) values($1,$2,'PRIVATE SOURCE') returning id",[h.childA,h.specialist]);
  const session={id:sessionId,patient_id:h.childA,therapist_id:h.specialist};
  await t.test('older published session version remains selectable and explicitly archived while new draft survives',async()=>{
   const [{id:old}]=await h.query("insert into parent_session_reports(patient_id,therapist_id,session_id,what_did,created_at) values($1,$2,$3,'Old published',now()-interval '1 day') returning id",[h.childA,h.specialist,sessionId]);
   await client.sb.functions.invoke('generate-parent-report-pdf',{body:{report_id:old,report_kind:'session'}});
   const [{id:draft}]=await h.query("insert into parent_session_reports(patient_id,therapist_id,session_id,what_did) values($1,$2,$3,'New draft') returning id",[h.childA,h.specialist,sessionId]);
   const before=(await h.query('select * from parent_session_reports where id=$1',[old]))[0];
   const v=surface(h,client);await renderParentSessionReportEditor({...v.options,session});assert.equal(v.root.querySelector('[name=what_did]').value,'New draft');
   await act(v.root,`[data-session-version="${old}"]`);assert.equal(v.root.querySelector('[name=what_did]').value,'Old published');assert.ok(v.root.querySelector('[name=what_did]').readOnly);
   const portalBefore=surface(h,client);await renderParentPortalSpecialist(portalBefore.options);await act(portalBefore.root,`[data-session="${sessionId}"]`);await act(portalBefore.root,`[data-session-version="${old}"]`);assert.ok(portalBefore.root.querySelector('[data-archive-report]'));
   // Execute the actual app session-history entrypoint with the real editor/client.
   const appEntry=surface(h,client);appEntry.root.innerHTML=`<button data-parent-session="${sessionId}"></button>`;
   const appSource=await readFile(new URL('../app.js',import.meta.url),'utf8'),start=appSource.indexOf('    const parentSessionRoot = document.createElement'),end=appSource.indexOf("    const form = document.getElementById('sessionForm')",start);let mounted;
   const env={document:appEntry.window.document,box:appEntry.root,state:{sessions:[session]},accountIsCurrent:appEntry.options.isCurrent,sb:client.sb,accountUserId:h.specialist,SUPABASE_URL:'https://auth.fizira.com',p:appEntry.options.patient,refreshParentControls:appEntry.options.refresh,renderParentSessionReportEditor(o){mounted=renderParentSessionReportEditor(o)}};
   new Function('env',`with(env){${appSource.slice(start,end)}}`)(env);appEntry.root.querySelector('[data-parent-session]').click();await mounted;
   await act(appEntry.root,`[data-session-version="${old}"]`);assert.equal(appEntry.root.querySelector('[name=what_did]').value,'Old published');
   await act(appEntry.root,'[data-archive-report]');const after=(await h.query('select * from parent_session_reports where id=$1',[old]))[0];assert.deepEqual({...after,publication_status:'published'},before);
   assert.equal((await h.query('select publication_status,what_did from parent_session_reports where id=$1',[draft]))[0].publication_status,'draft');
   assert.deepEqual(await h.as('authenticated',h.parentA,()=>h.scalar('select parent_portal_report($1)',[old])),{report:null});
   const portal=surface(h,client);await renderParentPortalSpecialist(portal.options);await act(portal.root,`[data-session="${sessionId}"]`);assert.ok(portal.root.querySelector(`[data-session-version="${old}"]`));
   const invalid=surface(h,client);await renderParentSessionReportEditor({...invalid.options,session,reportId:h.childB});assert.equal(invalid.root.querySelector('textarea'),null);assert.match(invalid.root.textContent,/Версия отчёта недоступна/);
  });
  await t.test('live lease recovery is server-refused; expired recovery publishes without any author or media write',async()=>{
   const [{id}]=await h.query("insert into parent_session_reports(patient_id,therapist_id,session_id,what_did) values($1,$2,$3,'Recovery text') returning id",[h.childA,h.specialist,sessionId]);
   await h.as('service_role',null,()=>h.scalar('select claim_parent_publication($1,$2,$3)',[h.specialist,id,'session']));
   const v=surface(h,client);await renderParentSessionReportEditor({...v.options,session,reportId:id});const start=client.calls.length;await act(v.root,'[data-recover-report]');assert.match(v.root.textContent,/Повторная генерация недоступна/);
   assert.equal((await h.query('select publication_status from parent_session_reports where id=$1',[id]))[0].publication_status,'publishing');
   await h.query("update parent_session_reports set publication_claimed_at=now()-interval '16 minutes' where id=$1",[id]);
   await act(v.root,'[data-recover-report]');assert.equal((await h.query('select publication_status,what_did from parent_session_reports where id=$1',[id]))[0].publication_status,'published');assert.equal(v.refreshes,1);
   assert.deepEqual(client.calls.slice(start).filter(x=>x.op&&x.op!=='select'),[]);
   assert.deepEqual(client.calls.slice(start).find(x=>x.name==='generate-parent-report-pdf').body,{report_id:id,report_kind:'session'});
   const [{id:pendingId}]=await h.query('insert into parent_session_reports(patient_id,therapist_id,session_id) values($1,$2,$3) returning id',[h.childA,h.specialist,sessionId]);await h.as('service_role',null,()=>h.scalar('select claim_parent_publication($1,$2,$3)',[h.specialist,pendingId,'session']));
   const stale=surface(h,client);await renderParentSessionReportEditor({...stale.options,session,reportId:pendingId});let finish;client.setDelay(()=>new Promise(r=>finish=r));const pending=stale.root.querySelector('[data-recover-report]').onclick();await Promise.resolve();stale.setCurrent(false);stale.root.textContent='new child';finish({data:{publication_status:'published'}});await pending;assert.equal(stale.refreshes,0);assert.equal(stale.root.textContent,'new child');client.setDelay(null);
  });
  await t.test('initial-report tab also recovers an expired lease with the exact initial ID/kind',async()=>{
   const [{id}]=await h.query("insert into parent_reports(patient_id,therapist_id,complaint) values($1,$2,'Initial recovery') returning id",[h.childA,h.specialist]);
   await h.as('service_role',null,()=>h.scalar('select claim_parent_publication($1,$2,$3)',[h.specialist,id,'initial']));
   await h.query("update parent_reports set publication_claimed_at=now()-interval '16 minutes' where id=$1",[id]);
   const v=surface(h,client);await renderParentPortalSpecialist(v.options);await act(v.root,`[data-open-initial="${id}"]`);const start=client.calls.length;
   v.window.confirm=()=>false;await act(v.root,'[data-recover-report]');assert.equal(client.calls.slice(start).filter(x=>x.name).length,0);
   v.window.confirm=()=>true;await act(v.root,'[data-recover-report]');assert.deepEqual(client.calls.slice(start).find(x=>x.name).body,{report_id:id,report_kind:'initial'});assert.equal((await h.query('select publication_status,complaint from parent_reports where id=$1',[id]))[0].complaint,'Initial recovery');assert.equal((await h.query('select publication_status from parent_reports where id=$1',[id]))[0].publication_status,'published');assert.deepEqual(client.calls.slice(start).filter(x=>x.op&&x.op!=='select'),[]);
  });
 } finally {await h.db.close();}
});
