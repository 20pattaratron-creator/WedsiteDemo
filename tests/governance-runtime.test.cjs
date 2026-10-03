const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const root=path.resolve(__dirname,'..');
const OUTBOX_KEY='comform_sync_outbox_v1';
const PERIOD_KEY='comform_governance_period_locks_v1';
const AUDIT_KEY='comform_governance_audit_v1';
const APPROVAL_KEY='comform_approval_history_v1';

function memoryStorage(){
  const map=new Map();
  return {
    get length(){return map.size;},
    key(index){return [...map.keys()][index]??null;},
    getItem(key){return map.has(String(key))?map.get(String(key)):null;},
    setItem(key,value){map.set(String(key),String(value));},
    removeItem(key){map.delete(String(key));},
    clear(){map.clear();},
    dump(){return new Map(map);}
  };
}

async function loadRuntime(){
  const localStorage=memoryStorage();
  const transactionCalls=[];
  const listeners=new Map();
  const old={window:global.window,document:global.document,localStorage:global.localStorage,CustomEvent:global.CustomEvent};
  global.localStorage=localStorage;
  global.CustomEvent=class CustomEvent{constructor(type,init={}){this.type=type;this.detail=init.detail;}};
  global.document={readyState:'loading',addEventListener(type,fn){listeners.set(type,fn);},getElementById(){return null;}};
  global.window={
    ComformTenant:{storageKey:key=>String(key),unwrapStorageKey:key=>String(key)},
    ERPIntegrity:{transaction(writes){
      transactionCalls.push(writes.map(([k,v])=>[k,JSON.parse(JSON.stringify(v))]));
      const before=new Map(writes.map(([k])=>[k,localStorage.getItem(k)]));
      const changed=[];
      try{
        for(const [k,v] of writes){localStorage.setItem(k,typeof v==='string'?v:JSON.stringify(v));changed.push(k);}
      }catch(error){
        for(const k of changed.reverse()){const value=before.get(k);if(value===null)localStorage.removeItem(k);else localStorage.setItem(k,value);}throw error;
      }
    }},
    ComformAuth:{getCurrentProfile(){return {email:'tester@example.com'};}},
    CurrentUser:{email:'tester@example.com'},
    FirebaseService:null,
    addEventListener(){},dispatchEvent(){},notify(){},
  };
  const url=pathToFileURL(path.join(root,'erp-governance.js')).href+`?test=${Date.now()}_${Math.random()}`;
  await import(url);
  const api=global.window.ERPGovernance;
  return {api,localStorage,transactionCalls,restore(){for(const [k,v] of Object.entries(old)){if(v===undefined)delete global[k];else global[k]=v;}}};
}

test('period lock validates before persistence and writes lock + audit atomically',async()=>{
  const env=await loadRuntime();
  try{
    assert.throws(()=>env.api.lockPeriod({branch:'ubon',scope:'sales',throughDate:'not-a-date'}),e=>e.code==='validation_error');
    assert.equal(env.localStorage.getItem(PERIOD_KEY),null);
    assert.equal(env.localStorage.getItem(AUDIT_KEY),null);
    assert.equal(env.transactionCalls.length,0);

    const lock=env.api.lockPeriod({branch:'ubon',scope:'sales',throughDate:'2026-09-30',reason:'month close'});
    assert.equal(lock.throughDate,'2026-09-30');
    assert.equal(env.transactionCalls.length,1);
    const keys=new Set(env.transactionCalls[0].map(([key])=>key));
    assert.deepEqual(keys,new Set([PERIOD_KEY,AUDIT_KEY]));
    assert.equal(JSON.parse(env.localStorage.getItem(PERIOD_KEY)).length,1);
    assert.equal(JSON.parse(env.localStorage.getItem(AUDIT_KEY))[0].action,'period_lock');
  }finally{env.restore();}
});

test('approval decision and audit evidence share one transaction',async()=>{
  const env=await loadRuntime();
  try{
    const decision=env.api.recordApprovalDecision({entityType:'quote',entityId:'Q1',entityNo:'QT001',decision:'approved',reason:'manager approved',amount:150000});
    assert.equal(decision.decision,'approved');
    assert.equal(env.transactionCalls.length,1);
    const keys=new Set(env.transactionCalls[0].map(([key])=>key));
    assert.deepEqual(keys,new Set([APPROVAL_KEY,AUDIT_KEY]));
    assert.equal(JSON.parse(env.localStorage.getItem(APPROVAL_KEY))[0].entityId,'Q1');
    assert.equal(JSON.parse(env.localStorage.getItem(AUDIT_KEY))[0].action,'approval_approved');
  }finally{env.restore();}
});

test('interrupted syncing becomes uncertain and is never auto-retried',async()=>{
  const env=await loadRuntime();
  try{
    env.localStorage.setItem(OUTBOX_KEY,JSON.stringify([{
      operationId:'OP1',channel:'business_method',method:'saveInvoice',payload:{id:1},args:[],status:'syncing',attempts:0,
      createdAt:'2026-09-16T00:00:00.000Z',updatedAt:'2026-09-16T00:00:00.000Z',entityType:'invoice',entityId:'1',branch:'ubon',commandFingerprint:'fp'
    }]));
    const recovered=env.api.recoverInterruptedSyncs(Date.parse('2026-09-16T00:10:00.000Z'));
    assert.equal(recovered.length,1);
    assert.equal(env.api.listOutbox()[0].status,'uncertain');
    assert.equal(JSON.parse(env.localStorage.getItem(AUDIT_KEY))[0].action,'sync_uncertain');
    assert.equal(env.transactionCalls.length,1);
    const keys=new Set(env.transactionCalls[0].map(([key])=>key));
    assert.deepEqual(keys,new Set([OUTBOX_KEY,AUDIT_KEY]));

    let calls=0;global.window.FirebaseService={saveInvoice(){calls++;return Promise.resolve({id:'x'});}};
    assert.deepEqual(await env.api.retryPending(),[]);
    assert.equal(calls,0);
    await assert.rejects(()=>env.api.retrySync('OP1'),e=>e.code==='sync_uncertain');
    assert.equal(calls,0);
  }finally{env.restore();}
});
