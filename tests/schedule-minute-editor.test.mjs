import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { openScheduleEditor } from '../schedule-editor.js';

test('editor shows existing minutes and saves an edited 09:45 appointment', async () => {
  const window = new Window({ url: 'https://fizira.test/' });
  try {
    Object.assign(globalThis, { window, document: window.document });
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    const app = document.createElement('main');
    document.body.append(app);
    const saved = [];
    const query = { select() { return this; }, eq() { return this; }, order() { return Promise.resolve({data:[],error:null}); } };
    const sb = { from: () => query, rpc: async (name, args) => { saved.push({name,args}); return {data:1,error:null}; } };
    const start = new Date(2026,9,30,8,30);
    const row = {id:'visit',patient_id:'p1',starts_at:start.toISOString(),ends_at:new Date(start.getTime()+3600000).toISOString(),kind:'appointment',status:'planned',price_kopecks:300000,paid_kopecks:0,updated_at:start.toISOString()};
    openScheduleEditor({app,sb,user:{id:'u1'},patients:[{id:'p1',display_name:'Тестовый пациент',schedule_price_kopecks:300000}],appointments:[row],row,esc:String,onSaved(){}});
    const form = app.querySelector('form');
    assert.equal(form.elements.namedItem('time').value,'08:30');
    form.elements.namedItem('time').value='09:45';
    form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
    for (let i=0;i<100&&!saved.length;i++) await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(saved.length,1);
    const payload=saved[0].args.entries[0];
    assert.equal(new Date(payload.starts_at).getHours(),9);
    assert.equal(new Date(payload.starts_at).getMinutes(),45);
    assert.equal(new Date(payload.ends_at).getTime()-new Date(payload.starts_at).getTime(),3600000);
    assert.equal(payload.id,'visit');
  } finally {
    await window.happyDOM.abort();
  }
});
