import test from 'node:test';import assert from 'node:assert/strict';import {Window} from 'happy-dom';
import {mountReportPdfExport} from '../report-pdf-export.mjs';
const pdf=new Blob(['%PDF-1.7\nfictional'],{type:'application/pdf'});
function fixture(options={}) {
 const window=new Window(),document=window.document;document.body.innerHTML='<div id="root"></div>';window.confirm=()=>options.confirm!==false;
 const root=document.getElementById('root'),calls=[],downloads=[];let current=true;
 const sb={functions:{invoke:async(name,{body})=>{calls.push({name,body});return options.delay?options.delay():options.error?{error:new Error()}:{data:options.data||pdf};}}};
 Object.defineProperty(window.navigator,'canShare',{configurable:true,value:options.canShare||(()=>true)});
 Object.defineProperty(window.navigator,'share',{configurable:true,writable:true,value:options.share|| (async data=>{calls.push({share:data});})});
 window.URL.createObjectURL=()=> 'blob:local-pdf';window.URL.revokeObjectURL=()=>{};window.HTMLAnchorElement.prototype.click=function(){downloads.push({href:this.href,name:this.download});};
 const control=mountReportPdfExport({root,sb,reportId:'fictional-report',reportKind:'initial',isCurrent:()=>current,beforePrepare:options.beforePrepare});
 return {window,root,calls,downloads,control,retire:()=>current=false,close:()=>window.happyDOM.abort()};
}
const click=async(h,selector)=>h.root.querySelector(selector).onclick();
test('ready PDF File is shared synchronously with no invitation or URL',async()=>{const h=fixture();try{await click(h,'[data-prepare-pdf]');let called=false;h.window.navigator.share=data=>{called=true;assert.deepEqual(Object.keys(data),['files']);assert.equal(data.files[0].type,'application/pdf');assert.equal(data.files[0].name,'Fizira-report.pdf');return Promise.resolve();};const pending=click(h,'[data-share-pdf]');assert.equal(called,true);await pending;assert.deepEqual(h.calls,[{name:'generate-parent-report-pdf',body:{report_id:'fictional-report',report_kind:'initial',mode:'export'}}]);assert.equal(h.downloads.length,0);}finally{h.close();}});
test('unsupported native sharing falls back to download',async()=>{const h=fixture({canShare:()=>false});try{await click(h,'[data-prepare-pdf]');await click(h,'[data-share-pdf]');assert.equal(h.downloads.length,1);assert.match(h.root.textContent,/скач|загруз/i);}finally{h.close();}});
test('cancel preserves ready file and does not download automatically',async()=>{const h=fixture({share:async()=>{throw new DOMException('cancel','AbortError')}});try{await click(h,'[data-prepare-pdf]');await click(h,'[data-share-pdf]');assert.match(h.root.textContent,/отмен/);assert.equal(h.downloads.length,0);assert.equal(h.root.querySelector('[data-share-pdf]').disabled,false);await click(h,'[data-download-pdf]');assert.equal(h.downloads.length,1);}finally{h.close();}});
test('non-PDF and server errors never enable sharing',async()=>{for(const opts of [{error:true},{data:new Blob(['html'],{type:'text/html'})}]){const h=fixture(opts);try{await click(h,'[data-prepare-pdf]');assert.match(h.root.textContent,/Не удалось/);assert.equal(h.root.querySelector('[data-share-pdf]').disabled,true);}finally{h.close();}}});
test('changed text and retired views ignore pending PDF',async()=>{let resolve;const h=fixture({delay:()=>new Promise(r=>resolve=r)});try{const pending=click(h,'[data-prepare-pdf]');h.control.invalidate();resolve({data:pdf});await pending;assert.equal(h.root.querySelector('[data-share-pdf]').disabled,true);h.retire();await click(h,'[data-prepare-pdf]');assert.equal(h.calls.length,1);}finally{h.close();}});
test('generation never requests browser confirmation; native failure downloads',async()=>{const h=fixture({confirm:false});try{await click(h,'[data-prepare-pdf]');assert.equal(h.calls.length,1);}finally{h.close();}const other=fixture({share:async()=>{throw new DOMException('unsupported','NotAllowedError')}});try{await click(other,'[data-prepare-pdf]');await click(other,'[data-share-pdf]');assert.equal(other.downloads.length,1);}finally{other.close();}});
test('generation awaits latest saved identity and shows an embedded ready preview',async()=>{
 let finish;const h=fixture({beforePrepare:()=>new Promise(r=>finish=r)});
 try {const pending=click(h,'[data-prepare-pdf]');assert.equal(h.calls.length,0);finish('new-saved-report');await pending;
 assert.equal(h.calls[0].body.report_id,'new-saved-report');assert.ok(h.root.querySelector('[data-pdf-preview] canvas'));assert.ok(h.root.querySelector('[data-open-pdf]').href.startsWith('blob:'));
 assert.equal(h.root.querySelector('[data-prepare-pdf]').hidden,true);assert.equal(h.root.querySelector('[data-share-pdf]').hidden,false);
 } finally {h.close();}
});
test('save failure blocks PDF requests and retains an explicit retry',async()=>{const h=fixture({beforePrepare:async()=>null});try{await click(h,'[data-prepare-pdf]');assert.equal(h.calls.length,0);assert.match(h.root.textContent,/Изменения пока не сохранены/);assert.equal(h.root.querySelector('[data-prepare-pdf]').disabled,false);}finally{h.close();}});
test('retiring an old control cannot clear the next reports preview',async()=>{
 const h=fixture();try{await click(h,'[data-prepare-pdf]');const previous=h.control;h.control=mountReportPdfExport({root:h.root,sb:{functions:{invoke:async()=>({data:pdf})}},reportId:'next-report',reportKind:'initial',isCurrent:()=>true});await click(h,'[data-prepare-pdf]');previous.invalidate();previous.dispose();assert.ok(h.root.querySelector('[data-open-pdf]').href.startsWith('blob:'));}finally{h.close();}
});
test('preview failure explains fallback and keeps the same downloadable PDF',async()=>{const h=fixture();try{await click(h,'[data-prepare-pdf]');assert.match(h.root.textContent,/Не удалось показать предпросмотр/);assert.equal(h.root.querySelector('[data-share-pdf]').disabled,false);await click(h,'[data-download-pdf]');assert.equal(h.downloads.length,1);}finally{h.close();}});
