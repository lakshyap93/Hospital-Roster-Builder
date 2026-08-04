const SUPABASE_URL = 'https://bumjwrmwzwzjqdejnqca.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_vgUSK9MQncLu_qLd_LEPMA_XKW9fVRJ';
if(!window.supabase || typeof window.supabase.createClient!=='function'){
  throw new Error('Supabase library failed to load. Check internet/CDN access.');
}
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);



const HOSPITAL='Jain Diwakar Sri Aurobindo Hospital, Ratlam';
let staff=[];
let codes=[{name:'Morning',code:'M'},{name:'Evening',code:'E'},{name:'Night',code:'N'},{name:'Off',code:'O'}];
let assignments={};
let currentRosterId=null;
let rosterStaff=[];
let viewingHistory=false;
const staffList=document.getElementById('staffList'),emptyStaff=document.getElementById('emptyStaff'),staffCount=document.getElementById('staffCount');
const staffName=document.getElementById('staffName'),staffId=document.getElementById('staffId');
const dutyLegend=document.getElementById('dutyLegend'),printLegend=document.getElementById('printLegend');
const rosterTable=document.getElementById('rosterTable'),rosterTitle=document.getElementById('rosterTitle');
const printTitle=document.getElementById('printTitle'),printMonth=document.getElementById('printMonth');

const monthEl=document.getElementById('month'),yearEl=document.getElementById('year');
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
const now=new Date();
if(monthEl&&yearEl){months.forEach((m,i)=>monthEl.add(new Option(m,i)));monthEl.value=now.getMonth();yearEl.value=now.getFullYear();}

function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function rosterDays(){const y=+yearEl.value,m=+monthEl.value;return Array.from({length:new Date(y,m+1,0).getDate()},(_,i)=>new Date(y,m,i+1))}
function localDateKey(d){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`}
function akey(id,date){return `${id}|${date}`}
function showError(prefix,error){console.error(prefix,error);alert(prefix+': '+(error?.message||'Unknown error'))}

async function init(){
  const page=document.body.dataset.page||'legacy';
  try{
    if(page==='staff'){await loadStaff();return}
    if(page==='history'){await loadStaff();await loadRosterHistory();return}
    if(page==='roster'){
      await loadStaff();renderCodes();await loadRoster();buildRoster();
      const q=new URLSearchParams(location.search),rid=q.get('rosterId'),mo=q.get('month'),yr=q.get('year');
      if(rid&&mo&&yr)await openSavedRoster(rid,Number(mo),Number(yr));
    }
  }catch(e){console.error(e);showError('Could not initialize page',e)}
}

async function loadStaff(){
  const {data,error}=await db.from('staff').select('id,name,unid_no,created_at').order('created_at');
  if(error){showError('Could not load staff',error);return}
  staff=(data||[]).map(x=>({uid:x.id,name:x.name,id:x.unid_no||''}));
  renderStaff();
}

async function addStaff(){
  viewingHistory=false;
  const name=staffName.value.trim(),id=staffId.value.trim();
  if(!name)return alert('Staff name required.');
  const {data,error}=await db.from('staff').insert({name,unid_no:id||null}).select('id,name,unid_no').single();
  if(error){showError('Could not add staff',error);return}
  staffName.value='';staffId.value='';
  await loadStaff();
  if(currentRosterId){
    try{
      await syncCurrentStaffIntoRoster(currentRosterId);
      await loadRosterSnapshot(currentRosterId);
    }catch(e){showError('Staff added, but could not add to current roster',e);return}
  }
  buildRoster();
}


async function syncStaffToCurrentRoster(){
  try{
    viewingHistory=false;
    const rid=await ensureRoster();if(!rid)return;
    await syncCurrentStaffIntoRoster(rid);
    await loadRosterSnapshot(rid);
    buildRoster();
    alert('All current staff are now included in this roster.');
  }catch(e){showError('Could not sync staff',e)}
}

async function deleteStaff(uid){
  if(!confirm('Delete this staff member from current/future staff list? Previous saved rosters will keep the staff name, UNID and duties.'))return;
  const {error}=await db.from('staff').delete().eq('id',uid);
  if(error){showError('Could not delete staff',error);return}
  await loadStaff();
  if(currentRosterId){await loadRosterSnapshot(currentRosterId)}
  buildRoster();
}

function renderStaff(){
  if(!staffList||!emptyStaff||!staffCount)return;
  staffList.innerHTML=staff.map((s,i)=>`<tr><td>${i+1}</td><td>${esc(s.name)}</td><td>${esc(s.id||'-')}</td><td><button class="danger" onclick="deleteStaff('${s.uid}')">Delete</button></td></tr>`).join('');
  emptyStaff.style.display=staff.length?'none':'block';staffCount.textContent=staff.length+' staff';
}

function addDutyCode(){
  const name=prompt('Duty name (example: Weekly Off)');if(!name)return;
  const code=(prompt('Short code (example: WO)')||'').trim().toUpperCase();if(!code)return;
  if(codes.some(c=>c.code===code))return alert('Code already exists.');
  codes.push({name,code});localStorage.setItem('sa_custom_codes',JSON.stringify(codes));renderCodes();buildRoster();
}
function renderCodes(){
  if(!dutyLegend||!printLegend)return;
  const saved=JSON.parse(localStorage.getItem('sa_custom_codes')||'null');if(saved)codes=saved;
  dutyLegend.innerHTML=codes.map((c,i)=>`<span class="chip"><b>${esc(c.code)}</b> = ${esc(c.name)} <button type="button" class="code-delete" onclick="deleteDutyCode(${i})" title="Delete ${esc(c.code)}">×</button></span>`).join('');
  printLegend.innerHTML=codes.map(c=>`${esc(c.code)} = ${esc(c.name)}`).join(' &nbsp;&nbsp; | &nbsp;&nbsp; ');
}
function deleteDutyCode(index){
  const c=codes[index];if(!c)return;
  const used=Object.values(assignments).some(v=>String(v).toUpperCase()===String(c.code).toUpperCase());
  const msg=used
    ? `Delete duty code "${c.code} = ${c.name}"? This code is already used in roster cells. Existing saved cells will remain as "${c.code}", but new entries will no longer accept it.`
    : `Delete duty code "${c.code} = ${c.name}"?`;
  if(!confirm(msg))return;
  codes.splice(index,1);
  localStorage.setItem('sa_custom_codes',JSON.stringify(codes));
  renderCodes();buildRoster();
}

async function ensureRoster(){
  const month=+monthEl.value+1,year=+yearEl.value,title=rosterTitle.value.trim()||'NURSING DUTY ROSTER';
  let {data,error}=await db.from('rosters').select('id,title').eq('month',month).eq('year',year).maybeSingle();
  if(error){showError('Could not find roster',error);return null}
  if(!data){
    const created=await db.from('rosters').insert({title,month,year}).select('id,title').single();
    if(created.error){showError('Could not create roster',created.error);return null}
    data=created.data;
    await snapshotCurrentStaff(data.id);
  }else{
    await ensureRosterSnapshot(data.id);
  }
  currentRosterId=data.id;
  await syncCurrentStaffIntoRoster(data.id);
  await loadRosterSnapshot(data.id);
  return data.id;
}


async function snapshotCurrentStaff(rosterId){
  if(!staff.length)return;
  const rows=staff.map((s,i)=>({roster_id:rosterId,staff_id:s.uid,staff_name:s.name,unid_no:s.id||null,sort_order:i+1}));
  const {error}=await db.from('roster_staff_snapshots').upsert(rows,{onConflict:'roster_id,staff_id',ignoreDuplicates:true});
  if(error)throw error;
}

async function syncCurrentStaffIntoRoster(rosterId){
  if(!rosterId || !staff.length)return;
  const rows=staff.map((s,i)=>({
    roster_id:rosterId,
    staff_id:s.uid,
    staff_name:s.name,
    unid_no:s.id||null,
    sort_order:i+1
  }));
  const {error}=await db.from('roster_staff_snapshots')
    .upsert(rows,{onConflict:'roster_id,staff_id',ignoreDuplicates:true});
  if(error)throw error;
}
async function ensureRosterSnapshot(rosterId){
  const q=await db.from('roster_staff_snapshots').select('id').eq('roster_id',rosterId).limit(1);
  if(q.error)throw q.error;
  if(!q.data?.length)await snapshotCurrentStaff(rosterId);
}
async function loadRosterSnapshot(rosterId){
  const q=await db.from('roster_staff_snapshots').select('staff_id,staff_name,unid_no,sort_order').eq('roster_id',rosterId).order('sort_order');
  if(q.error)throw q.error;
  rosterStaff=(q.data||[]).map(x=>({uid:x.staff_id,name:x.staff_name,id:x.unid_no||''}));
}
async function loadRoster(){
  viewingHistory=false;assignments={};currentRosterId=null;rosterStaff=[];
  const month=+monthEl.value+1,year=+yearEl.value;
  const r=await db.from('rosters').select('id,title').eq('month',month).eq('year',year).maybeSingle();
  if(r.error){showError('Could not load roster',r.error);return}
  if(!r.data){rosterStaff=[...staff];return}
  currentRosterId=r.data.id;
  rosterTitle.value=r.data.title||'NURSING DUTY ROSTER';
  try{
    await ensureRosterSnapshot(currentRosterId);
    await syncCurrentStaffIntoRoster(currentRosterId);
    await loadRosterSnapshot(currentRosterId);
  }catch(e){
    console.error('Roster snapshot sync warning:',e);
    // UI still merges current staff, so roster creation is not blocked by snapshot sync.
    rosterStaff=[];
  }
  const q=await db.from('roster_assignments').select('staff_id,duty_date,duty_code').eq('roster_id',currentRosterId);
  if(q.error){showError('Could not load duties',q.error);return}
  (q.data||[]).forEach(x=>{if(x.staff_id)assignments[akey(x.staff_id,x.duty_date)]=x.duty_code});
}

async function setDuty(uid,date,val){
  val=val.trim().toUpperCase();
  if(val && !codes.some(c=>c.code===val)){alert('Invalid duty code. Add it first.');buildRoster();return}
  const rid=await ensureRoster();if(!rid)return;
  if(!val){
    const {error}=await db.from('roster_assignments').delete().eq('roster_id',rid).eq('staff_id',uid).eq('duty_date',date);
    if(error){showError('Could not clear duty',error);return}
    delete assignments[akey(uid,date)];
  }else{
    const {error}=await db.from('roster_assignments').upsert(
      {roster_id:rid,staff_id:uid,duty_date:date,duty_code:val},
      {onConflict:'roster_id,staff_id,duty_date'}
    );
    if(error){showError('Could not save duty',error);return}
    assignments[akey(uid,date)]=val;
  }
}


function getBuilderStaff(){
  if(viewingHistory)return rosterStaff;
  const merged=[...rosterStaff];
  const seen=new Set(merged.map(s=>String(s.uid)));
  staff.forEach(s=>{if(!seen.has(String(s.uid)))merged.push(s)});
  return merged;
}

function buildRoster(){
  if(!rosterTable||!monthEl||!yearEl||!rosterTitle)return;
  const ds=rosterDays(),title=rosterTitle.value.trim()||'DUTY ROSTER';
  const displayStaff=getBuilderStaff();
  printTitle.textContent=title;printMonth.textContent=`FOR THE MONTH OF ${months[+monthEl.value].toUpperCase()} - ${yearEl.value}`;
  let html=`<thead><tr><th>Sr.</th><th class="name">NAME OF STAFF</th><th class="idcol">UNID NO.</th>${ds.map(d=>`<th class="date ${d.getDay()===0?'sun':''}">${d.getDate()}<br>${d.toLocaleDateString('en',{weekday:'short'}).slice(0,2)}</th>`).join('')}</tr></thead><tbody>`;
  if(!displayStaff.length)html+=`<tr class="empty-row"><td colspan="${ds.length+3}">No staff created yet. Add staff above to start roster.</td></tr>`;
  displayStaff.forEach((s,i)=>{
    html+=`<tr data-uid="${s.uid}"><td>${i+1}</td><td class="name">${esc(s.name)}</td><td>${esc(s.id||'')}</td>`;
    ds.forEach(d=>{const dk=localDateKey(d),v=assignments[akey(s.uid,dk)]||'';html+=`<td class="${d.getDay()===0?'sun':''}"><input maxlength="3" data-uid="${s.uid}" value="${esc(v)}" onchange="setDuty('${s.uid}','${dk}',this.value)" title="${d.toDateString()}"></td>`});
    html+='</tr>';
  });
  rosterTable.innerHTML=html+'</tbody>';
}

let copiedRowAssignments = null;

function copyRow(uid) {
  const ds = rosterDays();
  copiedRowAssignments = {};
  ds.forEach(d => {
    const dk = localDateKey(d);
    copiedRowAssignments[dk] = assignments[akey(uid, dk)] || '';
  });
}

async function pasteRow(uid) {
  if (!copiedRowAssignments) {
    alert('Please copy a row first.');
    return;
  }
  const rid = await ensureRoster();
  if (!rid) return;
  
  const ds = rosterDays();
  const updates = [];
  const deletes = [];
  
  ds.forEach(d => {
    const dk = localDateKey(d);
    const val = copiedRowAssignments[dk];
    const currentVal = assignments[akey(uid, dk)] || '';
    
    if (val !== currentVal) {
      if (val) {
        updates.push({ roster_id: rid, staff_id: uid, duty_date: dk, duty_code: val });
        assignments[akey(uid, dk)] = val;
      } else {
        deletes.push(dk);
        delete assignments[akey(uid, dk)];
      }
    }
  });

  if (updates.length > 0) {
    const { error } = await db.from('roster_assignments').upsert(updates, { onConflict: 'roster_id,staff_id,duty_date' });
    if (error) { showError('Could not save pasted duties', error); return; }
  }
  
  if (deletes.length > 0) {
    const { error } = await db.from('roster_assignments')
      .delete()
      .eq('roster_id', rid)
      .eq('staff_id', uid)
      .in('duty_date', deletes);
    if (error) { showError('Could not clear pasted duties', error); return; }
  }
  
  buildRoster();
}

async function saveRoster(){
  viewingHistory=false;
  const rid=await ensureRoster();if(!rid)return;
  try{
    await syncCurrentStaffIntoRoster(rid);
    await loadRosterSnapshot(rid);
    buildRoster();
  }catch(e){showError('Could not sync staff into roster',e);return}
  const {error}=await db.from('rosters').update({title:rosterTitle.value.trim()||'NURSING DUTY ROSTER',updated_at:new Date().toISOString()}).eq('id',rid);
  if(error){showError('Could not save roster',error);return}
  await loadRosterHistory();
  alert('Roster saved to Supabase cloud. Previous months remain saved separately.');
}


function getExportStaff(){return getBuilderStaff();}
function getAdaptiveLayout(count){
 const n=Math.max(1,count), rowMm=Math.max(5.2,Math.min(18,205/n));
 if(n<=4)return {rowMm,dutyPt:12,namePt:13.5,idPt:12.5,headerPt:8.5,paddingMm:2.2};
 if(n<=7)return {rowMm,dutyPt:10.5,namePt:12,idPt:11,headerPt:8,paddingMm:1.7};
 if(n<=10)return {rowMm,dutyPt:9.5,namePt:11,idPt:10,headerPt:7.5,paddingMm:1.3};
 if(n<=15)return {rowMm,dutyPt:8.5,namePt:10,idPt:9.2,headerPt:7,paddingMm:1};
 if(n<=22)return {rowMm,dutyPt:7.3,namePt:8.8,idPt:8.2,headerPt:6.5,paddingMm:.7};
 return {rowMm,dutyPt:6.3,namePt:7.8,idPt:7.2,headerPt:6,paddingMm:.45};
}
function applyAdaptivePrintSizing(){
 const exportStaff=getExportStaff(),s=getAdaptiveLayout(exportStaff.length),r=document.documentElement;
 r.style.setProperty('--print-row-height',s.rowMm+'mm');
 r.style.setProperty('--print-duty-font',s.dutyPt+'pt');
 r.style.setProperty('--print-name-font',s.namePt+'pt');
 r.style.setProperty('--print-id-font',s.idPt+'pt');
 r.style.setProperty('--print-header-font',s.headerPt+'pt');
 r.style.setProperty('--print-cell-padding',s.paddingMm+'mm');
}
function printAdaptiveRoster(){if(!getExportStaff().length)return alert('Add staff first.');applyAdaptivePrintSizing();window.print();}
async function createRosterPdfBlob(){
 const exportStaff=getExportStaff();if(!exportStaff.length)throw new Error('Add staff first.');
 const {jsPDF}=window.jspdf,ds=rosterDays(),s=getAdaptiveLayout(exportStaff.length);
 const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a3'});
 const img=await imageData('hospital-logo.jpg');if(img)doc.addImage(img,'JPEG',12,7,24,24);
 doc.setFont('helvetica','bold');doc.setFontSize(15);doc.text(HOSPITAL,210,13,{align:'center'});
 doc.setFontSize(11);doc.text(rosterTitle.value.trim()||'DUTY ROSTER',210,20,{align:'center'});
 doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text(`FOR THE MONTH OF ${months[+monthEl.value].toUpperCase()} - ${yearEl.value}`,210,26,{align:'center'});
 const head=[['Sr.','NAME OF STAFF','UNID NO.',...ds.map(d=>`${d.getDate()}\n${d.toLocaleDateString('en',{weekday:'short'}).slice(0,2)}`)]];
 const body=exportStaff.map((x,i)=>[i+1,x.name,x.id||'',...ds.map(d=>assignments[akey(x.uid,localDateKey(d))]||'')]);
 doc.autoTable({head,body,startY:34,theme:'grid',
  styles:{font:'helvetica',fontSize:s.dutyPt,cellPadding:s.paddingMm,minCellHeight:s.rowMm,halign:'center',valign:'middle',overflow:'linebreak'},
  headStyles:{fontStyle:'bold',fontSize:s.headerPt,minCellHeight:9},
  columnStyles:{0:{cellWidth:9,fontStyle:'bold'},1:{cellWidth:55.20,halign:'center',valign:'middle',fontStyle:'bold',fontSize:14,overflow:'ellipsize'},2:{cellWidth:20,halign:'center',valign:'middle',fontStyle:'bold',fontSize:12.5,overflow:'ellipsize'}},
  didParseCell:d=>{
      d.cell.styles.textColor=[0,0,0];
      d.cell.styles.lineColor=[10,10,10];
      d.cell.styles.lineWidth=.35;
      if(d.section==='body' && d.column.index>=3){
        d.cell.styles.fontSize=10.5;
        d.cell.styles.fontStyle='bold';
        d.cell.styles.textColor=[0,0,0];
      }
      if(d.section==='head' && d.column.index>=3){
        d.cell.styles.fontSize=9.5;
        d.cell.styles.fontStyle='bold';
        d.cell.styles.textColor=[0,0,0];
      }if(d.section==='body'&&d.column.index===1){d.cell.styles.fontStyle='bold';d.cell.styles.fontSize=13;d.cell.styles.halign='center';d.cell.styles.valign='middle';d.cell.styles.overflow='ellipsize'}if(d.section==='body'&&d.column.index===2){d.cell.styles.fontStyle='bold';d.cell.styles.fontSize=12.5;d.cell.styles.halign='center';d.cell.styles.valign='middle';d.cell.styles.overflow='ellipsize'}},
  margin:{left:7,right:7},pageBreak:'auto',rowPageBreak:'avoid'});
 const ph=doc.internal.pageSize.getHeight(),fy=doc.lastAutoTable?.finalY||180,ly=Math.min(fy+6,ph-30);
 doc.setFont('helvetica','normal');doc.setFontSize(7);doc.text(codes.map(c=>`${c.code} = ${c.name}`).join('    |    '),10,ly);
 const sy=Math.min(ly+15,ph-13);doc.setDrawColor(40);doc.line(28,sy,88,sy);doc.line(330,sy,390,sy);
 doc.setFont('helvetica','bold');doc.setFontSize(8);doc.text('Signature of Nursing Supt.',58,sy+5,{align:'center'});doc.text('Signature of Medical Supt.',360,sy+5,{align:'center'});
 doc.setFont('helvetica','normal');doc.setFontSize(7);doc.text('Developed by Lakshya Purohit © 2026',410,ph-4,{align:'right'});
 return doc.output('blob');
}
async function sharePDF(){
 if(!getExportStaff().length)return alert('Add staff first.');
 try{
  const blob=await createRosterPdfBlob(),fn=`Roster-${months[+monthEl.value]}-${yearEl.value}.pdf`,file=new File([blob],fn,{type:'application/pdf'});
  if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){
   await navigator.share({title:`${rosterTitle.value.trim()||'Nursing Duty Roster'} - ${months[+monthEl.value]} ${yearEl.value}`,text:`${HOSPITAL} duty roster`,files:[file]});
  }else{
   const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=fn;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500);
   alert('Direct PDF sharing is not supported by this browser. PDF downloaded instead.');
  }
 }catch(e){if(e?.name!=='AbortError'){console.error(e);alert('Could not share PDF: '+(e?.message||'Unknown error'))}}
}
async function downloadExcel(){
  const exportStaff=getExportStaff();if(!exportStaff.length)return alert('Add staff first.');
  const ds=rosterDays(),data=[];
  data.push([HOSPITAL]);data.push([rosterTitle.value.trim()||'DUTY ROSTER']);data.push([`FOR THE MONTH OF ${months[+monthEl.value].toUpperCase()} - ${yearEl.value}`]);data.push([]);
  data.push(['Sr.No','NAME OF STAFF','UNID NO.',...ds.map(d=>d.getDate())]);
  data.push(['','','',...ds.map(d=>d.toLocaleDateString('en',{weekday:'short'}))]);
  exportStaff.forEach((s,i)=>data.push([i+1,s.name,s.id||'',...ds.map(d=>assignments[akey(s.uid,localDateKey(d))]||'')]));
  data.push([]);data.push(['Duty Codes:',...codes.map(c=>`${c.code}=${c.name}`)]);
  const ws=XLSX.utils.aoa_to_sheet(data);
  ws['!cols']=[{wch:6},{wch:24},{wch:12},...ds.map(()=>({wch:4}))];
  ws['!merges']=[XLSX.utils.decode_range(`A1:${XLSX.utils.encode_col(ds.length+2)}1`),XLSX.utils.decode_range(`A2:${XLSX.utils.encode_col(ds.length+2)}2`),XLSX.utils.decode_range(`A3:${XLSX.utils.encode_col(ds.length+2)}3`)];
  const excelRowPt=Math.max(18,Math.min(55,Math.round(300/Math.max(1,exportStaff.length))));
  ws['!rows']=data.map((_,idx)=>({hpt:idx<6?22:excelRowPt}));
  ws['!pageSetup']={orientation:'landscape',fitToWidth:1,fitToHeight:1,paperSize:8};
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Roster');XLSX.writeFile(wb,`Roster-${months[+monthEl.value]}-${yearEl.value}.xlsx`);
}

async function downloadPDF(){
 if(!getExportStaff().length)return alert('Add staff first.');
 try{const b=await createRosterPdfBlob(),fn=`Roster-${months[+monthEl.value]}-${yearEl.value}.pdf`,u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=fn;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500)}
 catch(e){console.error(e);alert('Could not create PDF: '+(e?.message||'Unknown error'))}
}
function imageData(src){return new Promise(resolve=>{const i=new Image();i.onload=()=>{const c=document.createElement('canvas');c.width=i.width;c.height=i.height;c.getContext('2d').drawImage(i,0,0);resolve(c.toDataURL('image/jpeg',.92))};i.onerror=()=>resolve(null);i.src=src})}


async function loadRosterHistory(){
  const body=document.getElementById('rosterHistory');
  if(!body)return;
  body.innerHTML='<tr><td colspan="4">Loading...</td></tr>';

  const {data,error}=await db
    .from('rosters')
    .select('id,title,month,year,updated_at')
    .order('year',{ascending:false})
    .order('month',{ascending:false});

  if(error){
    body.innerHTML='<tr><td colspan="4">Could not load history</td></tr>';
    showError('Could not load roster history',error);
    return;
  }

  if(!data || !data.length){
    body.innerHTML='<tr><td colspan="4">No previous roster saved yet.</td></tr>';
    return;
  }

  body.innerHTML=data.map(r=>`<tr>
    <td>${esc(r.title||'NURSING DUTY ROSTER')}</td>
    <td>${esc(months[Number(r.month)-1]||r.month)}</td>
    <td>${esc(r.year)}</td>
    <td>
      <button type="button" onclick="openSavedRoster('${r.id}',${Number(r.month)},${Number(r.year)})">Open</button>
      <button type="button" class="danger" onclick="deleteSavedRoster('${r.id}',${Number(r.month)},${Number(r.year)})">Delete</button>
    </td>
  </tr>`).join('');
}

async function openSavedRoster(rosterId,monthNumber,yearNumber){
  if(document.body.dataset.page==='history'){location.href=`roster.html?rosterId=${encodeURIComponent(rosterId)}&month=${encodeURIComponent(monthNumber)}&year=${encodeURIComponent(yearNumber)}`;return}
  try{
    viewingHistory=true;
    monthEl.value=String(Number(monthNumber)-1);yearEl.value=String(Number(yearNumber));
    const {data:r,error:rError}=await db.from('rosters').select('id,title,month,year').eq('id',rosterId).single();
    if(rError)throw rError;
    currentRosterId=r.id;rosterTitle.value=r.title||'NURSING DUTY ROSTER';assignments={};
    await ensureRosterSnapshot(rosterId);
    await loadRosterSnapshot(rosterId);
    const {data:aData,error:aError}=await db.from('roster_assignments').select('staff_id,duty_date,duty_code').eq('roster_id',rosterId);
    if(aError)throw aError;
    (aData||[]).forEach(x=>{if(x.staff_id)assignments[akey(x.staff_id,x.duty_date)]=x.duty_code});
    buildRoster();
    document.querySelector('.roster-card')?.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(error){showError('Could not open saved roster',error)}
}

async function deleteSavedRoster(rosterId,monthNumber,yearNumber){
  const label=`${months[Number(monthNumber)-1]} ${yearNumber}`;
  if(!confirm(`Delete saved roster for ${label}? All duty assignments of this month will also be deleted. This cannot be undone.`))return;

  const {error}=await db.from('rosters').delete().eq('id',rosterId);
  if(error){
    showError('Could not delete saved roster',error);
    return;
  }

  if(currentRosterId===rosterId){
    currentRosterId=null;
    assignments={};
    buildRoster();
  }

  await loadRosterHistory();
  alert(`Roster for ${label} deleted successfully.`);
}

async function clearAllData(){
  if(!confirm('Delete ALL cloud staff and roster data? This cannot be undone.'))return;
  alert('For safety, cloud-wide reset is disabled. Delete staff individually.');
}

async function changeMonth(){await loadRoster();buildRoster()}
if(monthEl)monthEl.onchange=changeMonth;
if(yearEl)yearEl.onchange=changeMonth;
if(rosterTitle)rosterTitle.oninput=buildRoster;

// Roster Table Zoom controls
let currentRosterZoom = 1.0;

window.adjustRosterZoom = function(amount) {
  currentRosterZoom = Math.max(0.5, Math.min(1.5, currentRosterZoom + amount));
  applyRosterZoom();
}

window.resetRosterZoom = function() {
  currentRosterZoom = 1.0;
  applyRosterZoom();
}

function applyRosterZoom() {
  const table = document.getElementById('rosterTable');
  const levelEl = document.getElementById('zoomLevel');
  if (table) {
    table.style.setProperty('--roster-zoom', currentRosterZoom);
    table.style.zoom = currentRosterZoom;
  }
  if (levelEl) {
    levelEl.textContent = Math.round(currentRosterZoom * 100) + '%';
  }
}

let hoveredUid = null;
document.addEventListener('mouseover', (e) => {
  const tr = e.target.closest('tr[data-uid]');
  hoveredUid = tr ? tr.dataset.uid : null;
});

document.addEventListener('keydown', (e) => {
  if (document.body.dataset.page !== 'roster') return;
  if (!e.ctrlKey) return;
  
  const uid = (document.activeElement && document.activeElement.tagName === 'INPUT' && document.activeElement.dataset.uid) || hoveredUid;
  if (!uid) return;
  
  if (e.key.toLowerCase() === 'c') {
    copyRow(uid);
    // Visual feedback for full row
    const tr = document.querySelector(`tr[data-uid="${uid}"]`);
    if (tr) {
      const originalBg = tr.style.backgroundColor;
      tr.style.backgroundColor = '#d1fae5';
      const inputs = tr.querySelectorAll('input');
      inputs.forEach(i => { i.dataset.origBg = i.style.backgroundColor; i.style.backgroundColor = '#d1fae5'; });
      setTimeout(() => {
        tr.style.backgroundColor = originalBg;
        inputs.forEach(i => i.style.backgroundColor = i.dataset.origBg || '');
      }, 300);
    }
  } else if (e.key.toLowerCase() === 'v') {
    e.preventDefault();
    pasteRow(uid);
  }
});

init();
