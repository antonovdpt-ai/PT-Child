import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const snapshot = {schema_version:1,report_kind:'initial',revision:7,child_name:'Артём Смирнов',source_date:'2026-10-03',therapist_name:'Анна Иванова',therapist_profession:'Физический терапевт',therapist_organization:'Клиника',therapist_phone:'+7 000',complaint:'Фиксированная жалоба',recommendations:'Точная рекомендация'};
test('real PDF embeds Noto Sans and extracts exact Cyrillic snapshot/revision with pagination',async()=>{
  const {renderParentPublicationPdf}=await import('./parent-pdf.ts');
  const before=structuredClone(snapshot);
  const bytes=await renderParentPublicationPdf(snapshot);
  assert.equal(Buffer.from(bytes).subarray(0,5).toString(),'%PDF-'); assert.ok(bytes.length>5000);
  assert.match(Buffer.from(bytes).toString('latin1'),/NotoSans/); assert.deepEqual(snapshot,before);
  const dir=await mkdtemp(join(tmpdir(),'parent-pdf-'));
  try {
    await writeFile(join(dir,'report.pdf'),bytes);
    const extracted=spawnSync('pdftotext',[join(dir,'report.pdf'),'-'],{encoding:'utf8'});
    assert.equal(extracted.status,0,extracted.stderr);
    for(const text of ['Артём Смирнов','Анна Иванова','Фиксированная жалоба','Точная рекомендация','03.10.2026','7']) assert.ok(extracted.stdout.includes(text),text);
    const long=await renderParentPublicationPdf({...snapshot,recommendations:'Длинный текст '.repeat(3000)});
    await writeFile(join(dir,'long.pdf'),long);
    assert.ok(Number(spawnSync('pdfinfo',[join(dir,'long.pdf')],{encoding:'utf8'}).stdout.match(/Pages:\s+(\d+)/)[1])>1);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('renderer rejects unknown schema and oversized body',async()=>{
  const {renderParentPublicationPdf}=await import('./parent-pdf.ts');
  await assert.rejects(renderParentPublicationPdf({...snapshot,schema_version:2}));
  await assert.rejects(renderParentPublicationPdf({...snapshot,complaint:'x'.repeat(200001)}));
});
test('branded PDF embeds the approved asset and omits empty section headings',async()=>{
 const {renderParentPublicationPdf}=await import('./parent-pdf.ts');
 const {PDFDocument,PDFName}=await import('pdf-lib');
 const bytes=await renderParentPublicationPdf(snapshot),doc=await PDFDocument.load(bytes);
 assert.ok([...doc.context.enumerateIndirectObjects()].some(([,object])=>object.dict?.get(PDFName.of('Subtype'))?.toString()==='/Image'),'Approved logo image must be embedded');
 const dir=await mkdtemp(join(tmpdir(),'fizira-brand-'));
 try {await writeFile(join(dir,'brand.pdf'),bytes);const text=spawnSync('pdftotext',[join(dir,'brand.pdf'),'-'],{encoding:'utf8'}).stdout;
 assert.match(text,/Fizira/);assert.match(text,/Сформировано в Fizira/);assert.match(text,/1\s*\/\s*1/);
 assert.doesNotMatch(text,/Сильные стороны|Над чем будем работать|Динамика/);
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('server endpoints bind checked contracts and do not accept authored paths',async()=>{
  for(const name of ['generate-parent-report-pdf','parent-report-file']) {
    const source=await readFile(new URL(`../${name}/index.ts`,import.meta.url),'utf8');
    assert.match(source,/parentPublicationHandler/);
  }
  const source=await readFile(new URL('./parent-publication.ts',import.meta.url),'utf8');
  assert.ok(source.indexOf('claim_parent_publication')<source.indexOf('.upload('));
  assert.match(source,/fail_parent_publication/); assert.match(source,/resolve_parent_publication_file/);
  assert.match(source,/createSignedUrl\(record.storage_path, 300\)/);
  assert.doesNotMatch(source,/from\("patient_media"\)/);
});
test('deployment config ships the bundled font/license without changing JWT verification',async()=>{
 const config=await readFile(new URL('../../config.toml',import.meta.url),'utf8');
 assert.match(config,/\[functions\.generate-parent-report-pdf\]/);assert.match(config,/static_files\s*=.*NotoSans-Regular\.ttf.*OFL\.txt/);assert.doesNotMatch(config,/verify_jwt|project_ref/);
});
