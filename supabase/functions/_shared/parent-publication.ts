import { ParentPublicError, parentCors, parentJson, uuid } from './parent-portal.ts';
import { renderParentPublicationPdf } from './parent-pdf.ts';
const PUBLIC_ERROR = 'Request could not be completed';
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
type Dependencies = {env:(name:string)=>string|undefined;createClient:(...args:any[])=>any;render?:typeof renderParentPublicationPdf;fetch?:typeof fetch};
export async function boundedResponse(response: Response): Promise<Response> {
  if (Number(response.headers.get('content-length')) > MAX_MEDIA_BYTES) {
    await response.body?.cancel(); throw new Error(PUBLIC_ERROR);
  }
  if (!response.body) return response;
  const reader = response.body.getReader(); let size = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const {done,value} = await reader.read();
        if (done) { reader.releaseLock(); controller.close(); return; }
        size += value.length;
        if (size > MAX_MEDIA_BYTES) { await reader.cancel(); reader.releaseLock(); controller.error(new Error(PUBLIC_ERROR)); return; }
        controller.enqueue(value);
      } catch (error) { controller.error(error); }
    },
    async cancel(reason) { await reader.cancel(reason); reader.releaseLock(); },
  });
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
}
export async function digestBytes(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
export function photoType(bytes: Uint8Array): { contentType:string;extension:string } {
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b)) return {contentType:'image/png',extension:'.png'};
  if (bytes.length >= 3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return {contentType:'image/jpeg',extension:'.jpg'};
  throw new Error(PUBLIC_ERROR);
}
async function readBody(request: Request, operation: string) {
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new ParentPublicError();
  const reader=request.body?.getReader(); if(!reader) throw new ParentPublicError();
  let size=0;const chunks:Uint8Array[]=[];
  try { while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024){await reader.cancel();throw new Error();}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!body||typeof body!=='object'||Array.isArray(body)) throw new Error();
    const keys=operation==='generate'?(body.mode==='export'?['report_id','report_kind','mode']:['report_id','report_kind']):body.kind==='photo'?['kind','report_id','media_id']:['kind','report_id'];
    if(Object.keys(body).length!==keys.length||Object.keys(body).some(k=>!keys.includes(k))) throw new Error();
    uuid(body.report_id);if(operation==='generate'){if(!['initial','session'].includes(body.report_kind))throw new Error();}
    else {if(!['pdf','photo'].includes(body.kind))throw new Error();if(body.kind==='photo')uuid(body.media_id);}
    return body;
  }catch{throw new ParentPublicError();}finally{reader.releaseLock();}
}
async function blobBytes(result: any): Promise<Uint8Array> {
  if(result.error||!result.data||result.data.size<=0||result.data.size>MAX_MEDIA_BYTES)throw new Error(PUBLIC_ERROR);
  return new Uint8Array(await result.data.arrayBuffer());
}
// Export is a read-only owner operation. It never claims/publishes a report or
// creates parent identity/access. Use the actor's JWT and existing RLS for ALL reads.
async function exportOwnedPdf(user: any, body: any, userId: string, deps: Dependencies, cors: Record<string,string>) {
  const fields = body.report_kind==='initial'
    ? ['complaint','strengths','observations','goals','progress','recommendations','therapist_name','therapist_profession','therapist_organization','therapist_phone']
    : ['session_id','what_did','what_worked','attention','home_recommendations'];
  const columns=['id','patient_id','therapist_id','publication_status','publication_revision','published_at','published_snapshot','pdf_storage_path','pdf_sha256','created_at','updated_at',...fields].join(',');
  const table=body.report_kind==='initial'?'parent_reports':'parent_session_reports';
  const read=()=>user.from(table).select(columns).eq('id',body.report_id).eq('therapist_id',userId).single();
  const source=await read();const report=source.data;
  if(source.error||!report||report.id!==body.report_id||report.therapist_id!==userId)throw new ParentPublicError(403);
  if(!['draft','publication_error','published','archived'].includes(report.publication_status))throw new ParentPublicError(409);
  const child=await user.from('patients').select('id,therapist_id,display_name').eq('id',report.patient_id).eq('therapist_id',userId).single();
  if(child.error||!child.data||child.data.id!==report.patient_id||child.data.therapist_id!==userId)throw new ParentPublicError(403);
  const frozen=!!report.published_at;
  let pdf: Uint8Array | undefined;
  if(frozen && report.pdf_sha256) {
    const expected=`${userId}/parent-reports/${body.report_kind}/${body.report_id}/${report.publication_revision}.pdf`;
    if(report.pdf_storage_path!==expected||!/^[a-f0-9]{64}$/.test(report.pdf_sha256))throw new ParentPublicError(403);
    pdf=await blobBytes(await user.storage.from('patient-media').download(expected));
    if(await digestBytes(pdf)!==report.pdf_sha256)throw new Error(PUBLIC_ERROR);
  } else {
    let snapshot=report.published_snapshot;
    // 009 snapshots were unversioned. Reuse only recognized report-bound originals;
    // never fill a legacy publication from current clinical text.
    if(frozen) {
      const paths=[`${userId}/parent-reports/${body.report_kind}/${body.report_id}/${report.publication_revision}.pdf`, `${userId}/parent-reports/${table}/${body.report_id}/${report.publication_revision}.pdf`];
      if(paths.includes(report.pdf_storage_path)) {
        const original=await user.storage.from('patient-media').download(report.pdf_storage_path);
        if(!original.error) {
          pdf=await blobBytes(original);
          if(new TextDecoder().decode(pdf.subarray(0,5))!=='%PDF-')throw new Error(PUBLIC_ERROR);
        }
      }
      if(!pdf) {
        if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))throw new Error(PUBLIC_ERROR);
        snapshot={schema_version:1,report_kind:body.report_kind,revision:report.publication_revision,
          source_date:snapshot.source_date||String(report.created_at).slice(0,10),child_name:snapshot.child_name||'',
          ...Object.fromEntries([...fields.filter(k=>k!=='session_id'),'therapist_name','therapist_profession','therapist_organization','therapist_phone'].map(k=>[k,snapshot[k]]))};
      }
    }
    if(!frozen) {
      snapshot={schema_version:1,report_kind:body.report_kind,revision:report.publication_revision,
        source_date:String(report.created_at).slice(0,10),child_name:child.data.display_name,
        ...Object.fromEntries(fields.filter(k=>k!=='session_id').map(k=>[k,report[k]]))};
      if(body.report_kind==='session') {
        const session=await user.from('sessions').select('id,patient_id,therapist_id,session_date').eq('id',report.session_id).eq('patient_id',report.patient_id).eq('therapist_id',userId).single();
        if(session.error||!session.data)throw new ParentPublicError(403);
        const profile=await user.from('profiles').select('full_name,profession,organization,phone').eq('id',userId).maybeSingle();
        if(profile.error)throw new Error(PUBLIC_ERROR);
        snapshot.source_date=session.data.session_date||snapshot.source_date;
        for(const [key,column] of Object.entries({therapist_name:'full_name',therapist_profession:'profession',therapist_organization:'organization',therapist_phone:'phone'}))snapshot[key]=profile.data?.[column]||null;
      }
    }
    if(!pdf) {
      if(!snapshot||snapshot.report_kind!==body.report_kind)throw new Error(PUBLIC_ERROR);
      pdf=await (deps.render||renderParentPublicationPdf)(snapshot);
    }
  }
  if(!pdf||!pdf.length||pdf.length>MAX_MEDIA_BYTES||new TextDecoder().decode(pdf.subarray(0,5))!=='%PDF-')throw new Error(PUBLIC_ERROR);
  const [checked,active,roles]=await Promise.all([read(),user.rpc('account_is_active'),user.rpc('current_app_roles')]);
  if(checked.error||JSON.stringify(checked.data)!==JSON.stringify(report)||active.error||active.data!==true||roles.error||!roles.data?.some((r:any)=>r.role==='specialist'))throw new ParentPublicError(403);
  return new Response(pdf,{headers:{...cors,'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="Fizira-report.pdf"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}

export function parentPublicationHandler(operation: 'generate'|'file', deps: Dependencies) {
  return async(request:Request):Promise<Response>=>{
    const cors=parentCors(request.headers.get('origin'),deps.env('FIZIRA_ALLOWED_ORIGINS')||'https://app.fizira.com');const origin=cors?.['Access-Control-Allow-Origin']||null;
    let admin:any;let recovery: (()=>any)|undefined;let claim:any;let body:any;let userId='';const attempted:string[]=[];
    // No Promise.race: timeout must not let background uploads escape cleanup.
    const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),110000);
    try {
      if(!cors)throw new ParentPublicError(403);if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'Cache-Control':'no-store'}});
      if(request.method!=='POST')throw new ParentPublicError(405);
      const authorization=request.headers.get('authorization');if(!authorization||!/^Bearer [^\s]+$/i.test(authorization))throw new ParentPublicError(401);
      body=await readBody(request,operation);
      const required=(name:string,alias?:string)=>{const v=deps.env(name)||(alias?deps.env(alias):undefined);if(!v)throw new Error(PUBLIC_ERROR);return v;};
      const url=required('SUPABASE_URL');
      const auth={persistSession:false,autoRefreshToken:false,detectSessionInUrl:false};
      const boundedFetch=async(input:any,init:any={})=>boundedResponse(await (deps.fetch||fetch)(input,{...init,signal:abort.signal}));
      const user=deps.createClient(url,required('SUPABASE_ANON_KEY','ANON_KEY'),{auth,global:{headers:{Authorization:authorization},fetch:boundedFetch}});
      const actor=await user.auth.getUser(authorization.slice(7));if(actor.error||!actor.data?.user?.id)throw new ParentPublicError(401);userId=uuid(actor.data.user.id);
      const active=await user.rpc('account_is_active');if(active.error||active.data!==true)throw new ParentPublicError(403);
      if(operation==='generate'){
        const roles=await user.rpc('current_app_roles');if(roles.error||!roles.data?.some((r:any)=>r.role==='specialist'))throw new ParentPublicError(403);
        const owned=await user.from(body.report_kind==='initial'?'parent_reports':'parent_session_reports').select('id,therapist_id').eq('id',body.report_id).eq('therapist_id',userId).single();
        if(owned.error||!owned.data)throw new ParentPublicError(403);
      }else{
        const visible=await user.rpc('parent_portal_report',{p_report_id:body.report_id});
        if(visible.error||!visible.data?.report||(body.kind==='photo'&&!visible.data.report.media_ids?.includes(body.media_id)))throw new ParentPublicError(403);
      }
      if(operation==='generate'&&body.mode==='export')return await exportOwnedPdf(user,body,userId,deps,cors);
      admin=deps.createClient(url,required('SUPABASE_SERVICE_ROLE_KEY','SERVICE_ROLE_KEY'),{auth,global:{fetch:boundedFetch}});
      recovery=()=>deps.createClient(url,required('SUPABASE_SERVICE_ROLE_KEY','SERVICE_ROLE_KEY'),{auth,global:{fetch:(input:any,init:any={})=>fetch(input,{...init,signal:AbortSignal.timeout(10000)})}});
      const storage=admin.storage.from('patient-media');
      if(operation==='file'){
        const resolved=await admin.rpc('resolve_parent_publication_file',{p_parent_id:userId,p_report_id:body.report_id,p_file_kind:body.kind,p_media_id:body.media_id||null});const record=resolved.data;
        if(resolved.error||!record||!record.storage_path||!/^[a-f0-9]{64}$/.test(record.sha256))throw new ParentPublicError(403);
        const bytes=await blobBytes(await storage.download(record.storage_path));
        if(await digestBytes(bytes)!==record.sha256)throw new Error(PUBLIC_ERROR);
        if(body.kind==='photo'&&photoType(bytes).contentType!==record.content_type)throw new Error(PUBLIC_ERROR);
        if(body.kind==='pdf'&&new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')throw new Error(PUBLIC_ERROR);
        // Repeat the private active-access resolver after the integrity read.
        const checked=await admin.rpc('resolve_parent_publication_file',{p_parent_id:userId,p_report_id:body.report_id,p_file_kind:body.kind,p_media_id:body.media_id||null});
        if(checked.error||JSON.stringify(checked.data)!==JSON.stringify(record))throw new ParentPublicError(403);
        const signed=await storage.createSignedUrl(record.storage_path, 300);
        if(signed.error||!signed.data?.signedUrl)throw new Error(PUBLIC_ERROR);
        const parsed=new URL(signed.data.signedUrl);
        const internal=new URL(url);
        const publicBase=new URL(required('SUPABASE_PUBLIC_URL'));
        if(parsed.origin!==internal.origin||parsed.username||parsed.password||parsed.hash||!parsed.pathname.startsWith('/storage/v1/object/sign/patient-media/'))throw new Error(PUBLIC_ERROR);
        if(publicBase.protocol!=='https:'||publicBase.username||publicBase.password||publicBase.pathname!=='/'||publicBase.search||publicBase.hash)throw new Error(PUBLIC_ERROR);
        const publicSigned=new URL(parsed.pathname+parsed.search,publicBase.origin);
        return parentJson(origin,200,{url:publicSigned.href,expires_at:new Date(Date.now()+300000).toISOString()});
      }
      const claimed=await admin.rpc('claim_parent_publication',{p_therapist_id:userId,p_report_id:body.report_id,p_kind:body.report_kind});
      if(claimed.error||!claimed.data)throw new Error(PUBLIC_ERROR);
      if(claimed.data.publication_status==='published')return parentJson(origin,200,{publication_status:'published',generated_at:claimed.data.generated_at});
      claim=claimed.data;uuid(claim.claim_id);if(!Number.isSafeInteger(claim.revision)||claim.revision<1||!Array.isArray(claim.media)||claim.media.length>100)throw new Error(PUBLIC_ERROR);
      const prefix=`${userId}/parent-reports/${body.report_kind}/${body.report_id}/${claim.revision}`;
      const pdf=await (deps.render||renderParentPublicationPdf)(claim.snapshot);
      if(pdf.length>MAX_MEDIA_BYTES||abort.signal.aborted)throw new Error(PUBLIC_ERROR);
      const artifacts:any[]=[];let total=pdf.length;
      for(const selected of claim.media){
        uuid(selected.id);if(!selected.storage_path.startsWith(`${userId}/`))throw new Error(PUBLIC_ERROR);
        // Bind the actual representation to the claim. A DB metadata check
        // alone cannot detect bytes changed before a pending metadata UPDATE.
        const etag=selected.source_object?.metadata?.eTag;
        if(typeof etag!=='string'||etag.length>256||!/^"[\x21\x23-\x7e]+"$/.test(etag))throw new Error(PUBLIC_ERROR);
        const segments=selected.storage_path.split('/');if(segments.some((s:string)=>!s||s==='.'||s==='..'))throw new Error(PUBLIC_ERROR);
        const objectUrl=`${url.replace(/\/$/,'')}/storage/v1/object/authenticated/patient-media/${segments.map(encodeURIComponent).join('/')}`;
        const response=await boundedFetch(objectUrl,{headers:{Authorization:`Bearer ${required('SUPABASE_SERVICE_ROLE_KEY','SERVICE_ROLE_KEY')}`,apikey:required('SUPABASE_SERVICE_ROLE_KEY','SERVICE_ROLE_KEY'),'If-Match':etag,'Cache-Control':'no-cache'},cache:'no-store',redirect:'error'});
        if(response.status!==200||response.headers.get('etag')!==etag){await response.body?.cancel();throw new Error(PUBLIC_ERROR);}
        const bytes=await blobBytes({data:await response.blob()});
        if(photoType(bytes).contentType!==response.headers.get('content-type')?.split(';')[0].trim().toLowerCase())throw new Error(PUBLIC_ERROR);
        total+=bytes.length;if(total>50*1024*1024||abort.signal.aborted)throw new Error(PUBLIC_ERROR);
        const type=photoType(bytes);const path=`${prefix}/${selected.id}${type.extension}`;attempted.push(path);
        const upload=await storage.upload(path,bytes,{upsert:false,contentType:type.contentType});if(upload.error)throw new Error(PUBLIC_ERROR);
        artifacts.push({id:selected.id,storage_path:path,sha256:await digestBytes(bytes),content_type:type.contentType});
      }
      const path=`${prefix}.pdf`;attempted.push(path);
      const upload=await storage.upload(path,pdf,{upsert:false,contentType:'application/pdf'});if(upload.error)throw new Error(PUBLIC_ERROR);
      const complete=await admin.rpc('complete_parent_publication',{p_therapist_id:userId,p_report_id:body.report_id,p_kind:body.report_kind,p_claim_id:claim.claim_id,p_revision:claim.revision,p_pdf_sha256:await digestBytes(pdf),p_media:artifacts});
      if(complete.error||complete.data!==true)throw new Error(PUBLIC_ERROR);
      // Idempotent read retrieves the database's authoritative generated timestamp.
      const completed=await admin.rpc('claim_parent_publication',{p_therapist_id:userId,p_report_id:body.report_id,p_kind:body.report_kind});
      if(completed.error||completed.data?.publication_status!=='published')throw new Error(PUBLIC_ERROR);
      return parentJson(origin,200,{publication_status:'published',generated_at:completed.data.generated_at});
    }catch(error){
      if(admin&&claim&&operation==='generate'){
        try{
          // CAS refusal/unknown completion means retain keys. Cleanup can never
          // delete published or newer claim artifacts. Crashes leave private orphans.
          const cleanup=recovery!();
          const failed=await cleanup.rpc('fail_parent_publication',{p_therapist_id:userId,p_report_id:body.report_id,p_kind:body.report_kind,p_claim_id:claim.claim_id,p_revision:claim.revision});
          if(!failed.error&&failed.data===true&&attempted.length)await cleanup.storage.from('patient-media').remove(attempted);
        }catch{/* Lease recovery handles unavailable failure persistence. */}
      }
      return parentJson(origin,error instanceof ParentPublicError?error.status:503,{error:PUBLIC_ERROR});
    }finally{clearTimeout(timer);}
  };
}
