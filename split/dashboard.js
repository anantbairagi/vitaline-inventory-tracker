let DATA = null;
let MANIFEST = null;
const COLS = {office:0,vendor:1,item:2,unitBasis:3,unitsPerPack:4,pricePerPack:5,onHand:6,parTarget:7,rop:8,orderPacks:9,orderUnits:10,orderCost:11,status:12};

const state = { vendor:'all', scope:'needs', search:'', activeOffice:null };

function apiUrl(path){
  if(path === 'dashboard-data.json' || path.endsWith('/dashboard-data.json')){
    return '/api/dashboard-data';
  }
  if(path === 'snapshots/manifest.json' || path.endsWith('snapshots/manifest.json')){
    return '/api/snapshots/manifest.json';
  }
  if(path.startsWith('snapshots/')){
    return '/api/snapshots/' + path.slice('snapshots/'.length);
  }
  return path;
}

function money(n){
  n = n||0;
  return '$' + n.toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0});
}
function qty(n){
  if(n===null||n===undefined||n==='') return '—';
  if(Math.abs(n - Math.round(n)) < 0.005) return Math.round(n).toLocaleString('en-US');
  return n.toLocaleString('en-US', {minimumFractionDigits:1, maximumFractionDigits:1});
}
function slug(s){ return s.toLowerCase().replace(/[^a-z0-9]+/g,'-'); }
function esc(s){ return (s===null||s===undefined)?'':String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function statusPillClass(status){
  if(status==='ORDER') return 's-order';
  if(status==='Below Target') return 's-below';
  if(status==='OK') return 's-ok';
  if(status==='Stock View') return 's-stockview';
  return 's-other';
}
function statusLabel(status){
  if(status==='ORDER') return 'Order now';
  if(status==='Below Target') return 'Below target';
  if(status==='OK') return 'On track';
  if(status==='Stock View') return 'Stock view';
  if(status==='Inactive') return 'Inactive';
  if(status==='No Demand') return 'No demand';
  return status;
}

function isActive(office){ const ACT = (DATA && DATA.activation) || {}; return (ACT[office] || 'Y') === 'Y'; }

function vendorMatch(row){
  return state.vendor==='all' || row[COLS.vendor]===state.vendor;
}
function isNeedsRow(row){
  const s = row[COLS.status];
  return s==='ORDER' || s==='Below Target';
}

function officeList(){
  const seen = new Set(); const out = [];
  DATA.rows.forEach(r=>{ if(!seen.has(r[COLS.office])){ seen.add(r[COLS.office]); out.push(r[COLS.office]); } });
  return out;
}

// Aggregate per office — ALWAYS uses needs-only semantics for headline stats,
// vendor filter applied, regardless of the scope toggle (which only affects the detail table).
// Inactive offices get tier 'inactive' and are excluded from network totals.
function aggregateOffices(){
  const agg = {};
  officeList().forEach(o=> agg[o] = {office:o, cost:0, needCount:0, trackedCount:0, orderN:0, belowN:0, okN:0, active:isActive(o)});
  DATA.rows.forEach(r=>{
    if(!vendorMatch(r)) return;
    const o = r[COLS.office]; const s = r[COLS.status]; const a = agg[o];
    if(s==='ORDER'||s==='Below Target'||s==='OK') a.trackedCount++;
    if(s==='ORDER'){ a.orderN++; a.needCount++; a.cost += r[COLS.orderCost]||0; }
    else if(s==='Below Target'){ a.belowN++; a.needCount++; a.cost += r[COLS.orderCost]||0; }
    else if(s==='OK'){ a.okN++; }
  });
  return Object.values(agg).map(a=>{
    a.pct = a.trackedCount ? (100*a.needCount/a.trackedCount) : 0;
    if(!a.active){ a.tier = 'inactive'; }
    else { a.tier = a.pct>50 ? 'critical' : (a.pct>=25 ? 'watch' : 'stable'); }
    return a;
  });
}

function networkTotals(aggList){
  const active = aggList.filter(a=>a.active);
  const cost = active.reduce((s,a)=>s+a.cost,0);
  const items = active.reduce((s,a)=>s+a.needCount,0);
  const critical = active.filter(a=>a.tier==='critical').length;
  return {cost, items, critical, offices: active.length};
}

function renderMetrics(totals){
  const el = document.getElementById('metrics');
  el.innerHTML = `
    <div class="metric">
      <div class="num">${money(totals.cost)}</div>
      <div class="lbl">to order this week</div>
    </div>
    <div class="metric">
      <div class="num">${totals.items.toLocaleString()}</div>
      <div class="lbl">line items need ordering</div>
    </div>
    <div class="metric ${totals.critical>0?'is-critical':''}">
      <div class="num">${totals.critical} <span style="font-size:15px;font-weight:500;opacity:.7">/ ${totals.offices}</span></div>
      <div class="lbl">of active offices at critical risk</div>
    </div>
  `;
}

const PULSE_TRACK_PX = 58;
function renderPulse(aggList){
  const el = document.getElementById('pulse-strip');
  const sorted = [...aggList].filter(a=>a.active).sort((a,b)=>b.cost-a.cost);
  const max = Math.max(1, ...sorted.map(a=>a.cost));
  el.innerHTML = sorted.map(a=>{
    const h = Math.max(2, Math.round(PULSE_TRACK_PX*a.cost/max));
    return `<button class="pulse-bar tier-${a.tier}" data-office="${esc(a.office)}" data-h="${h}" title="${esc(a.office)} — ${money(a.cost)} (${a.needCount} items)">
      <div class="fill" style="height:2px"></div>
      <div class="tip">${esc(a.office)}</div>
    </button>`;
  }).join('');
  requestAnimationFrame(()=>{
    el.querySelectorAll('.pulse-bar').forEach(b=>{ b.querySelector('.fill').style.height = b.dataset.h + 'px'; });
  });
  el.querySelectorAll('.pulse-bar').forEach(b=> b.addEventListener('click', ()=> selectOffice(b.dataset.office, true)));
}

function tierLabel(t){ return t==='critical'?'Critical':(t==='watch'?'Watch':(t==='inactive'?'Inactive':'Stable')); }
function tierBlurb(t){
  if(t==='critical') return 'over half of tracked items need ordering';
  if(t==='watch') return 'a meaningful share of items need ordering';
  if(t==='inactive') return 'toggled off — excluded from totals';
  return 'most items are at or above target';
}

function renderCards(aggList){
  const container = document.getElementById('card-view');
  const tiers = ['critical','watch','stable','inactive'];
  const sections = tiers.map(tier=>{
    const list = aggList.filter(a=>a.tier===tier).sort((a,b)=>b.cost-a.cost);
    if(list.length===0) return '';
    const cardsHtml = list.map(a=>{
      if(tier==='inactive'){
        return `
        <button class="office-card card-inactive ${state.activeOffice===a.office?'is-open':''}" id="card-${slug(a.office)}" data-office="${esc(a.office)}">
          <span class="badge"><span class="dot"></span>Inactive</span>
          <h3>${esc(a.office)}</h3>
          <div class="stat-cost" style="color:var(--ink-faint)">—</div>
          <div class="stat-sub">excluded from ordering</div>
          <div class="stat-pct">Set to <b>Y</b> in Office Activation to re-enable</div>
        </button>`;
      }
      return `
      <button class="office-card ${state.activeOffice===a.office?'is-open':''}" id="card-${slug(a.office)}" data-office="${esc(a.office)}">
        <span class="badge"><span class="dot"></span>${tierLabel(a.tier)}</span>
        <h3>${esc(a.office)}</h3>
        <div class="stat-cost">${money(a.cost)}</div>
        <div class="stat-sub">${a.needCount} item${a.needCount===1?'':'s'} to order</div>
        <div class="stat-pct"><b>${a.pct.toFixed(0)}%</b> of ${a.trackedCount} tracked items below target</div>
      </button>`;
    }).join('');
    return `
      <section class="section tier-${tier}" data-tier-section="${tier}">
        <div class="section-head">
          <span class="tier-dot"></span>
          <h2>${tierLabel(tier)} · ${list.length} office${list.length===1?'':'s'}</h2>
          <span class="count">${tierBlurb(tier)}</span>
          <span class="rule"></span>
        </div>
        <div class="card-row" data-row-for="${tier}">${cardsHtml}</div>
      </section>
    `;
  });
  container.innerHTML = sections.join('');

  container.querySelectorAll('.office-card').forEach(c=>{
    c.addEventListener('click', ()=> selectOffice(c.dataset.office, false));
  });

  if(state.activeOffice){
    renderDetailInline(state.activeOffice);
  }
}

function selectOffice(office, scrollTo){
  state.activeOffice = (state.activeOffice===office) ? null : office;
  const aggList = aggregateOffices();
  renderCards(aggList);
  if(state.activeOffice && scrollTo){
    const card = document.getElementById('card-'+slug(office));
    if(card) card.scrollIntoView({behavior:'smooth', block:'center'});
  }
}

function renderDetailInline(office){
  const card = document.getElementById('card-'+slug(office));
  if(!card) return;
  const rowContainer = card.closest('.card-row');

  let rows = DATA.rows.filter(r=> r[COLS.office]===office && vendorMatch(r));
  if(state.scope==='needs'){
    rows = rows.filter(r=> isNeedsRow(r));
  } else {
    // full list: keep everything, but push No Demand / Excluded to the bottom
  }
  const order = {ORDER:0,'Below Target':1,OK:2,'No Demand':3,Excluded:4};
  rows.sort((a,b)=>{
    const oa = order[a[COLS.status]] ?? 5, ob = order[b[COLS.status]] ?? 5;
    if(oa!==ob) return oa-ob;
    return (b[COLS.orderCost]||0) - (a[COLS.orderCost]||0);
  });

  const totalCost = rows.reduce((s,r)=> s + (isNeedsRow(r)? (r[COLS.orderCost]||0) : 0), 0);

  let bodyHtml;
  if(rows.length===0){
    bodyHtml = `<div class="detail-empty">No items match the current filters for ${esc(office)}.</div>`;
  } else {
    bodyHtml = `
      <div class="detail-table-wrap">
      <table class="detail-table">
        <thead><tr>
          <th>Item</th><th>Status</th>
          <th class="num-col">On hand</th><th class="num-col">PAR target</th>
          <th class="num-col">Order qty</th><th class="num-col">Est. cost</th>
        </tr></thead>
        <tbody>
          ${rows.map(r=>{
            const basis = r[COLS.unitBasis] ? r[COLS.unitBasis] : '';
            const orderQ = r[COLS.orderPacks];
            return `<tr>
              <td><div class="item-name">${esc(r[COLS.item])}</div><div class="item-vendor">${esc(r[COLS.vendor])}</div></td>
              <td><span class="status-pill ${statusPillClass(r[COLS.status])}"><span class="dot"></span>${statusLabel(r[COLS.status])}</span></td>
              <td class="num-col qty-cell">${qty(r[COLS.onHand])}</td>
              <td class="num-col qty-cell">${qty(r[COLS.parTarget])}</td>
              <td class="num-col qty-cell">${orderQ?qty(orderQ):'—'}</td>
              <td class="num-col cost-cell">${r[COLS.orderCost]?money(r[COLS.orderCost]):'—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      </div>
      <div class="detail-footnote">${rows.filter(isNeedsRow).length} item${rows.filter(isNeedsRow).length===1?'':'s'} to order · ${money(totalCost)} estimated ${state.vendor==='all'?'':'(' + state.vendor + ' only)'}</div>
    `;
  }

  const panel = document.createElement('div');
  panel.className = 'detail-panel';
  panel.innerHTML = `
    <div class="detail-head">
      <div>
        <h3>${esc(office)}</h3>
        <div class="meta">${state.scope==='needs' ? 'Showing items that need ordering' : 'Full item list, including items on track'}</div>
      </div>
      <button class="detail-close" aria-label="Close">×</button>
    </div>
    ${bodyHtml}
  `;
  panel.querySelector('.detail-close').addEventListener('click', ()=>{ state.activeOffice=null; renderCards(aggregateOffices()); });

  rowContainer.insertAdjacentElement('afterend', panel);
}

function renderSearch(){
  const cardView = document.getElementById('card-view');
  const searchView = document.getElementById('search-view');
  const q = state.search.trim().toLowerCase();
  if(!q){
    cardView.style.display='';
    searchView.style.display='none';
    return;
  }
  cardView.style.display='none';
  searchView.style.display='';

  let rows = DATA.rows.filter(r=> vendorMatch(r) && (state.scope==='full' || isNeedsRow(r)));
  rows = rows.filter(r=>{
    return String(r[COLS.item]).toLowerCase().includes(q) || String(r[COLS.vendor]).toLowerCase().includes(q) || String(r[COLS.office]).toLowerCase().includes(q);
  });
  rows.sort((a,b)=> (b[COLS.orderCost]||0) - (a[COLS.orderCost]||0));

  if(rows.length===0){
    searchView.innerHTML = `<div class="empty-state"><div class="big">No matches</div>Try a different item name, SKU, or vendor.</div>`;
    return;
  }

  const shown = rows.slice(0,300);
  searchView.innerHTML = `
    <div class="search-meta">${rows.length} result${rows.length===1?'':'s'} for “${esc(state.search)}”${rows.length>300?' — showing first 300':''}</div>
    <div class="search-results">
      ${shown.map(r=>`
        <div class="result-row">
          <div class="ritem">
            <div class="name">${esc(r[COLS.item])}</div>
            <div class="meta">${esc(r[COLS.office])} · ${esc(r[COLS.vendor])} · <span class="status-pill ${statusPillClass(r[COLS.status])}" style="padding:2px 7px;"><span class="dot"></span>${statusLabel(r[COLS.status])}</span></div>
          </div>
          <div class="rqty">${r[COLS.orderPacks]?qty(r[COLS.orderPacks])+' pk':'—'}</div>
          <div class="rcost">${r[COLS.orderCost]?money(r[COLS.orderCost]):'—'}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderVendorChips(){
  const vendors = Array.from(new Set(DATA.rows.map(r=>r[COLS.vendor]))).sort();
  const el = document.getElementById('vendor-chips');
  const all = [{key:'all', label:'All vendors'}, ...vendors.map(v=>({key:v,label:v}))];
  el.innerHTML = all.map(v=>`<button class="chip ${state.vendor===v.key?'is-active':''}" data-vendor="${esc(v.key)}">${esc(v.label)}</button>`).join('');
  el.querySelectorAll('.chip').forEach(c=> c.addEventListener('click', ()=>{
    state.vendor = c.dataset.vendor;
    fullRender();
  }));
}

function fullRender(){
  const aggList = aggregateOffices();
  renderMetrics(networkTotals(aggList));
  renderPulse(aggList);
  renderVendorChips();
  renderCards(aggList);
  renderSearch();
}

document.getElementById('search-input').addEventListener('input', (e)=>{
  state.search = e.target.value;
  renderSearch();
});
document.querySelectorAll('#scope-toggle button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('#scope-toggle button').forEach(b=>b.classList.remove('is-active'));
    btn.classList.add('is-active');
    state.scope = btn.dataset.scope;
    fullRender();
  });
});

function paintControls(){
  document.getElementById('dw-range').textContent = DATA.controls.booking_start + ' – ' + DATA.controls.booking_end;
  document.getElementById('dw-snap').textContent = DATA.controls.snapshot;
  document.getElementById('dw-basis').textContent = DATA.controls.demand_basis;
  let stamp = 'Loaded ' + new Date().toLocaleString('en-US', {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
  if(DATA.generated){
    const g = new Date(DATA.generated);
    if(!isNaN(g)) stamp = 'Data refreshed ' + g.toLocaleString('en-US', {month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit'});
  }
  document.getElementById('gen-stamp').textContent = stamp;
}

async function loadWeek(fileUrl){
  const url = apiUrl(fileUrl) + (apiUrl(fileUrl).indexOf('?')>=0?'&':'?') + 'v=' + Date.now();
  const resp = await fetch(url, {cache:'no-store'});
  if(!resp.ok) throw new Error('HTTP ' + resp.status);
  return await resp.json();
}

function populateWeekPicker(manifest){
  const picker = document.getElementById('week-picker');
  const sel = document.getElementById('week-select');
  const weeks = (manifest && manifest.weeks) || [];
  if(weeks.length <= 1){ picker.style.display='none'; return; }
  sel.innerHTML = weeks.map(w=>`<option value="${esc(w.file)}" data-week="${esc(w.week)}">${esc(w.label)}</option>`).join('');
  picker.style.display='flex';
  sel.onchange = async ()=>{
    const opt = sel.options[sel.selectedIndex];
    const file = sel.value;
    const wk = opt.getAttribute('data-week');
    try {
      DATA = await loadWeek(file);
      state.activeOffice = null; state.search='';
      const si=document.getElementById('search-input'); if(si) si.value='';
      paintControls();
      fullRender();
      updateWeekBadge(wk, manifest.current);
    } catch(err){
      showLoadError('Could not load that week ('+esc(String(err.message||err))+').');
    }
  };
  updateWeekBadge(manifest.current, manifest.current);
}

function updateWeekBadge(viewing, current){
  const badge = document.getElementById('week-badge');
  if(!badge) return;
  if(viewing === current){
    badge.textContent = 'Current week';
    badge.className = 'week-badge is-current';
  } else {
    badge.textContent = 'Past week';
    badge.className = 'week-badge is-past';
  }
}

function showLoadError(msg){
  document.getElementById('card-view').innerHTML =
    '<div class="empty-state"><div class="big">Couldn\u2019t load data</div>' +
    '<div style="max-width:520px;margin:0 auto;line-height:1.6">' + msg + '</div></div>';
}

function setUploadStatus(msg, kind){
  const el = document.getElementById('upload-status');
  if(!el) return;
  el.textContent = msg || '';
  el.className = 'upload-status' + (kind ? ' is-' + kind : '');
}

async function reloadDashboardData(){
  let manifest = null;
  try {
    const mResp = await fetch('/api/snapshots/manifest.json?v=' + Date.now(), {cache:'no-store'});
    if(mResp.ok) manifest = await mResp.json();
  } catch(e){ /* single-week mode */ }

  MANIFEST = manifest;
  if(manifest && manifest.weeks && manifest.weeks.length){
    const cur = manifest.weeks.find(w=>w.week===manifest.current) || manifest.weeks[0];
    DATA = await loadWeek(cur.file);
    populateWeekPicker(manifest);
  } else {
    DATA = await loadWeek('dashboard-data.json');
    const picker = document.getElementById('week-picker');
    if(picker) picker.style.display='none';
  }
  if(!DATA || !DATA.rows) throw new Error('Data file loaded but looks empty or malformed.');
  paintControls();
  fullRender();
}

async function uploadWorkbook(file){
  setUploadStatus('Uploading workbook…', 'busy');
  const form = new FormData();
  form.append('file', file, file.name);
  const resp = await fetch('/api/upload-workbook', { method:'POST', body: form });
  let body = {};
  try { body = await resp.json(); } catch(e){ /* ignore */ }
  if(!resp.ok){
    if(resp.status === 502 || resp.status === 504){
      throw new Error('Workbook processing failed on the server (timeout or memory). Please try again in a moment.');
    }
    throw new Error(body.detail || body.message || ('Upload failed (HTTP ' + resp.status + ')'));
  }
  state.activeOffice = null;
  state.search = '';
  state.vendor = 'all';
  state.scope = 'needs';
  const si = document.getElementById('search-input'); if(si) si.value='';
  document.querySelectorAll('#scope-toggle button').forEach(b=>{
    b.classList.toggle('is-active', b.dataset.scope === 'needs');
  });
  await reloadDashboardData();
  const label = body.snapshot_label || body.week || 'updated week';
  setUploadStatus('Updated to ' + label + ' (' + (body.rows || 0).toLocaleString() + ' rows)', 'ok');
}

function initUploadControls(){
  const input = document.getElementById('workbook-upload');
  const btn = document.getElementById('upload-btn');
  if(!input || !btn) return;
  btn.addEventListener('click', ()=> input.click());
  input.addEventListener('change', async ()=>{
    const file = input.files && input.files[0];
    input.value = '';
    if(!file) return;
    if(!/\.xlsx$/i.test(file.name)){
      setUploadStatus('Please choose an .xlsx workbook.', 'error');
      return;
    }
    try {
      await uploadWorkbook(file);
    } catch(err){
      setUploadStatus(String(err.message || err), 'error');
    }
  });
}

async function boot(){
  try {
    await reloadDashboardData();
    initUploadControls();
  } catch (err) {
    showLoadError('The dashboard could not load its data (' + esc(String(err.message||err)) + ').');
  }
}

boot();
