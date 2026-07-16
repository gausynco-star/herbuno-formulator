(function(){
var MX=window.HB_MX;
if(!MX){document.getElementById('bb').innerHTML='<p>Matrix asset not loaded.</p>';return;}

var T2F={'Standardised Extract':'SE','Water-Soluble Extract':'WL','Botanical Extract Powder':'RE',
'Oil-Soluble Extract':'OE','Dehydrated Powder':'MP','Nutraceutical Active':'IC','Carrier Oil':'CO',
'Spray-Dried Powder':'SD','Spray-Dried Extract':'SD','Tea & Infusion':'TC','Whole Herb & Spice':'WD',
'Grain, Flour & Starch':'MP','Liposomal Ingredient':'LP','Mushroom Ingredient':'MU','Botanical Powder':'MP'};
function fmtOf(pt,ti){var c=T2F[pt];return c==='MU'?(/extract/i.test(ti)?'RE':'WD'):(c||'XX');}
var CODE_NAMES=MX.code_names||{};
var HELP=MX.product_helpers||{};

function fmtLabel(code,entry){
 var base=CODE_NAMES[code]||code;
 if(entry&&entry.overlay==='standardised'){
  var beh=(entry.behaviour||'').toLowerCase();
  if(beh.indexOf('dual')>-1) return 'Standardised extract (matched to phase)';
  if(beh.indexOf('water-soluble')>-1) return 'Standardised + water-soluble extract';
  if(beh.indexOf('oil-soluble')>-1) return 'Standardised + oil-soluble extract';
  if(beh.indexOf('dry-solid')>-1) return 'Standardised + dry extract';
  return 'Standardised extract';
 }
 return base;
}

var PROD={};
MX.fam.forEach(function(f){f.products.forEach(function(p){PROD[p.id]={n:p.name,tag:p.tag,tagLabel:p.tag_label,roles:p.roles};});});
var ROLES=['base','active','functional','flavour','carrier','texture','colour'];
var ROLE_DESC={base:'the primary carrier or body of the product',active:'the ingredient delivering the main intended benefit',
 functional:'fibre or bulking ingredient',flavour:'flavour or aroma',carrier:'carrier or excipient',texture:'texture or structure',colour:'colour'};

function tier(roleEntry,code){
 if(!roleEntry||roleEntry.routing!=='catalogue') return null;
 if(code==='IC'||code==='LP') return 'review'; /* Option A: isolates/liposomals -> application review, not a blanket tier */
 var e=(roleEntry.fmt||{})[code];
 if(!e) return 'unknown';
 return e.tier==='ok'?'ok':(e.tier==='warn'?'wn':'no');
}
function tierIcon(tr){return tr==='ok'?'\u2713':tr==='wn'?'\u26A0':tr==='unknown'?'?':tr==='review'?'\u2699':'\u26D4';}
function tierClass(tr){return tr==='ok'?'ok':tr==='wn'?'wn':tr==='unknown'?'unk':tr==='review'?'unk':'no';}
function whyNote(roleEntry,code){
 if(code==='IC'||code==='LP') return 'The right form of an isolate or liposomal depends on its solubility, dose and physical grade, which the catalogue Type cannot resolve \u2014 application review needed.';
 var e=(roleEntry.fmt||{})[code];
 if(e&&e.note) return e.note;
 if(e) return 'Tiered Avoid for this role.';
 return 'Not evaluated for this role \u2014 no rule exists either way. Neither recommended nor disqualified; ask us if you want to use it.';
}
function codesForTier(c,want){
 if(!c||c.routing!=='catalogue'||!c.fmt) return [];
 return Object.keys(c.fmt).filter(function(code){return c.fmt[code].tier===want;});
}
function bestFitCode(c){
 /* Best fit is ONLY an 'ok' tier for this exact Product x Role. No fallthrough to conditional/avoid. */
 if(!c||c.routing!=='catalogue'||!c.fmt) return null;
 var ok=Object.keys(c.fmt).filter(function(x){return c.fmt[x].tier==='ok';});
 return ok.length?ok[0]:null;
}
function possibleCode(c){
 if(!c||c.routing!=='catalogue'||!c.fmt) return null;
 var wn=Object.keys(c.fmt).filter(function(x){return c.fmt[x].tier==='warn';});
 return wn.length?wn[0]:null;
}
/* Build-row recommendation cell: shows the best fit, or a clearly-labelled compromise, never a bare conditional/avoid dressed up as required. */
function needHint(c){
 if(!c||c.routing!=='catalogue') return '<i style="color:var(--l)">not our category</i>';
 var bf=bestFitCode(c);
 if(bf) return '<b>'+esc(fmtLabel(bf,c.fmt[bf]))+'</b>';
 var pc=possibleCode(c);
 if(pc) return '<span style="color:var(--m)"><i>no single best fit \u00b7 possible: '+esc(fmtLabel(pc,c.fmt[pc]))+'</i></span>';
 return '<i style="color:var(--l)">no catalogue best fit \u2014 see options</i>';
}

var S={mode:'quick',p:null,batch:'',rows:[],q:{role:'',sku:'',q:'',pct:''}};
try{var lm=sessionStorage.getItem('hb_mode'); if(lm==='build'||lm==='quick') S.mode=lm;}catch(e){}
var CAT=[];
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}
function clean(t){return String(t).split('|')[0].replace(/\s*[-\u2013]\s*(Natural|Pure|Premium|Bulk|Wholesale).*$/i,'').trim();}
function packGrams(o){var m=String(o).match(/^\s*([\d.]+)\s*(kg|g)\b/i);if(!m)return 0;var n=parseFloat(m[1]);return /kg/i.test(m[2])?n*1000:n;}
function money(n){return '$'+n.toFixed(2);}
function pickVar(sku,needG,role){
 if(!sku.v||!sku.v.length)return null;
 var vs=sku.v.slice();
 if(sku.r){var want=role==='base'?'10:1':'25:1';var f=vs.filter(function(v){return v.rat===want;});
  if(!f.length)f=vs.filter(function(v){return v.rat==='10:1';});if(f.length)vs=f;}
 vs.sort(function(a,b){return a.g-b.g;});
 if(!needG) return {v:vs[0],qty:1};
 for(var i=0;i<vs.length;i++) if(vs[i].g>=needG) return {v:vs[i],qty:1};
 var big=vs[vs.length-1]; return {v:big,qty:Math.ceil(needG/big.g)};
}
function find(q){q=(q||'').toLowerCase().trim();if(q.length<2)return[];
 return CAT.filter(function(s){return s.t.toLowerCase().indexOf(q)>-1;}).slice(0,30);}

function renderControls(){
 var C=document.getElementById('bb-controls');
 [].forEach.call(document.querySelectorAll('.bb-mode'),function(b){b.classList.toggle('on',b.dataset.mode===S.mode);});
 var opts='<option value="">Select a product\u2026</option>';
 MX.fam.forEach(function(f){opts+='<optgroup label="'+esc(f.name)+'">';
  f.products.forEach(function(p){opts+='<option value="'+p.id+'"'+(p.id===S.p?' selected':'')+'>'+esc(p.name)+'</option>';});
  opts+='</optgroup>';});
 var help=(S.p&&HELP[S.p])?'<p class="bb-help">'+esc(HELP[S.p])+'</p>':'';
 if(S.mode==='quick'){
  var roleOpts='<option value="">Select a role\u2026</option>';
  if(S.p){var P=PROD[S.p];
   ROLES.forEach(function(rid){var c=P.roles[rid];if(!c)return;
    var naOrOos=c.na||c.routing==='out_of_scope';
    roleOpts+='<option value="'+rid+'"'+(rid===S.q.role?' selected':'')+(naOrOos?' disabled':'')+'>'+
      esc(c.label||rid)+' \u2014 '+esc(ROLE_DESC[rid]||'')+(naOrOos?' (not a sourced ingredient here)':'')+'</option>';});}
  C.innerHTML='<div class="bb-selrow q">'+
   '<div><span class="bb-lbl">1 \u00B7 What are you making?</span><select class="bb-sel" id="bb-prod">'+opts+'</select>'+help+'</div>'+
   '<div><span class="bb-lbl">2 \u00B7 Which role does it perform?</span><select class="bb-sel" id="bb-role" '+(S.p?'':'disabled')+'>'+roleOpts+'</select></div></div>';
 } else {
  C.innerHTML='<div class="bb-selrow"><div><span class="bb-lbl">What are you making?</span>'+
   '<select class="bb-sel" id="bb-prod">'+opts+'</select>'+help+'</div>'+
   '<div class="bb-tb"><span class="bb-lbl">Batch size (optional)</span>'+
   '<div class="bb-tb-in"><input class="bb-sel" id="bb-batch" type="number" min="0" step="0.1" placeholder="e.g. 5" value="'+esc(S.batch)+'"><span>kg</span></div></div></div>';
 }
}

function renderResult(c){
 var h='';
 if(c.na||c.routing==='out_of_scope'){
  return '<div class="bb-result"><div class="bb-res-guide"><b>Usually supplied by your manufacturer or excipient partner.</b><br>'+esc(c.rec)+'</div></div>';
 }
 if(c.routing==='ask_us'||c.routing==='no_code_application_dependent'){
  h+='<div class="bb-result"><div class="bb-res-guide"><b>Application review needed.</b> '+esc(c.rec)+'<br><span style="color:var(--m)">The correct form depends on dosage, process or device details.</span></div>';
  if(c.reason) h+='<div class="bb-tech-body"><div class="bb-drv">'+esc(c.reason)+'</div></div>';
  return h+'</div>';
 }
 if(c.routing==='guidance_only'){
  h+='<div class="bb-result"><div class="bb-res-guide"><b>Technical guidance \u2014 no direct catalogue match.</b><br>'+esc(c.rec)+'</div>';
  var tb='';
  if(c.acc&&c.acc!=='\u2014') tb+='<div class="bb-drv"><b>Acceptable with caveat:</b> '+esc(c.acc)+'</div>';
  if(c.avoid&&c.avoid!=='\u2014') tb+='<div class="bb-drv"><b>Avoid:</b> '+esc(c.avoid)+'</div>';
  if(c.reason) tb+='<div class="bb-drv">'+esc(c.reason)+'</div>';
  if(tb) h+='<div class="bb-tech-body">'+tb+'</div>';
  return h+'</div>';
 }
 function chips(codes){if(!codes.length)return '';
  return '<div class="bb-chips">'+codes.map(function(cd){return '<span class="bb-chip-f">'+esc(fmtLabel(cd,(c.fmt||{})[cd]))+'</span>';}).join('')+'</div>';}
 h+='<div class="bb-result">';
 h+='<div class="bb-res-band best"><div class="bb-res-tag">Best fit</div><div class="bb-res-txt">'+esc(c.rec)+'</div>'+chips(codesForTier(c,'ok'))+'</div>';
 if((c.acc&&c.acc!=='\u2014')||codesForTier(c,'warn').length){
  h+='<div class="bb-res-band poss"><div class="bb-res-tag">Possible, with a compromise</div><div class="bb-res-txt">'+
     esc(c.acc&&c.acc!=='\u2014'?c.acc:'Usable in some cases with a consequence \u2014 see technical explanation.')+'</div>'+chips(codesForTier(c,'warn'))+'</div>';
 }
 if((c.avoid&&c.avoid!=='\u2014')||codesForTier(c,'avoid').length){
  h+='<div class="bb-res-band avoid"><div class="bb-res-tag">Usually unsuitable</div><div class="bb-res-txt">'+
     esc(c.avoid&&c.avoid!=='\u2014'?c.avoid:'Some formats are disqualified for this role \u2014 see technical explanation.')+'</div>'+chips(codesForTier(c,'avoid'))+'</div>';
 }
 var tech='';
 if(c.reason) tech+='<div class="bb-drv"><b>Why this recommendation:</b> '+esc(c.reason)+'</div>';
 if(c.qual&&c.qual!=='\u2014') tech+='<div class="bb-drv"><b>Manufacturing / scope condition:</b> '+esc(c.qual)+'</div>';
 if(tech) h+='<details class="bb-tech"><summary>Technical explanation</summary><div class="bb-tech-body">'+tech+'</div></details>';
 return h+'</div>';
}

function supplierText(c){
 var P=PROD[S.p];
 var form=(c.rec||'').replace(/\s+/g,' ').trim();
 var qual=(c.qual&&c.qual!=='\u2014')?(' Manufacturing note: '+c.qual+'.'):'';
 return 'Supplier request\nPlease quote '+(form.charAt(0).toLowerCase()+form.slice(1))+
   ' suitable for use in '+P.n+', with solubility data, carrier declaration and a representative COA.'+qual;
}

function drawQuick(){
 var W=document.getElementById('bb-work'),F=document.getElementById('bb-foot');
 F.innerHTML='';
 var P=PROD[S.p];
 if(!P){W.innerHTML='<p class="bb-empty">Pick what you\u2019re making, then the role your ingredient plays. You\u2019ll get the right form straight away \u2014 no need to build a whole blend.</p>';physStrip();return;}
 physStrip();
 if(!S.q.role){W.innerHTML='<p class="bb-empty">Now choose the role your ingredient performs, above.</p>';return;}
 var c=P.roles[S.q.role];
 var h=renderResult(c);
 if(c.routing==='catalogue'){
  h+='<div class="bb-match"><div class="bb-match-h">3 \u00B7 Find matching Herbuno products</div>'+
     '<div class="bb-sw"><input class="bb-in" id="bb-qq" value="'+esc(S.q.q||'')+'" placeholder="Search a botanical\u2026" autocomplete="off">'+ddQuick()+'</div></div>';
  if(S.q.sku){var sk=CAT.filter(function(x){return x.h===S.q.sku;})[0];
   if(sk){var tr=tier(c,sk.f);
    h+='<div class="bb-note '+(tr==='ok'?'info':tr==='wn'?'wn':tr==='unknown'?'no':'wn')+'"><span class="ic '+tierClass(tr)+'">'+tierIcon(tr)+'</span> <b>'+esc(clean(sk.t))+'</b> \u2014 '+esc(fmtLabel(sk.f,(c.fmt||{})[sk.f]))+'.<br>'+esc(whyNote(c,sk.f))+'</div>';}}
  h+='<div class="bb-supp"><div class="bb-supp-h">Supplier-ready wording</div><div class="bb-supp-b" id="bb-suppt">'+esc(supplierText(c))+'</div>'+
     '<div class="bb-supp-a"><button class="bb-btn sm" data-copysupp="1">Copy request</button>'+
      '<button class="bb-btn sm o" data-askherbuno="1">Ask Herbuno</button>'+
      '<button class="bb-btn sm o" data-reqsample="1">Request sample</button></div></div>';
  h+='<div class="bb-actions"><button class="bb-btn o" data-toblend="1">Add this ingredient to a full blend \u2192</button></div>';
 } else {
  h+='<div class="bb-actions"><button class="bb-btn" data-askrole="1">Ask a sourcing specialist \u2192</button>'+
     '<button class="bb-btn o" data-toblend="1">Continue in the full blend builder \u2192</button></div>';
 }
 W.innerHTML=h;
}
function ddQuick(){
 if(S.q.sku) return ''; /* a selection is active; typing clears it (input handler) and reopens search */
 var P=PROD[S.p],c=P.roles[S.q.role],hits=find(S.q.q);
 if(!S.q.q||S.q.q.length<2||!hits.length){
  return (S.q.q&&S.q.q.length>=2)?'<div class="bb-dd"><div class="bb-ox">Nothing matching \u201C'+esc(S.q.q)+'\u201D in the catalogue.</div></div>':'';
 }
 return ddCommon(hits,c,'q');
}

function drawBuild(){
 var P=PROD[S.p];physStrip();
 var W=document.getElementById('bb-work');
 if(!P){W.innerHTML='<p class="bb-empty">Add the ingredient you are evaluating, and choose the role it performs in your finished product.<br><span style="color:var(--l)">You can check one ingredient or continue building the full blend.</span></p>';buildFoot();return;}
 var h='<div class="bb-grid"><div class="bb-hd"><span></span><span>Role</span><span>Ingredient</span><span>Best-fit format</span><span>%</span><span></span></div>';
 if(!S.rows.length){h+='<p class="bb-empty">Add the ingredient you are evaluating below, and choose the role it performs.<br><span style="color:var(--l)">You can check one ingredient or continue building the full blend.</span></p>';}
 S.rows.forEach(function(r,i){
  var c=P.roles[r.role],pick=r.sku?CAT.filter(function(x){return x.h===r.sku;})[0]:null,tr=pick?tier(c,pick.f):'';
  h+='<div class="bb-r'+(r.open?' open':'')+'"><button class="bb-tw" data-tw="'+i+'" title="Why?">'+(r.open?'\u25BE':'\u25B8')+'</button>';
  var first=i===0||S.rows[i-1].role!==r.role;
  h+='<div class="bb-role">'+(first?esc(c.label):'<span style="color:var(--l);font-weight:400">\u21B3</span>')+'</div>';
  if(c.routing==='ask_us'||c.routing==='no_code_application_dependent'){
   h+='<div style="grid-column:3/6;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="bb-need">'+esc(c.rec)+'</span><button class="bb-btn sm o" data-rfq-role="'+i+'">Ask a sourcing specialist \u2192</button></div>';
  } else if(c.routing==='guidance_only'){
   h+='<div class="bb-need" style="grid-column:3/6"><i>Technical guidance \u2014 no direct catalogue match:</i> '+esc(c.rec)+'</div>';
  } else if(pick){
   h+='<div class="bb-picked"><span class="ic '+tierClass(tr)+'">'+tierIcon(tr)+'</span><span>'+esc(clean(pick.t))+' <span style="color:var(--m);font-size:.85em">\u00b7 selected: '+esc(fmtLabel(pick.f,(c.fmt||{})[pick.f]))+'</span></span></div>';
   h+='<div class="bb-need">'+needHint(c)+'</div>';
   h+='<input class="bb-in bb-pct" type="number" min="0" max="100" step="0.1" data-pct="'+i+'" value="'+(r.pct||'')+'" placeholder="0">';
  } else {
   h+='<div class="bb-sw"><input class="bb-in" data-q="'+i+'" value="'+esc(r.q||'')+'" placeholder="Search a botanical\u2026" autocomplete="off">'+ddBuild(i,c,r)+'</div>';
   h+='<div class="bb-need">'+needHint(c)+'</div>';
   h+='<input class="bb-in bb-pct" type="number" min="0" max="100" step="0.1" data-pct="'+i+'" value="'+(r.pct||'')+'" placeholder="0">';
  }
  h+='<button class="bb-x" data-del="'+i+'">\u00D7</button>';
  if(r.open) h+='<div class="bb-exp">'+renderResult(c)+expPickNotes(c,pick,r,i)+'</div>';
  h+='</div>';
 });
 var used=S.rows.map(function(x){return x.role;});
 h+='<div class="bb-addbar">'+ROLES.filter(function(x){return P.roles[x]&&!P.roles[x].na&&P.roles[x].routing!=='out_of_scope';}).map(function(x){
   var n=used.filter(function(u){return u===x;}).length;
   return '<button class="bb-chip" data-add="'+x+'" title="'+esc(ROLE_DESC[x]||'')+'">+ '+esc(P.roles[x].label)+(n?' <b style="color:var(--td)">('+n+')</b>':'')+'</button>';}).join('')+'</div></div>';
 W.innerHTML=h;buildFoot();
}
function expPickNotes(c,pick,r,i){
 if(!pick||c.routing!=='catalogue') return '';
 var h='',tr=tier(c,pick.f),top=bestFitCode(c);
 if(tr==='unknown') h+='<div class="bb-note no"><b>? '+esc(fmtLabel(pick.f,(c.fmt||{})[pick.f]))+' \u2014 not evaluated for this role.</b><br>No rule either way. Ask us before relying on it.<br><button class="bb-btn sm" style="margin-top:8px" data-rfq="'+esc(r.q||clean(pick.t))+'|'+esc(pick.f)+'">Ask us \u2192</button></div>';
 if(tr==='review') h+='<div class="bb-note no"><b>\u2699 '+esc(fmtLabel(pick.f,(c.fmt||{})[pick.f]))+' \u2014 application review needed.</b><br>The right form of an isolate or liposomal depends on its solubility, dose and grade, which the catalogue Type cannot resolve. Tell us and we\u2019ll confirm.<br><button class="bb-btn sm" style="margin-top:8px" data-rfq="'+esc(r.q||clean(pick.t))+'|'+esc(pick.f)+'">Ask a sourcing specialist \u2192</button></div>';
 if(tr==='no'&&top) h+='<div class="bb-note wn"><b>This is not the correct format for this role.</b> The best fit is a <b>'+esc(fmtLabel(top,(c.fmt||{})[top]))+'</b>, and we don\u2019t stock '+esc(r.q||clean(pick.t))+' in that form.<br><button class="bb-btn sm" style="margin-top:8px" data-rfq="'+esc(r.q||clean(pick.t))+'|'+esc(top)+'">Ask us to source it \u2192</button></div>';
 if(tr==='no'&&!top) h+='<div class="bb-note wn"><b>This format is disqualified for this role.</b> There\u2019s no single best-fit catalogue format here \u2014 see the grouped options, or ask us.<br><button class="bb-btn sm" style="margin-top:8px" data-rfq="'+esc(r.q||clean(pick.t))+'|'+esc(pick.f)+'">Ask us \u2192</button></div>';
 if(pick.r&&r.role==='base') h+='<div class="bb-note wn"><b>\u26D4 This offers 10:1 and 25:1 \u2014 and it\u2019s your BASE.</b> A higher ratio means less material per serving: right for a dose, wrong for the body of the product. Choose <b>10:1</b>, or reconsider the concentrate entirely.<br><i>Ask whether the ratio is on a fresh or dried basis \u2014 it swings the same powder 4\u20135\u00D7.</i></div>';
 if(pick.r&&r.role==='active') h+='<div class="bb-note wn"><b>10:1 or 25:1?</b> For an active the higher ratio is usually right. But <b>a ratio is not an assay</b> \u2014 if you need a label figure, you need a standardised extract.</div>';
 return h;
}
function ddCommon(hits,c,ctx){
 var A=hits.filter(function(x){return tier(c,x.f)==='ok';});
 var B=hits.filter(function(x){return tier(c,x.f)==='wn';});
 var RV=hits.filter(function(x){return tier(c,x.f)==='review';});
 var U=hits.filter(function(x){return tier(c,x.f)==='unknown';});
 var Cc=hits.filter(function(x){return tier(c,x.f)==='no';});
 var pickAttr=ctx==='q'?'data-qpick="1"':'data-pick="'+ctx+'"';
 var h='<div class="bb-dd">';
 A.forEach(function(x){h+='<div class="bb-o" '+pickAttr+' data-h="'+x.h+'"><span class="ic ok">\u2713</span><span>'+esc(clean(x.t))+'</span><span class="bb-of">'+esc(fmtLabel(x.f,(c.fmt||{})[x.f]))+'</span></div>';});
 B.forEach(function(x){h+='<div class="bb-o" '+pickAttr+' data-h="'+x.h+'"><span class="ic wn">\u26A0</span><span>'+esc(clean(x.t))+'</span><span class="bb-of">'+esc(fmtLabel(x.f,(c.fmt||{})[x.f]))+'</span></div><div class="bb-ox">'+esc(whyNote(c,x.f))+'</div>';});
 RV.forEach(function(x){h+='<div class="bb-o" '+pickAttr+' data-h="'+x.h+'"><span class="ic unk">\u2699</span><span>'+esc(clean(x.t))+'</span><span class="bb-of">'+esc(fmtLabel(x.f,(c.fmt||{})[x.f]))+'</span></div><div class="bb-ox">Isolate/liposomal \u2014 application review needed; the right form depends on solubility and dose. Selectable; we\u2019ll confirm.</div>';});
 U.forEach(function(x){h+='<div class="bb-o" '+pickAttr+' data-h="'+x.h+'"><span class="ic unk">?</span><span>'+esc(clean(x.t))+'</span><span class="bb-of">'+esc(fmtLabel(x.f,(c.fmt||{})[x.f]))+'</span></div><div class="bb-ox">Not evaluated for this role \u2014 no rule either way. Selectable, but confirm with us before relying on it.</div>';});
 Cc.forEach(function(x){h+='<div class="bb-o dis"><span class="ic no">\u26D4</span><span style="color:var(--m)">'+esc(clean(x.t))+'</span><span class="bb-of">'+esc(fmtLabel(x.f,(c.fmt||{})[x.f]))+'</span></div><div class="bb-ox">'+esc(whyNote(c,x.f))+'</div>';});
 var top=bestFitCode(c);
 if(!A.length){var qtext=ctx==='q'?S.q.q:(S.rows[+ctx]?S.rows[+ctx].q:'');
  h+='<div class="bb-src"><p>'+(top?'<b>We don\u2019t stock \u201C'+esc(qtext)+'\u201D as a '+esc(fmtLabel(top,(c.fmt||{})[top]))+'</b> (the best fit for this role). ':'<b>No confirmed best-fit catalogue format for this role.</b> ')+
     (B.length||U.length||RV.length?'The options above may be usable, but none is the confirmed best fit.':'Everything above is disqualified for this role.')+'</p>'+
     '<button class="bb-btn sm" data-rfq="'+esc(qtext)+'|'+esc(top||'')+'">Ask us to source it \u2192</button></div>';}
 return h+'</div>';
}
function ddBuild(i,c,r){
 var hits=find(r.q);
 if(!r.q||r.q.length<2||!hits.length){
  return (r.q&&r.q.length>=2)?'<div class="bb-dd"><div class="bb-ox">Nothing matching \u201C'+esc(r.q)+'\u201D in the catalogue.</div></div>':'';
 }
 return ddCommon(hits,c,''+i);
}
function physStrip(){
 var el=document.getElementById('bb-phys'),P=PROD[S.p];
 if(!P){el.innerHTML='';return;}
 var h='<div class="bb-phys">Physics class: '+esc(P.tagLabel)+'</div>';
 var nas=ROLES.filter(function(x){return P.roles[x]&&(P.roles[x].na||P.roles[x].routing==='out_of_scope');});
 if(nas.length){h+='<div class="bb-na"><span class="bb-lbl">Usually supplied by your manufacturer or excipient partner</span>'+
  nas.map(function(x){return '<div class="bb-na-r"><b>'+esc(P.roles[x].label)+'</b><span>'+esc(P.roles[x].rec)+'</span></div>';}).join('')+'</div>';}
 el.innerHTML=h;
}

function buildFoot(){
 var P=PROD[S.p],F=document.getElementById('bb-foot');
 if(!P||S.mode!=='build'){F.innerHTML='';return;}
 var tot=S.rows.reduce(function(a,x){return a+(parseFloat(x.pct)||0);},0);
 var used=S.rows.map(function(x){return x.role;});
 var multi={};S.rows.forEach(function(x){if(x.pct)multi[x.role]=(multi[x.role]||0)+(parseFloat(x.pct)||0);});
 var sub=Object.keys(multi).filter(function(k){return S.rows.filter(function(x){return x.role===k;}).length>1;}).map(function(k){return P.roles[k].label+' '+multi[k].toFixed(1)+'%';}).join(' \u00B7 ');
 var msg;
 if(tot>100) msg='Over 100% \u2014 something has to come out.';
 else if(tot===100) msg='Balanced.'+(sub?'  '+sub:'');
 else if(tot>0) msg=(100-tot).toFixed(1)+'% remaining \u2014 usually the base or a carrier.';
 else if(S.rows.length>1&&used.indexOf('base')<0) msg='No base defined. Something is doing that job by accident.';
 else msg='Assign an inclusion rate to each ingredient.';
 var B=parseFloat(S.batch)||0,cost=[],total=0,unpriced=0;
 if(B>0){S.rows.forEach(function(r){var c=P.roles[r.role];if(c.routing!=='catalogue')return;
  var sk=r.sku?CAT.filter(function(x){return x.h===r.sku;})[0]:null;
  if(sk&&(tier(c,sk.f)==='unknown'||tier(c,sk.f)==='review')){unpriced++;return;}
  var pct=parseFloat(r.pct)||0;if(!sk||!pct){if(sk&&!pct)unpriced++;return;}
  var needG=B*1000*pct/100,pv=pickVar(sk,needG,r.role);if(!pv){unpriced++;return;}
  var line=pv.v.price*pv.qty;total+=line;cost.push({r:r,sk:sk,needG:needG,pv:pv,line:line});});}
 var h='<div class="bb-foot"><div class="bb-tot'+(tot>100?' over':'')+(tot===100?' done':'')+'">'+tot.toFixed(1)+'%<small>'+esc(msg)+'</small></div>';
 if(B>0&&cost.length){h+='<div class="bb-costsum"><div class="bb-lbl">Cost of a '+B+' kg batch</div><div class="bb-costsum-n">'+money(total)+'</div><small>'+money(total/B)+' per kg of finished blend</small></div>';}
 h+='</div>';
 if(B>0&&cost.length){h+='<div class="bb-cost"><div class="bb-cost-h"><span>Ingredient</span><span>Needed</span><span>Pack</span><span>Cost</span><span>Share</span></div>';
  cost.sort(function(a,b){return b.line-a.line;});
  cost.forEach(function(c){var share=total?100*c.line/total:0,q=c.needG>=1000?(c.needG/1000).toFixed(2)+' kg':Math.round(c.needG)+' g',big=share>=40;
   h+='<div class="bb-cost-r"><span class="n">'+esc(clean(c.sk.t))+(c.pv.v.rat?' <i>'+esc(c.pv.v.rat)+'</i>':'')+'</span><span class="m">'+q+'</span><span class="m">'+(c.pv.qty>1?c.pv.qty+' \u00D7 ':'')+esc(c.pv.v.pack.split('/')[0].trim())+'</span><span class="m">'+money(c.line)+'</span><span class="sh'+(big?' big':'')+'"><b style="width:'+Math.round(share)+'%"></b>'+share.toFixed(0)+'%</span></div>';});
  if(unpriced) h+='<div class="bb-cost-note">'+unpriced+' ingredient(s) not costed \u2014 missing a percentage, or not a catalogue-matched role.</div>';
  h+='</div>';}
 h+='<div class="bb-actions">';
 if(cost.length){h+='<button class="bb-btn hero" id="bb-bench">Order bench samples \u2014 smallest pack of each \u2192</button><button class="bb-btn" id="bb-full">Add full batch to cart \u2014 '+money(total)+'</button>';}
 h+='<button class="bb-btn o" id="bb-send">Send to Herbuno</button><button class="bb-btn o" id="bb-dl">Download spec</button></div>';
 if(S.rows.length){h+='<div class="bb-share"><span class="bb-lbl">Share this formulation</span><button class="bb-sh" data-share="whatsapp">WhatsApp</button><button class="bb-sh" data-share="email">Email</button><button class="bb-sh" data-share="linkedin">LinkedIn</button><button class="bb-sh" data-share="copy">Copy link</button><em>The link carries your blend in the page fragment \u2014 it is never sent to our server.</em></div>';}
 h+='<div id="bb-cartmsg"></div>';
 if(!B&&S.rows.some(function(r){return r.sku;})) h+='<p class="bb-hint">Enter a <b>batch size</b> above to see quantities, costs and add these to your cart.</p>';
 F.innerHTML=h;
}

function draw(){renderControls();if(S.mode==='quick')drawQuick();else drawBuild();}

function loadCat(){
 var c=null;try{c=JSON.parse(sessionStorage.getItem('hb_cat_v4')||'null');}catch(e){}
 if(c&&c.t>Date.now()-1800000){CAT=c.s;stat();draw();return;}
 var all=[],pg=1;
 (function nx(){fetch('/products.json?limit=250&page='+pg).then(function(r){return r.json();}).then(function(d){
  (d.products||[]).forEach(function(p){var ri=-1;(p.options||[]).forEach(function(o,k){if(/Extraction Ratio/i.test(o.name))ri=k;});
   var vs=(p.variants||[]).map(function(v){var o1=v.option1||'',g=packGrams(o1);var rat=ri===1?(v.option2||''):(ri===2?(v.option3||''):'');
    return {id:v.id,pack:o1,g:g,price:parseFloat(v.price)||0,rat:rat,av:v.available!==false};}).filter(function(v){return v.g>0;});
   all.push({h:p.handle,t:p.title,f:fmtOf(p.product_type,p.title),r:ri>-1?1:0,v:vs});});
  if((d.products||[]).length===250&&pg<10){pg++;nx();}
  else{CAT=all;try{sessionStorage.setItem('hb_cat_v4',JSON.stringify({t:Date.now(),s:all}));}catch(e){}stat();draw();}
 }).catch(function(){stat(1);draw();});})();
}
function stat(e){document.getElementById('bb-stat').textContent=e?'Catalogue unavailable \u2014 showing formats only.':CAT.length+' live products \u00B7 straight from the Herbuno catalogue';}

var root=document.getElementById('bb');
root.addEventListener('click',function(e){
 var md=e.target.closest('[data-mode]');
 if(md){switchMode(md.dataset.mode);return;}
 var t=e.target.closest('[data-add],[data-del],[data-tw],[data-pick],[data-qpick],[data-rfq],[data-rfq-role],[data-share],[data-copysupp],[data-askherbuno],[data-reqsample],[data-toblend],[data-askrole],#bb-send,#bb-dl,#bb-bench,#bb-full');
 if(!t)return;
 if(t.dataset.add!==undefined){S.rows.push({role:t.dataset.add,q:'',sku:'',pct:'',open:false});
   S.rows=ROLES.map(function(rr){return S.rows.filter(function(x){return x.role===rr;});}).reduce(function(a,b){return a.concat(b);},[]);draw();}
 else if(t.dataset.del!==undefined){S.rows.splice(+t.dataset.del,1);draw();}
 else if(t.dataset.tw!==undefined){S.rows[+t.dataset.tw].open=!S.rows[+t.dataset.tw].open;draw();}
 else if(t.dataset.pick!==undefined){var r=S.rows[+t.dataset.pick];r.sku=t.dataset.h;
   var s=CAT.filter(function(x){return x.h===r.sku;})[0],c=PROD[S.p].roles[r.role];
   if(s&&tier(c,s.f)!=='ok')r.open=true;draw();}
 else if(t.dataset.qpick!==undefined){S.q.sku=t.dataset.h;var _s=CAT.filter(function(x){return x.h===S.q.sku;})[0];if(_s)S.q.q=clean(_s.t);draw();}
 else if(t.dataset.rfq!==undefined){var q=t.dataset.rfq.split('|');rfq(q[0],q[1]);}
 else if(t.dataset.rfqRole!==undefined){rfqRole(S.rows[+t.dataset.rfqRole]);}
 else if(t.dataset.askrole!==undefined){rfqRoleQuick();}
 else if(t.dataset.copysupp!==undefined){copySupplier(t);}
 else if(t.dataset.askherbuno!==undefined){rfqQuick();}
 else if(t.dataset.reqsample!==undefined){rfqQuick(true);}
 else if(t.dataset.toblend!==undefined){toBlend();}
 else if(t.id==='bb-send'){rfq('','');}
 else if(t.dataset.share){share(t.dataset.share,t);}
 else if(t.id==='bb-bench'){addCart(true,t);}
 else if(t.id==='bb-full'){addCart(false,t);}
 else if(t.id==='bb-dl'){dl();}
});
root.addEventListener('input',function(e){var t=e.target;
 if(t.id==='bb-qq'){S.q.q=t.value;S.q.sku='';draw();var el=root.querySelector('#bb-qq');if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);}}
 else if(t.dataset.q!==undefined){var i=+t.dataset.q;S.rows[i].q=t.value;S.rows[i].sku='';draw();var el2=root.querySelector('[data-q="'+i+'"]');if(el2){el2.focus();el2.setSelectionRange(el2.value.length,el2.value.length);}}
 else if(t.dataset.pct!==undefined){S.rows[+t.dataset.pct].pct=t.value;buildFoot();}
});
root.addEventListener('change',function(e){var t=e.target;
 if(t.id==='bb-prod'){S.p=t.value;S.q.role='';S.q.sku='';S.q.q='';if(S.mode==='build')S.rows=[];draw();}
 else if(t.id==='bb-role'){S.q.role=t.value;S.q.sku='';S.q.q='';draw();}
 else if(t.id==='bb-batch'){S.batch=t.value;buildFoot();}
});
function switchMode(m){if(m===S.mode)return;S.mode=m;try{sessionStorage.setItem('hb_mode',m);}catch(e){}draw();}
function toBlend(){
 S.mode='build';try{sessionStorage.setItem('hb_mode','build');}catch(e){}
 if(S.q.role){var exists=S.rows.some(function(r){return r.role===S.q.role&&r.sku===S.q.sku;});
  if(!exists){S.rows.push({role:S.q.role,q:S.q.q||'',sku:S.q.sku||'',pct:S.q.pct||'',open:true});
   S.rows=ROLES.map(function(rr){return S.rows.filter(function(x){return x.role===rr;});}).reduce(function(a,b){return a.concat(b);},[]);}}
 draw();
}
function copySupplier(btn){var el=document.getElementById('bb-suppt');if(!el)return;var txt=el.textContent;
 var done=function(){var o=btn.textContent;btn.textContent='Copied';setTimeout(function(){btn.textContent=o;},1600);};
 if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(done,done);}
 else{var ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');}catch(e){}document.body.removeChild(ta);done();}
 try{if(typeof gtag==='function')gtag('event','supplier_request_copy',{product:S.p||'',role:S.q.role||''});}catch(e){}
}

function share(how,btn){var url=shareURL(),txt=shareText(),P=PROD[S.p];
 try{if(typeof gtag==='function')gtag('event','formulator_share',{method:how,product:S.p||''});}catch(e){}
 if(how==='copy'){var done=function(){var o=btn.textContent;btn.textContent='Link copied';setTimeout(function(){btn.textContent=o;},1800);};
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(url).then(done,done);}
  else{var ta=document.createElement('textarea');ta.value=url;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');}catch(e){}document.body.removeChild(ta);done();}return;}
 if(how==='whatsapp'){window.open('https://wa.me/?text='+encodeURIComponent(txt+'\n'+url),'_blank','noopener');return;}
 if(how==='linkedin'){window.open('https://www.linkedin.com/sharing/share-offsite/?url='+encodeURIComponent(url),'_blank','noopener');return;}
 if(how==='email'){var subj=P?'Formulation \u2014 '+P.n:'HerbIQ Formulator';
  var body=(P?'Product: '+P.n+'\nConstraint: '+P.tagLabel+'\n'+(S.batch?'Batch: '+S.batch+' kg\n':'')+'\n'+lines()+'\n\n':'')+'Open this formulation:\n'+url+'\n\nEvery format is derived from physics and trade convention.';
  if(body.length>1600) body=(P?'Product: '+P.n+'\n\n':'')+'Open this formulation:\n'+url;
  var a=document.createElement('a');a.href='mailto:?subject='+encodeURIComponent(subj)+'&body='+encodeURIComponent(body);a.style.display='none';
  document.body.appendChild(a);a.click();document.body.removeChild(a);return;}
}
function shareURL(){var payload={m:S.mode,p:S.p,b:S.batch,r:S.rows.map(function(r){return [r.role,r.sku,r.pct];}),q:[S.q.role,S.q.sku,S.q.pct]};
 return location.origin+location.pathname+'#f='+encodeURIComponent(JSON.stringify(payload));}
function shareText(){var P=PROD[S.p];return P?('A formulation for '+P.n+' \u2014 built with the HerbIQ Formulator.'):'A formulation built with the HerbIQ Formulator.';}
function decodeBlend(){var m=location.hash.match(/#f=(.+)$/);if(!m)return false;
 try{var p=JSON.parse(decodeURIComponent(m[1]));if(!p.p||!PROD[p.p])return false;
  S.p=p.p;S.batch=p.b||'';S.mode=(p.m==='quick'||p.m==='build')?p.m:S.mode;
  S.rows=(p.r||[]).map(function(t){return {role:t[0],sku:t[1]||'',pct:t[2]||'',q:'',open:false};});
  if(p.q){S.q={role:p.q[0]||'',sku:p.q[1]||'',q:'',pct:p.q[2]||''};}
  return true;}catch(e){return false;}}

function addCart(bench,btn){
 var P=PROD[S.p],B=parseFloat(S.batch)||0,items=[],skipped=[];
 S.rows.forEach(function(r){var c=P.roles[r.role];if(c.routing!=='catalogue')return;
  var sk=r.sku?CAT.filter(function(x){return x.h===r.sku;})[0]:null;if(!sk)return;
  var _t=tier(c,sk.f); if(_t==='unknown'||_t==='review'){skipped.push(clean(sk.t)+(_t==='review'?' (application review needed)':' (not evaluated for this role)'));return;}
  var pct=parseFloat(r.pct)||0;var pv=bench?pickVar(sk,0,r.role):pickVar(sk,B*1000*pct/100,r.role);
  if(!pv||!pv.v||!pv.v.id){skipped.push(clean(sk.t));return;}
  items.push({id:Number(pv.v.id),quantity:bench?1:Math.max(1,pv.qty),_n:clean(sk.t),_role:c.label,_pct:pct});});
 if(!items.length){msgBtn(btn,'Nothing to add');return;}
 btn.disabled=true;var orig=btn.textContent;btn.textContent=bench?'Adding samples\u2026':'Adding to cart\u2026';
 var added=0,failed=[];
 function step(k){if(k>=items.length){finish();return;}var it=items[k];
  fetch('/cart/add.js',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},
   body:JSON.stringify({id:it.id,quantity:it.quantity,properties:{'Formulation':P.n,'Role':it._role,'Inclusion':(it._pct?it._pct+'%':'\u2014'),'Source':'HerbIQ Formulator'}})})
  .then(function(r){return r.json().then(function(j){return {ok:r.ok,status:r.status,j:j};});})
  .then(function(res){if(res.ok){added++;}else{failed.push(it._n+' \u2014 '+((res.j&&(res.j.description||res.j.message))||('HTTP '+res.status)));}step(k+1);})
  .catch(function(){failed.push(it._n+' \u2014 network error');step(k+1);});}
 function finish(){fetch('/cart/update.js',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({attributes:{'Formulator - making':P.n,'Formulator - batch':(bench?'bench samples':(B?B+' kg':'\u2014')),'Formulator - blend':lines()}})}).catch(function(){}).then(function(){
   try{if(typeof gtag==='function')gtag('event',bench?'formulator_bench_cart':'formulator_batch_cart',{product:S.p,items:added,batch_kg:B});}catch(e){}
   if(added&&!failed.length){window.location.href='/cart';return;}
   if(added&&failed.length){var w=document.getElementById('bb-cartmsg');
    if(w)w.innerHTML='<div class="bb-note wn"><b>'+added+' added to cart.</b> These could not be added:<br>'+failed.map(function(x){return '\u00B7 '+esc(x);}).join('<br>')+'<br><a href="/cart" style="color:var(--tk)">Go to cart \u2192</a></div>';
    btn.disabled=false;btn.textContent=orig;return;}
   var w2=document.getElementById('bb-cartmsg');
   if(w2)w2.innerHTML='<div class="bb-note wn"><b>Nothing could be added to the cart.</b><br>'+failed.map(function(x){return '\u00B7 '+esc(x);}).join('<br>')+'</div>';
   btn.disabled=false;btn.textContent=orig;});}
 step(0);
}
function msgBtn(b,t){var o=b.textContent;b.textContent=t;setTimeout(function(){b.textContent=o;},2000);}
function lines(){var P=PROD[S.p];
 return S.rows.map(function(r){var c=P.roles[r.role];
  if(c.routing!=='catalogue') return '\u2022 '+c.label+': (ask us \u2014 no catalogue match)';
  var s=CAT.filter(function(x){return x.h===r.sku;})[0];
  return '\u2022 '+c.label+': '+(s?clean(s.t)+' ['+fmtLabel(s.f,(c.fmt||{})[s.f])+']':'(not selected)')+(r.pct?' \u2014 '+r.pct+'%':'');}).join('\n');}

function rfq(bot,fmt){var P=PROD[S.p]||{n:'(no product selected)',tagLabel:''};
 var ctx=bot?'<b>'+esc(bot)+'</b> as <b>'+esc(fmtLabel(fmt,null)||fmt||'a format we don\u2019t stock')+'</b><br>for <b>'+esc(P.n)+'</b>':'<b>'+esc(P.n)+'</b><br><span style="color:var(--m)">'+esc(P.tagLabel)+'</span>';
 var body=(bot?'SOURCING REQUEST\n\nBotanical: '+bot+'\nRequired format: '+(fmtLabel(fmt,null)||fmt||'-')+'\nNot currently stocked.\n\n':'FORMULATION ENQUIRY\n\n')+'Product: '+P.n+'\n\nBlend so far:\n'+lines()+'\n\nGenerated by HerbIQ Formulator.';
 openRfqModal(bot?'Ask us to source this':'Send this formulation to Herbuno',ctx,body,bot,fmt);}
function rfqRole(row){var P=PROD[S.p],c=P.roles[row.role];
 var ctx='<b>'+esc(c.label)+'</b> for <b>'+esc(P.n)+'</b><br><span style="color:var(--m)">'+esc(c.rec)+'</span>';
 var body='ROLE ENQUIRY\n\nProduct: '+P.n+'\nRole: '+c.label+'\nGuidance: '+c.rec+'\n\nBlend so far:\n'+lines()+'\n\nGenerated by HerbIQ Formulator.';
 openRfqModal('Ask us about '+c.label,ctx,body,'','');}
function rfqRoleQuick(){var P=PROD[S.p],c=P.roles[S.q.role];
 var ctx='<b>'+esc(c.label)+'</b> for <b>'+esc(P.n)+'</b><br><span style="color:var(--m)">'+esc(c.rec)+'</span>';
 var body='APPLICATION REVIEW\n\nProduct: '+P.n+'\nRole: '+c.label+'\nGuidance: '+c.rec+'\n\nThe correct form depends on dosage, process or device details.\n\nGenerated by HerbIQ Formulator.';
 openRfqModal('Ask a sourcing specialist',ctx,body,'','');}
function rfqQuick(sample){var P=PROD[S.p],c=P.roles[S.q.role];
 var sk=S.q.sku?CAT.filter(function(x){return x.h===S.q.sku;})[0]:null;
 var ctx='<b>'+esc(P.n)+'</b> \u2014 '+esc(c.label)+'<br><span style="color:var(--m)">'+esc(c.rec)+'</span>';
 var body=(sample?'SAMPLE REQUEST\n\n':'ENQUIRY\n\n')+'Product: '+P.n+'\nRole: '+c.label+'\nRecommended form: '+c.rec+'\n'+(sk?'Considering: '+clean(sk.t)+'\n':'')+'\n'+supplierText(c)+'\n\nGenerated by HerbIQ Formulator.';
 openRfqModal(sample?'Request a sample':'Ask Herbuno',ctx,body,'','');}
function openRfqModal(title,ctx,body,bot,fmt){
 var m=document.createElement('div');m.className='bb-modal';
 m.innerHTML='<div class="bb-mb"><div class="bb-mt"><h3>'+title+'</h3><button class="bb-x" data-close="1">\u00D7</button></div><div class="bb-mbd">'+
 '<div class="bb-ctx">'+ctx+'</div>'+
 '<form method="post" action="/contact#contact_form" accept-charset="UTF-8">'+
 '<input type="hidden" name="form_type" value="contact"><input type="hidden" name="utf8" value="\u2713">'+
 '<input type="hidden" name="contact[Enquiry]" value="'+esc(title)+' \u2014 HerbIQ Formulator">'+
 '<input type="hidden" name="contact[Making]" value="'+esc((PROD[S.p]||{}).n||'')+'">'+
 (bot?'<input type="hidden" name="contact[Botanical]" value="'+esc(bot)+'"><input type="hidden" name="contact[Format needed]" value="'+esc(fmtLabel(fmt,null)||fmt||'')+'">':'')+
 '<div class="bb-f"><div class="bb-lbl">Your name</div><input class="bb-in" name="contact[name]" required></div>'+
 '<div class="bb-f"><div class="bb-lbl">Work email</div><input class="bb-in" type="email" name="contact[email]" required></div>'+
 '<div class="bb-f"><div class="bb-lbl">Company</div><input class="bb-in" name="contact[company]"></div>'+
 '<div class="bb-f"><div class="bb-lbl">Anything else?</div><textarea name="contact[body]">'+esc(body)+'</textarea></div>'+
 '<button class="bb-btn" type="submit" style="width:100%">Send to Herbuno \u2192</button>'+
 '<p class="bb-priv">Your formulation stays private. We do not publish buyer formulations, ever.</p>'+
 '</form></div></div>';
 root.appendChild(m);
 m.addEventListener('click',function(e){if(e.target===m||e.target.dataset.close)m.remove();});
 m.querySelector('form').addEventListener('submit',function(){try{if(typeof gtag==='function')gtag('event',bot?'sourcing_rfq':'formulation_rfq',{botanical:bot||'',format:fmt||'',product:S.p||''});}catch(e){}});
}
function dl(){var P=PROD[S.p];if(!P)return;
 var L=['HERBUNO \u2014 FORMULATION SPEC','Product: '+P.n,'Physics class: '+P.tagLabel,'',lines(),'','TOTAL: '+S.rows.reduce(function(a,x){return a+(parseFloat(x.pct)||0);},0).toFixed(1)+'%','','Every format above is derived from physics and trade convention.','Inclusion rates are yours \u2014 we do not publish them.','herbuno.com/pages/herbiq-formulator'];
 var b=new Blob([L.join('\n')],{type:'text/plain'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='herbuno-spec.txt';a.click();
 try{fetch('/cart/update.js',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({attributes:{'Formulator - making':P.n,'Formulator - blend':lines()}})}).catch(function(){});
  if(typeof gtag==='function')gtag('event','formulation_spec',{product:S.p});}catch(e){}}

draw();loadCat();
setTimeout(function(){if(decodeBlend()){draw();}},0);
})();
