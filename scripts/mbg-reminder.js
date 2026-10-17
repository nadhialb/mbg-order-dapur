// MBG Order Dapur — pengingat supplier otomatis (H-1, hari H, pengingat pribadi).
// Dijalankan oleh GitHub Actions tiap pagi. Baca data dari Supabase, lalu kirim
// 1 notifikasi ke HP lewat ntfy.sh. Logikanya sama dengan "Asisten Pengingat" di aplikasi.
const SB_URL = process.env.SB_URL || 'https://mvliluqrkzywojjnqxdm.supabase.co/rest/v1';
const SB_KEY = process.env.SUPABASE_ANON_KEY;
const TOPIC = process.env.NTFY_TOPIC;
const APP_URL = process.env.APP_URL || '';
const DRY = process.env.DRY_RUN === '1';

const DAYS = ['Senin','Selasa','Rabu','Kamis','Jumat'];
const addDays = (d,n)=>{const r=new Date(d);r.setDate(r.getDate()+n);return r;};
function getWeekDates(wk){
  const [yr,wn]=wk.split('-W').map(Number);
  const jan4=new Date(yr,0,4), mon1=new Date(jan4);
  mon1.setDate(jan4.getDate()-(jan4.getDay()||7)+1);
  return Array.from({length:5},(_,i)=>{const d=new Date(mon1);d.setDate(mon1.getDate()+(wn-1)*7+i);return d;});
}
function today0(){
  if(process.env.TODAY){const [y,m,d]=process.env.TODAY.split('-').map(Number);return new Date(y,m-1,d);}
  const t=new Date();t.setHours(0,0,0,0);return t;
}
function effSupplierId(S,si){
  if(si.supplierId)return si.supplierId;
  const m=S.materials.find(x=>x.id===si.materialId);
  return (m&&m.supplierIds&&m.supplierIds.length===1)?m.supplierIds[0]:null;
}
function computeReminders(S, td){
  const res={h0:{},h1:{},custom:[]};
  (S.scheduleItems||[]).forEach(si=>{
    if(si.isReceived)return;
    const m=(S.materials||[]).find(x=>x.id===si.materialId);if(!m||!si.weekKey)return;
    const dates=getWeekDates(si.weekKey);if(!dates[si.day])return;
    const diff=Math.round((addDays(dates[si.day],-1)-td)/864e5);
    if(diff!==0&&diff!==1)return;
    const sid=effSupplierId(S,si)||'_none';
    const b=diff===0?res.h0:res.h1;
    const kit=(S.kitchens||[]).find(k=>k.id===si.kitchenId);
    (b[sid]=b[sid]||[]).push({m,si,kit:kit?kit.name:'',ordered:!!si.isOrdered});
  });
  (S.customReminders||[]).forEach(r=>{
    if(r.done)return;
    const p=String(r.date||'').split('-').map(Number);if(p.length!==3||!p[0])return;
    const diff=Math.round((new Date(p[0],p[1]-1,p[2])-td)/864e5);
    if(diff<=1)res.custom.push({...r,diff});
  });
  res.custom.sort((a,b)=>a.diff-b.diff);
  return res;
}
function buildMessage(S, res){
  const supp=id=>(S.suppliers||[]).find(s=>s.id===id);
  const sect=(title,map)=>{
    const ids=Object.keys(map);if(!ids.length)return '';
    return title+'\n'+ids.map(id=>{
      const s=supp(id);
      const head='🏪 '+(s?s.name:'Belum ada supplier')+(s&&s.phone?' ('+s.phone+')':'');
      const lines=map[id].map(x=>'  • '+(x.m.needsAttention?'🚩 ':'')+x.m.name+' '+x.si.qty+' '+x.m.unit+(x.ordered?'':' [belum dipesan]'));
      return head+'\n'+lines.join('\n');
    }).join('\n')+'\n\n';
  };
  let t='';
  t+=sect('📦 DATANG HARI INI — hubungi supplier:',res.h0);
  t+=sect('⏰ DATANG BESOK (H-1) — konfirmasi supplier:',res.h1);
  if(res.custom.length){
    t+='📌 Pengingat saya:\n'+res.custom.map(x=>{
      const s=x.supplierId?supp(x.supplierId):null;
      const when=x.diff<0?`(lewat ${-x.diff} hari)`:x.diff===0?'(hari ini)':'(besok)';
      return '  • '+x.note+(s?' — '+s.name:'')+' '+when;
    }).join('\n')+'\n';
  }
  return t.trim();
}
async function fetchState(){
  const r=await fetch(SB_URL+'/app_state?select=data&limit=1',{headers:{apikey:SB_KEY,Authorization:'Bearer '+SB_KEY}});
  if(!r.ok)throw new Error('Supabase HTTP '+r.status);
  const rows=await r.json();
  if(!rows.length)throw new Error('app_state kosong');
  return rows[0].data;
}
async function main(){
  const S=process.env.MOCK_DATA?JSON.parse(require('fs').readFileSync(process.env.MOCK_DATA,'utf8')):await fetchState();
  const td=today0();
  const res=computeReminders(S,td);
  const n0=Object.keys(res.h0).length,n1=Object.keys(res.h1).length;
  if(!n0&&!n1&&!res.custom.length){console.log('Tidak ada pengingat hari ini.');return;}
  const message=buildMessage(S,res);
  const title=`🔔 MBG: ${n0} supplier hari ini, ${n1} besok${res.custom.length?`, ${res.custom.length} catatan`:''}`;
  const payload={topic:TOPIC||'(dry)',title,message,priority:n0?4:3,tags:['bell']};
  if(APP_URL)payload.click=APP_URL;
  if(DRY){console.log(JSON.stringify(payload,null,2));return;}
  if(!TOPIC)throw new Error('NTFY_TOPIC belum diisi di GitHub Secrets');
  const r=await fetch('https://ntfy.sh/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(!r.ok)throw new Error('ntfy HTTP '+r.status+' '+await r.text());
  console.log('Terkirim:',title);
}
if(require.main===module)main().catch(e=>{console.error(e);process.exit(1);});
module.exports={computeReminders,buildMessage};
