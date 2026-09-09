// ERP DEMO 4.3.0 — best-effort same-browser write lease. Not a server transaction.
const PREFIX='erp_demo_write_lease_v1:';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function owner(){ return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
export async function withDemoWriteLease(scope, task, options={}) {
  const key=PREFIX+String(scope||'document');
  const mine=owner();
  const timeout=Number(options.timeoutMs||5000), ttl=Number(options.ttlMs||8000);
  const started=Date.now();
  while(Date.now()-started<timeout){
    let current=null;
    try{ current=JSON.parse(localStorage.getItem(key)||'null'); }catch{ current=null; }
    if(!current || Number(current.expiresAt||0)<=Date.now()){
      const lease={owner:mine,expiresAt:Date.now()+ttl};
      try{ localStorage.setItem(key,JSON.stringify(lease)); }catch{ return task(); }
      let verify=null; try{verify=JSON.parse(localStorage.getItem(key)||'null')}catch{}
      if(verify?.owner===mine){
        try{return await task();}
        finally{
          try{const latest=JSON.parse(localStorage.getItem(key)||'null'); if(latest?.owner===mine)localStorage.removeItem(key);}catch{}
        }
      }
    }
    await sleep(80+Math.floor(Math.random()*80));
  }
  throw new Error('มีอีกหน้าต่างกำลังบันทึกเอกสารอยู่ กรุณารอสักครู่แล้วลองใหม่');
}
