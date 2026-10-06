import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Window} from 'happy-dom';
import {escapeHtml} from '../security-utils.mjs';

test('ordinary goal creation offers explicit parent visibility, private by default',async()=>{
 const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
 const start=source.indexOf("  if (state.tab === 'goals') {");
 const end=source.indexOf("  if (state.tab === 'sessions') {",start);
 assert.ok(start>=0&&end>start,'Execute the actual ordinary Goals branch');
 const window=new Window();
 try{
  const {document}=window;
  const box=document.createElement('div');document.body.append(box);
  const env={document,box,esc:escapeHtml,state:{patientId:'fictional-child',tab:'goals',goals:[]},p:{id:'fictional-child'},
   goalsHtml:()=>'',watchFormDirty:()=>{},accountIsCurrent:()=>true};
  new Function('env',`with(env){${source.slice(start,end)}}`)(env);
  const form=box.querySelector('#goalForm');assert.ok(form);
  const control=[...form.querySelectorAll('input[type=checkbox]')].find(input=>
   input.closest('label')?.textContent.includes('Показывать родителю')||
   input.getAttribute('aria-label')==='Показывать родителю');
  assert.ok(control,'New clinical goal needs an explicit Показывать родителю control');
  assert.equal(control.checked,false,'Creating a new goal must not implicitly publish clinical fields');
 }finally{window.happyDOM.abort();}
});
