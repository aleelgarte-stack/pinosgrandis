/* Legajo Pinos Grandis — aplicación web.
   Los datos viven en la planilla de Google Sheets y los documentos en Drive;
   este archivo solo dibuja la pantalla y habla con /api. */
(function () {
"use strict";

/* ---------------- utilidades ---------------- */
var HOY = new Date(); HOY.setHours(0, 0, 0, 0);
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function parseD(s){ if(!s) return null; var p=String(s).split("-"); if(p.length!==3) return null; var d=new Date(+p[0],+p[1]-1,+p[2]); d.setHours(0,0,0,0); return isNaN(d)?null:d; }
function fmt(s){ var d=parseD(s); if(!d) return "—"; return ("0"+d.getDate()).slice(-2)+"/"+("0"+(d.getMonth()+1)).slice(-2)+"/"+d.getFullYear(); }
function mesAnio(s){ var d=parseD(s); if(!d) return "—"; return ("0"+(d.getMonth()+1)).slice(-2)+"/"+String(d.getFullYear()).slice(-2); }
function dias(s){ var d=parseD(s); if(!d) return null; return Math.round((d-HOY)/86400000); }
function anios(s){ var d=parseD(s); if(!d) return null; var a=HOY.getFullYear()-d.getFullYear();
  var m=HOY.getMonth()-d.getMonth(); if(m<0||(m===0&&HOY.getDate()<d.getDate())) a--; return a; }
function addDays(n){ return new Date(HOY.getTime()+n*86400000).toISOString().slice(0,10); }
function hoyISO(){ return HOY.toISOString().slice(0,10); }
function iniciales(n){
  var p=String(n||"").replace(/-/g," ").split(/\s+/).filter(Boolean);
  if(!p.length) return "?";
  return ((p[0][0]||"")+(p.length>1?p[p.length-1][0]:"")).toUpperCase();
}
function titulo(n){ return String(n||"").toLowerCase().replace(/(^|[\s\-])([a-záéíóúñ])/g,function(m,a,b){return a+b.toUpperCase();}); }

function toast(msg){
  var t=document.getElementById("toast");
  t.textContent=msg; t.classList.add("on");
  clearTimeout(t._t); t._t=setTimeout(function(){t.classList.remove("on");},3200);
}
var pendientes=0;
function ocupado(si){
  pendientes+=si?1:-1; if(pendientes<0) pendientes=0;
  document.getElementById("guardando").classList.toggle("on",pendientes>0);
}
async function api(ruta,opciones){
  ocupado(true);
  try{
    var r=await fetch("/api/"+ruta,Object.assign({credentials:"same-origin"},opciones||{}));
    var t=await r.text();
    var j=t?JSON.parse(t):{};
    if(r.status===401&&ruta!=="login"){
      /* El servidor no reconoce la sesión: se volvió a la pantalla de ingreso. */
      salir(true);
      throw new Error("La sesión venció. Volvé a entrar.");
    }
    if(!r.ok){ var e=new Error(j.error||("Error "+r.status)); e.codigo=j.codigo; e.faltan=j.faltan; throw e; }
    return j;
  } finally { ocupado(false); }
}

/* ---------------- semáforo ---------------- */
var COLOR={bad:"var(--crit)",near:"var(--alert)",soon:"var(--warn)",ok:"var(--ok)",none:"var(--muted)"};
var PESO={bad:0,near:1,soon:2,ok:3,none:4};
function estadoDoc(o){
  if(!o) return {k:"none",txt:"Sin dato",corto:"—",cls:"none"};
  if(o.na) return {k:"none",txt:"No aplica",corto:"N/A",cls:"none"};
  var d=dias(o.vto);
  if(d===null) return {k:"none",txt:"Sin dato",corto:"—",cls:"none"};
  if(d<0) return {k:"bad",txt:"Vencido hace "+Math.abs(d)+" d",corto:"Vencido",cls:"bad"};
  if(d<=30) return {k:"near",txt:"Vence en "+d+" días",corto:d+" d",cls:"near"};
  if(d<=60) return {k:"soon",txt:"Vence en "+d+" días",corto:d+" d",cls:"soon"};
  return {k:"ok",txt:"Vigente hasta "+fmt(o.vto),corto:mesAnio(o.vto),cls:"ok"};
}
function estadoBps(p){
  if(p.bps&&p.bps.tiene) return {k:"ok",txt:"Presentada",corto:"Sí",cls:"ok"};
  return {k:"none",txt:"Pendiente de cargar",corto:"Pendiente",cls:"soon"};
}
function chip(e){ return '<span class="chip '+e.cls+'"><span class="dot"></span>'+esc(e.txt)+'</span>'; }
function chipMini(e){ return '<span class="chip '+e.cls+'"><span class="dot"></span>'+esc(e.corto)+'</span>'; }

/* ---------------- modelo ---------------- */
var DOCS=[
  {k:"salud",n:"Carné de salud",corto:"C. salud"},
  {k:"moto",n:"Carné de motosierrista",corto:"Motosierrista"},
  {k:"libH",n:"Libreta de conducir · categoría H",corto:"Libreta H"},
  {k:"libA",n:"Libreta de conducir · categoría A",corto:"Libreta A"},
  {k:"pa",n:"Primeros auxilios",corto:"1ros auxilios"}
];
var TITULOS={}; DOCS.forEach(function(d){ TITULOS[d.k]=d.n; }); TITULOS.bps="Constancia de alta en BPS";
var CATEGORIAS=["Maquinista especializado","Maquinista ll","Peón Común","Obrero","Titular"];
var FUNCIONES=["Maquinista","Motosierrista","Peón","Dirección","Chofer","Vivero","Administración"];
var EPP_TIPOS=["Casco forestal con protector facial y auditivo","Pantalón anticorte","Polainas anticorte","Botas con puntera de acero","Guantes anticorte","Chaleco reflectivo","Antiparras","Protector auditivo","Campera impermeable"];

var DB={personas:[],planillaUrl:"",carpetaUrl:""};
var sesion=null;

function nuevaPersona(){
  var d=function(){ return {vto:"",na:false,archivo:null}; };
  return {id:"",nombre:"",empresa:"Pinos Grandis",servicio:"",documento:"",fechaNac:"",ingreso:"",
    categoria:"",funcion:"",estado:"Activo",
    salud:d(),moto:d(),libH:d(),libA:d(),
    pa:{vto:"",na:false,emisor:"",archivo:null},
    bps:{tiene:false,numero:"",fecha:"",archivo:null},
    epp:[],archivos:[]};
}
function docsDe(p){ return DOCS.map(function(d){ return {k:d.k,n:d.n,corto:d.corto,o:p[d.k]||{},e:estadoDoc(p[d.k])}; }); }
function peorDe(p){ var peor="ok"; docsDe(p).forEach(function(x){ if(x.e.k!=="none"&&PESO[x.e.k]<PESO[peor]) peor=x.e.k; }); return peor; }
function eppPendientes(p){
  var n=0;
  (p.epp||[]).forEach(function(x){
    if(!x.entregado) n++;
    else if(!x.repuesto){ var d=dias(x.fechaReposicion); if(d!==null&&d<=0) n++; }
  });
  return n;
}
function totales(){
  var t={activos:0,vencidos:0,proximos:0,epp:0,bps:0};
  DB.personas.forEach(function(p){
    if(p.estado!=="Activo") return;
    t.activos++;
    docsDe(p).forEach(function(x){
      if(x.e.k==="bad") t.vencidos++;
      else if(x.e.k==="near"||x.e.k==="soon") t.proximos++;
    });
    t.epp+=eppPendientes(p);
    if(!p.bps.tiene) t.bps++;
  });
  return t;
}
function valoresDe(campo){
  var m={}; DB.personas.forEach(function(p){ if(p[campo]) m[p[campo]]=1; });
  return Object.keys(m).sort();
}
function totalArchivos(p){
  var n=(p.archivos||[]).length;
  DOCS.concat([{k:"bps"}]).forEach(function(d){ if(p[d.k]&&p[d.k].archivo) n++; });
  return n;
}
function urlArchivo(a){ return "/api/documentos/"+encodeURIComponent(a.id)+"/archivo"; }
function esImagen(a){ return a&&a.mime&&a.mime.indexOf("image/")===0; }
function esPdf(a){ return a&&a.mime==="application/pdf"; }
function extDe(a){ if(esPdf(a)) return "PDF"; var e=((a&&a.nombre)||"").split(".").pop(); return (e&&e.length<=4?e:"DOC").toUpperCase(); }
function fmtSize(b){
  b=parseInt(b,10);
  if(!b) return "—";
  if(b<1024) return b+" B";
  if(b<1048576) return Math.round(b/1024)+" KB";
  return (b/1048576).toFixed(1).replace(".",",")+" MB";
}

/* ---------------- carga ---------------- */
async function cargar(){
  var d=await api("datos");
  sesion=d.sesion;
  DB.personas=d.personas||[];
  DB.planillaUrl=d.planillaUrl||"";
  DB.carpetaUrl=d.carpetaUrl||"";
  ponerUsuario(sesion);
}

function ponerUsuario(s){
  sesion=s||sesion;
  document.getElementById("userNom").textContent=sesion?sesion.nombre:"—";
  document.getElementById("userIni").textContent=iniciales(sesion?sesion.nombre:"");
}

/* ---------------- navegación ---------------- */
var vista="personal",fichaId=null,tab="datos";
var filtro="",fEmpresa="",fServicio="",fFuncion="",fEstado="Activo";
function go(v){ vista=v; fichaId=null; render(); window.scrollTo(0,0); }
function abrir(id){ vista="ficha"; fichaId=id; tab="datos"; render(); window.scrollTo(0,0); }
function actual(){ for(var i=0;i<DB.personas.length;i++) if(DB.personas[i].id===fichaId) return DB.personas[i]; return null; }

/* ---------------- vistas ---------------- */
function head(t,s,extra){ return '<div class="page-head"><div><h1>'+esc(t)+'</h1><p>'+esc(s)+'</p></div>'+(extra||"")+'</div>'; }
function stat(k,v,s,c){
  return '<div class="stat"><span class="bar" style="background:'+c+'"></span><div class="k">'+esc(k)+'</div>'+
    '<div class="v" style="color:'+c+'">'+v+'</div><div class="s">'+esc(s)+'</div></div>';
}
function statsHTML(){
  var t=totales();
  return '<div class="stats">'+
    stat("Personal activo",t.activos,"de "+DB.personas.length+" legajos","var(--accent)")+
    stat("Vencidos",t.vencidos,"requieren acción hoy","var(--crit)")+
    stat("Por vencer (60 días)",t.proximos,"agendar renovación","var(--alert)")+
    stat("Altas BPS",t.bps,"pendientes de cargar","var(--warn)")+
    stat("EPP",t.epp,"entrega o reposición","var(--ok)")+
  '</div>';
}
function legend(){
  return '<div class="legend">'+
    '<span><i style="background:var(--crit)"></i> Vencido</span>'+
    '<span><i style="background:var(--alert)"></i> Vence en 30 días o menos</span>'+
    '<span><i style="background:var(--warn)"></i> Vence en 60 días o menos</span>'+
    '<span><i style="background:var(--ok)"></i> Vigente (mes/año de vencimiento)</span>'+
    '<span><i style="background:var(--muted)"></i> N/A no aplica · — sin dato</span>'+
  '</div>';
}
function sel(id,opts,val,ph){
  return '<select id="'+id+'"><option value="">'+esc(ph)+'</option>'+opts.map(function(o){
    return '<option value="'+esc(o)+'"'+(o===val?" selected":"")+'>'+esc(o)+'</option>'; }).join("")+'</select>';
}
function filtrados(){
  var q=filtro.trim().toLowerCase();
  return DB.personas.filter(function(p){
    if(fEmpresa&&p.empresa!==fEmpresa) return false;
    if(fServicio&&p.servicio!==fServicio) return false;
    if(fFuncion&&p.funcion!==fFuncion) return false;
    if(fEstado&&p.estado!==fEstado) return false;
    if(!q) return true;
    return (p.nombre+" "+p.documento+" "+p.categoria+" "+p.funcion+" "+p.servicio).toLowerCase().indexOf(q)>=0;
  }).sort(function(a,b){ return a.nombre.localeCompare(b.nombre,"es"); });
}

/* Primera vez: la planilla está vacía y hay que cargar la gente del Excel. */
function panelImportar(){
  return '<div class="card" style="margin-bottom:18px"><div class="card-body" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">'+
    '<div style="flex:1;min-width:260px">'+
      '<h3 style="font-family:var(--ui);font-size:15px;margin:0 0 4px">La planilla está vacía</h3>'+
      '<p style="margin:0;font-size:13.5px;color:var(--muted)">Cargá de una vez las 28 personas de <b>BD PERSONAL 2025</b>. '+
      'A cada una se le crea su carpeta en Drive. Tarda alrededor de un minuto.</p>'+
    '</div>'+
    '<button class="btn btn-primary" id="importar">Cargar las 28 personas</button>'+
  '</div></div>';
}
async function importarInicial(boton){
  boton.disabled=true; boton.textContent="Cargando…";
  try{
    var r=await fetch("/datos-iniciales.json",{credentials:"same-origin"});
    if(!r.ok) throw new Error("No se encontró el archivo con los datos iniciales.");
    var d=await r.json();
    var res=await api("importar",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(d)});
    await cargar(); render();
    toast(res.importadas+" fichas cargadas, cada una con su carpeta en Drive.");
  }catch(e){
    toast(e.message||"No se pudo importar.");
    boton.disabled=false; boton.textContent="Cargar las 28 personas";
  }
}

/* Todavía sin conectar con Google. */
function pantallaConfig(){
  document.getElementById("main").innerHTML=
    head("Conectar con Google","Falta un paso para que el sistema pueda escribir en la planilla y guardar los documentos.")+
    '<div class="card" style="max-width:640px"><div class="card-body">'+
      '<p style="margin-top:0;font-size:14.5px">Cuando toques el botón, Google te va a pedir que elijas la cuenta de la empresa y aceptes. '+
      'Va a avisar que la aplicación no está verificada: entrá en <b>Configuración avanzada → Ir a Legajo Pinos Grandis</b>.</p>'+
      '<p style="font-size:14.5px">Al volver vas a ver un texto largo. Copialo y pegalo en Render, en <b>Environment</b>, '+
      'como variable <b>GOOGLE_REFRESH_TOKEN</b>. El servicio se reinicia solo y ya queda andando.</p>'+
      '<div class="enlaces" style="margin-top:18px">'+
        '<a class="btn btn-primary" href="/api/oauth/inicio">Conectar con Google</a>'+
        '<button class="btn" id="reintentar">Ya lo cargué, reintentar</button>'+
      '</div>'+
    '</div></div>';
  var b=document.getElementById("reintentar");
  if(b) b.addEventListener("click",function(){ arrancar(); });
}

function vPersonal(){
  if(!DB.personas.length&&!filtro&&!fEmpresa&&!fServicio&&!fFuncion){
    return head("Personal","Legajo del personal. Cada ficha tiene su carpeta de documentos en Drive.")+panelImportar();
  }
  var rows=filtrados().map(function(p){
    var byK={}; docsDe(p).forEach(function(x){ byK[x.k]=x.e; });
    return '<tr class="clickable" data-open="'+p.id+'">'+
      '<td><div class="person"><span class="stripe" style="background:'+COLOR[peorDe(p)]+'"></span>'+
        '<div><b>'+esc(titulo(p.nombre))+'</b><small>'+esc(p.documento||"sin documento")+'</small></div></div></td>'+
      '<td>'+esc(p.servicio||"—")+'<br><span style="color:var(--muted);font-size:11.5px">'+esc(p.empresa)+'</span></td>'+
      '<td>'+esc(p.funcion||"—")+'<br><span style="color:var(--muted);font-size:11.5px">'+esc(p.categoria||"")+'</span></td>'+
      '<td>'+chipMini(byK.salud)+'</td><td>'+chipMini(byK.moto)+'</td>'+
      '<td>'+chipMini(byK.libH)+'</td><td>'+chipMini(byK.libA)+'</td><td>'+chipMini(byK.pa)+'</td>'+
      '<td>'+chipMini(estadoBps(p))+'</td>'+
      '<td>'+(eppPendientes(p)?'<span class="chip near"><span class="dot"></span>'+eppPendientes(p)+'</span>':'<span class="chip ok"><span class="dot"></span>Al día</span>')+'</td></tr>';
  }).join("");
  return head("Personal","Legajo del personal. Cada ficha tiene su carpeta de documentos en Drive.",
      '<button class="btn btn-primary" id="nuevo">+ Nueva ficha</button>')+
    statsHTML()+
    '<div class="toolbar">'+
      '<input type="text" id="q" placeholder="Buscar por nombre, documento, categoría…" value="'+esc(filtro)+'">'+
      sel("fEmpresa",valoresDe("empresa"),fEmpresa,"Todas las empresas")+
      sel("fServicio",valoresDe("servicio"),fServicio,"Todos los servicios")+
      sel("fFuncion",valoresDe("funcion"),fFuncion,"Todas las funciones")+
      sel("fEstado",["Activo","Baja"],fEstado,"Todos los estados")+
    '</div>'+
    '<div class="card"><div class="tablewrap"><table><thead><tr>'+
      '<th>Persona</th><th>Servicio</th><th>Función</th><th>C. salud</th><th>Motosierrista</th>'+
      '<th>Libreta H</th><th>Libreta A</th><th>1ros aux.</th><th>Alta BPS</th><th>EPP</th>'+
    '</tr></thead><tbody>'+(rows||'<tr><td colspan="10"><div class="empty">No hay fichas que coincidan con el filtro.</div></td></tr>')+
    '</tbody></table></div></div>'+legend();
}

function vVencimientos(){
  var items=[];
  DB.personas.forEach(function(p){
    if(p.estado!=="Activo") return;
    docsDe(p).forEach(function(x){ if(x.e.k!=="none"&&x.e.k!=="ok") items.push({p:p,n:x.n,e:x.e,f:x.o.vto}); });
  });
  items.sort(function(a,b){ return PESO[a.e.k]-PESO[b.e.k]||((dias(a.f)||0)-(dias(b.f)||0)); });
  var rows=items.map(function(i){
    return '<tr class="clickable" data-open="'+i.p.id+'">'+
      '<td><div class="person"><span class="stripe" style="background:'+COLOR[i.e.k]+'"></span>'+
        '<div><b>'+esc(titulo(i.p.nombre))+'</b><small>'+esc(i.p.documento)+'</small></div></div></td>'+
      '<td>'+esc(i.n)+'</td><td class="num">'+fmt(i.f)+'</td><td>'+chip(i.e)+'</td>'+
      '<td>'+esc(i.p.servicio||"—")+'</td><td>'+esc(i.p.funcion||"—")+'</td></tr>';
  }).join("");
  return head("Vencimientos","Todo lo vencido o por vencer en los próximos 60 días, ordenado por urgencia.")+
    statsHTML()+
    '<div class="card"><div class="tablewrap"><table><thead><tr><th>Persona</th><th>Documento</th><th>Vence</th><th>Estado</th><th>Servicio</th><th>Función</th></tr></thead><tbody>'+
    (rows||'<tr><td colspan="6"><div class="empty">Sin vencimientos próximos. Todo al día.</div></td></tr>')+
    '</tbody></table></div></div>'+legend();
}

function estadoEpp(x){
  if(!x.entregado) return {k:"near",txt:"Sin entregar",cls:"near"};
  if(x.repuesto) return {k:"ok",txt:"Repuesto",cls:"ok"};
  var d=dias(x.fechaReposicion);
  if(d===null) return {k:"ok",txt:"Entregado",cls:"ok"};
  if(d<0) return {k:"bad",txt:"Reposición vencida",cls:"bad"};
  if(d<=30) return {k:"near",txt:"Reponer en "+d+" d",cls:"near"};
  if(d<=60) return {k:"soon",txt:"Reponer en "+d+" d",cls:"soon"};
  return {k:"ok",txt:"Entregado",cls:"ok"};
}
function vEpp(){
  var rows=[];
  DB.personas.forEach(function(p){ (p.epp||[]).forEach(function(x){ rows.push({p:p,x:x,e:estadoEpp(x)}); }); });
  rows.sort(function(a,b){ return PESO[a.e.k]-PESO[b.e.k]; });
  var html=rows.map(function(r){
    return '<tr class="clickable" data-open="'+r.p.id+'">'+
      '<td><div class="person"><span class="stripe" style="background:'+COLOR[r.e.k]+'"></span>'+
        '<div><b>'+esc(titulo(r.p.nombre))+'</b><small>'+esc(r.p.documento)+'</small></div></div></td>'+
      '<td>'+esc(r.x.equipo)+(r.x.detalle?'<br><span style="color:var(--muted);font-size:11.5px">'+esc(r.x.detalle)+'</span>':'')+'</td>'+
      '<td class="num">'+fmt(r.x.fechaEntrega)+'</td>'+
      '<td>'+(r.x.entregado?'<span class="chip ok"><span class="dot"></span>Sí</span>':'<span class="chip none"><span class="dot"></span>No</span>')+'</td>'+
      '<td class="num">'+fmt(r.x.fechaReposicion)+'</td><td>'+chip(r.e)+'</td></tr>';
  }).join("");
  return head("Entregas de EPP","Equipo de protección personal entregado a cada trabajador, con su fecha de reposición.")+
    '<div class="card"><div class="tablewrap"><table><thead><tr><th>Persona</th><th>Equipo</th><th>Fecha de entrega</th><th>Entregado</th><th>Reposición</th><th>Estado</th></tr></thead><tbody>'+
    (html||'<tr><td colspan="6"><div class="empty">Todavía no se registraron entregas. Se cargan desde la pestaña EPP de cada ficha.</div></td></tr>')+
    '</tbody></table></div></div>'+legend();
}

function vDrive(){
  var rows=filtrados().map(function(p){
    return '<tr class="clickable" data-open="'+p.id+'">'+
      '<td><b>'+esc(titulo(p.nombre))+'</b></td>'+
      '<td class="path">'+esc(p.documento.replace(/[.\-]/g,"")+" — "+p.nombre)+'</td>'+
      '<td class="num">'+totalArchivos(p)+'</td>'+
      '<td>'+(p.carpetaUrl?'<a class="btn btn-sm" href="'+esc(p.carpetaUrl)+'" target="_blank" rel="noopener">Abrir en Drive</a>'
              :'<span class="chip none"><span class="dot"></span>Se crea al guardar</span>')+'</td></tr>';
  }).join("");
  return head("Drive","La planilla y las carpetas donde vive todo. Se pueden abrir y editar directamente en Google.")+
    '<div class="card" style="margin-bottom:16px"><div class="card-body">'+
      '<div class="drive"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>'+
      '<div><b>Pinos Grandis — Legajos</b><br><span class="path">Carpeta raíz con una subcarpeta por persona y la planilla BD PERSONAL</span></div>'+
      '<span class="enlaces" style="margin-left:auto">'+
        (DB.planillaUrl?'<a class="btn btn-sm" href="'+esc(DB.planillaUrl)+'" target="_blank" rel="noopener">Abrir la planilla</a>':'')+
        (DB.carpetaUrl?'<a class="btn btn-sm" href="'+esc(DB.carpetaUrl)+'" target="_blank" rel="noopener">Abrir la carpeta</a>':'')+
      '</span></div>'+
      '<p style="font-size:12.5px;color:var(--muted);margin:12px 0 0">Si editás la planilla a mano, refrescá esta página para ver los cambios. Las columnas se ubican por su nombre, así que se pueden reordenar; no cambies el texto del encabezado ni la columna ID.</p>'+
    '</div></div>'+
    '<div class="card"><div class="tablewrap"><table><thead><tr><th>Persona</th><th>Carpeta</th><th>Archivos</th><th></th></tr></thead><tbody>'+
    (rows||'<tr><td colspan="4"><div class="empty">Sin fichas cargadas.</div></td></tr>')+'</tbody></table></div></div>';
}

/* ----- ficha ----- */
function dt(k,v){ return '<dt>'+esc(k)+'</dt><dd>'+esc(v||"—")+'</dd>'; }
function card(t,body,extra){
  return '<div class="card"><div class="card-head"><h3>'+esc(t)+'</h3>'+(extra||"")+'</div><div class="card-body">'+body+'</div></div>';
}
function tabBtn(k,l){ return '<button class="tab'+(tab===k?" on":"")+'" data-tab="'+k+'">'+esc(l)+'</button>'; }
function barra(o){
  if(!o||o.na) return "";
  var d=dias(o.vto); if(d===null) return "";
  var e=estadoDoc(o), pct=Math.max(0,Math.min(100,Math.round((d/730)*100)));
  return '<div class="progress"><i style="width:'+(d<0?100:Math.max(4,pct))+'%;background:'+COLOR[e.k]+'"></i></div>';
}
function attHTML(a,key){
  var thumb=esImagen(a)?'<img src="'+urlArchivo(a)+'" alt="">':esc(extDe(a));
  return '<div class="att"><span class="thumb">'+thumb+'</span>'+
    '<span class="att-meta"><b>'+esc(a.nombre)+'</b><span>'+esc(fmtSize(a.tam))+' · '+fmt(a.fecha)+'</span></span>'+
    '<button class="btn btn-sm" data-ver="'+esc(a.id)+'">Ver</button>'+
    '<button class="btn btn-sm" data-quitar="'+esc(a.id)+'">Quitar</button></div>';
}
function dropHTML(key,texto){
  return '<div class="dropzone" data-drop="'+esc(key)+'" tabindex="0" role="button">'+
    '<b>+ Adjuntar '+esc(texto||"documento")+'</b><span>PDF o imagen · hasta 15 MB · arrastrá el archivo o hacé clic</span></div>';
}
function vFicha(){
  var p=actual(); if(!p) return head("Ficha no encontrada","");
  var d=docsDe(p);
  var h='<button class="back" id="volver">← Volver al personal</button>'+
   '<div class="ficha-head">'+
     '<span class="avatar-lg">'+esc(iniciales(p.nombre))+'</span>'+
     '<div style="flex:1;min-width:220px">'+
       '<h2>'+esc(titulo(p.nombre))+'</h2>'+
       '<div class="meta">'+
         '<span class="chip flat">C.I. '+esc(p.documento||"—")+'</span>'+
         '<span class="chip flat">'+esc(p.funcion||"Sin función")+'</span>'+
         '<span class="chip flat">'+esc(p.categoria||"Sin categoría")+'</span>'+
         '<span class="chip flat">'+esc(p.servicio||"Sin servicio")+'</span>'+
         '<span class="chip '+(p.estado==="Activo"?"ok":"none")+'"><span class="dot"></span>'+esc(p.estado)+'</span>'+
       '</div></div>'+
     '<div class="enlaces">'+
       (p.carpetaUrl?'<a class="btn" href="'+esc(p.carpetaUrl)+'" target="_blank" rel="noopener">Carpeta en Drive</a>':'')+
       '<button class="btn" id="editar">Editar ficha</button></div></div>'+
   '<div class="tabs">'+tabBtn("datos","Datos")+tabBtn("docs","Documentación")+tabBtn("epp","EPP")+tabBtn("archivos","Archivos ("+totalArchivos(p)+")")+'</div>';

  if(tab==="datos"){
    var edad=anios(p.fechaNac), ant=anios(p.ingreso);
    h+='<div class="grid2">'+
      card("Datos personales",'<dl class="dl">'+dt("Nombre",titulo(p.nombre))+dt("Documento",p.documento)+
        dt("Fecha de nacimiento",fmt(p.fechaNac)+(edad!==null?" · "+edad+" años":""))+'</dl>')+
      card("Datos laborales",'<dl class="dl">'+dt("Empresa",p.empresa)+dt("Servicio",p.servicio)+
        dt("Ingreso",fmt(p.ingreso)+(ant!==null?" · "+ant+" años":""))+dt("Categoría",p.categoria)+
        dt("Función",p.funcion)+dt("Estado",p.estado)+'</dl>')+
    '</div><div style="height:14px"></div>'+
    card("Resumen de documentación",'<div class="grid2">'+
      d.map(function(x){
        return '<div class="doc"><div class="doc-top"><h4>'+esc(x.n)+'</h4>'+chip(x.e)+'</div>'+
          '<div class="num" style="color:var(--muted)">'+(x.o.na?"No aplica a esta función":"Vence el "+fmt(x.o.vto))+'</div>'+
          '<div style="margin-top:9px"><span class="tag">'+(x.o.archivo?"con archivo adjunto":"sin archivo")+'</span></div></div>';
      }).join("")+
      '<div class="doc"><div class="doc-top"><h4>Constancia de alta en BPS</h4>'+chip(estadoBps(p))+'</div>'+
      '<div class="num" style="color:var(--muted)">'+(p.bps.tiene?"Alta del "+fmt(p.bps.fecha):"Sin cargar")+'</div>'+
      '<div style="margin-top:9px"><span class="tag">'+(p.bps.archivo?"con archivo adjunto":"sin archivo")+'</span></div></div>'+
    '</div>');
  }

  if(tab==="docs"){
    var bloques=d.map(function(x){
      var cuerpo=x.o.na?'<div class="empty">No aplica a esta función.</div>'
        :'<dl class="dl">'+dt("Vence",fmt(x.o.vto))+(x.k==="pa"?dt("Dictado por",x.o.emisor):"")+'</dl>'+barra(x.o);
      return card(x.n,cuerpo+(x.o.archivo?attHTML(x.o.archivo,x.k):dropHTML(x.k,"documento escaneado")),chip(x.e));
    }).join("");
    bloques+=card("Constancia de alta en BPS",
      (p.bps.tiene?'<dl class="dl">'+dt("Número",p.bps.numero)+dt("Fecha de alta",fmt(p.bps.fecha))+'</dl>'
       :'<div class="empty">Constancia pendiente de cargar.</div>')+
      (p.bps.archivo?attHTML(p.bps.archivo,"bps"):dropHTML("bps","constancia")),chip(estadoBps(p)));
    h+='<div class="grid2">'+bloques+'</div>'+
      '<p style="font-size:12.5px;color:var(--muted);margin:14px 0 0">Cada archivo que adjuntes acá se sube a la carpeta de la persona en Drive.</p>';
  }

  if(tab==="epp"){
    var filas=(p.epp||[]).map(function(x){
      var e=estadoEpp(x);
      return '<tr><td><span class="stripe" style="background:'+COLOR[e.k]+'"></span>'+esc(x.equipo)+
        (x.detalle?'<br><span style="color:var(--muted);font-size:11.5px">'+esc(x.detalle)+'</span>':'')+'</td>'+
        '<td><label class="check" style="padding:0"><input type="checkbox" data-epp="'+x.id+'" data-f="entregado"'+(x.entregado?" checked":"")+'> Entregado</label></td>'+
        '<td class="num">'+fmt(x.fechaEntrega)+'</td><td class="num">'+fmt(x.fechaReposicion)+'</td>'+
        '<td><label class="check" style="padding:0"><input type="checkbox" data-epp="'+x.id+'" data-f="repuesto"'+(x.repuesto?" checked":"")+'> Repuesto</label></td>'+
        '<td>'+chip(e)+'</td><td><button class="btn btn-sm" data-delepp="'+x.id+'">Quitar</button></td></tr>';
    }).join("");
    h+=card("Entregas registradas",
      '<div class="tablewrap"><table><thead><tr><th>Equipo</th><th>Entrega</th><th>Fecha de entrega</th><th>Reposición prevista</th><th>Reposición</th><th>Estado</th><th></th></tr></thead><tbody>'+
      (filas||'<tr><td colspan="7"><div class="empty">Sin entregas registradas.</div></td></tr>')+'</tbody></table></div>',
      '<button class="btn btn-primary btn-sm" id="addEpp">+ Registrar entrega</button>');
  }

  if(tab==="archivos"){
    function fila(f,tipo,fijo){
      var icono=esImagen(f)?'<img src="'+urlArchivo(f)+'" alt="" style="width:100%;height:100%;object-fit:cover">':esc(extDe(f));
      return '<div class="filerow"><span class="fileicon" style="overflow:hidden">'+icono+'</span>'+
        '<div style="flex:1;min-width:0"><div style="font-weight:500;font-size:13.5px;word-break:break-all">'+esc(f.nombre)+'</div>'+
        '<div style="font-size:11.5px;color:var(--muted)">'+esc(tipo)+' · '+fmt(f.fecha)+' · '+esc(fmtSize(f.tam))+'</div></div>'+
        (fijo?'<span class="tag">desde documentación</span>':'')+
        '<button class="btn btn-sm" data-ver="'+esc(f.id)+'">Ver</button>'+
        '<button class="btn btn-sm" data-quitar="'+esc(f.id)+'">Quitar</button></div>';
    }
    var files="";
    DOCS.concat([{k:"bps",n:"Constancia de alta BPS"}]).forEach(function(dd){
      var a=p[dd.k]&&p[dd.k].archivo;
      if(a) files+=fila(a,dd.n||TITULOS[dd.k],true);
    });
    files+=(p.archivos||[]).map(function(f){ return fila(f,f.tipoEtiqueta||"Otros",false); }).join("");
    h+='<div class="card" style="margin-bottom:14px"><div class="card-body">'+
        '<div class="drive"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>'+
        '<div><b>Carpeta de la persona</b><br><span class="path">'+esc(p.documento.replace(/[.\-]/g,"")+" — "+p.nombre)+'</span></div>'+
        (p.carpetaUrl?'<a class="btn btn-sm" style="margin-left:auto" href="'+esc(p.carpetaUrl)+'" target="_blank" rel="noopener">Abrir en Drive</a>':'')+
        '</div></div></div>'+
      card("Documentos anexos",(files||'<div class="empty">Todavía no hay documentos en la carpeta.</div>'),
        '<button class="btn btn-primary btn-sm" id="addFile">+ Anexar documento</button>');
  }
  return h;
}

function render(){
  document.querySelectorAll(".nav a").forEach(function(a){ a.classList.toggle("on",a.dataset.view===vista); });
  var t=totales();
  document.getElementById("cPersonal").textContent=DB.personas.length;
  document.getElementById("cVenc").textContent=(t.vencidos+t.proximos)||"";
  document.getElementById("cEpp").textContent=t.epp||"";
  var m=document.getElementById("main");
  if(vista==="personal") m.innerHTML=vPersonal();
  else if(vista==="vencimientos") m.innerHTML=vVencimientos();
  else if(vista==="epp") m.innerHTML=vEpp();
  else if(vista==="drive") m.innerHTML=vDrive();
  else m.innerHTML=vFicha();
  wire();
}

/* ---------------- modales ---------------- */
var ov=document.getElementById("overlay");
function cerrar(){ ov.classList.remove("on"); ov.innerHTML=""; }
ov.addEventListener("click",function(ev){ if(ev.target===ov) cerrar(); });
document.addEventListener("keydown",function(ev){ if(ev.key==="Escape") cerrar(); });
function modal(tit,body,okTxt,onOk){
  ov.innerHTML='<div class="modal" role="dialog" aria-modal="true">'+
    '<div class="modal-head"><h3>'+esc(tit)+'</h3><button class="btn btn-sm" data-x>Cerrar</button></div>'+
    '<div class="modal-body">'+body+'</div>'+
    '<div class="modal-foot"><button class="btn" data-x>Cancelar</button><button class="btn btn-primary" data-ok>'+esc(okTxt)+'</button></div></div>';
  ov.classList.add("on");
  ov.querySelectorAll("[data-x]").forEach(function(b){ b.addEventListener("click",cerrar); });
  var ok=ov.querySelector("[data-ok]");
  ok.addEventListener("click",async function(){
    ok.disabled=true;
    try{ if((await onOk())!==false) cerrar(); }
    catch(e){ toast(e.message||"No se pudo guardar."); }
    finally{ ok.disabled=false; }
  });
}
function inp(id,label,val,type,ph){
  return '<div class="field"><label for="'+id+'">'+esc(label)+'</label><input id="'+id+'" type="'+(type||"text")+'" value="'+esc(val||"")+'" placeholder="'+esc(ph||"")+'"></div>';
}
function selF(id,label,opts,val){
  var extra=(val&&opts.indexOf(val)<0)?[val]:[];
  return '<div class="field"><label for="'+id+'">'+esc(label)+'</label><select id="'+id+'"><option value="">—</option>'+
    opts.concat(extra).map(function(o){return '<option'+(o===val?" selected":"")+'>'+esc(o)+'</option>';}).join("")+'</select></div>';
}
function chk(id,label,on){ return '<label class="check"><input type="checkbox" id="'+id+'"'+(on?" checked":"")+'> '+esc(label)+'</label>'; }
function v(id){ var e=document.getElementById(id); return e?e.value.trim():""; }
function c(id){ var e=document.getElementById(id); return e?e.checked:false; }

function formPersona(p){
  var h='<div class="section-title">Datos personales</div>'+
    '<div class="full">'+inp("f_nombre","Nombre completo",p.nombre,"text","APELLIDOS Y NOMBRES")+'</div>'+
    inp("f_doc","Documento",p.documento,"text","1.234.567-8")+
    inp("f_nac","Fecha de nacimiento",p.fechaNac,"date")+
  '<div class="section-title">Datos laborales</div>'+
    selF("f_empresa","Empresa",valoresDe("empresa").concat(["Pinos Grandis","Vandes"]).filter(function(x,i,a){return a.indexOf(x)===i;}),p.empresa)+
    selF("f_servicio","Servicio (cliente)",valoresDe("servicio"),p.servicio)+
    selF("f_categoria","Categoría",CATEGORIAS,p.categoria)+
    selF("f_funcion","Función",FUNCIONES,p.funcion)+
    inp("f_ingreso","Fecha de ingreso",p.ingreso,"date")+
    selF("f_estado","Estado",["Activo","Baja"],p.estado);
  DOCS.forEach(function(dd){
    var o=p[dd.k]||{};
    h+='<div class="section-title">'+esc(dd.n)+'</div>'+
      inp("f_"+dd.k,"Vencimiento",o.vto,"date")+
      chk("f_"+dd.k+"_na","No aplica a esta persona",o.na);
    if(dd.k==="pa") h+='<div class="full">'+inp("f_pa_em","Dictado por",o.emisor)+'</div>';
  });
  h+='<div class="section-title">Constancia de alta en BPS</div>'+
    chk("f_bps","Constancia presentada",p.bps.tiene)+
    inp("f_bps_num","Número de constancia",p.bps.numero)+
    inp("f_bps_fecha","Fecha de alta",p.bps.fecha,"date");
  return h;
}
function leerForm(){
  var p={
    nombre:v("f_nombre"),documento:v("f_doc"),fechaNac:v("f_nac"),
    empresa:v("f_empresa")||"Pinos Grandis",servicio:v("f_servicio"),
    categoria:v("f_categoria"),funcion:v("f_funcion"),
    ingreso:v("f_ingreso"),estado:v("f_estado")||"Activo",
    bps:{tiene:c("f_bps"),numero:v("f_bps_num"),fecha:v("f_bps_fecha")}
  };
  DOCS.forEach(function(dd){
    p[dd.k]={vto:v("f_"+dd.k),na:c("f_"+dd.k+"_na")};
    if(dd.k==="pa") p.pa.emisor=v("f_pa_em");
  });
  return p;
}
function abrirNuevo(){
  modal("Nueva ficha de personal",formPersona(nuevaPersona()),"Crear ficha y carpeta",async function(){
    var p=leerForm();
    if(!p.nombre){ toast("Falta el nombre de la persona."); return false; }
    var r=await api("personas",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(p)});
    await cargar();
    toast("Ficha creada y carpeta abierta en Drive.");
    abrir(r.id);
    return true;
  });
}
function abrirEditar(){
  var p=actual(); if(!p) return;
  modal("Editar ficha — "+titulo(p.nombre),formPersona(p),"Guardar cambios",async function(){
    var d=leerForm();
    if(!d.nombre){ toast("Falta el nombre de la persona."); return false; }
    await api("personas/"+encodeURIComponent(p.id),{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(d)});
    await cargar(); render();
    toast("Ficha actualizada en la planilla.");
    return true;
  });
}
function abrirEpp(){
  var p=actual(); if(!p) return;
  var body='<div class="field full"><label for="e_eq">Equipo entregado</label><select id="e_eq">'+
      EPP_TIPOS.map(function(o){return '<option>'+esc(o)+'</option>';}).join("")+'<option>Otro</option></select></div>'+
    '<div class="field full"><label for="e_det">Detalle <span class="hint">talle, marca, observaciones</span></label><input id="e_det" type="text" placeholder="Talle 42 · clase 1"></div>'+
    inp("e_fecha","Fecha de entrega",hoyISO(),"date")+
    inp("e_rep","Fecha de reposición prevista",addDays(365),"date")+
    chk("e_check","Entregado y firmado por el trabajador",true);
  modal("Registrar entrega de EPP",body,"Registrar",async function(){
    await api("personas/"+encodeURIComponent(p.id)+"/epp",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({equipo:v("e_eq"),detalle:v("e_det"),fechaEntrega:v("e_fecha"),
        entregado:c("e_check"),fechaReposicion:v("e_rep"),repuesto:false})});
    await cargar(); render(); toast("Entrega registrada.");
    return true;
  });
}
function abrirFile(){
  var p=actual(); if(!p) return;
  var pend=null;
  var body=selF("a_tipo","Tipo de documento",["Documento de identidad","Contrato","Constancia BPS","Certificado de capacitación","Entrega de EPP","Recibo de sueldo","Otros"],"Otros")+
    inp("a_fecha","Fecha del documento",hoyISO(),"date")+
    '<div class="full" id="a_zona">'+dropHTML("nuevo","archivo PDF o imagen")+'</div>';
  modal("Anexar documento",body,"Subir a Drive",async function(){
    if(!pend){ toast("Elegí el archivo a anexar."); return false; }
    await subir(p.id,"otros",v("a_tipo")||"Otros",v("a_fecha"),pend);
    return true;
  });
  var zona=document.getElementById("a_zona");
  function mostrar(){
    zona.innerHTML='<div class="att"><span class="thumb">'+esc((pend.name.split(".").pop()||"DOC").toUpperCase().slice(0,4))+'</span>'+
      '<span class="att-meta"><b>'+esc(pend.name)+'</b><span>'+esc(fmtSize(pend.size))+'</span></span>'+
      '<button class="btn btn-sm" type="button" id="a_otro">Cambiar</button></div>';
    document.getElementById("a_otro").addEventListener("click",function(){ elegir(function(f){ pend=f; mostrar(); }); });
  }
  wireDrop(zona,function(f){ pend=f; mostrar(); });
}

/* ---------------- archivos ---------------- */
function valido(f){
  if(f.size>15*1048576){ toast("El archivo supera los 15 MB."); return false; }
  if(!/^image\//.test(f.type)&&f.type!=="application/pdf"){ toast("Solo se aceptan archivos PDF o imagen."); return false; }
  return true;
}
function elegir(cb){
  var i=document.createElement("input");
  i.type="file"; i.accept="application/pdf,image/*";
  i.addEventListener("change",function(){ if(i.files&&i.files[0]&&valido(i.files[0])) cb(i.files[0]); });
  i.click();
}
function wireDrop(cont,cb){
  var z=(cont&&cont.classList&&cont.classList.contains("dropzone"))?cont:(cont&&cont.querySelector?cont.querySelector(".dropzone"):null);
  if(!z) return;
  z.addEventListener("click",function(){ elegir(cb); });
  z.addEventListener("keydown",function(ev){ if(ev.key==="Enter"||ev.key===" "){ ev.preventDefault(); elegir(cb); } });
  z.addEventListener("dragover",function(ev){ ev.preventDefault(); z.classList.add("over"); });
  z.addEventListener("dragleave",function(){ z.classList.remove("over"); });
  z.addEventListener("drop",function(ev){
    ev.preventDefault(); z.classList.remove("over");
    var f=ev.dataTransfer&&ev.dataTransfer.files&&ev.dataTransfer.files[0];
    if(f&&valido(f)) cb(f);
  });
}
async function subir(personaId,tipo,etiqueta,fecha,archivo){
  var fd=new FormData();
  fd.append("tipo",tipo); fd.append("etiqueta",etiqueta||""); fd.append("fecha",fecha||hoyISO());
  fd.append("archivo",archivo);
  await api("personas/"+encodeURIComponent(personaId)+"/documentos",{method:"POST",body:fd});
  await cargar(); render();
  toast("Documento subido a la carpeta en Drive.");
}
function buscarDoc(p,id){
  var todos=[];
  DOCS.concat([{k:"bps"}]).forEach(function(d){ if(p[d.k]&&p[d.k].archivo) todos.push({a:p[d.k].archivo,t:TITULOS[d.k]}); });
  (p.archivos||[]).forEach(function(f){ todos.push({a:f,t:f.tipoEtiqueta||"Documento"}); });
  return todos.find(function(x){ return x.a.id===id; })||null;
}
function verArchivo(a,tit){
  var cuerpo=esPdf(a)
    ? '<iframe src="'+urlArchivo(a)+'" title="'+esc(a.nombre)+'"></iframe>'
    : '<img src="'+urlArchivo(a)+'" alt="'+esc(a.nombre)+'">';
  ov.innerHTML='<div class="modal wide" role="dialog" aria-modal="true">'+
    '<div class="modal-head"><h3>'+esc(tit)+'</h3><button class="btn btn-sm" data-x>Cerrar</button></div>'+
    '<div class="modal-body"><div class="viewer">'+cuerpo+'</div></div>'+
    '<div class="modal-foot"><span class="path" style="margin-right:auto">'+esc(a.nombre)+' · '+esc(fmtSize(a.tam))+'</span>'+
    (a.enlace?'<a class="btn" href="'+esc(a.enlace)+'" target="_blank" rel="noopener">Abrir en Drive</a>':'')+
    '<button class="btn" data-x>Cerrar</button></div></div>';
  ov.classList.add("on");
  ov.querySelectorAll("[data-x]").forEach(function(b){ b.addEventListener("click",cerrar); });
}

/* ---------------- eventos ---------------- */
function wire(){
  var m=document.getElementById("main");
  m.querySelectorAll("[data-open]").forEach(function(tr){
    tr.addEventListener("click",function(ev){ if(ev.target.closest("button,input,label,a")) return; abrir(tr.dataset.open); });
  });
  m.querySelectorAll("[data-tab]").forEach(function(b){ b.addEventListener("click",function(){ tab=b.dataset.tab; render(); }); });
  var q=document.getElementById("q");
  if(q) q.addEventListener("input",function(){
    filtro=q.value; var pos=q.selectionStart; render();
    var n=document.getElementById("q"); if(n){ n.focus(); n.setSelectionRange(pos,pos); }
  });
  [["fEmpresa",function(x){fEmpresa=x;}],["fServicio",function(x){fServicio=x;}],
   ["fFuncion",function(x){fFuncion=x;}],["fEstado",function(x){fEstado=x;}]].forEach(function(par){
    var el=document.getElementById(par[0]);
    if(el) el.addEventListener("change",function(){ par[1](el.value); render(); });
  });
  var nb=document.getElementById("nuevo"); if(nb) nb.addEventListener("click",abrirNuevo);
  var ib=document.getElementById("importar"); if(ib) ib.addEventListener("click",function(){ importarInicial(ib); });
  var ed=document.getElementById("editar"); if(ed) ed.addEventListener("click",abrirEditar);
  var vb=document.getElementById("volver"); if(vb) vb.addEventListener("click",function(){ go("personal"); });
  var ae=document.getElementById("addEpp"); if(ae) ae.addEventListener("click",abrirEpp);
  var af=document.getElementById("addFile"); if(af) af.addEventListener("click",abrirFile);

  m.querySelectorAll("[data-drop]").forEach(function(z){
    (function(tipo){
      wireDrop(z,async function(f){
        var p=actual(); if(!p) return;
        try{ await subir(p.id,tipo,TITULOS[tipo]||"",hoyISO(),f); }
        catch(e){ toast(e.message||"No se pudo subir el archivo."); }
      });
    })(z.dataset.drop);
  });
  m.querySelectorAll("[data-ver]").forEach(function(b){
    b.addEventListener("click",function(ev){
      ev.stopPropagation();
      var p=actual(); if(!p) return;
      var x=buscarDoc(p,b.dataset.ver); if(!x) return;
      verArchivo(x.a,x.t);
    });
  });
  m.querySelectorAll("[data-quitar]").forEach(function(b){
    b.addEventListener("click",function(ev){
      ev.stopPropagation();
      var p=actual(); if(!p) return;
      var x=buscarDoc(p,b.dataset.quitar); if(!x) return;
      modal("Quitar documento",'<div class="full" style="font-size:13.5px;line-height:1.6">Se va a borrar <b>'+esc(x.a.nombre)+
        '</b> de la carpeta de '+esc(titulo(p.nombre))+' en Drive. No se puede deshacer.</div>',"Borrar de Drive",async function(){
        await api("documentos/"+encodeURIComponent(x.a.id),{method:"DELETE"});
        await cargar(); render(); toast("Documento borrado.");
        return true;
      });
    });
  });
  m.querySelectorAll("[data-epp]").forEach(function(cb){
    cb.addEventListener("change",async function(){
      var p=actual(); if(!p) return;
      var cambio={}; cambio[cb.dataset.f]=cb.checked;
      try{
        await api("epp/"+encodeURIComponent(cb.dataset.epp),{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(cambio)});
        await cargar(); render();
      }catch(e){ toast(e.message); cb.checked=!cb.checked; }
    });
  });
  m.querySelectorAll("[data-delepp]").forEach(function(b){
    b.addEventListener("click",async function(){
      try{
        await api("epp/"+encodeURIComponent(b.dataset.delepp),{method:"DELETE"});
        await cargar(); render(); toast("Entrega eliminada.");
      }catch(e){ toast(e.message); }
    });
  });
}

document.querySelectorAll(".nav a").forEach(function(a){ a.addEventListener("click",function(){ go(a.dataset.view); }); });

/* ---------------- sesión ---------------- */
function mostrarApp(){
  document.getElementById("login").style.display="none";
  document.getElementById("app").style.display="block";
}
function mostrarLogin(){
  document.getElementById("app").style.display="none";
  document.getElementById("login").style.display="grid";
}
async function salir(silencioso){
  try{ await fetch("/api/logout",{method:"POST",credentials:"same-origin"}); }catch(e){}
  DB={personas:[],planillaUrl:"",carpetaUrl:""};
  mostrarLogin();
  if(!silencioso) document.getElementById("loginErr").textContent="";
}
document.getElementById("logout").addEventListener("click",function(){ salir(); });

document.getElementById("loginForm").addEventListener("submit",async function(ev){
  ev.preventDefault();
  var btn=document.getElementById("btnEntrar"), err=document.getElementById("loginErr");
  btn.disabled=true; err.textContent="";
  try{
    var r=await api("login",{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({usuario:document.getElementById("u").value,clave:document.getElementById("p").value})});
    ponerUsuario(r.sesion);
    mostrarApp();
    await arrancar();
  }catch(e){ err.textContent=e.message||"No se pudo entrar."; }
  finally{ btn.disabled=false; }
});

async function arrancar(){
  document.getElementById("main").innerHTML='<div class="cargando"><span class="spin"></span> Leyendo la planilla…</div>';
  try{
    await cargar(); render();
  }catch(e){
    if(e.codigo==="SIN_GOOGLE"){ pantallaConfig(); return; }
    document.getElementById("main").innerHTML=
      '<div class="banner"><div><b>No se pudo leer la planilla.</b><br>'+esc(e.message||"")+'</div></div>'+
      '<button class="btn" id="reintentar">Reintentar</button>';
    var b=document.getElementById("reintentar");
    if(b) b.addEventListener("click",function(){ arrancar(); });
  }
}

(async function inicio(){
  try{
    var s0=await api("sesion");
    ponerUsuario(s0.sesion);
    mostrarApp();
    await arrancar();
  }catch(e){ mostrarLogin(); }
})();

})();
