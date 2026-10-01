const db = window.db || window.supabaseClient || (window.getSupabaseClient ? window.getSupabaseClient() : null);



const HOSPITAL='Jain Diwakar Sri Aurobindo Hospital, Ratlam';
let staff=[];
let codes=[{name:'Morning',code:'M'},{name:'Evening',code:'E'},{name:'Night',code:'N'},{name:'Off',code:'O'},{name:'Leave',code:'LE'}];
let assignments={};
let savedAssignmentsBaseline={};
let savedAssignmentsBaselineRosterId=null;
let rosterDutySaveQueue=Promise.resolve();
let staffLeaveDutyKeys=new Set();
let currentRosterId=null;
let forceCreateRoster=false;
let rosterStaff=[];
let manualRosterRows=[];
let manualRosterRowSequence=0;
let manualRowsSaveQueue=Promise.resolve();
let subtitleColumnAvailable=true;
let subtitleMigrationWarningShown=false;
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
function rosterDays(){const y=Number(yearEl?.value),m=Number(monthEl?.value);if(!Number.isInteger(y)||y<2020||y>2100||!Number.isInteger(m)||m<0||m>11)return [];return Array.from({length:new Date(y,m+1,0).getDate()},(_,i)=>new Date(y,m,i+1))}
function localDateKey(d){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`}
function akey(id,date){return `${id}|${date}`}
function queueRosterDutySave(uid,date,value){
  rosterDutySaveQueue=rosterDutySaveQueue.catch(()=>{}).then(()=>setDuty(uid,date,value));
  return rosterDutySaveQueue;
}
function rememberRosterAssignments(rosterId,source=assignments){
  savedAssignmentsBaselineRosterId=rosterId?String(rosterId):null;
  savedAssignmentsBaseline={...source};
}
async function restoreRosterAssignments(rosterId,snapshot){
  if(!rosterId)return;
  const {data:current,error:readError}=await db.from('roster_assignments').select('staff_id,duty_date').eq('roster_id',rosterId);
  if(readError)throw readError;
  const rows=Object.entries(snapshot||{}).map(([key,duty_code])=>{
    const split=key.lastIndexOf('|');
    return {roster_id:rosterId,staff_id:key.slice(0,split),duty_date:key.slice(split+1),duty_code};
  }).filter(row=>row.staff_id&&row.duty_date&&row.duty_code);
  if(rows.length){
    const {error}=await db.from('roster_assignments').upsert(rows,{onConflict:'roster_id,staff_id,duty_date'});
    if(error)throw error;
  }
  const keep=new Set(rows.map(row=>akey(row.staff_id,row.duty_date)));
  const staleByStaff=new Map();
  (current||[]).forEach(row=>{
    const staffId=String(row.staff_id),date=String(row.duty_date);
    if(keep.has(akey(staffId,date)))return;
    if(!staleByStaff.has(staffId))staleByStaff.set(staffId,[]);
    staleByStaff.get(staffId).push(date);
  });
  for(const [staffId,dates] of staleByStaff){
    const {error}=await db.from('roster_assignments').delete().eq('roster_id',rosterId).eq('staff_id',staffId).in('duty_date',dates);
    if(error)throw error;
  }
}
function manualRowsStorageKey(){return `sa_manual_roster_rows:${getFullRosterTitle()}`}
function loadManualRosterRows(){try{const rows=JSON.parse(localStorage.getItem(manualRowsStorageKey())||'[]');return Array.isArray(rows)?rows:[]}catch{return []}}
function saveManualRosterRows(){try{localStorage.setItem(manualRowsStorageKey(),JSON.stringify(manualRosterRows))}catch(e){console.warn('Could not save extra roster rows locally:',e)}}
function rosterSubtitleStorageKey(rosterId){return `sa_roster_staff_subtitles:${rosterId}`}
function loadRosterSubtitlesLocally(rosterId){try{return JSON.parse(localStorage.getItem(rosterSubtitleStorageKey(rosterId))||'{}')}catch{return {}}}
function saveRosterSubtitlesLocally(rosterId,list){try{localStorage.setItem(rosterSubtitleStorageKey(rosterId),JSON.stringify(Object.fromEntries(list.map(person=>[String(person.uid),String(person.subtitle||'')]))))}catch(e){console.warn('Could not cache staff subtitles:',e)}}
function isMissingSubtitleColumn(error){return ['42703','PGRST204'].includes(error?.code)||/subtitle.{0,80}(column|schema cache|does not exist)|column.{0,80}subtitle/i.test(String(error?.message||''))}
function showSubtitleMigrationWarning(){
  if(subtitleMigrationWarningShown)return;
  subtitleMigrationWarningShown=true;
  showAppDialog('Staff subtitles are saved in this browser for now. To sync them with saved rosters and include them from every device, run database/roster-staff-subtitle.sql in the database SQL editor.',{title:'Subtitle database setup needed'});
}
let manualRowsSchemaWarningShown=false;
function isMissingManualRowsTable(error){return ['42P01','PGRST205'].includes(error?.code)||/roster_manual_rows.{0,80}(not found|does not exist)|could not find.{0,80}roster_manual_rows/i.test(String(error?.message||''))}
function showManualRowsSchemaWarning(){
  if(manualRowsSchemaWarningShown)return;
  manualRowsSchemaWarningShown=true;
  showAppDialog('The roster is saved, but blank rows need the database setup first. Run database/roster-manual-rows.sql in the database SQL editor, then reopen the roster.',{title:'Blank rows need database setup'});
}
async function persistManualRosterRows(rosterId=currentRosterId){
  const rid=rosterId||await ensureRoster();
  if(!rid)throw new Error('Save or select a roster before saving blank rows.');
  const rows=manualRosterRows.map((row,index)=>({
    roster_id:rid,row_key:String(row.id),sort_order:index+1,
    name:String(row.name||''),unid_no:String(row.unid||''),duties:row.duties||{}
  }));
  const {data:existing,error:readError}=await db.from('roster_manual_rows').select('row_key').eq('roster_id',rid);
  if(readError){if(!rows.length&&isMissingManualRowsTable(readError))return rid;throw readError}
  if(rows.length){
    const {error}=await db.from('roster_manual_rows').upsert(rows,{onConflict:'roster_id,row_key'});
    if(error)throw error;
  }
  const keep=new Set(rows.map(row=>row.row_key));
  const stale=(existing||[]).map(row=>row.row_key).filter(key=>!keep.has(String(key)));
  if(stale.length){
    const {error}=await db.from('roster_manual_rows').delete().eq('roster_id',rid).in('row_key',stale);
    if(error)throw error;
  }
  return rid;
}
function queueManualRosterRowsSave(){
  manualRowsSaveQueue=manualRowsSaveQueue.catch(()=>{}).then(async()=>{
    const rid=await persistManualRosterRows();
    const status=document.getElementById('rosterSaveStatus');
    if(status)status.textContent='Blank rows saved';
    return rid;
  }).catch(error=>{
    const status=document.getElementById('rosterSaveStatus');
    if(status)status.textContent=isMissingManualRowsTable(error)?'Blank rows need database setup':'Blank rows not saved';
    if(isMissingManualRowsTable(error))showManualRowsSchemaWarning();
    else showError('Could not save blank rows to the database',error);
  });
  return manualRowsSaveQueue;
}
async function loadManualRosterRowsFromDatabase(rosterId){
  const {data,error}=await db.from('roster_manual_rows').select('row_key,sort_order,name,unid_no,duties').eq('roster_id',rosterId).order('sort_order');
  if(error)throw error;
  const savedRows=data||[];
  if(!savedRows.length&&manualRosterRows.length){
    // Bring forward browser-only rows from older saves the first time DB support is enabled.
    await persistManualRosterRows(rosterId);
    return;
  }
  manualRosterRows=savedRows.map(row=>({id:row.row_key,name:row.name||'',unid:row.unid_no||'',duties:row.duties||{}}));
  saveManualRosterRows();
}
function addManualRosterRow(){
  if(!rosterTitle?.value.trim()){alert('Add or select a roster title first.');openTitleDropdown();return}
  if(!rosterDays().length){alert('Choose a valid month and year first.');return}
  if(manualRosterRows.length>=60){alert('You can add up to 60 blank rows.');return}
  manualRosterRows.push({id:`manual-${Date.now()}-${++manualRosterRowSequence}`,duties:{}});
  saveManualRosterRows();buildRoster();void queueManualRosterRowsSave();
}
function setManualRosterDuty(id,date,value){
  const row=manualRosterRows.find(r=>r.id===id);if(!row)return;
  const code=normalizeDutyEntry(value);
  if(code===null){alert('Enter one duty code or two codes separated by /. Example: M/E.');buildRoster();return}
  if(code)row.duties[date]=code;else delete row.duties[date];saveManualRosterRows();void queueManualRosterRowsSave();
}
function setManualRosterIdentity(id,field,value){
  const row=manualRosterRows.find(r=>r.id===id);if(!row||!['name','unid'].includes(field))return;
  row[field]=String(value||'').trim();saveManualRosterRows();void queueManualRosterRowsSave();
}
function removeManualRosterRow(id){manualRosterRows=manualRosterRows.filter(r=>r.id!==id);saveManualRosterRows();buildRoster();void queueManualRosterRowsSave()}
function showError(prefix,error){console.error(prefix,error);alert(`${prefix}. Please try again, or contact the administrator if this continues.`)}
function normalizeDutyEntry(value){
  const text=String(value||'').trim().toUpperCase().replace(/\s*\/\s*/g,'/');
  if(!text)return '';
  const parts=text.split('/');
  if(parts.length>2||parts.some(code=>!code||!codes.some(c=>String(c.code).toUpperCase()===code)))return null;
  if(parts.includes('LE'))return null;
  return text;
}

async function init(){
  const page=document.body.dataset.page||'legacy';
  try{
    if(page==='staff'){await loadStaff();return}
    if(page==='staff-leave'){
      const today=localDateKey(new Date());
      const from=document.getElementById('leaveStartDate'),to=document.getElementById('leaveEndDate');
      if(from&&!from.value)from.value=today;if(to&&!to.value)to.value=today;
      await loadStaff();await loadStaffLeaves();return;
    }
    if(page==='history'){await loadStaff();await loadRosterHistory();return}
    if(page==='daily-message'){renderCodes();syncDailyDutyDate();return}
    if(page==='roster'){
      initTitleDropdown();
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
  const name=staffName?.value.trim(),id=staffId?.value.trim();
  if(!name){alert('Staff name required.');staffName?.focus();return}
  const button=document.querySelector('body[data-page="staff"] .staff-entry-submit');
  if(button){button.disabled=true;button.textContent='Adding…'}
  try{
    if(!db)throw new Error('The app could not connect to its data service. Refresh the page and try again.');
    const {error}=await db.from('staff').insert({name,unid_no:id||null});
    if(error){
      console.error('Could not add staff',error);
      const message=error.code==='42501'
        ? 'Your account is not allowed to add staff yet. The staff-table insert permission needs to be enabled for signed-in users.'
        : error.code==='23505'
          ? 'A staff member with this name or ID already exists.'
          : error.code==='23502'
            ? 'A required staff field is missing in the database. Please check the staff table setup.'
            : error.message||'The staff member could not be saved. Please check your connection and try again.';
      alert(message);return;
    }
    staffName.value='';staffId.value='';
    await loadStaff();
    staffName.focus();
    if(currentRosterId){
      try{
        await syncCurrentStaffIntoRoster(currentRosterId);
        await loadRosterSnapshot(currentRosterId);
      }catch(e){showError('Staff added, but could not add to current roster',e);return}
    }
    buildRoster();
  }catch(error){showError('Could not add staff',error)}
  finally{if(button){button.disabled=false;button.textContent='Add staff member'}}
}


async function syncStaffToCurrentRoster(){
  try{
    viewingHistory=false;
    const rid=await ensureRoster();if(!rid){if(status)status.textContent='Could not save changes';return}
    const subtitles=new Map(rosterStaff.map(person=>[String(person.uid),person.subtitle||'']));
    rosterStaff=staff.map(person=>({...person,subtitle:subtitles.get(String(person.uid))||''}));
    await saveRosterStaffSnapshot(rid, rosterStaff);
    buildRoster();
    updateSelectedStaffBadge();
    alert('All current staff are now included in this roster.');
  }catch(e){showError('Could not sync staff',e)}
}

async function deleteStaff(uid){
  if(!await showAppDialog('Delete this staff member from the staff list? Previous saved rosters will keep the staff name, UNID and duties.',{kind:'confirm',title:'Delete staff member'}))return;
  const {error}=await db.from('staff').delete().eq('id',uid);
  if(error){showError('Could not delete staff',error);return}
  await loadStaff();
  rosterStaff=rosterStaff.filter(s=>String(s.uid)!==String(uid));
  updateSelectedStaffBadge();
  if(currentRosterId){await saveRosterStaffSnapshot(currentRosterId, rosterStaff)}
  buildRoster();
}

async function editStaff(uid){
  const person=staff.find(s=>String(s.uid)===String(uid));if(!person)return;
  const name=await showAppDialog('Update this staff member’s name.',{kind:'prompt',title:'Edit staff member',defaultValue:person.name,placeholder:'Full name'});
  if(name===null)return;
  const cleanName=String(name).trim();
  if(!cleanName){alert('Staff name required.');return}
  const id=await showAppDialog('Update the staff ID / UNID, or leave it empty.',{kind:'prompt',title:'Edit staff ID',defaultValue:person.id||'',placeholder:'Optional staff ID'});
  if(id===null)return;
  const cleanId=String(id).trim();
  const {error}=await db.from('staff').update({name:cleanName,unid_no:cleanId||null}).eq('id',uid);
  if(error){showError('Could not update staff member',error);return}
  await loadStaff();
  staffName?.focus();
}

function renderStaff(){
  if(!staffList||!emptyStaff||!staffCount)return;
  staffList.innerHTML=staff.map((s,i)=>`<tr><td data-label="Sr.">${i+1}</td><td data-label="Staff name" class="staff-name-cell">${esc(s.name)}</td><td data-label="UNID / ID" class="staff-id-cell">${esc(s.id||'—')}</td><td data-label="Actions" class="staff-actions"><button type="button" class="staff-edit-btn" onclick="editStaff('${s.uid}')">Edit</button><button type="button" class="danger" onclick="deleteStaff('${s.uid}')">Delete</button></td></tr>`).join('');
  emptyStaff.style.display=staff.length?'none':'block';
  document.querySelector('.staff-list-card')?.classList.toggle('is-empty',staff.length===0);
  staffCount.textContent=staff.length+' staff';
}

function addDutyCode(name,code){
  if(name===undefined||code===undefined){
    requestDutyCodeDetails();return false;
  }
  name=String(name||'').trim();code=String(code||'').trim().toUpperCase();
  if(!name||!code){alert('Enter both a duty name and a short code.');return false;}
  if(!/^[A-Z0-9]{1,4}(?:\/[A-Z0-9]{1,4})?$/.test(code)){alert('Use one code or two 1–4 character codes separated by /. Example: M/E.');return false;}
  const parts=code.split('/');
  if(parts.length===2&&parts.includes('LE')){alert('LE is reserved for staff leave records and cannot be combined with another duty.');return false;}
  if(parts.length===2&&!parts.every(part=>codes.some(item=>String(item.code).toUpperCase()===part))){alert('A combined duty code must use existing codes. Example: M/E.');return false;}
  if(codes.some(c=>String(c.code).toUpperCase()===code)){alert('Code already exists.');return false;}
  codes.push({name,code});localStorage.setItem('sa_custom_codes',JSON.stringify(codes));renderCodes();buildRoster();return true;
}
async function requestDutyCodeDetails(){
  const name=await showAppDialog('Enter a name for the new duty code.',{kind:'prompt',title:'Add duty code',placeholder:'e.g. Weekly Off'});
  if(!name?.trim())return;
  const code=await showAppDialog('Enter one code or two existing 1–4 character codes separated by /. Example: M/E.',{kind:'prompt',title:'Add duty code',placeholder:'e.g. WO or M/E'});
  if(!code?.trim())return;
  addDutyCode(name,code);
}

function addDutyCodeFromPortal(event){
  event.preventDefault();
  const form=event.currentTarget;
  const name=form.elements.namedItem('dutyName').value;
  const code=form.elements.namedItem('dutyCode').value;
  if(addDutyCode(name,code)){
    const portal=document.getElementById('_dutyPortal');
    if(portal){_renderDutyPortal(portal);_positionPortal(portal,document.getElementById('dutyCodesTrigger'),340);portal.querySelector('[name="dutyCode"]')?.focus()}
  }
}
function renderCodes(){
  try { const saved=JSON.parse(localStorage.getItem('sa_custom_codes')||'null');if(Array.isArray(saved))codes=saved; } catch { localStorage.removeItem('sa_custom_codes'); }
  const leaveCode=codes.find(c=>String(c.code||'').toUpperCase()==='LE');
  if(leaveCode){leaveCode.code='LE';leaveCode.name='Leave';}else codes.push({name:'Leave',code:'LE'});
  if(!dutyLegend||!printLegend)return;
  dutyLegend.innerHTML=codes.map((c,i)=>`<span class="chip"><b>${esc(c.code)}</b> = ${esc(c.name)}${String(c.code).toUpperCase()==='LE'?' <span class="system-code-label">System</span>':` <button type="button" class="code-delete" onclick="deleteDutyCode(${i})" title="Delete ${esc(c.code)}">×</button>`}</span>`).join('');
  printLegend.innerHTML=codes.map(c=>`${esc(c.code)} = ${esc(c.name)}`).join(' &nbsp;&nbsp; | &nbsp;&nbsp; ');
  updateDutyCodesTriggerLabel && updateDutyCodesTriggerLabel();
}
async function deleteDutyCode(index){
  const c=codes[index];if(!c)return;
  const code=String(c.code).toUpperCase();
  if(code==='LE'){showAppDialog('LE is reserved for staff leave records and cannot be removed.',{title:'System duty code'});return}
  const used=Object.values(assignments).some(v=>String(v).toUpperCase()===code||String(v).toUpperCase().split('/').includes(code));
  const msg=used
    ? `Delete duty code "${c.code} = ${c.name}"? This code is already used in roster cells. Existing saved cells will remain as "${c.code}", but new entries will no longer accept it.`
    : `Delete duty code "${c.code} = ${c.name}"?`;
  if(!await showAppDialog(msg,{kind:'confirm',title:'Delete duty code'}))return;
  codes.splice(index,1);
  localStorage.setItem('sa_custom_codes',JSON.stringify(codes));
  renderCodes();buildRoster();
}

/* =========================================================
   User-managed roster title list
   ========================================================= */
const TITLE_STORAGE_KEY = 'sa_custom_roster_titles';
let _titleDropdownOpen = false;

function getTitlePresets() {
  let custom=[];
  try { const stored=JSON.parse(localStorage.getItem(TITLE_STORAGE_KEY)||'[]');if(Array.isArray(stored))custom=stored; }
  catch { localStorage.removeItem(TITLE_STORAGE_KEY); }
  const seen = new Set();
  return custom.map(t=>String(t).trim().toUpperCase()).filter(t=>{
    const key=t.toLocaleUpperCase();
    if(!t||seen.has(key))return false;
    seen.add(key);return true;
  });
}

function saveCustomTitle(title) {
  const t = title.trim().replace(/\s+/g,' ').toUpperCase();
  if (!t) { alert('Enter a roster title first.'); return false; }
  if (t.length>60) { alert('Roster titles can be up to 60 characters.'); return false; }
  const custom = getTitlePresets();
  if (custom.some(c => c.toUpperCase() === t)) { alert('This title is already in your saved title list.'); return false; }
  custom.push(t);
  localStorage.setItem(TITLE_STORAGE_KEY, JSON.stringify(custom));
  updateTitleDropdownLabel();
  return true;
}

function deleteCustomTitle(title) {
  const t = title.trim().toUpperCase();
  const custom = getTitlePresets().filter(c => c.toUpperCase() !== t);
  localStorage.setItem(TITLE_STORAGE_KEY, JSON.stringify(custom));
  updateTitleDropdownLabel();
}

function setRosterTitle(value) {
  const hiddenInput = document.getElementById('rosterTitle');
  const displayEl   = document.getElementById('titleDropdownValue');
  const previousTitle=hiddenInput?.value.trim()||'';
  const title=String(value||'').trim();
  if (hiddenInput) hiddenInput.value = title;
  manualRosterRows=title?loadManualRosterRows():[];
  if (displayEl) { displayEl.textContent = title || 'Select or add a roster title'; displayEl.classList.toggle('is-placeholder',!title); }
  currentRosterId = null;
  forceCreateRoster = false;
  rememberRosterAssignments(null,{});
  staffLeaveDutyKeys=new Set();
  if(previousTitle.toUpperCase()!==title.toUpperCase()){
    assignments={};
    if(previousTitle)rosterStaff=[];
    updateSelectedStaffBadge();
  }
  buildRoster();
}

/* --- Portal helpers --- */
function _getOrCreatePortal(id) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }
  return el;
}

function _positionPortal(portal, triggerEl, maxWidth=380) {
  if(!triggerEl)return;
  const r = triggerEl.getBoundingClientRect();
  const viewportWidth=window.innerWidth;
  const spaceBelow = window.innerHeight - r.bottom;
  const spaceAbove = r.top;
  const goUp = spaceBelow < 260 && spaceAbove > spaceBelow;
  const width=Math.max(0,Math.min(Math.max(r.width,300),maxWidth,viewportWidth-24));

  portal.style.position  = 'fixed';
  portal.style.zIndex    = '999999';
  portal.style.width     = width + 'px';
  portal.style.maxWidth  = 'calc(100vw - 24px)';
  portal.style.maxHeight = Math.max(180,Math.min(430,window.innerHeight-24)) + 'px';
  portal.style.overflowY = 'auto';
  portal.style.left      = Math.max(12,Math.min(r.left,viewportWidth-width-12)) + 'px';

  if (goUp) {
    portal.style.top    = 'auto';
    portal.style.bottom = (window.innerHeight-r.top+6)+'px';
  } else {
    portal.style.top    = (r.bottom + 6) + 'px';
    portal.style.bottom = 'auto';
  }
}

/* --- Title Dropdown --- */
function toggleTitleDropdown(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  _titleDropdownOpen ? closeTitleDropdown() : openTitleDropdown();
}

function openTitleDropdown() {
  closeDutyCodesPanel();
  _titleDropdownOpen = true;
  const btn  = document.getElementById('titleDropdownBtn');
  const wrap = document.getElementById('titleDropdownWrap');
  if (btn)  btn.setAttribute('aria-expanded', 'true');
  if (wrap) wrap.classList.add('open');

  const portal = _getOrCreatePortal('_titlePortal');
  portal.className = 'title-dropdown-portal';
  portal.setAttribute('role','dialog');
  portal.setAttribute('aria-label','Manage roster titles');
  _positionPortal(portal, btn, 420);
  _renderTitlePortal(portal);
  portal.style.display = 'block';
  portal.querySelector('#titlePresetInput')?.focus();
}

function closeTitleDropdown() {
  _titleDropdownOpen = false;
  const btn  = document.getElementById('titleDropdownBtn');
  const wrap = document.getElementById('titleDropdownWrap');
  if (btn)  btn.setAttribute('aria-expanded', 'false');
  if (wrap) wrap.classList.remove('open');
  const portal = document.getElementById('_titlePortal');
  if (portal) portal.style.display = 'none';
}

function _renderTitlePortal(portal) {
  const presets = getTitlePresets();
  const current = (document.getElementById('rosterTitle')?.value || '').trim().toUpperCase();
  portal.innerHTML = `<div class="title-portal-header"><strong>Roster titles</strong><span>${presets.length} saved</span></div>
    <div class="title-portal-list">${presets.length ? presets.map(title=>`<div class="title-opt${title===current?' is-active':''}">
      <button type="button" class="title-opt-select" data-select-title="${esc(title)}"><span class="title-opt-text">${esc(title)}</span>${title===current?'<span class="title-opt-check">✓</span>':''}</button>
      <button type="button" class="title-opt-del" data-delete-title="${esc(title)}" aria-label="Delete ${esc(title)}" title="Delete saved title">×</button>
    </div>`).join('') : '<p class="title-portal-empty">No saved titles yet. Add your first title below.</p>'}</div>
    <form class="title-add-form" id="titlePresetForm"><label for="titlePresetInput">Add a title</label><div class="title-add-row"><input id="titlePresetInput" name="title" type="text" maxlength="60" placeholder="e.g. Nursing duty roster" required><button type="submit">＋ Add title</button></div></form>`;
  portal.querySelector('#titlePresetForm')?.addEventListener('submit',addTitlePresetFromForm);
  portal.querySelectorAll('[data-select-title]').forEach(button=>button.addEventListener('click',()=>selectTitleOption(button.dataset.selectTitle)));
  portal.querySelectorAll('[data-delete-title]').forEach(button=>button.addEventListener('click',()=>deleteTitleOption(button.dataset.deleteTitle)));
}

function addTitlePresetFromForm(event){
  event.preventDefault();
  const input=document.getElementById('titlePresetInput');
  const title=(input?.value||'').trim().replace(/\s+/g,' ');
  if(!saveCustomTitle(title)){input?.focus();return;}
  const saved=title.toUpperCase();
  closeTitleDropdown();setRosterTitle(saved);loadRoster().then(buildRoster);
}

function selectTitleOption(title) {
  setRosterTitle(title);
  closeTitleDropdown();
  loadRoster().then(() => buildRoster());
}

async function deleteTitleOption(title) {
  if (!await showAppDialog(`Remove "${title}" from your saved roster titles? Saved rosters in the archive will not be deleted.`,{kind:'confirm',title:'Remove roster title'})) return;
  deleteCustomTitle(title);
  const current = document.getElementById('rosterTitle')?.value || '';
  if (current.toUpperCase() === title.toUpperCase()) { setRosterTitle('');loadRoster(); }
  const portal = document.getElementById('_titlePortal');
  if (portal) { _renderTitlePortal(portal);_positionPortal(portal,document.getElementById('titleDropdownBtn'),420); }
}

function initTitleDropdown() {
  const hiddenInput = document.getElementById('rosterTitle');
  const displayEl   = document.getElementById('titleDropdownValue');
  if (hiddenInput && displayEl) { hiddenInput.value='';displayEl.textContent='Select or add a roster title';displayEl.classList.add('is-placeholder'); }
  updateTitleDropdownLabel();
}

function updateTitleDropdownLabel(){
  const btn=document.getElementById('titleDropdownBtn');
  if(btn){const count=getTitlePresets().length;btn.setAttribute('title',`${count} saved roster titles`);btn.setAttribute('aria-label',`${count} saved roster titles. Select or add a roster title`)}
}

/* =========================================================
   DUTY CODES PANEL — fixed-position portal (escapes overflow)
   ========================================================= */
let _dutyPanelOpen = false;

function toggleDutyCodesPanel(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  _dutyPanelOpen ? closeDutyCodesPanel() : openDutyCodesPanel();
}

function openDutyCodesPanel() {
  closeTitleDropdown();
  _dutyPanelOpen = true;
  const trigger = document.getElementById('dutyCodesTrigger');
  const wrap    = document.getElementById('dutyCodesWrap');
  if (trigger) trigger.setAttribute('aria-expanded', 'true');
  if (wrap)    wrap.classList.add('open');

  const portal = _getOrCreatePortal('_dutyPortal');
  portal.className = 'duty-codes-portal';
  portal.setAttribute('role','dialog');
  portal.setAttribute('aria-label','Manage duty codes');
  _positionPortal(portal, trigger, 340);
  _renderDutyPortal(portal);
  portal.style.display = 'block';
}

function closeDutyCodesPanel() {
  _dutyPanelOpen = false;
  const trigger = document.getElementById('dutyCodesTrigger');
  const wrap    = document.getElementById('dutyCodesWrap');
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
  if (wrap)    wrap.classList.remove('open');
  const portal = document.getElementById('_dutyPortal');
  if (portal)  portal.style.display = 'none';
}

function _renderDutyPortal(portal) {
  const codeItems = codes.map((c, i) => `
    <div class="duty-opt">
      <span class="duty-opt-code">${esc(c.code)}</span>
      <span class="duty-opt-name">${esc(c.name)}</span>
      <button type="button" class="duty-opt-del" onclick="deleteDutyCode(${i})" aria-label="Delete duty code ${esc(c.code)}" title="Delete ${esc(c.code)}">×</button>
    </div>`).join('');
  portal.innerHTML = `
    <div class="duty-portal-header">
      <span class="duty-portal-title">Duty codes</span>
      <span class="duty-portal-count">${codes.length} total</span>
    </div>
    <div class="duty-portal-list">${codeItems || '<p class="duty-portal-empty">No duty codes yet. Add the first one below.</p>'}</div>
    <form class="duty-code-add-form" id="dutyCodeForm">
      <label for="dutyCodeInput">Add a duty code</label>
      <div class="duty-code-add-row"><input id="dutyCodeInput" name="dutyCode" maxlength="9" pattern="[A-Za-z0-9]{1,4}(/[A-Za-z0-9]{1,4})?" placeholder="Code (e.g. M/E)" aria-label="Short duty code, or two existing codes separated by slash" title="Use a code like M or two existing codes like M/E" required><input id="dutyNameInput" name="dutyName" maxlength="40" placeholder="Duty name" aria-label="Duty name" required><button type="submit">＋ Add</button></div>
      <small>Use 1–4 letters or numbers, such as D or WO.</small>
    </form>`;
  portal.querySelector('#dutyCodeForm')?.addEventListener('submit',addDutyCodeFromPortal);
}

function updateDutyCodesTriggerLabel() {
  const el = document.getElementById('dutyCodesTriggerLabel');
  if (el) el.textContent = `Duty Codes (${codes.length})`;
  // Re-render portal if open
  if (_dutyPanelOpen) {
    const portal = document.getElementById('_dutyPortal');
    if (portal) _renderDutyPortal(portal);
  }
}

/* --- Close both portals on outside click / Escape --- */
document.addEventListener('click', e => {
  if (_titleDropdownOpen) {
    const btn  = document.getElementById('titleDropdownBtn');
    const portal = document.getElementById('_titlePortal');
    if (btn && !btn.contains(e.target) && portal && !portal.contains(e.target)) closeTitleDropdown();
  }
  if (_dutyPanelOpen) {
    const trigger = document.getElementById('dutyCodesTrigger');
    const portal  = document.getElementById('_dutyPortal');
    if (trigger && !trigger.contains(e.target) && portal && !portal.contains(e.target)) closeDutyCodesPanel();
  }
});

function repositionOpenPortals(){
  if(_titleDropdownOpen)_positionPortal(document.getElementById('_titlePortal'),document.getElementById('titleDropdownBtn'),420);
  if(_dutyPanelOpen)_positionPortal(document.getElementById('_dutyPortal'),document.getElementById('dutyCodesTrigger'),340);
}
window.addEventListener('resize',repositionOpenPortals);
document.addEventListener('scroll',repositionOpenPortals,true);



let tempSelectedStaffOrder = []; // Array preserving selection order
let modalSearchQuery = '';

function updateSelectedStaffBadge() {
  const badge = document.getElementById('selectedStaffBadge');
  if (badge) {
    badge.textContent = rosterStaff ? rosterStaff.length : 0;
  }
}

function openStaffModal() {
  if (!staff || !staff.length) {
    alert('No staff members registered in the system yet. Please add staff in the "Staff" page first.');
    return;
  }

  const modal = document.getElementById('staffModalOverlay');
  if (!modal) return;

  const sub = document.getElementById('staffModalSubtitle');
  if (sub && monthEl && yearEl) {
    sub.textContent = `Choose which staff members should be included in the ${months[+monthEl.value]} ${yearEl.value} duty roster.`;
  }

  // Pre-populate with currently selected rosterStaff, preserving their order
  tempSelectedStaffOrder = (rosterStaff || []).map(s => String(s.uid));

  const searchInput = document.getElementById('modalStaffSearch');
  if (searchInput) {
    searchInput.value = '';
    modalSearchQuery = '';
  }
  const clearBtn = document.getElementById('modalSearchClear');
  if (clearBtn) clearBtn.style.display = 'none';

  renderModalStaffList();

  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  if (searchInput) {
    setTimeout(() => searchInput.focus(), 150);
  }
}

function closeStaffModal() {
  const modal = document.getElementById('staffModalOverlay');
  if (modal) {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
  }
  document.body.style.overflow = '';
}

function handleModalBackdropClick(event) {
  if (event.target && event.target.id === 'staffModalOverlay') {
    closeStaffModal();
  }
}

function onStaffSearchChange(val) {
  modalSearchQuery = (val || '').trim().toLowerCase();
  const clearBtn = document.getElementById('modalSearchClear');
  if (clearBtn) {
    clearBtn.style.display = modalSearchQuery ? 'block' : 'none';
  }
  renderModalStaffList();
}

function focusModalStaffSearch(selectQuery = false) {
  const input = document.getElementById('modalStaffSearch');
  if (!input) return;
  input.focus();
  if (selectQuery) input.select();
}

function handleModalStaffKeyboard(event) {
  const modal = document.getElementById('staffModalOverlay');
  if (!modal || !modal.classList.contains('active')) return;

  const search = document.getElementById('modalStaffSearch');
  const options = Array.from(document.querySelectorAll('#modalStaffContainer input[type="checkbox"]'));
  if (event.target === search && event.key === 'ArrowDown' && options.length) {
    event.preventDefault();
    options[0].focus();
    return;
  }

  const index = options.indexOf(event.target);
  if (index < 0) return;

  if (event.key === 'ArrowDown' && index < options.length - 1) {
    event.preventDefault();
    options[index + 1].focus();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (index > 0) options[index - 1].focus();
    else if (search) search.focus();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    options[index].click();
  }
  // Tab and Space keep their native browser behavior.
}

document.addEventListener('keydown', handleModalStaffKeyboard);

function clearModalStaffSearch() {
  const input = document.getElementById('modalStaffSearch');
  if (input) input.value = '';
  modalSearchQuery = '';
  const clearBtn = document.getElementById('modalSearchClear');
  if (clearBtn) clearBtn.style.display = 'none';
  renderModalStaffList();
  focusModalStaffSearch();
}

function renderModalStaffList() {
  const container = document.getElementById('modalStaffContainer');
  const selCountEl = document.getElementById('modalSelectedCount');
  const totCountEl = document.getElementById('modalTotalCount');
  const btnCountEl = document.getElementById('modalBtnCount');

  if (!container) return;

  const selectedSet = new Set(tempSelectedStaffOrder);

  const filtered = staff.filter(s => {
    if (!modalSearchQuery) return true;
    const nameMatch = (s.name || '').toLowerCase().includes(modalSearchQuery);
    const idMatch = (s.id || '').toLowerCase().includes(modalSearchQuery);
    return nameMatch || idMatch;
  });

  if (selCountEl) selCountEl.textContent = tempSelectedStaffOrder.length;
  if (totCountEl) totCountEl.textContent = staff.length;
  if (btnCountEl) btnCountEl.textContent = tempSelectedStaffOrder.length;

  if (!filtered.length) {
    container.innerHTML = `
      <div class="modal-empty-state">
        <p>No staff found matching "<strong>${esc(modalSearchQuery)}</strong>"</p>
        <button type="button" class="secondary compact-btn" onclick="clearModalStaffSearch()">Clear Search</button>
      </div>
    `;
    return;
  }

  let html = '';
  filtered.forEach(s => {
    const isChecked = selectedSet.has(String(s.uid));
    const selIndex = tempSelectedStaffOrder.indexOf(String(s.uid));
    html += `
      <div class="modal-staff-item ${isChecked ? 'is-selected' : ''}" onclick="toggleModalStaffItem('${s.uid}', event)">
        <input type="checkbox" id="modal_staff_${s.uid}" ${isChecked ? 'checked' : ''} onclick="event.stopPropagation(); toggleModalStaffItem('${s.uid}')" aria-label="Select ${esc(s.name)}">
        <div class="staff-info">
          <span class="staff-name-text">${esc(s.name)}</span>
          ${s.id ? `<span class="staff-unid-tag">UNID: ${esc(s.id)}</span>` : '<span class="staff-unid-tag muted">No UNID</span>'}
        </div>
        ${isChecked ? `<span class="modal-sel-order">#${selIndex + 1}</span>` : ''}
      </div>
    `;
  });

  container.innerHTML = html;
}

function toggleModalStaffItem(uid, event) {
  const strId = String(uid);
  const idx = tempSelectedStaffOrder.indexOf(strId);
  if (idx !== -1) {
    tempSelectedStaffOrder.splice(idx, 1);
  } else {
    tempSelectedStaffOrder.push(strId);
  }
  renderModalStaffList();
  // Keep the picker ready for the next search and select the old query so typing
  // a new name replaces it immediately.
  focusModalStaffSearch(true);
}

function modalSelectAll() {
  const filtered = staff.filter(s => {
    if (!modalSearchQuery) return true;
    const nameMatch = (s.name || '').toLowerCase().includes(modalSearchQuery);
    const idMatch = (s.id || '').toLowerCase().includes(modalSearchQuery);
    return nameMatch || idMatch;
  });
  // Add only those not already in the order array (append at end)
  const selectedSet = new Set(tempSelectedStaffOrder);
  filtered.forEach(s => {
    if (!selectedSet.has(String(s.uid))) {
      tempSelectedStaffOrder.push(String(s.uid));
    }
  });
  renderModalStaffList();
}

function modalDeselectAll() {
  if (modalSearchQuery) {
    const filtered = staff.filter(s => {
      const nameMatch = (s.name || '').toLowerCase().includes(modalSearchQuery);
      const idMatch = (s.id || '').toLowerCase().includes(modalSearchQuery);
      return nameMatch || idMatch;
    });
    const removeSet = new Set(filtered.map(s => String(s.uid)));
    tempSelectedStaffOrder = tempSelectedStaffOrder.filter(id => !removeSet.has(id));
  } else {
    tempSelectedStaffOrder = [];
  }
  renderModalStaffList();
}

async function applyStaffSelection() {
  // Build staff list in the exact order the user selected them
  const staffMap = new Map(staff.map(s => [String(s.uid), s]));
  const existingRosterStaff = new Map((rosterStaff||[]).map(person=>[String(person.uid),person]));
  rosterStaff = tempSelectedStaffOrder
    .map(id => staffMap.get(id))
    .filter(Boolean)
    .map(person=>({...person,subtitle:existingRosterStaff.get(String(person.uid))?.subtitle||''}));
  viewingHistory = false;

  updateSelectedStaffBadge();

  if (currentRosterId) {
    try {
      await saveRosterStaffSnapshot(currentRosterId, rosterStaff);
    } catch (e) {
      console.warn('Could not update roster snapshot in cloud:', e);
    }
  }

  await loadRosterStaffLeaveDuties();
  buildRoster();
  closeStaffModal();
}

function handleCreateRefreshRoster() {
  if (!rosterStaff || !rosterStaff.length) {
    openStaffModal();
  } else {
    buildRoster();
  }
}

async function removeStaffFromRoster(uid) {
  const strId = String(uid);
  const targetStaff = rosterStaff.find(s => String(s.uid) === strId);
  const name = targetStaff ? targetStaff.name : 'this staff member';
  
  if (!await showAppDialog(`Remove "${name}" from this roster? Their details will remain in the staff list.`,{kind:'confirm',title:'Remove staff from roster'})) {
    return;
  }

  if (currentRosterId) {
    try {
      const { error } = await db.from('roster_assignments').delete().eq('roster_id', currentRosterId).eq('staff_id', strId);
      if (error) throw error;
      const nextRosterStaff = rosterStaff.filter(s => String(s.uid) !== strId);
      await saveRosterStaffSnapshot(currentRosterId, nextRosterStaff);
    } catch (e) {
      showError('Could not remove staff from roster', e);
      return;
    }
  }

  rosterStaff = rosterStaff.filter(s => String(s.uid) !== strId);
  updateSelectedStaffBadge();
  const ds = rosterDays();
  ds.forEach(d => delete assignments[akey(strId, localDateKey(d))]);

  buildRoster();
}

async function saveRosterStaffSnapshot(rosterId, staffList) {
  if (!rosterId) return;
  const list = staffList !== undefined ? staffList : rosterStaff;

  try {
    const { data: existing, error: fetchErr } = await db
      .from('roster_staff_snapshots')
      .select('id, staff_id')
      .eq('roster_id', rosterId);
    if (fetchErr) throw fetchErr;

    const keepUids = new Set(list.map(s => String(s.uid)));
    const toDelete = (existing || []).filter(x => !keepUids.has(String(x.staff_id))).map(x => x.id);

    if (toDelete.length > 0) {
      const { error: delErr } = await db.from('roster_staff_snapshots').delete().in('id', toDelete);
      if (delErr) console.warn('Could not delete unselected staff snapshot rows:', delErr);
    }

    if (list.length > 0) {
      const rows = list.map((s, i) => ({
        roster_id: rosterId,
        staff_id: s.uid,
        staff_name: s.name,
        unid_no: s.id || null,
        sort_order: i + 1,
        subtitle: String(s.subtitle||'').trim()
      }));
      let { error: upsertErr } = await db
        .from('roster_staff_snapshots')
        .upsert(rows, { onConflict: 'roster_id,staff_id' });
      if(upsertErr&&isMissingSubtitleColumn(upsertErr)){
        subtitleColumnAvailable=false;
        upsertErr=(await db.from('roster_staff_snapshots').upsert(rows.map(({subtitle,...row})=>row),{onConflict:'roster_id,staff_id'})).error;
      }
      if (upsertErr) throw upsertErr;
    }
    saveRosterSubtitlesLocally(rosterId,list);
  } catch (e) {
    console.error('Error saving roster staff snapshot:', e);
    throw e;
  }
}

function getFullRosterTitle(){
  const raw=(rosterTitle?rosterTitle.value.trim():'');
  if(!monthEl || !yearEl) return raw;
  const m = months[+monthEl.value] || '';
  const y = yearEl.value || new Date().getFullYear();
  const monthYear = `${m}-${y}`;
  // Strip existing Month-Year pattern if already present at the end
  const escapedMonth = m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`[-–—\\s]*${escapedMonth}[-–—\\s]*${y}$`, 'i');
  const base = raw.replace(regex, '').trim();

  const finalBase = base || 'DUTY ROSTER';
  return `${finalBase} - ${monthYear}`;
}

function getRosterBaseTitle(title){
  const value=String(title||'').trim();
  const pattern=new RegExp(`[-–—\\s]*(?:${months.join('|')})[-–—\\s]*\\d{4}$`,'i');
  return value.replace(pattern,'').trim()||value;
}

function getRosterFileBaseName(){
  const fullTitle = getFullRosterTitle();
  return fullTitle.replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}

async function ensureRoster(){
  if(!rosterTitle?.value.trim()){
    const status=document.getElementById('rosterSaveStatus');
    if(status)status.textContent='Add or select a roster title first';
    alert('Add or select a roster title before saving this roster.');
    openTitleDropdown();
    return null;
  }
  const validYear=Number(yearEl?.value),validMonth=Number(monthEl?.value);
  if(!Number.isInteger(validYear)||validYear<2020||validYear>2100||!Number.isInteger(validMonth)||validMonth<0||validMonth>11){
    alert('Choose a valid month and year (2020–2100) before saving.');
    return null;
  }
  // If we already have a currentRosterId loaded, reuse it (avoids duplicate creation)
  if(currentRosterId){
    await saveRosterStaffSnapshot(currentRosterId, rosterStaff);
    return currentRosterId;
  }
  const month=+monthEl.value+1,year=+yearEl.value;
  const fullTitle=getFullRosterTitle();
  // A deliberate "Save as new" bypasses title matching so this month can have copies.
  let data=null,error=null;
  if(!forceCreateRoster){
    const found=await db.from('rosters').select('id,title').eq('month',month).eq('year',year).eq('title',fullTitle).order('updated_at',{ascending:false}).limit(1).maybeSingle();
    data=found.data;error=found.error;
  }
  if(error){showError('Could not find roster',error);return null}
  if(!data){
    const created=await db.from('rosters').insert({title:fullTitle,month,year}).select('id,title').single();
    if(created.error){
      const detail=`${created.error.message||''} ${created.error.details||''} ${created.error.hint||''}`;
      if(created.error.code==='23505'&&/month[\s\S]*year|year[\s\S]*month/i.test(detail)){
        showAppDialog('The database currently blocks more than one roster for the same month and year. The app now supports separate rosters, but the database month/year uniqueness rule must be removed before these can be saved.',{title:'Database rule prevents another roster'});
      }else showError('Could not create roster',created.error);
      return null;
    }
    data=created.data;
    forceCreateRoster=false;
  }
  currentRosterId=data.id;
  await saveRosterStaffSnapshot(currentRosterId, rosterStaff);
  return data.id;
}

async function ensureRosterSnapshot(rosterId){
  const q=await db.from('roster_staff_snapshots').select('id').eq('roster_id',rosterId).limit(1);
  if(q.error)throw q.error;
  if(!q.data?.length && rosterStaff.length){
    await saveRosterStaffSnapshot(rosterId, rosterStaff);
  }
}

async function loadRosterSnapshot(rosterId){
  let q=await db.from('roster_staff_snapshots').select('staff_id,staff_name,unid_no,sort_order,subtitle').eq('roster_id',rosterId).order('sort_order');
  if(q.error&&isMissingSubtitleColumn(q.error)){
    subtitleColumnAvailable=false;
    q=await db.from('roster_staff_snapshots').select('staff_id,staff_name,unid_no,sort_order').eq('roster_id',rosterId).order('sort_order');
  }
  if(q.error)throw q.error;
  const localSubtitles=loadRosterSubtitlesLocally(rosterId);
  rosterStaff=(q.data||[]).map(x=>({uid:x.staff_id,name:x.staff_name,id:x.unid_no||'',subtitle:String(x.subtitle||localSubtitles[String(x.staff_id)]||'')}));
  saveRosterSubtitlesLocally(rosterId,rosterStaff);
  updateSelectedStaffBadge();
}

function getRosterDuty(uid,date){
  const key=akey(uid,date);
  return staffLeaveDutyKeys.has(key)?'LE':(assignments[key]||'');
}

async function loadRosterStaffLeaveDuties(){
  staffLeaveDutyKeys=new Set();
  const staffIds=[...new Set((rosterStaff||[]).map(person=>String(person.uid)).filter(Boolean))];
  const days=rosterDays();
  if(!staffIds.length||!days.length)return;
  const firstDate=localDateKey(days[0]),lastDate=localDateKey(days[days.length-1]);
  const {data,error}=await db.from('staff_leaves').select('staff_id,leave_start,leave_end')
    .in('staff_id',staffIds).lte('leave_start',lastDate).gte('leave_end',firstDate);
  if(error){
    if(!isMissingStaffLeavesTable(error))console.warn('Could not load leave overlays for roster:',error);
    return;
  }
  (data||[]).forEach(leave=>{
    if(!leave.staff_id)return;
    days.forEach(day=>{
      const date=localDateKey(day);
      if(date>=leave.leave_start&&date<=leave.leave_end)staffLeaveDutyKeys.add(akey(leave.staff_id,date));
    });
  });
}

async function loadRoster(){
  viewingHistory=false;assignments={};currentRosterId=null;staffLeaveDutyKeys=new Set();rememberRosterAssignments(null,{});
  const selectedTitle=(rosterTitle?rosterTitle.value.trim():'');
  if(!selectedTitle){updateSelectedStaffBadge();return}
  const selectedYear=Number(yearEl?.value),selectedMonth=Number(monthEl?.value);
  if(!Number.isInteger(selectedYear)||selectedYear<2020||selectedYear>2100||!Number.isInteger(selectedMonth)||selectedMonth<0||selectedMonth>11){updateSelectedStaffBadge();return}
  const month=+monthEl.value+1,year=+yearEl.value;
  const currentTitle=getFullRosterTitle();
  manualRosterRows=loadManualRosterRows();
  // Match by title+month+year for multiple-roster-per-month support
  const r=await db.from('rosters').select('id,title').eq('month',month).eq('year',year).eq('title',currentTitle).order('updated_at',{ascending:false}).limit(1).maybeSingle();
  if(r.error){showError('Could not load roster',r.error);return}
  if(!r.data){
    await loadRosterStaffLeaveDuties();
    updateSelectedStaffBadge();
    return;
  }
  currentRosterId=r.data.id;
  if(rosterTitle) rosterTitle.value=getRosterBaseTitle(r.data.title)||selectedTitle;
  const titleDisplay=document.getElementById('titleDropdownValue');
  if(titleDisplay){titleDisplay.textContent=rosterTitle.value;titleDisplay.classList.remove('is-placeholder')}
  try{await loadManualRosterRowsFromDatabase(currentRosterId)}catch(e){
    console.error('Blank roster rows load warning:',e);
    // Blank rows are an optional roster feature. A missing migration must not
    // interrupt opening the saved roster; persistence prompts when rows change.
    if(!isMissingManualRowsTable(e))showError('Could not load blank rows',e);
  }
  try{
    await loadRosterSnapshot(currentRosterId);
  }catch(e){
    console.error('Roster snapshot load warning:',e);
    rosterStaff=[];
  }
  const q=await db.from('roster_assignments').select('staff_id,duty_date,duty_code').eq('roster_id',currentRosterId);
  if(q.error){showError('Could not load duties',q.error);return}
  (q.data||[]).forEach(x=>{if(x.staff_id)assignments[akey(x.staff_id,x.duty_date)]=x.duty_code});
  rememberRosterAssignments(currentRosterId);
  await loadRosterStaffLeaveDuties();
  updateSelectedStaffBadge();
}

async function setDuty(uid,date,val){
  if(staffLeaveDutyKeys.has(akey(uid,date))){buildRoster();return}
  val=normalizeDutyEntry(val);
  if(val===null){alert('Enter one duty code or two codes separated by /. Example: M/E.');buildRoster();return}
  const status = document.getElementById('rosterSaveStatus');
  if (status) status.textContent = 'Saving…';
  try {
    const rid=await ensureRoster();if(!rid)return;
    if(!val){
      const {error}=await db.from('roster_assignments').delete().eq('roster_id',rid).eq('staff_id',uid).eq('duty_date',date);
      if(error)throw error;
      delete assignments[akey(uid,date)];
    }else{
      const {error}=await db.from('roster_assignments').upsert(
        {roster_id:rid,staff_id:uid,duty_date:date,duty_code:val},
        {onConflict:'roster_id,staff_id,duty_date'}
      );
      if(error)throw error;
      assignments[akey(uid,date)]=val;
    }
    if (status) status.textContent = 'All changes saved';
  } catch (error) {
    if (status) status.textContent = 'Save failed — retry this cell';
    showError(val ? 'Could not save duty' : 'Could not clear duty', error);
    buildRoster();
  }
}

async function clearStaffRowDuties(uid){
  const person=rosterStaff.find(item=>String(item.uid)===String(uid));
  if(!person)return;
  if(!await showAppDialog(`Clear every duty in ${person.name}'s row? The staff member will stay in this roster.`,{kind:'confirm',title:'Clear staff row'}))return;
  const status=document.getElementById('rosterSaveStatus');
  if(status)status.textContent='Clearing row duties…';
  try{
    const rosterId=await ensureRoster();
    if(!rosterId)return;
    const {error}=await db.from('roster_assignments').delete().eq('roster_id',rosterId).eq('staff_id',String(uid));
    if(error)throw error;
    for(const key of Object.keys(assignments))if(key.startsWith(`${uid}|`))delete assignments[key];
    buildRoster();
    if(status)status.textContent=`All duties cleared for ${person.name}`;
  }catch(error){
    if(status)status.textContent='Could not clear row duties';
    showError('Could not clear this staff member’s duties',error);
  }
}

async function setRosterStaffSubtitle(uid,value){
  const person=rosterStaff.find(item=>String(item.uid)===String(uid));
  if(!person)return;
  person.subtitle=String(value||'').trim().slice(0,100);
  saveRosterSubtitlesLocally(currentRosterId||'draft');
  try{
    const rosterId=currentRosterId||await ensureRoster();
    if(!rosterId)return;
    await saveRosterStaffSnapshot(rosterId,rosterStaff);
    const status=document.getElementById('rosterSaveStatus');
    if(status)status.textContent=subtitleColumnAvailable?'Subtitle saved':'Subtitle saved on this device';
    if(!subtitleColumnAvailable&&person.subtitle)showSubtitleMigrationWarning();
  }catch(error){showError('Could not save staff subtitle',error)}
}

function getBuilderStaff(){
  return rosterStaff || [];
}

function buildRoster(){
  if(!rosterTable||!monthEl||!yearEl||!rosterTitle)return;
  const ds=rosterDays();
  syncDailyDutyDate();
  const fullTitle=getFullRosterTitle();
  const displayStaff=getBuilderStaff();
  updateSelectedStaffBadge();
  printTitle.textContent=fullTitle;
  const monthName=months[+monthEl.value];
  printMonth.textContent=monthName&&yearEl.value?`FOR THE MONTH OF ${monthName.toUpperCase()} - ${yearEl.value}`:'Choose a valid month and year';
  let html=`<thead><tr><th>Sr.</th><th class="name">NAME OF STAFF</th><th class="idcol">UNID NO.</th>${ds.map(d=>`<th class="date ${d.getDay()===0?'sun':''}"><span class="date-number">${d.getDate()}</span><span class="date-weekday">${d.toLocaleDateString('en',{weekday:'short'}).slice(0,2)}</span></th>`).join('')}</tr></thead><tbody>`;
  displayStaff.forEach((s,i)=>{
    html+=`<tr data-uid="${s.uid}" draggable="true"><td class="roster-order-cell"><span class="roster-order-number">${i+1}</span></td><td class="name" data-staff-uid="${s.uid}" tabindex="0" title="Click the staff name, then press Delete to clear every duty in this row. Drag the row to change its order; hold Ctrl while dragging to copy duties."><div class="staff-name-cell"><div class="staff-name-block"><span class="staff-name-text">${esc(s.name)}</span><input class="staff-subtitle-input no-print" type="text" maxlength="100" value="${esc(s.subtitle||'')}" placeholder="Add subtitle" aria-label="Subtitle for ${esc(s.name)}" onchange="setRosterStaffSubtitle('${s.uid}',this.value)"><span class="staff-subtitle-print">${esc(s.subtitle||'')}</span></div><button type="button" class="row-remove-btn no-print" onclick="removeStaffFromRoster('${s.uid}')" title="Remove from this roster">×</button></div></td><td>${esc(s.id||'')}</td>`;
    ds.forEach(d=>{const dk=localDateKey(d),isLeave=staffLeaveDutyKeys.has(akey(s.uid,dk)),v=getRosterDuty(s.uid,dk);html+=`<td class="${d.getDay()===0?'sun':''}"><input maxlength="9"${isLeave?' readonly class="leave-duty-cell"':''} data-duty-cell="true" data-uid="${s.uid}" data-date="${dk}" value="${esc(v)}" onchange="queueRosterDutySave('${s.uid}','${dk}',this.value)" title="${isLeave?'Staff leave record is active for this date. Edit it on the Staff leave page.':`${d.toDateString()} — use M/E for two duties. Press Delete to clear this duty.`}"></td>`});
    html+='</tr>';
  });
  manualRosterRows.forEach((row,index)=>{
    const rowId=String(row.id||'').replace(/[^a-zA-Z0-9_-]/g,'');
    html+=`<tr class="manual-roster-row"><td>${displayStaff.length+index+1}</td><td class="name"><div class="manual-name-cell"><input type="text" maxlength="100" value="${esc(row.name||'')}" aria-label="Name for row ${displayStaff.length+index+1}" onchange="setManualRosterIdentity('${rowId}','name',this.value)"><button type="button" class="row-remove-btn manual-row-remove no-print" onclick="removeManualRosterRow('${rowId}')" title="Remove this blank row" aria-label="Remove blank duty row">×</button></div></td><td><input class="manual-row-unid" type="text" maxlength="40" value="${esc(row.unid||'')}" aria-label="UNID for row ${displayStaff.length+index+1}" onchange="setManualRosterIdentity('${rowId}','unid',this.value)"></td>`;
    ds.forEach(d=>{const dk=localDateKey(d),v=row.duties?.[dk]||'';html+=`<td class="${d.getDay()===0?'sun':''}"><input maxlength="9" data-duty-cell="true" data-date="${dk}" data-manual-row="${rowId}" value="${esc(v)}" aria-label="Duty for ${d.toDateString()}" onchange="setManualRosterDuty('${rowId}','${dk}',this.value)" title="${d.toDateString()} — use M/E for two duties. Press Delete to clear this duty."></td>`});
    html+='</tr>';
  });
  rosterTable.innerHTML=html+'</tbody>';
}

function syncDailyDutyDate(){
  const input=document.getElementById('dailyDutyDate');
  if(!input)return;
  input.removeAttribute('min');input.removeAttribute('max');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.value))input.value=localDateKey(new Date());
}

async function buildMergedDailyDutyMessage(dateValue){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)){
    throw new Error('Choose a valid date for the daily duty message.');
  }
  const date=new Date(`${dateValue}T12:00:00`);
  const dateKey=localDateKey(date);
  try{
    const month=Number(dateValue.slice(5,7)),year=Number(dateValue.slice(0,4));
    const rosterResult=await db.from('rosters').select('id,month,year').eq('month',month).eq('year',year);
    if(rosterResult.error)throw rosterResult.error;
    const rosterIds=(rosterResult.data||[]).map(row=>String(row.id));
    const snapshotRows=[];
    const dutyRows=[];
    if(rosterIds.length){
      let snapshotResult=await db.from('roster_staff_snapshots').select('roster_id,staff_id,staff_name,unid_no,sort_order,subtitle').in('roster_id',rosterIds).order('sort_order');
      if(snapshotResult.error&&isMissingSubtitleColumn(snapshotResult.error)){
        subtitleColumnAvailable=false;
        snapshotResult=await db.from('roster_staff_snapshots').select('roster_id,staff_id,staff_name,unid_no,sort_order').in('roster_id',rosterIds).order('sort_order');
      }
      if(snapshotResult.error)throw snapshotResult.error;
      const localSubtitleMaps=new Map(rosterIds.map(id=>[id,loadRosterSubtitlesLocally(id)]));
      snapshotRows.push(...(snapshotResult.data||[]).map(row=>({
        roster_id:String(row.roster_id),staff_id:String(row.staff_id),name:row.staff_name||'',
        subtitle:String(row.subtitle||localSubtitleMaps.get(String(row.roster_id))?.[String(row.staff_id)]||''),
        sort_order:Number(row.sort_order)||0
      })));
      const assignmentsResult=await db.from('roster_assignments').select('roster_id,staff_id,duty_code').in('roster_id',rosterIds).eq('duty_date',dateKey);
      if(assignmentsResult.error)throw assignmentsResult.error;
      dutyRows.push(...(assignmentsResult.data||[]).map(row=>({...row,roster_id:String(row.roster_id),staff_id:String(row.staff_id)})));
    }

    const dateMatchesOpenRoster=!!(monthEl&&yearEl&&Number(monthEl.value)+1===month&&Number(yearEl.value)===year);
    const openRosterId=currentRosterId?String(currentRosterId):'';
    if(dateMatchesOpenRoster&&rosterStaff.length){
      const activeId= openRosterId||'__current_draft__';
      for(let i=snapshotRows.length-1;i>=0;i--)if(snapshotRows[i].roster_id===activeId)snapshotRows.splice(i,1);
      snapshotRows.push(...rosterStaff.map((person,index)=>({roster_id:activeId,staff_id:String(person.uid),name:person.name,subtitle:String(person.subtitle||''),sort_order:index+1})));
      for(let i=dutyRows.length-1;i>=0;i--)if(dutyRows[i].roster_id===activeId)dutyRows.splice(i,1);
      Object.entries(assignments).forEach(([key,duty_code])=>{
        const split=key.lastIndexOf('|');
        if(split>=0&&key.slice(split+1)===dateKey)dutyRows.push({roster_id:activeId,staff_id:key.slice(0,split),duty_code});
      });
    }

    const staffIds=[...new Set(snapshotRows.map(person=>String(person.staff_id)).filter(Boolean))];
    if(staffIds.length){
      const leaveResult=await db.from('staff_leaves').select('staff_id').in('staff_id',staffIds)
        .lte('leave_start',dateKey).gte('leave_end',dateKey);
      if(leaveResult.error&&!isMissingStaffLeavesTable(leaveResult.error))throw leaveResult.error;
      const onLeave=new Set((leaveResult.data||[]).map(row=>String(row.staff_id)));
      if(onLeave.size){
        for(let i=dutyRows.length-1;i>=0;i--)if(onLeave.has(String(dutyRows[i].staff_id)))dutyRows.splice(i,1);
        const inserted=new Set();
        snapshotRows.forEach(person=>{
          if(!onLeave.has(String(person.staff_id)))return;
          const key=`${person.roster_id}|${person.staff_id}`;
          if(inserted.has(key))return;
          inserted.add(key);dutyRows.push({roster_id:person.roster_id,staff_id:person.staff_id,duty_code:'LE'});
        });
      }
    }

    const staffByRosterAndId=new Map(snapshotRows.map(person=>[`${person.roster_id}|${person.staff_id}`,person]));
    const groups=new Map(codes.map(item=>[String(item.code).toUpperCase(),{label:item.name,code:String(item.code).toUpperCase(),people:new Map()}]));
    dutyRows.forEach(row=>{
      const person=staffByRosterAndId.get(`${row.roster_id}|${row.staff_id}`);
      if(!person)return;
      String(row.duty_code||'').toUpperCase().split('/').filter(Boolean).forEach(code=>{
        const group=groups.get(code);if(!group)return;
        const existing=group.people.get(person.staff_id);
        if(existing){if(person.subtitle&&!existing.subtitles.includes(person.subtitle))existing.subtitles.push(person.subtitle)}
        else group.people.set(person.staff_id,{key:person.staff_id,name:person.name,subtitles:person.subtitle?[person.subtitle]:[]});
      });
    });
    const numbers=new Map();let nextNumber=1;
    const sections=[...groups.values()].filter(group=>group.people.size).map(group=>{
      const heading=group.code==='O'?'Off -':`${group.label} Duty`;
      const lines=[...group.people.values()].map(person=>{
        if(!numbers.has(person.key))numbers.set(person.key,nextNumber++);
        const subtitle=person.subtitles.length?` - ${person.subtitles.join(' / ')}`:'';
        return `${numbers.get(person.key)}-${person.name}${subtitle}`;
      });
      return `*${heading}*\n${lines.join('\n')}`;
    });
  const formattedDate=date.toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'});
  const weekday=date.toLocaleDateString('en-IN',{weekday:'long'});
  const message=`*${formattedDate} (${weekday}) Nursing staff duty roster*\n\n${sections.length?sections.join('\n\n'):'No duties have been entered for this date.'}`;
    return message;
  }catch(error){throw error}
}

async function generateDailyWhatsAppMessage(){
  const dateValue=document.getElementById('dailyDutyDate')?.value||'';
  const preview=document.getElementById('dailyMessagePreview');
  const status=document.getElementById('dailyMessageStatus');
  const generateButton=document.querySelector('.daily-message-controls button');
  if(generateButton)generateButton.disabled=true;
  if(status)status.textContent='Building message from saved rosters…';
  try{
    const message=await buildMergedDailyDutyMessage(dateValue);
    if(preview)preview.value=message;
    document.getElementById('openWhatsAppButton')?.removeAttribute('disabled');
    document.getElementById('copyWhatsAppMessageButton')?.removeAttribute('disabled');
    if(status)status.textContent='All saved rosters for this date are combined. Edit the preview before sharing if needed.';
  }catch(error){
    if(status)status.textContent='Could not generate the message.';
    showError('Could not prepare the merged daily duty message',error);
  }finally{if(generateButton)generateButton.disabled=false}
}

function openGeneratedDailyWhatsApp(){
  const message=document.getElementById('dailyMessagePreview')?.value||'';
  if(!message)return;
  const opened=window.open(`https://wa.me/?text=${encodeURIComponent(message)}`,'_blank');
  if(opened)opened.opener=null;
  if(!opened)showAppDialog('Allow pop-ups for this site to open WhatsApp.',{title:'Allow pop-ups'});
}

async function copyGeneratedDailyWhatsApp(){
  const preview=document.getElementById('dailyMessagePreview');
  const status=document.getElementById('dailyMessageStatus');
  if(!preview?.value)return;
  try{
    await navigator.clipboard.writeText(preview.value);
  }catch{
    preview.focus();preview.select();
    if(!document.execCommand('copy')){showAppDialog('Could not copy the message. Select and copy it manually.',{title:'Copy message'});return}
  }
  if(status)status.textContent='Message copied to clipboard.';
}

let copiedRowAssignments = null;
let draggedRosterUid = null;
let draggedRosterOrderUid = null;

async function reorderRosterStaff(fromUid,toUid,afterTarget){
  const previous=[...rosterStaff];
  const fromIndex=rosterStaff.findIndex(staff=>String(staff.uid)===String(fromUid));
  if(fromIndex<0||String(fromUid)===String(toUid))return;
  const [moved]=rosterStaff.splice(fromIndex,1);
  let targetIndex=rosterStaff.findIndex(staff=>String(staff.uid)===String(toUid));
  if(targetIndex<0){rosterStaff=previous;return}
  if(afterTarget)targetIndex++;
  rosterStaff.splice(targetIndex,0,moved);
  buildRoster();
  try{
    const rosterId=currentRosterId||await ensureRoster();
    if(!rosterId)throw new Error('Could not save the roster before changing staff order.');
    if(currentRosterId)await saveRosterStaffSnapshot(rosterId,rosterStaff);
    const status=document.getElementById('rosterSaveStatus');
    if(status)status.textContent='Staff order saved';
  }catch(error){
    rosterStaff=previous;buildRoster();showError('Could not save staff order',error);
  }
}

function copyRow(uid) {
  const ds = rosterDays();
  copiedRowAssignments = {};
  ds.forEach(d => {
    const dk = localDateKey(d);
    copiedRowAssignments[dk] = assignments[akey(uid, dk)] || '';
  });
  const status=document.getElementById('rosterSaveStatus');
  if(status)status.textContent='Row copied — Ctrl+drag another staff row or press Ctrl+V to paste';
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
      } else {
        deletes.push(dk);
      }
    }
  });

  try {
    if (updates.length > 0) {
      const { error } = await db.from('roster_assignments').upsert(updates, { onConflict: 'roster_id,staff_id,duty_date' });
      if (error) throw error;
    }
    if (deletes.length > 0) {
      const { error } = await db.from('roster_assignments')
        .delete()
        .eq('roster_id', rid)
        .eq('staff_id', uid)
        .in('duty_date', deletes);
      if (error) throw error;
    }
  } catch (error) {
    showError('Could not paste row duties', error);
    return;
  }
  ds.forEach(d => {
    const dk = localDateKey(d);
    const val = copiedRowAssignments[dk];
    if (val) assignments[akey(uid, dk)] = val;
    else delete assignments[akey(uid, dk)];
  });
  const status=document.getElementById('rosterSaveStatus');
  if(status){const name=getBuilderStaff().find(s=>String(s.uid)===String(uid))?.name;status.textContent=name?`Duties copied to ${name}`:'Row duties copied';}
  buildRoster();
}

async function saveRoster(){
  if(!rosterTitle?.value.trim()){
    alert('Add or select a roster title first.');
    openTitleDropdown();
    return;
  }
  if(!rosterStaff || !rosterStaff.length){
    alert('Please select staff members for this roster first.');
    openStaffModal();
    return;
  }
  const validYear=Number(yearEl?.value),validMonth=Number(monthEl?.value);
  if(!Number.isInteger(validYear)||validYear<2020||validYear>2100||!Number.isInteger(validMonth)||validMonth<0||validMonth>11){
    alert('Choose a valid month and year (2020–2100) before saving.');
    return;
  }
  viewingHistory=false;
  const status=document.getElementById('rosterSaveStatus');
  if(status)status.textContent='Saving roster…';
  const fullTitle=getFullRosterTitle();

  const rid=await ensureRoster();if(!rid){if(status)status.textContent='Could not save roster';return}
  try{
    await loadRosterStaffLeaveDuties();
    await saveRosterStaffSnapshot(rid, rosterStaff);
    await manualRowsSaveQueue;
  }catch(e){if(status)status.textContent='Save failed';showError('Could not sync roster staff',e);return}
  let blankRowsSaved=true;
  try{await persistManualRosterRows(rid)}catch(e){
    blankRowsSaved=false;
    if(isMissingManualRowsTable(e))showManualRowsSchemaWarning();
    else showError('Roster can be saved, but blank rows could not be saved',e);
  }
  buildRoster();

  const {error}=await db.from('rosters').update({
    title:fullTitle,
    updated_at:new Date().toISOString()
  }).eq('id',rid);
  if(error){if(status)status.textContent='Save failed';showError('Could not save roster',error);return}
  if(status)status.textContent=blankRowsSaved?'Roster saved successfully':'Roster saved; blank rows need database setup';
  rememberRosterAssignments(rid);
  await loadRosterHistory();
  alert(`Roster "${fullTitle}" saved successfully.`);
}

async function saveRosterAsNew(){
  if(!rosterTitle?.value.trim()){alert('Add or select a roster title first.');openTitleDropdown();return}
  if(!rosterStaff?.length){alert('Please select staff members for this roster first.');openStaffModal();return}
  const suggested=rosterTitle.value.trim();
  const entered=await showAppDialog('Give this additional roster a title. If the same title already exists this month, a copy number will be added.',{kind:'prompt',title:'Save another roster',defaultValue:suggested,placeholder:'e.g. ICU duty roster'});
  if(entered===null)return;
  await rosterDutySaveQueue;
  const assignmentsCopy={...assignments};
  let base=String(entered).trim().replace(/\s+/g,' ').toUpperCase();
  if(!base){alert('Enter a roster title first.');return}
  if(base.length>60){alert('Roster titles can be up to 60 characters.');return}
  const month=Number(monthEl.value)+1,year=Number(yearEl.value);
  const existing=await db.from('rosters').select('title').eq('month',month).eq('year',year);
  if(existing.error){showError('Could not check saved rosters',existing.error);return}
  const used=new Set((existing.data||[]).map(row=>getRosterBaseTitle(row.title||'').toUpperCase()));
  if(used.has(base)){
    const original=base;
    let copy=2;
    while(used.has(`${original} (${copy})`))copy++;
    const suffix=` (${copy})`;
    base=original.slice(0,60-suffix.length).trimEnd()+suffix;
  }
  const sourceRosterId=currentRosterId?String(currentRosterId):null;
  if(sourceRosterId&&savedAssignmentsBaselineRosterId===sourceRosterId){
    try{await restoreRosterAssignments(sourceRosterId,savedAssignmentsBaseline)}
    catch(error){showError('Could not keep the original roster unchanged',error);return}
  }
  if(!getTitlePresets().includes(base))saveCustomTitle(base);
  const staffCopy=rosterStaff.map(staff=>({...staff}));
  const manualCopy=JSON.parse(JSON.stringify(manualRosterRows));
  setRosterTitle(base);
  rosterStaff=staffCopy;assignments=assignmentsCopy;manualRosterRows=manualCopy;
  currentRosterId=null;forceCreateRoster=true;
  saveManualRosterRows();updateSelectedStaffBadge();await loadRosterStaffLeaveDuties();buildRoster();
  await saveRoster();
  if(currentRosterId&&document.getElementById('rosterSaveStatus')?.textContent?.startsWith('Roster saved')){
    const copiedDuties=Object.entries(assignments).map(([key,duty_code])=>{
      const split=key.lastIndexOf('|');
      return {roster_id:currentRosterId,staff_id:key.slice(0,split),duty_date:key.slice(split+1),duty_code};
    }).filter(row=>row.staff_id&&row.duty_date&&row.duty_code);
    if(copiedDuties.length){
      const {error}=await db.from('roster_assignments').upsert(copiedDuties,{onConflict:'roster_id,staff_id,duty_date'});
      if(error){showError('New roster saved, but duty assignments could not be copied',error);return}
    }
    rememberRosterAssignments(currentRosterId);
  }
}


function getExportStaff(){return [...getBuilderStaff().map(s=>({...s,isManual:false})),...manualRosterRows.map(row=>({uid:null,name:row.name||'',id:row.unid||'',isManual:true,manualRow:row}))];}
function getAdaptiveLayout(count){
 const n=Math.max(1,count), rowMm=Math.max(5.2,Math.min(18,205/n));
 if(n<=4)return {rowMm,dutyPt:12,namePt:13.5,idPt:12.5,headerPt:8.5,paddingMm:2.2};
 if(n<=7)return {rowMm,dutyPt:10.5,namePt:12.5,idPt:11.5,headerPt:8,paddingMm:1.7};
 if(n<=10)return {rowMm,dutyPt:9.5,namePt:12,idPt:11,headerPt:7.5,paddingMm:1.3};
 if(n<=15)return {rowMm,dutyPt:8.5,namePt:11,idPt:10,headerPt:7,paddingMm:1};
 if(n<=22)return {rowMm,dutyPt:7.3,namePt:10.5,idPt:9.5,headerPt:6.5,paddingMm:.7};
 return {rowMm,dutyPt:6.3,namePt:9.2,idPt:8.5,headerPt:6,paddingMm:.45};
}
function applyAdaptivePrintSizing(){
 const exportStaff=getExportStaff(),s=getAdaptiveLayout(exportStaff.length),r=document.documentElement;
 r.style.setProperty('--print-row-height',s.rowMm+'mm');
 r.style.setProperty('--print-duty-font',Math.max(8.5,s.dutyPt)+'pt');
 r.style.setProperty('--print-name-font',Math.min(15,s.namePt+3)+'pt');
 r.style.setProperty('--print-id-font',Math.min(14,s.idPt+2)+'pt');
 r.style.setProperty('--print-header-font',Math.max(10.5,s.headerPt+3)+'pt');
 r.style.setProperty('--print-cell-padding',s.paddingMm+'mm');
}
window.addEventListener('beforeprint',applyAdaptivePrintSizing);
async function printAdaptiveRoster(){
 if(!getExportStaff().length){alert('Add staff or a blank duty row first.');return}
 const printWindow=window.open('about:blank','_blank');
 if(!printWindow){showAppDialog('Allow pop-ups for this site to open the print-ready roster.',{title:'Open print preview'});return}
 printWindow.document.write('<!doctype html><html><head><title>Preparing roster…</title><style>body{font:16px Arial,sans-serif;padding:32px;color:#234138}</style></head><body>Preparing your print-ready roster…</body></html>');
 printWindow.document.close();
 try{
  const blob=await createRosterPdfBlob();
  const url=URL.createObjectURL(blob);
  printWindow.addEventListener('load',()=>setTimeout(()=>{try{printWindow.focus();printWindow.print()}catch{}},700),{once:true});
  printWindow.location.href=url;
  setTimeout(()=>URL.revokeObjectURL(url),10*60*1000);
 }catch(error){
  printWindow.close();
  showError('Could not prepare the print-ready roster',error);
 }
}
async function createRosterPdfBlob(){
 const exportStaff=getExportStaff();if(!exportStaff.length)throw new Error('Add staff or a blank duty row first.');
 const fullTitle=getFullRosterTitle();
 const {jsPDF}=window.jspdf,ds=rosterDays(),s=getAdaptiveLayout(exportStaff.length);
 const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a3'});
 const dayCellWidth=(420-14-9-55.2-20)/Math.max(1,ds.length);
 const img=await imageData('hospital-logo.jpg');if(img)doc.addImage(img,'JPEG',12,5,28,28);
 doc.setFont('times','bold');doc.setFontSize(18);doc.text(HOSPITAL,210,13,{align:'center'});
 doc.setFontSize(14);doc.text(fullTitle,210,21,{align:'center'});
 doc.setFont('times','bold');doc.setFontSize(11);doc.text(`FOR THE MONTH OF ${months[+monthEl.value].toUpperCase()} - ${yearEl.value}`,210,30,{align:'center'});
 const head=[['Sr.','NAME OF STAFF','UNID NO.',...ds.map(()=> '')]];
 const body=exportStaff.map((x,i)=>[i+1,x.subtitle?`${x.name}\n${x.subtitle}`:x.name,x.id||'',...ds.map(d=>x.isManual?(x.manualRow.duties?.[localDateKey(d)]||''):getRosterDuty(x.uid,localDateKey(d)))]);
 const columnStyles={0:{cellWidth:9,fontStyle:'bold',fontSize:11},1:{cellWidth:55.2,halign:'center',valign:'middle',fontStyle:'bold',fontSize:Math.min(15,s.namePt+3),overflow:'linebreak'},2:{cellWidth:20,halign:'center',valign:'middle',fontStyle:'bold',fontSize:Math.min(14,s.idPt+2),overflow:'ellipsize'}};
 ds.forEach((_,i)=>{columnStyles[i+3]={cellWidth:dayCellWidth,halign:'center',valign:'middle'}});
 doc.autoTable({head,body,startY:37,theme:'grid',
  styles:{font:'times',fontSize:Math.max(8.5,s.dutyPt),cellPadding:s.paddingMm,minCellHeight:s.rowMm,halign:'center',valign:'middle',overflow:'linebreak'},
  headStyles:{fontStyle:'bold',fontSize:11,minCellHeight:14},
  columnStyles,
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
        d.cell.styles.fontSize=11;
        d.cell.styles.fontStyle='bold';
        d.cell.styles.textColor=[0,0,0];
      }
      if(d.section==='head'&&d.column.index===0)d.cell.styles.fontSize=11;
      if(d.section==='head'&&d.column.index===1)d.cell.styles.fontSize=13;
      if(d.section==='head'&&d.column.index===2)d.cell.styles.fontSize=11;
      if(d.section==='head'&&d.column.index<3){d.cell.styles.fontStyle='bold';d.cell.styles.halign='center';d.cell.styles.valign='middle';d.cell.styles.overflow='linebreak'}
      if(d.section==='body'&&d.column.index===1){d.cell.styles.fontStyle='bold';d.cell.styles.fontSize=String(d.cell.raw||'').includes('\n')?Math.max(9,Math.min(14,s.namePt+1.5)):Math.min(15,s.namePt+3);d.cell.styles.halign='center';d.cell.styles.valign='middle';d.cell.styles.overflow='linebreak'}
      if(d.section==='body'&&d.column.index===2){d.cell.styles.fontStyle='bold';d.cell.styles.fontSize=Math.min(14,s.idPt+2);d.cell.styles.halign='center';d.cell.styles.valign='middle';d.cell.styles.overflow='ellipsize'}},
  didDrawCell:d=>{if(d.section==='head'&&d.column.index>=3){const centerY=d.cell.y+d.cell.height/2,day=ds[d.column.index-3];doc.setDrawColor(0);doc.setLineWidth(.2);doc.line(d.cell.x+1,centerY,d.cell.x+d.cell.width-1,centerY);doc.setFont('times','bold');doc.setTextColor(0,0,0);doc.setFontSize(11);doc.text(String(day.getDate()),d.cell.x+d.cell.width/2,centerY-1.2,{align:'center'});doc.setFontSize(10);doc.text(day.toLocaleDateString('en',{weekday:'short'}).slice(0,2),d.cell.x+d.cell.width/2,centerY+4,{align:'center'})}},
  margin:{left:7,right:7,bottom:36},pageBreak:'auto',rowPageBreak:'avoid'});
 const fy=doc.lastAutoTable?.finalY||180;
 const ph=doc.internal.pageSize.getHeight(),ly=Math.min(fy+5,ph-29);
 doc.setFont('times','normal');doc.setFontSize(8);doc.text(codes.map(c=>`${c.code} = ${c.name}`).join('    |    '),10,ly);
 const sy=ph-20;doc.setDrawColor(40);doc.setLineWidth(.35);doc.line(28,sy,88,sy);doc.line(330,sy,390,sy);
 doc.setFont('times','bold');doc.setFontSize(10);doc.text('Signature of Nursing Supt.',58,sy+5,{align:'center'});doc.text('Signature of Medical Supt.',360,sy+5,{align:'center'});
 doc.setFont('times','normal');doc.setFontSize(8);doc.text('Developed by Lakshya Purohit © 2026',410,ph-4,{align:'right'});
 return doc.output('blob');
}
async function sharePDF(){
 if(!getExportStaff().length)return alert('Add staff or a blank duty row first.');
 const fullTitle=getFullRosterTitle();
 const fn=`${getRosterFileBaseName()}.pdf`;
 try{
  const blob=await createRosterPdfBlob(),file=new File([blob],fn,{type:'application/pdf'});
  if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){
   await navigator.share({title:fullTitle,text:`${HOSPITAL} duty roster: ${fullTitle}`,files:[file]});
  }else{
   const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=fn;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500);
   alert('Direct PDF sharing is not supported by this browser. PDF downloaded instead.');
  }
 }catch(e){if(e?.name!=='AbortError'){console.error(e);alert('Could not share PDF: '+(e?.message||'Unknown error'))}}
}
async function downloadExcel(){
  const exportStaff=getExportStaff();if(!exportStaff.length)return alert('Add staff or a blank duty row first.');
  const fullTitle=getFullRosterTitle();
  const ds=rosterDays(),data=[];
  data.push([HOSPITAL]);
  data.push([fullTitle]);
  data.push([`FOR THE MONTH OF ${months[+monthEl.value].toUpperCase()} - ${yearEl.value}`]);
  data.push([]);
  data.push(['Sr.No','NAME OF STAFF','UNID NO.',...ds.map(d=>d.getDate())]);
  data.push(['','','',...ds.map(d=>d.toLocaleDateString('en',{weekday:'short'}))]);
  exportStaff.forEach((s,i)=>data.push([i+1,s.subtitle?`${s.name} — ${s.subtitle}`:s.name,s.id||'',...ds.map(d=>s.isManual?(s.manualRow.duties?.[localDateKey(d)]||''):getRosterDuty(s.uid,localDateKey(d)))]));
  data.push([]);data.push(['Duty Codes:',...codes.map(c=>`${c.code}=${c.name}`)]);
  const ws=XLSX.utils.aoa_to_sheet(data);
  ws['!cols']=[{wch:6},{wch:34},{wch:12},...ds.map(()=>({wch:4}))];
  ws['!merges']=[XLSX.utils.decode_range(`A1:${XLSX.utils.encode_col(ds.length+2)}1`),XLSX.utils.decode_range(`A2:${XLSX.utils.encode_col(ds.length+2)}2`),XLSX.utils.decode_range(`A3:${XLSX.utils.encode_col(ds.length+2)}3`)];
  const excelRowPt=Math.max(18,Math.min(55,Math.round(300/Math.max(1,exportStaff.length))));
  ws['!rows']=data.map((_,idx)=>({hpt:idx<6?22:excelRowPt}));
  ws['!pageSetup']={orientation:'landscape',fitToWidth:1,fitToHeight:1,paperSize:8};
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Roster');
  XLSX.writeFile(wb,`${getRosterFileBaseName()}.xlsx`);
}

async function downloadPDF(){
 if(!getExportStaff().length)return alert('Add staff or a blank duty row first.');
 const fn=`${getRosterFileBaseName()}.pdf`;
 try{const b=await createRosterPdfBlob(),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=fn;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500)}
 catch(e){console.error(e);alert('Could not create PDF: '+(e?.message||'Unknown error'))}
}
function imageData(src){return new Promise(resolve=>{const i=new Image();i.onload=()=>{const c=document.createElement('canvas');c.width=i.width;c.height=i.height;c.getContext('2d').drawImage(i,0,0);resolve(c.toDataURL('image/jpeg',.92))};i.onerror=()=>resolve(null);i.src=src})}

let staffLeaveRows=[];
let staffLeaveStatusTimer=null;
function setStaffLeaveStatus(message,clearAfter=0){
  const status=document.getElementById('staffLeaveStatus');
  if(!status)return;
  clearTimeout(staffLeaveStatusTimer);
  status.textContent=message;
  if(clearAfter>0){
    const displayedMessage=message;
    staffLeaveStatusTimer=setTimeout(()=>{if(status.textContent===displayedMessage)status.textContent='';},clearAfter);
  }
}
function isMissingStaffLeavesTable(error){return ['42P01','PGRST205'].includes(error?.code)||/staff_leaves.{0,80}(not found|does not exist)|could not find.{0,80}staff_leaves/i.test(String(error?.message||''))}
function showStaffLeaveSetup(message='Run database/staff-leave.sql in the database SQL editor to enable the leave log.'){
  const notice=document.getElementById('staffLeaveSetupNotice');
  if(notice){notice.hidden=false;notice.textContent=message}
}
function renderLeaveStaffOptions(){
  const select=document.getElementById('leaveStaffSelect');
  if(!select)return;
  select.innerHTML='<option value="">Choose a staff member</option>'+staff.map(person=>`<option value="${esc(person.uid)}">${esc(person.name)}${person.id?` — ${esc(person.id)}`:''}</option>`).join('');
  select.disabled=!staff.length;
  const hint=document.getElementById('leaveStaffHint');
  if(hint)hint.textContent=staff.length?`${staff.length} staff members available`:'Add staff in the Staff page before logging leave.';
}
function formatLeaveDate(value){
  if(!value)return '—';
  const date=new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())?String(value):date.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
}
function getLeaveDayCount(row){
  const start=String(row.leave_start||'').split('-').map(Number),end=String(row.leave_end||'').split('-').map(Number);
  if(start.length!==3||end.length!==3||!start[0]||!end[0])return 0;
  return Math.max(0,Math.floor((Date.UTC(end[0],end[1]-1,end[2])-Date.UTC(start[0],start[1]-1,start[2]))/86400000)+1);
}
function renderStaffLeaves(){
  const body=document.getElementById('staffLeaveRows');
  const count=document.getElementById('staffLeaveCount');
  if(!body)return;
  if(count)count.textContent=`${staffLeaveRows.length} record${staffLeaveRows.length===1?'':'s'}`;
  if(!staffLeaveRows.length){body.innerHTML='<tr><td colspan="8" class="leave-empty-cell">No leave records saved yet.</td></tr>';return}
  body.innerHTML=staffLeaveRows.map((row,index)=>{
    return `<tr><td data-label="Sr.">${index+1}</td><td data-label="Staff name"><strong>${esc(row.staff_name)}</strong></td><td data-label="UNID / ID">${esc(row.unid_no||'—')}</td><td data-label="Leave from">${esc(formatLeaveDate(row.leave_start))}</td><td data-label="Leave through">${esc(formatLeaveDate(row.leave_end))}</td><td data-label="Days">${getLeaveDayCount(row)}</td><td data-label="Note" class="leave-note-cell">${esc(row.note||'—')}</td><td data-label="Action"><button type="button" class="danger compact-btn" onclick="deleteStaffLeave('${esc(row.id)}')">Delete</button></td></tr>`;
  }).join('');
}
async function loadStaffLeaves(){
  renderLeaveStaffOptions();
  setStaffLeaveStatus('Loading leave records…');
  const data=[];let error=null,offset=0,batch=[];
  do{
    const result=await db.from('staff_leaves').select('id,staff_id,staff_name,unid_no,leave_start,leave_end,note,created_at')
      .order('leave_start',{ascending:false}).order('created_at',{ascending:false}).range(offset,offset+499);
    if(result.error){error=result.error;break}
    batch=result.data||[];data.push(...batch);offset+=batch.length;
  }while(batch.length===500);
  if(error){
    staffLeaveRows=[];renderStaffLeaves();
    if(isMissingStaffLeavesTable(error)){showStaffLeaveSetup();setStaffLeaveStatus('Database table setup is required before loading leave records.');}
    else setStaffLeaveStatus('Could not load leave records.');
    if(!isMissingStaffLeavesTable(error))console.error('Could not load staff leave records:',error);
    return;
  }
  staffLeaveRows=data||[];renderStaffLeaves();
  const notice=document.getElementById('staffLeaveSetupNotice');if(notice)notice.hidden=true;
  setStaffLeaveStatus('');
}
async function saveStaffLeave(event){
  event?.preventDefault();
  const select=document.getElementById('leaveStaffSelect');
  const fromInput=document.getElementById('leaveStartDate');
  const toInput=document.getElementById('leaveEndDate');
  const noteInput=document.getElementById('leaveNote');
  const button=document.getElementById('saveStaffLeaveButton');
  const person=staff.find(item=>String(item.uid)===String(select?.value));
  const leaveStart=fromInput?.value||'',leaveEnd=toInput?.value||'';
  if(!person){setStaffLeaveStatus('Select a staff member first.');select?.focus();return}
  if(!/^\d{4}-\d{2}-\d{2}$/.test(leaveStart)||!/^\d{4}-\d{2}-\d{2}$/.test(leaveEnd)){setStaffLeaveStatus('Choose the leave start and end dates.');fromInput?.focus();return}
  if(leaveEnd<leaveStart){setStaffLeaveStatus('The end date cannot be before the start date.');toInput?.focus();return}
  if(button){button.disabled=true;button.textContent='Saving…'}
  setStaffLeaveStatus('Saving leave record…');
  try{
    const {data,error}=await db.from('staff_leaves').insert({
      staff_id:person.uid,staff_name:person.name,unid_no:person.id||null,
      leave_start:leaveStart,leave_end:leaveEnd,note:String(noteInput?.value||'').trim().slice(0,300)
    }).select('id,staff_id,staff_name,unid_no,leave_start,leave_end,note,created_at').single();
    if(error)throw error;
    staffLeaveRows=[data,...staffLeaveRows].sort((a,b)=>String(b.leave_start).localeCompare(String(a.leave_start))||String(b.created_at).localeCompare(String(a.created_at)));
    renderStaffLeaves();if(noteInput)noteInput.value='';
    setStaffLeaveStatus(`Leave saved for ${person.name}.`,5000);
  }catch(error){
    if(isMissingStaffLeavesTable(error)){
      showStaffLeaveSetup();setStaffLeaveStatus('Database table setup is required before saving.');
    }else{
      setStaffLeaveStatus('Could not save the leave record. Check the connection and try again.');
      console.error('Could not save staff leave:',error);
    }
  }finally{if(button){button.disabled=false;button.textContent='Save leave';}}
}
async function deleteStaffLeave(id){
  const row=staffLeaveRows.find(item=>String(item.id)===String(id));if(!row)return;
  if(!await showAppDialog(`Delete the leave record for ${row.staff_name} (${formatLeaveDate(row.leave_start)})?`,{kind:'confirm',title:'Delete leave record'}))return;
  const {error}=await db.from('staff_leaves').delete().eq('id',id);
  if(error){showError('Could not delete leave record',error);return}
  staffLeaveRows=staffLeaveRows.filter(item=>String(item.id)!==String(id));renderStaffLeaves();
  setStaffLeaveStatus('Leave record deleted.',4000);
}
function printStaffLeaveHistory(){
  if(!staffLeaveRows.length){setStaffLeaveStatus('There are no leave records to print.');return}
  window.print();
}
async function createStaffLeavePdfBlob(){
  const JsPDF=window.jspdf?.jsPDF;
  if(!JsPDF)throw new Error('The PDF tools could not load. Check your internet connection and retry.');
  const doc=new JsPDF({orientation:'landscape',unit:'mm',format:'a4'});
  if(typeof doc.autoTable!=='function')throw new Error('The PDF table formatter could not load. Refresh and retry.');
  const generatedAt=new Date().toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const body=staffLeaveRows.length?staffLeaveRows.map((row,index)=>[
    index+1,row.staff_name||'',row.unid_no||'—',formatLeaveDate(row.leave_start),formatLeaveDate(row.leave_end),getLeaveDayCount(row),row.note||'—'
  ]):[['—','No leave records saved yet.','','','','','']];
  const pageWidth=doc.internal.pageSize.getWidth(),pageHeight=doc.internal.pageSize.getHeight();
  doc.autoTable({
    head:[['Sr.','Staff name','UNID / ID','Leave from','Leave through','Days','Note']],
    body,startY:32,margin:{top:32,bottom:15,left:10,right:10},
    styles:{font:'helvetica',fontSize:8,cellPadding:2.4,lineColor:[220,229,225],lineWidth:.2,overflow:'linebreak',valign:'middle'},
    headStyles:{fillColor:[19,83,70],textColor:[255,255,255],fontStyle:'bold',fontSize:8.5},
    alternateRowStyles:{fillColor:[245,249,247]},
    columnStyles:{0:{cellWidth:10,halign:'center'},1:{cellWidth:44,fontStyle:'bold'},2:{cellWidth:24,halign:'center'},3:{cellWidth:34},4:{cellWidth:34},5:{cellWidth:13,halign:'center'},6:{cellWidth:118}},
    didDrawPage:()=>{
      doc.setFont('helvetica','bold');doc.setFontSize(16);doc.setTextColor(18,58,51);doc.text('Staff Leave History',10,14);
      doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(91,111,117);
      doc.text(`${staffLeaveRows.length} record${staffLeaveRows.length===1?'':'s'}  |  Generated ${generatedAt}`,10,21);
      doc.setDrawColor(214,226,220);doc.line(10,25,pageWidth-10,25);
      doc.setFontSize(7);doc.text('Hospital Roster Builder',10,pageHeight-6);
    }
  });
  return doc.output('blob');
}
async function downloadStaffLeavePdf(){
  const button=document.querySelector('.leave-history-actions [onclick="downloadStaffLeavePdf()"]');
  if(button){button.disabled=true;button.textContent='Preparing…'}
  setStaffLeaveStatus('Preparing the leave history PDF…');
  try{
    const blob=await createStaffLeavePdfBlob();
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');
    anchor.href=url;anchor.download=`Staff-Leave-History-${localDateKey(new Date())}.pdf`;
    document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    setStaffLeaveStatus('Leave history PDF downloaded.',5000);
  }catch(error){
    console.error('Could not create staff leave PDF:',error);
    setStaffLeaveStatus('Could not create the PDF. Check the connection and retry.');
    showError('Could not download staff leave history PDF',error);
  }finally{if(button){button.disabled=false;button.textContent='Download PDF'}}
}
window.saveStaffLeave=saveStaffLeave;
window.deleteStaffLeave=deleteStaffLeave;
window.loadStaffLeaves=loadStaffLeaves;
window.printStaffLeaveHistory=printStaffLeaveHistory;
window.downloadStaffLeavePdf=downloadStaffLeavePdf;

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

  body.innerHTML=data.map(r=>`<tr data-title="${esc(r.title||'DUTY ROSTER')}">
    <td data-label="Roster title"><strong>${esc(getRosterBaseTitle(r.title||'DUTY ROSTER'))}</strong></td>
    <td data-label="Month">${esc(months[Number(r.month)-1]||r.month)}</td>
    <td data-label="Year">${esc(r.year)}</td>
    <td data-label="Actions">
      <button type="button" onclick="openSavedRoster('${r.id}',${Number(r.month)},${Number(r.year)})">Open</button>
      <button type="button" class="danger" onclick="deleteSavedRoster('${r.id}',${Number(r.month)},${Number(r.year)},this.closest('tr').dataset.title)">Delete</button>
    </td>
  </tr>`).join('');
}

async function openSavedRoster(rosterId,monthNumber,yearNumber){
  if(document.body.dataset.page==='history'){location.href=`roster.html?rosterId=${encodeURIComponent(rosterId)}&month=${encodeURIComponent(monthNumber)}&year=${encodeURIComponent(yearNumber)}`;return}
  try{
    viewingHistory=true;
    monthEl.value=String(Number(monthNumber)-1);yearEl.value=String(Number(yearNumber));
    assignments={};rememberRosterAssignments(null,{});currentRosterId=null;
    const {data:r,error:rError}=await db.from('rosters').select('id,title,month,year').eq('id',rosterId).single();
    if(rError)throw rError;
    currentRosterId=r.id;
    staffLeaveDutyKeys=new Set();
    const loadedTitle = getRosterBaseTitle(r.title||'DUTY ROSTER');
    rosterTitle.value = loadedTitle;
    manualRosterRows=loadManualRosterRows();
    try{await loadManualRosterRowsFromDatabase(rosterId)}catch(error){
      if(isMissingManualRowsTable(error)){
        manualRosterRows=loadManualRosterRows();
      }else throw error;
    }
    // Sync the dropdown display button
    const displayEl = document.getElementById('titleDropdownValue');
    if (displayEl) { displayEl.textContent = loadedTitle;displayEl.classList.remove('is-placeholder'); }
    assignments={};
    await ensureRosterSnapshot(rosterId);
    await loadRosterSnapshot(rosterId);
    const {data:aData,error:aError}=await db.from('roster_assignments').select('staff_id,duty_date,duty_code').eq('roster_id',rosterId);
    if(aError)throw aError;
    (aData||[]).forEach(x=>{if(x.staff_id)assignments[akey(x.staff_id,x.duty_date)]=x.duty_code});
    rememberRosterAssignments(rosterId);
    await loadRosterStaffLeaveDuties();
    buildRoster();
    document.querySelector('.roster-card')?.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(error){showError('Could not open saved roster',error)}
}

async function deleteSavedRoster(rosterId,monthNumber,yearNumber,rosterTitleText){
  const label=rosterTitleText||`${months[Number(monthNumber)-1]} ${yearNumber}`;
  if(!await showAppDialog(`Delete saved roster "${label}"? All duty assignments will also be deleted. This cannot be undone.`,{kind:'confirm',title:'Delete saved roster'}))return;

  const {error}=await db.from('rosters').delete().eq('id',rosterId);
  if(error){
    showError('Could not delete saved roster',error);
    return;
  }

  if(currentRosterId===rosterId){
    currentRosterId=null;
    assignments={};
    rememberRosterAssignments(null,{});
    staffLeaveDutyKeys=new Set();
    buildRoster();
  }

  await loadRosterHistory();
  alert(`Roster "${label}" deleted successfully.`);
}

async function clearAllData(){
  if(!await showAppDialog('Delete all staff and rosters? This cannot be undone.',{kind:'confirm',title:'Delete all data'}))return;
  alert('For safety, cloud-wide reset is disabled. Delete staff individually.');
}

async function changeMonth(){
  currentRosterId=null; // Reset so ensureRoster re-queries with new month/year
  manualRosterRows=rosterTitle?.value.trim()?loadManualRosterRows():[];
  await loadRoster();
  buildRoster();
}
if(monthEl)monthEl.onchange=changeMonth;
if(yearEl)yearEl.onchange=changeMonth;

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

document.addEventListener('keydown', event => {
  if(document.body.dataset.page!=='roster')return;
  if(event.key==='Delete'){
    const dutyInput=event.target.closest('#rosterTable input[data-duty-cell="true"]');
    if(dutyInput){
      event.preventDefault();
      if(dutyInput.dataset.manualRow){setManualRosterDuty(dutyInput.dataset.manualRow,dutyInput.dataset.date,'');dutyInput.value=''}
      else if(dutyInput.dataset.uid){dutyInput.value='';void queueRosterDutySave(dutyInput.dataset.uid,dutyInput.dataset.date,'')}
      return;
    }
    if(event.target.closest('input,textarea,select,button,[contenteditable="true"]'))return;
    const staffCell=event.target.closest('#rosterTable td.name[data-staff-uid]');
    if(staffCell){event.preventDefault();void clearStaffRowDuties(staffCell.dataset.staffUid)}
    return;
  }
  if(!event.key.startsWith('Arrow'))return;
  const input=event.target.closest('#rosterTable input[data-duty-cell="true"]');
  if(!input)return;
  const rows=Array.from(rosterTable?.tBodies[0]?.rows||[]);
  const rowIndex=rows.findIndex(row=>row.contains(input));
  if(rowIndex<0)return;
  const rowCells=row=>Array.from(row.querySelectorAll('input[data-duty-cell="true"]'));
  const columnIndex=rowCells(rows[rowIndex]).indexOf(input);
  let target=null;
  if(event.key==='ArrowUp'||event.key==='ArrowDown'){
    const step=event.key==='ArrowUp'?-1:1;
    const nextRowIndex=rowIndex+step;
    if(nextRowIndex>=0&&nextRowIndex<rows.length)target=rowCells(rows[nextRowIndex])[columnIndex]||null;
  }else{
    const allCells=rows.flatMap(rowCells),currentIndex=allCells.indexOf(input);
    target=allCells[currentIndex+(event.key==='ArrowLeft'?-1:1)]||null;
  }
  if(target){event.preventDefault();target.focus()}
});

if(rosterTable){
  rosterTable.addEventListener('click',event=>{
    const staffCell=event.target.closest('td.name[data-staff-uid]');
    if(!staffCell||event.target.closest('input,button'))return;
    staffCell.focus({preventScroll:true});
  });
  rosterTable.addEventListener('dragstart',event=>{
    const row=event.target.closest('tr[data-uid]');
    if(!row||event.target.closest('input,button')){event.preventDefault();return}
    if(event.ctrlKey){
      draggedRosterUid=row.dataset.uid;
      draggedRosterOrderUid=null;
      copyRow(draggedRosterUid);
      if(event.dataTransfer){event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData('text/plain',draggedRosterUid)}
    }else{
      draggedRosterOrderUid=row.dataset.uid;
      draggedRosterUid=null;
      if(event.dataTransfer){event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',`reorder:${draggedRosterOrderUid}`)}
    }
    row.classList.add('is-row-dragging');
  });
  rosterTable.addEventListener('dragover',event=>{
    const row=event.target.closest('tr[data-uid]');
    const activeUid=draggedRosterOrderUid||draggedRosterUid;
    if(!activeUid||!row||String(row.dataset.uid)===String(activeUid))return;
    event.preventDefault();
    if(event.dataTransfer)event.dataTransfer.dropEffect=draggedRosterOrderUid?'move':'copy';
    rosterTable.querySelectorAll('.is-row-drop-target,.is-row-drop-before,.is-row-drop-after').forEach(el=>el.classList.remove('is-row-drop-target','is-row-drop-before','is-row-drop-after'));
    row.classList.add(draggedRosterOrderUid?(event.clientY<row.getBoundingClientRect().top+row.offsetHeight/2?'is-row-drop-before':'is-row-drop-after'):'is-row-drop-target');
  });
  rosterTable.addEventListener('drop',async event=>{
    const row=event.target.closest('tr[data-uid]');
    if(draggedRosterOrderUid&&row){
      if(String(row.dataset.uid)!==String(draggedRosterOrderUid)){
        event.preventDefault();
        const afterTarget=event.clientY>=row.getBoundingClientRect().top+row.offsetHeight/2;
        await reorderRosterStaff(draggedRosterOrderUid,row.dataset.uid,afterTarget);
      }
      draggedRosterOrderUid=null;
      rosterTable.querySelectorAll('.is-row-dragging,.is-row-drop-target,.is-row-drop-before,.is-row-drop-after').forEach(el=>el.classList.remove('is-row-dragging','is-row-drop-target','is-row-drop-before','is-row-drop-after'));
      return;
    }
    if(!draggedRosterUid||!row||String(row.dataset.uid)===String(draggedRosterUid))return;
    event.preventDefault();
    const targetUid=row.dataset.uid;
    await pasteRow(targetUid);
    draggedRosterUid=null;
    rosterTable.querySelectorAll('.is-row-dragging,.is-row-drop-target').forEach(el=>el.classList.remove('is-row-dragging','is-row-drop-target'));
  });
  rosterTable.addEventListener('dragend',()=>{
    draggedRosterUid=null;draggedRosterOrderUid=null;
    rosterTable.querySelectorAll('.is-row-dragging,.is-row-drop-target,.is-row-drop-before,.is-row-drop-after').forEach(el=>el.classList.remove('is-row-dragging','is-row-drop-target','is-row-drop-before','is-row-drop-after'));
  });
}

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

// Live Date/Time Header Widget
function updateHeaderDateTime() {
  const el = document.getElementById('liveDateTime');
  if (!el) return;
  const now = new Date();
  const options = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
  el.textContent = now.toLocaleDateString('en-US', options).replace(',', '');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', updateHeaderDateTime);
} else {
  updateHeaderDateTime();
}
setInterval(updateHeaderDateTime, 1000);

// Compact Hamburger & Slide-in Sidebar Controls
function toggleSidebar(e) {
  if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
  setSidebarOpen(!document.body.classList.contains('sidebar-open'));
}

function closeSidebar() {
  setSidebarOpen(false);
}

function openSidebar() {
  setSidebarOpen(true);
}

function setSidebarOpen(isOpen) {
  document.body.classList.toggle('sidebar-open', isOpen);
  const button = document.getElementById('menuToggleBtn');
  if (button) {
    button.setAttribute('aria-expanded', String(isOpen));
    button.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
  }
}

window.toggleSidebar = toggleSidebar;
window.closeSidebar = closeSidebar;
window.openSidebar = openSidebar;

// Global Escape key and Outside click listener for sidebar drawer and modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if(_titleDropdownOpen){closeTitleDropdown();return}
    if(_dutyPanelOpen){closeDutyCodesPanel();return}
    const modal = document.getElementById('staffModalOverlay');
    if (modal && modal.classList.contains('active')) {
      closeStaffModal();
      return;
    }
  }
  if (e.key === 'Escape' && document.body.classList.contains('sidebar-open')) {
    closeSidebar();
  }
});

document.addEventListener('click', (e) => {
  if (!document.body.classList.contains('sidebar-open')) return;
  const drawer = document.getElementById('sidebarDrawer');
  const btn = document.getElementById('menuToggleBtn');
  if (drawer && !drawer.contains(e.target) && (!btn || !btn.contains(e.target))) {
    closeSidebar();
  }
});

init();
