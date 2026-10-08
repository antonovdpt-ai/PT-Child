import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceFixture} from './parent-report-fixture.mjs';
test('consultation without Parent Cabinet saves and generates after one review action',async()=>{
 const h=await workspaceFixture();try{await h.root.querySelector('[data-start-report]').onclick();await h.root.querySelector('[data-prepare-pdf]').onclick();assert.equal(h.rows.length,1);assert.equal(h.rows[0].publication_status,'draft');assert.equal(h.root.querySelector('[data-share-pdf]').disabled,false);assert.deepEqual(h.calls.filter(c=>c.name).map(c=>c.name),['generate-parent-report-pdf']);assert.equal(h.calls.at(-1).body.mode,'export');h.root.querySelector('[data-edit-pdf]').click();h.input('complaint','Последняя правка');assert.equal(h.root.querySelector('[data-share-pdf]').disabled,true);await h.root.querySelector('[data-prepare-pdf]').onclick();assert.equal(h.rows[0].complaint,'Последняя правка');assert.equal(h.calls.filter(c=>c.name).length,2);}finally{await h.close();}
});
