const db = window.db || window.supabaseClient || (window.getSupabaseClient ? window.getSupabaseClient() : null);



const HOSPITAL='Jain Diwakar Sri Aurobindo Hospital, Ratlam';
let staff=[];
let codes=[{name:'Morning',code:'M'},{name:'Evening',code:'E'},{name:'Night',code:'N'},{name:'Off',code:'O'}];
let assignments={};
let currentRosterId=null;
let forceCreateRoster=false;
let rosterStaff=[];
let manualRosterRows=[];
let manualRosterRowSequence=0;
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
function manualRowsStorageKey(){return `sa_manual_roster_rows:${getFullRosterTitle()}`}
function loadManualRosterRows(){try{const rows=JSON.parse(localStorage.getItem(manualRowsStorageKey())||'[]');return Array.isArray(rows)?rows:[]}catch{return []}}
function saveManualRosterRows(){try{localStorage.setItem(manualRowsStorageKey(),JSON.stringify(manualRosterRows))}catch(e){console.warn('Could not save extra roster rows locally:',e)}}
function addManualRosterRow(){
  if(!rosterTitle?.value.trim()){alert('Add or select a roster title first.');openTitleDropdown();return}
  if(!rosterDays().length){alert('Choose a valid month and year first.');return}
  if(manualRosterRows.length>=60){alert('You can add up to 60 blank rows.');return}
  manualRosterRows.push({id:`manual-${Date.now()}-${++manualRosterRowSequence}`,duties:{}});
  saveManualRosterRows();buildRoster();
}
function setManualRosterDuty(id,date,value){
  const row=manualRosterRows.find(r=>r.id===id);if(!row)return;
  const code=normalizeDutyEntry(value);
  if(code===null){alert('Enter one duty code or two codes separated by /. Example: M/E.');buildRoster();return}
  if(code)row.duties[date]=code;else delete row.duties[date];saveManualRosterRows();
}
function setManualRosterIdentity(id,field,value){
  const row=manualRosterRows.find(r=>r.id===id);if(!row||!['name','unid'].includes(field))return;
  row[field]=String(value||'').trim();saveManualRosterRows();
}
function removeManualRosterRow(id){manualRosterRows=manualRosterRows.filter(r=>r.id!==id);saveManualRosterRows();buildRoster()}
function showError(prefix,error){console.error(prefix,error);alert(`${prefix}. Please try again, or contact the administrator if this continues.`)}
function normalizeDutyEntry(value){
  const text=String(value||'').trim().toUpperCase().replace(/\s*\/\s*/g,'/');
  if(!text)return '';
  const parts=text.split('/');
  if(parts.length>2||parts.some(code=>!code||!codes.some(c=>String(c.code).toUpperCase()===code)))return null;
  return text;
}

async function init(){
  const page=document.body.dataset.page||'legacy';
  try{
    if(page==='staff'){await loadStaff();return}
    if(page==='history'){await loadStaff();await loadRosterHistory();return}
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
    rosterStaff=[...staff];
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
  staffList.innerHTML=staff.map((s,i)=>`<tr><td>${i+1}</td><td class="staff-name-cell">${esc(s.name)}</td><td class="staff-id-cell">${esc(s.id||'—')}</td><td class="staff-actions"><button type="button" class="staff-edit-btn" onclick="editStaff('${s.uid}')">Edit</button><button type="button" class="danger" onclick="deleteStaff('${s.uid}')">Delete</button></td></tr>`).join('');
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
  if(!/^[A-Z0-9]{1,4}$/.test(code)){alert('Use 1–4 letters or numbers for a duty code.');return false;}
  if(codes.some(c=>String(c.code).toUpperCase()===code)){alert('Code already exists.');return false;}
  codes.push({name,code});localStorage.setItem('sa_custom_codes',JSON.stringify(codes));renderCodes();buildRoster();return true;
}
async function requestDutyCodeDetails(){
  const name=await showAppDialog('Enter a name for the new duty code.',{kind:'prompt',title:'Add duty code',placeholder:'e.g. Weekly Off'});
  if(!name?.trim())return;
  const code=await showAppDialog('Enter a short code using 1–4 letters or numbers.',{kind:'prompt',title:'Add duty code',placeholder:'e.g. WO'});
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
  if(!dutyLegend||!printLegend)return;
  try { const saved=JSON.parse(localStorage.getItem('sa_custom_codes')||'null');if(Array.isArray(saved))codes=saved; } catch { localStorage.removeItem('sa_custom_codes'); }
  dutyLegend.innerHTML=codes.map((c,i)=>`<span class="chip"><b>${esc(c.code)}</b> = ${esc(c.name)} <button type="button" class="code-delete" onclick="deleteDutyCode(${i})" title="Delete ${esc(c.code)}">×</button></span>`).join('');
  printLegend.innerHTML=codes.map(c=>`${esc(c.code)} = ${esc(c.name)}`).join(' &nbsp;&nbsp; | &nbsp;&nbsp; ');
  updateDutyCodesTriggerLabel && updateDutyCodesTriggerLabel();
}
async function deleteDutyCode(index){
  const c=codes[index];if(!c)return;
  const used=Object.values(assignments).some(v=>String(v).toUpperCase()===String(c.code).toUpperCase());
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
      <div class="duty-code-add-row"><input id="dutyCodeInput" name="dutyCode" maxlength="4" pattern="[A-Za-z0-9]{1,4}" placeholder="Code" aria-label="Short duty code" required><input id="dutyNameInput" name="dutyName" maxlength="40" placeholder="Duty name" aria-label="Duty name" required><button type="submit">＋ Add</button></div>
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

function clearModalStaffSearch() {
  const input = document.getElementById('modalStaffSearch');
  if (input) input.value = '';
  modalSearchQuery = '';
  const clearBtn = document.getElementById('modalSearchClear');
  if (clearBtn) clearBtn.style.display = 'none';
  renderModalStaffList();
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
  rosterStaff = tempSelectedStaffOrder
    .map(id => staffMap.get(id))
    .filter(Boolean);
  viewingHistory = false;

  updateSelectedStaffBadge();

  if (currentRosterId) {
    try {
      await saveRosterStaffSnapshot(currentRosterId, rosterStaff);
    } catch (e) {
      console.warn('Could not update roster snapshot in cloud:', e);
    }
  }

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
        sort_order: i + 1
      }));
      const { error: upsertErr } = await db
        .from('roster_staff_snapshots')
        .upsert(rows, { onConflict: 'roster_id,staff_id' });
      if (upsertErr) throw upsertErr;
    }
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
  const q=await db.from('roster_staff_snapshots').select('staff_id,staff_name,unid_no,sort_order').eq('roster_id',rosterId).order('sort_order');
  if(q.error)throw q.error;
  rosterStaff=(q.data||[]).map(x=>({uid:x.staff_id,name:x.staff_name,id:x.unid_no||''}));
  updateSelectedStaffBadge();
}

async function loadRoster(){
  viewingHistory=false;assignments={};currentRosterId=null;
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
    updateSelectedStaffBadge();
    return;
  }
  currentRosterId=r.data.id;
  if(rosterTitle) rosterTitle.value=getRosterBaseTitle(r.data.title)||selectedTitle;
  const titleDisplay=document.getElementById('titleDropdownValue');
  if(titleDisplay){titleDisplay.textContent=rosterTitle.value;titleDisplay.classList.remove('is-placeholder')}
  try{
    await loadRosterSnapshot(currentRosterId);
  }catch(e){
    console.error('Roster snapshot load warning:',e);
    rosterStaff=[];
  }
  const q=await db.from('roster_assignments').select('staff_id,duty_date,duty_code').eq('roster_id',currentRosterId);
  if(q.error){showError('Could not load duties',q.error);return}
  (q.data||[]).forEach(x=>{if(x.staff_id)assignments[akey(x.staff_id,x.duty_date)]=x.duty_code});
  updateSelectedStaffBadge();
}

async function setDuty(uid,date,val){
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

function getBuilderStaff(){
  return rosterStaff || [];
}

function buildRoster(){
  if(!rosterTable||!monthEl||!yearEl||!rosterTitle)return;
  const ds=rosterDays();
  const fullTitle=getFullRosterTitle();
  const displayStaff=getBuilderStaff();
  updateSelectedStaffBadge();
  printTitle.textContent=fullTitle;
  const monthName=months[+monthEl.value];
  printMonth.textContent=monthName&&yearEl.value?`FOR THE MONTH OF ${monthName.toUpperCase()} - ${yearEl.value}`:'Choose a valid month and year';
  let html=`<thead><tr><th>Sr.</th><th class="name">NAME OF STAFF</th><th class="idcol">UNID NO.</th>${ds.map(d=>`<th class="date ${d.getDay()===0?'sun':''}">${d.getDate()}<br>${d.toLocaleDateString('en',{weekday:'short'}).slice(0,2)}</th>`).join('')}</tr></thead><tbody>`;
  displayStaff.forEach((s,i)=>{
    html+=`<tr data-uid="${s.uid}" draggable="true"><td>${i+1}</td><td class="name" title="Drag this row onto another staff row to copy duties"><div class="staff-name-cell"><span>${esc(s.name)}</span><button type="button" class="row-remove-btn no-print" onclick="removeStaffFromRoster('${s.uid}')" title="Remove from this roster">×</button></div></td><td>${esc(s.id||'')}</td>`;
    ds.forEach(d=>{const dk=localDateKey(d),v=assignments[akey(s.uid,dk)]||'';html+=`<td class="${d.getDay()===0?'sun':''}"><input maxlength="9" data-duty-cell="true" data-uid="${s.uid}" value="${esc(v)}" onchange="setDuty('${s.uid}','${dk}',this.value)" title="${d.toDateString()} — use M/E for two duties"></td>`});
    html+='</tr>';
  });
  manualRosterRows.forEach((row,index)=>{
    const rowId=String(row.id||'').replace(/[^a-zA-Z0-9_-]/g,'');
    html+=`<tr class="manual-roster-row"><td>${displayStaff.length+index+1}</td><td class="name"><div class="manual-name-cell"><input type="text" maxlength="100" value="${esc(row.name||'')}" aria-label="Name for row ${displayStaff.length+index+1}" onchange="setManualRosterIdentity('${rowId}','name',this.value)"><button type="button" class="row-remove-btn manual-row-remove no-print" onclick="removeManualRosterRow('${rowId}')" title="Remove this blank row" aria-label="Remove blank duty row">×</button></div></td><td><input class="manual-row-unid" type="text" maxlength="40" value="${esc(row.unid||'')}" aria-label="UNID for row ${displayStaff.length+index+1}" onchange="setManualRosterIdentity('${rowId}','unid',this.value)"></td>`;
    ds.forEach(d=>{const dk=localDateKey(d),v=row.duties?.[dk]||'';html+=`<td class="${d.getDay()===0?'sun':''}"><input maxlength="9" data-duty-cell="true" value="${esc(v)}" aria-label="Duty for ${d.toDateString()}" onchange="setManualRosterDuty('${rowId}','${dk}',this.value)" title="${d.toDateString()} — use M/E for two duties"></td>`});
    html+='</tr>';
  });
  rosterTable.innerHTML=html+'</tbody>';
}

let copiedRowAssignments = null;
let draggedRosterUid = null;

function copyRow(uid) {
  const ds = rosterDays();
  copiedRowAssignments = {};
  ds.forEach(d => {
    const dk = localDateKey(d);
    copiedRowAssignments[dk] = assignments[akey(uid, dk)] || '';
  });
  const status=document.getElementById('rosterSaveStatus');
  if(status)status.textContent='Row copied — drag onto another staff row to paste';
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
    await saveRosterStaffSnapshot(rid, rosterStaff);
    buildRoster();
  }catch(e){if(status)status.textContent='Save failed';showError('Could not sync staff into roster',e);return}

  const {error}=await db.from('rosters').update({
    title:fullTitle,
    updated_at:new Date().toISOString()
  }).eq('id',rid);
  if(error){if(status)status.textContent='Save failed';showError('Could not save roster',error);return}
  if(status)status.textContent='Roster saved successfully';
  await loadRosterHistory();
  alert(`Roster "${fullTitle}" saved successfully.`);
}

async function saveRosterAsNew(){
  if(!rosterTitle?.value.trim()){alert('Add or select a roster title first.');openTitleDropdown();return}
  if(!rosterStaff?.length){alert('Please select staff members for this roster first.');openStaffModal();return}
  const suggested=rosterTitle.value.trim();
  const entered=await showAppDialog('Give this additional roster a title. If the same title already exists this month, a copy number will be added.',{kind:'prompt',title:'Save another roster',defaultValue:suggested,placeholder:'e.g. ICU duty roster'});
  if(entered===null)return;
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
  if(!getTitlePresets().includes(base))saveCustomTitle(base);
  const staffCopy=rosterStaff.map(staff=>({...staff}));
  const assignmentsCopy={...assignments};
  const manualCopy=JSON.parse(JSON.stringify(manualRosterRows));
  setRosterTitle(base);
  rosterStaff=staffCopy;assignments=assignmentsCopy;manualRosterRows=manualCopy;
  currentRosterId=null;forceCreateRoster=true;
  saveManualRosterRows();updateSelectedStaffBadge();buildRoster();
  await saveRoster();
  if(currentRosterId&&document.getElementById('rosterSaveStatus')?.textContent==='Roster saved successfully'){
    const copiedDuties=Object.entries(assignments).map(([key,duty_code])=>{
      const split=key.lastIndexOf('|');
      return {roster_id:currentRosterId,staff_id:key.slice(0,split),duty_date:key.slice(split+1),duty_code};
    }).filter(row=>row.staff_id&&row.duty_date&&row.duty_code);
    if(copiedDuties.length){
      const {error}=await db.from('roster_assignments').upsert(copiedDuties,{onConflict:'roster_id,staff_id,duty_date'});
      if(error){showError('New roster saved, but duty assignments could not be copied',error);return}
    }
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
 r.style.setProperty('--print-duty-font',s.dutyPt+'pt');
 r.style.setProperty('--print-name-font',s.namePt+'pt');
 r.style.setProperty('--print-id-font',s.idPt+'pt');
 r.style.setProperty('--print-header-font',s.headerPt+'pt');
 r.style.setProperty('--print-cell-padding',s.paddingMm+'mm');
}
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
 const img=await imageData('hospital-logo.jpg');if(img)doc.addImage(img,'JPEG',12,7,24,24);
 doc.setFont('helvetica','bold');doc.setFontSize(15);doc.text(HOSPITAL,210,13,{align:'center'});
 doc.setFontSize(11);doc.text(fullTitle,210,20,{align:'center'});
 doc.setFont('helvetica','normal');doc.setFontSize(9);doc.text(`FOR THE MONTH OF ${months[+monthEl.value].toUpperCase()} - ${yearEl.value}`,210,26,{align:'center'});
 const head=[['Sr.','NAME OF STAFF','UNID NO.',...ds.map(d=>`${d.getDate()}\n${d.toLocaleDateString('en',{weekday:'short'}).slice(0,2)}`)]];
 const body=exportStaff.map((x,i)=>[i+1,x.name,x.id||'',...ds.map(d=>x.isManual?(x.manualRow.duties?.[localDateKey(d)]||''):(assignments[akey(x.uid,localDateKey(d))]||''))]);
 const columnStyles={0:{cellWidth:9,fontStyle:'bold'},1:{cellWidth:55.2,halign:'center',valign:'middle',fontStyle:'bold',fontSize:s.namePt,overflow:'ellipsize'},2:{cellWidth:20,halign:'center',valign:'middle',fontStyle:'bold',fontSize:s.idPt,overflow:'ellipsize'}};
 ds.forEach((_,i)=>{columnStyles[i+3]={cellWidth:dayCellWidth,halign:'center',valign:'middle'}});
 doc.autoTable({head,body,startY:34,theme:'grid',
  styles:{font:'helvetica',fontSize:s.dutyPt,cellPadding:s.paddingMm,minCellHeight:s.rowMm,halign:'center',valign:'middle',overflow:'linebreak'},
  headStyles:{fontStyle:'bold',fontSize:9.5,minCellHeight:s.rowMm},
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
        d.cell.styles.fontSize=9.5;
        d.cell.styles.fontStyle='bold';
        d.cell.styles.textColor=[0,0,0];
      }
      if(d.section==='head'&&d.column.index===0)d.cell.styles.fontSize=10;
      if(d.section==='head'&&d.column.index===1)d.cell.styles.fontSize=11;
      if(d.section==='head'&&d.column.index===2)d.cell.styles.fontSize=10;
      if(d.section==='head'&&d.column.index<3){d.cell.styles.fontStyle='bold';d.cell.styles.halign='center';d.cell.styles.valign='middle';d.cell.styles.overflow='linebreak'}
      if(d.section==='body'&&d.column.index===1){d.cell.styles.fontStyle='bold';d.cell.styles.fontSize=s.namePt;d.cell.styles.halign='center';d.cell.styles.valign='middle';d.cell.styles.overflow='ellipsize'}
      if(d.section==='body'&&d.column.index===2){d.cell.styles.fontStyle='bold';d.cell.styles.fontSize=s.idPt;d.cell.styles.halign='center';d.cell.styles.valign='middle';d.cell.styles.overflow='ellipsize'}},
  margin:{left:7,right:7},pageBreak:'auto',rowPageBreak:'avoid'});
 const fy=doc.lastAutoTable?.finalY||180;
 const ph=doc.internal.pageSize.getHeight(),ly=Math.min(fy+6,ph-30);
 doc.setFont('helvetica','normal');doc.setFontSize(7);doc.text(codes.map(c=>`${c.code} = ${c.name}`).join('    |    '),10,ly);
 const sy=Math.min(ly+15,ph-13);doc.setDrawColor(40);doc.line(28,sy,88,sy);doc.line(330,sy,390,sy);
 doc.setFont('helvetica','bold');doc.setFontSize(8);doc.text('Signature of Nursing Supt.',58,sy+5,{align:'center'});doc.text('Signature of Medical Supt.',360,sy+5,{align:'center'});
 doc.setFont('helvetica','normal');doc.setFontSize(7);doc.text('Developed by Lakshya Purohit © 2026',410,ph-4,{align:'right'});
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
  exportStaff.forEach((s,i)=>data.push([i+1,s.name,s.id||'',...ds.map(d=>s.isManual?(s.manualRow.duties?.[localDateKey(d)]||''):(assignments[akey(s.uid,localDateKey(d))]||''))]));
  data.push([]);data.push(['Duty Codes:',...codes.map(c=>`${c.code}=${c.name}`)]);
  const ws=XLSX.utils.aoa_to_sheet(data);
  ws['!cols']=[{wch:6},{wch:24},{wch:12},...ds.map(()=>({wch:4}))];
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
    <td><strong>${esc(getRosterBaseTitle(r.title||'DUTY ROSTER'))}</strong></td>
    <td>${esc(months[Number(r.month)-1]||r.month)}</td>
    <td>${esc(r.year)}</td>
    <td>
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
    const {data:r,error:rError}=await db.from('rosters').select('id,title,month,year').eq('id',rosterId).single();
    if(rError)throw rError;
    currentRosterId=r.id;
    const loadedTitle = getRosterBaseTitle(r.title||'DUTY ROSTER');
    rosterTitle.value = loadedTitle;
    manualRosterRows=loadManualRosterRows();
    // Sync the dropdown display button
    const displayEl = document.getElementById('titleDropdownValue');
    if (displayEl) { displayEl.textContent = loadedTitle;displayEl.classList.remove('is-placeholder'); }
    assignments={};
    await ensureRosterSnapshot(rosterId);
    await loadRosterSnapshot(rosterId);
    const {data:aData,error:aError}=await db.from('roster_assignments').select('staff_id,duty_date,duty_code').eq('roster_id',rosterId);
    if(aError)throw aError;
    (aData||[]).forEach(x=>{if(x.staff_id)assignments[akey(x.staff_id,x.duty_date)]=x.duty_code});
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
  if(document.body.dataset.page!=='roster'||!event.key.startsWith('Arrow'))return;
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
  rosterTable.addEventListener('dragstart',event=>{
    const row=event.target.closest('tr[data-uid]');
    if(!row||event.target.closest('input,button')){event.preventDefault();return}
    draggedRosterUid=row.dataset.uid;
    copyRow(draggedRosterUid);
    row.classList.add('is-row-dragging');
    if(event.dataTransfer){event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData('text/plain',draggedRosterUid)}
  });
  rosterTable.addEventListener('dragover',event=>{
    const row=event.target.closest('tr[data-uid]');
    if(!draggedRosterUid||!row||String(row.dataset.uid)===String(draggedRosterUid))return;
    event.preventDefault();
    if(event.dataTransfer)event.dataTransfer.dropEffect='copy';
    rosterTable.querySelectorAll('.is-row-drop-target').forEach(el=>el.classList.remove('is-row-drop-target'));
    row.classList.add('is-row-drop-target');
  });
  rosterTable.addEventListener('drop',async event=>{
    const row=event.target.closest('tr[data-uid]');
    if(!draggedRosterUid||!row||String(row.dataset.uid)===String(draggedRosterUid))return;
    event.preventDefault();
    const targetUid=row.dataset.uid;
    await pasteRow(targetUid);
    draggedRosterUid=null;
    rosterTable.querySelectorAll('.is-row-dragging,.is-row-drop-target').forEach(el=>el.classList.remove('is-row-dragging','is-row-drop-target'));
  });
  rosterTable.addEventListener('dragend',()=>{
    draggedRosterUid=null;
    rosterTable.querySelectorAll('.is-row-dragging,.is-row-drop-target').forEach(el=>el.classList.remove('is-row-dragging','is-row-drop-target'));
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
