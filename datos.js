/*
 * Modelo de datos sobre la planilla de Google Sheets.
 * La planilla es la base: se puede abrir y editar a mano en Drive y la web
 * refleja el cambio. Las columnas se ubican por su nombre, así que se pueden
 * reordenar sin romper nada; lo único que no hay que cambiar es el texto del
 * encabezado ni la columna ID.
 */

import * as G from "./google.js";

export const CARPETA_RAIZ = "Pinos Grandis — Legajos";
export const NOMBRE_PLANILLA = "BD PERSONAL";

export const HOJAS = {
  personal: "Personal",
  documentos: "Documentos",
  epp: "EPP",
};

export const COLUMNAS = {
  Personal: [
    "ID", "Empresa", "Servicio", "Nombre", "Documento", "F. Nacimiento", "Ingreso",
    "Categoría", "Función", "Estado",
    "C. Salud", "C. Salud N/A",
    "C. Motosierrista", "C. Motosierrista N/A",
    "Libreta H", "Libreta H N/A",
    "Libreta A", "Libreta A N/A",
    "Primeros Auxilios", "Primeros Auxilios N/A", "Dictado por",
    "Alta BPS", "Nº BPS", "Fecha alta BPS",
    "Carpeta Drive", "Enlace carpeta", "Actualizado",
  ],
  Documentos: [
    "ID", "PersonaID", "Tipo", "Etiqueta", "Archivo", "Fecha",
    "Drive ID", "Enlace", "MIME", "Tamaño",
  ],
  EPP: [
    "ID", "PersonaID", "Equipo", "Detalle", "Fecha entrega", "Entregado",
    "Fecha reposición", "Repuesto",
  ],
};

/* --------------------------- utilidades --------------------------- */

export function nuevoId(prefijo) {
  return prefijo + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* Acepta 2026-08-29, 29/08/2026 y 29-08-2026. Devuelve ISO o "". */
export function aISO(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + "-" + p2(m[2]) + "-" + p2(m[3]);
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return m[3] + "-" + p2(m[2]) + "-" + p2(m[1]);
  return "";
}
function p2(n) { return ("0" + n).slice(-2); }

function esSi(v) {
  const s = String(v == null ? "" : v).trim().toUpperCase();
  return s === "SI" || s === "SÍ" || s === "TRUE" || s === "VERDADERO" || s === "X" || s === "1";
}
function esNA(v) {
  const s = String(v == null ? "" : v).trim().toUpperCase();
  return s === "N/A" || s === "NA" || s === "NO APLICA" || esSi(v);
}
const SI = "SI", NO = "";

/* ------------------- ubicación de carpeta y planilla ------------------- */

let cacheDestino = null;

export async function destino(env) {
  if (cacheDestino) return cacheDestino;

  let carpeta = (await G.buscar(
    env,
    "mimeType='" + G.MIME.CARPETA + "' and name='" + CARPETA_RAIZ + "' and trashed=false"
  ))[0];
  if (!carpeta) carpeta = await G.crearCarpeta(env, CARPETA_RAIZ, null);

  let planilla = (await G.buscar(
    env,
    "mimeType='" + G.MIME.PLANILLA + "' and name='" + NOMBRE_PLANILLA +
    "' and '" + carpeta.id + "' in parents and trashed=false"
  ))[0];
  if (!planilla) {
    planilla = await G.crearPlanilla(env, NOMBRE_PLANILLA, carpeta.id, [
      { titulo: HOJAS.personal, encabezados: COLUMNAS.Personal },
      { titulo: HOJAS.documentos, encabezados: COLUMNAS.Documentos },
      { titulo: HOJAS.epp, encabezados: COLUMNAS.EPP },
    ]);
  }

  cacheDestino = {
    carpetaId: carpeta.id,
    carpetaUrl: carpeta.webViewLink || ("https://drive.google.com/drive/folders/" + carpeta.id),
    planillaId: planilla.id,
    planillaUrl: planilla.webViewLink || ("https://docs.google.com/spreadsheets/d/" + planilla.id),
  };
  return cacheDestino;
}

/* --------------------------- lectura --------------------------- */

async function leerHoja(env, planillaId, hoja, columnas) {
  const filas = await G.leerRango(env, planillaId, hoja + "!A1:AZ10000");
  if (!filas.length) return { encabezados: columnas.slice(), datos: [] };
  const encabezados = filas[0].map((h) => String(h || "").trim());
  const idx = {};
  encabezados.forEach((h, i) => { idx[h] = i; });
  const datos = [];
  for (let n = 1; n < filas.length; n++) {
    const f = filas[n];
    if (!f || !f.some((c) => String(c || "").trim())) continue;
    const o = { _fila: n + 1 };
    columnas.forEach((c) => { o[c] = idx[c] === undefined ? "" : (f[idx[c]] == null ? "" : String(f[idx[c]])); });
    datos.push(o);
  }
  return { encabezados, idx, datos };
}

function aPersona(f, documentos, epp) {
  const id = f["ID"];
  const doc = (tipo) => documentos.find((d) => d.personaId === id && d.tipo === tipo) || null;
  return {
    id,
    empresa: f["Empresa"] || "",
    servicio: f["Servicio"] || "",
    nombre: f["Nombre"] || "",
    documento: f["Documento"] || "",
    fechaNac: aISO(f["F. Nacimiento"]),
    ingreso: aISO(f["Ingreso"]),
    categoria: f["Categoría"] || "",
    funcion: f["Función"] || "",
    estado: f["Estado"] || "Activo",
    salud: { vto: aISO(f["C. Salud"]), na: esNA(f["C. Salud N/A"]), archivo: doc("salud") },
    moto: { vto: aISO(f["C. Motosierrista"]), na: esNA(f["C. Motosierrista N/A"]), archivo: doc("moto") },
    libH: { vto: aISO(f["Libreta H"]), na: esNA(f["Libreta H N/A"]), archivo: doc("libH") },
    libA: { vto: aISO(f["Libreta A"]), na: esNA(f["Libreta A N/A"]), archivo: doc("libA") },
    pa: {
      vto: aISO(f["Primeros Auxilios"]), na: esNA(f["Primeros Auxilios N/A"]),
      emisor: f["Dictado por"] || "", archivo: doc("pa"),
    },
    bps: {
      tiene: esSi(f["Alta BPS"]), numero: f["Nº BPS"] || "",
      fecha: aISO(f["Fecha alta BPS"]), archivo: doc("bps"),
    },
    carpetaId: f["Carpeta Drive"] || "",
    carpetaUrl: f["Enlace carpeta"] || "",
    archivos: documentos.filter((d) => d.personaId === id && d.tipo === "otros"),
    epp: epp.filter((e) => e.personaId === id),
    _fila: f._fila,
  };
}

function aDocumento(f) {
  return {
    id: f["ID"], personaId: f["PersonaID"], tipo: f["Tipo"] || "otros",
    tipoEtiqueta: f["Etiqueta"] || "", nombre: f["Archivo"] || "",
    fecha: aISO(f["Fecha"]), driveId: f["Drive ID"] || "", enlace: f["Enlace"] || "",
    mime: f["MIME"] || "", tam: f["Tamaño"] || "", _fila: f._fila,
  };
}
function aEpp(f) {
  return {
    id: f["ID"], personaId: f["PersonaID"], equipo: f["Equipo"] || "", detalle: f["Detalle"] || "",
    fechaEntrega: aISO(f["Fecha entrega"]), entregado: esSi(f["Entregado"]),
    fechaReposicion: aISO(f["Fecha reposición"]), repuesto: esSi(f["Repuesto"]), _fila: f._fila,
  };
}

export async function leerTodo(env) {
  const d = await destino(env);
  const [per, doc, epp] = await Promise.all([
    leerHoja(env, d.planillaId, HOJAS.personal, COLUMNAS.Personal),
    leerHoja(env, d.planillaId, HOJAS.documentos, COLUMNAS.Documentos),
    leerHoja(env, d.planillaId, HOJAS.epp, COLUMNAS.EPP),
  ]);
  const documentos = doc.datos.map(aDocumento);
  const equipos = epp.datos.map(aEpp);
  return {
    destino: d,
    personas: per.datos.map((f) => aPersona(f, documentos, equipos)),
    _hojas: { personal: per, documentos: doc, epp: epp },
  };
}

/* --------------------------- escritura --------------------------- */

function filaDePersona(p, encabezados) {
  const v = {
    "ID": p.id,
    "Empresa": p.empresa || "",
    "Servicio": p.servicio || "",
    "Nombre": p.nombre || "",
    "Documento": p.documento || "",
    "F. Nacimiento": p.fechaNac || "",
    "Ingreso": p.ingreso || "",
    "Categoría": p.categoria || "",
    "Función": p.funcion || "",
    "Estado": p.estado || "Activo",
    "C. Salud": p.salud.vto || "",
    "C. Salud N/A": p.salud.na ? "N/A" : NO,
    "C. Motosierrista": p.moto.vto || "",
    "C. Motosierrista N/A": p.moto.na ? "N/A" : NO,
    "Libreta H": p.libH.vto || "",
    "Libreta H N/A": p.libH.na ? "N/A" : NO,
    "Libreta A": p.libA.vto || "",
    "Libreta A N/A": p.libA.na ? "N/A" : NO,
    "Primeros Auxilios": p.pa.vto || "",
    "Primeros Auxilios N/A": p.pa.na ? "N/A" : NO,
    "Dictado por": p.pa.emisor || "",
    "Alta BPS": p.bps.tiene ? SI : NO,
    "Nº BPS": p.bps.numero || "",
    "Fecha alta BPS": p.bps.fecha || "",
    "Carpeta Drive": p.carpetaId || "",
    "Enlace carpeta": p.carpetaUrl || "",
    "Actualizado": new Date().toISOString().slice(0, 10),
  };
  return encabezados.map((h) => (v[h] === undefined ? "" : v[h]));
}

export function nombreCarpeta(p) {
  const ci = String(p.documento || "sin-documento").replace(/[.\-\s]/g, "");
  return ci + " — " + (p.nombre || "Sin nombre").trim();
}

export async function crearPersona(env, datos) {
  const d = await destino(env);
  const p = normalizar(datos);
  p.id = nuevoId("P");

  const carpeta = await G.crearCarpeta(env, nombreCarpeta(p), d.carpetaId);
  p.carpetaId = carpeta.id;
  p.carpetaUrl = carpeta.webViewLink || ("https://drive.google.com/drive/folders/" + carpeta.id);

  const { encabezados } = await leerHoja(env, d.planillaId, HOJAS.personal, COLUMNAS.Personal);
  await G.agregarFila(env, d.planillaId, HOJAS.personal, filaDePersona(p, encabezados));
  return p;
}

export async function actualizarPersona(env, id, datos) {
  const d = await destino(env);
  const hoja = await leerHoja(env, d.planillaId, HOJAS.personal, COLUMNAS.Personal);
  const actual = hoja.datos.find((f) => f["ID"] === id);
  if (!actual) throw new Error("No existe la ficha " + id);

  const p = normalizar(datos);
  p.id = id;
  p.carpetaId = actual["Carpeta Drive"] || "";
  p.carpetaUrl = actual["Enlace carpeta"] || "";

  /* Si no tenía carpeta, se crea ahora; si cambió el nombre o el documento, se renombra. */
  const nombreNuevo = nombreCarpeta(p);
  if (!p.carpetaId) {
    const c = await G.crearCarpeta(env, nombreNuevo, d.carpetaId);
    p.carpetaId = c.id;
    p.carpetaUrl = c.webViewLink || ("https://drive.google.com/drive/folders/" + c.id);
  } else {
    const anterior = nombreCarpeta({
      documento: actual["Documento"], nombre: actual["Nombre"],
    });
    if (anterior !== nombreNuevo) await G.renombrar(env, p.carpetaId, nombreNuevo).catch(() => {});
  }

  await G.escribirRango(
    env, d.planillaId,
    HOJAS.personal + "!A" + actual._fila,
    [filaDePersona(p, hoja.encabezados)]
  );
  return p;
}

export async function bajaPersona(env, id) {
  const d = await destino(env);
  const hoja = await leerHoja(env, d.planillaId, HOJAS.personal, COLUMNAS.Personal);
  const actual = hoja.datos.find((f) => f["ID"] === id);
  if (!actual) throw new Error("No existe la ficha " + id);
  const col = hoja.encabezados.indexOf("Estado");
  if (col < 0) throw new Error("La planilla no tiene la columna Estado");
  const letra = letraColumna(col);
  await G.escribirRango(env, d.planillaId, HOJAS.personal + "!" + letra + actual._fila, [["Baja"]]);
  return true;
}

function letraColumna(i) {
  let s = "";
  i = i + 1;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

function normalizar(x) {
  const doc = (o) => ({ vto: aISO((o && o.vto) || ""), na: !!(o && o.na) });
  return {
    id: x.id || "",
    empresa: (x.empresa || "").trim(),
    servicio: (x.servicio || "").trim(),
    nombre: (x.nombre || "").trim(),
    documento: (x.documento || "").trim(),
    fechaNac: aISO(x.fechaNac),
    ingreso: aISO(x.ingreso),
    categoria: (x.categoria || "").trim(),
    funcion: (x.funcion || "").trim(),
    estado: x.estado === "Baja" ? "Baja" : "Activo",
    salud: doc(x.salud), moto: doc(x.moto), libH: doc(x.libH), libA: doc(x.libA),
    pa: { ...doc(x.pa), emisor: ((x.pa && x.pa.emisor) || "").trim() },
    bps: {
      tiene: !!(x.bps && x.bps.tiene),
      numero: ((x.bps && x.bps.numero) || "").trim(),
      fecha: aISO(x.bps && x.bps.fecha),
    },
    carpetaId: x.carpetaId || "", carpetaUrl: x.carpetaUrl || "",
  };
}

/* --------------------------- documentos --------------------------- */

export async function carpetaDe(env, id) {
  const d = await destino(env);
  const hoja = await leerHoja(env, d.planillaId, HOJAS.personal, COLUMNAS.Personal);
  const f = hoja.datos.find((x) => x["ID"] === id);
  if (!f) throw new Error("No existe la ficha " + id);
  if (f["Carpeta Drive"]) return { carpetaId: f["Carpeta Drive"], fila: f, hoja, destino: d };

  const c = await G.crearCarpeta(env, nombreCarpeta({ documento: f["Documento"], nombre: f["Nombre"] }), d.carpetaId);
  const url = c.webViewLink || ("https://drive.google.com/drive/folders/" + c.id);
  const iCar = hoja.encabezados.indexOf("Carpeta Drive");
  const iEnl = hoja.encabezados.indexOf("Enlace carpeta");
  if (iCar >= 0) await G.escribirRango(env, d.planillaId, HOJAS.personal + "!" + letraColumna(iCar) + f._fila, [[c.id]]);
  if (iEnl >= 0) await G.escribirRango(env, d.planillaId, HOJAS.personal + "!" + letraColumna(iEnl) + f._fila, [[url]]);
  return { carpetaId: c.id, fila: f, hoja, destino: d };
}

export async function guardarDocumento(env, personaId, { tipo, etiqueta, nombre, mime, datos, fecha }) {
  const { carpetaId, destino: d } = await carpetaDe(env, personaId);
  const subido = await G.subirArchivo(env, { nombre, mime, datos, carpeta: carpetaId });

  /* Un documento de vencimiento reemplaza al anterior del mismo tipo. */
  if (tipo && tipo !== "otros") {
    const hoja = await leerHoja(env, d.planillaId, HOJAS.documentos, COLUMNAS.Documentos);
    const previo = hoja.datos.find((f) => f["PersonaID"] === personaId && f["Tipo"] === tipo);
    if (previo) await borrarDocumentoFila(env, d, hoja, previo);
  }

  const doc = {
    id: nuevoId("D"), personaId, tipo: tipo || "otros", etiqueta: etiqueta || "",
    nombre: subido.name || nombre, fecha: aISO(fecha) || new Date().toISOString().slice(0, 10),
    driveId: subido.id, enlace: subido.webViewLink || "",
    mime: subido.mimeType || mime || "", tam: subido.size || "",
  };
  const hoja = await leerHoja(env, d.planillaId, HOJAS.documentos, COLUMNAS.Documentos);
  const v = {
    "ID": doc.id, "PersonaID": doc.personaId, "Tipo": doc.tipo, "Etiqueta": doc.etiqueta,
    "Archivo": doc.nombre, "Fecha": doc.fecha, "Drive ID": doc.driveId, "Enlace": doc.enlace,
    "MIME": doc.mime, "Tamaño": doc.tam,
  };
  await G.agregarFila(env, d.planillaId, HOJAS.documentos, hoja.encabezados.map((h) => v[h] ?? ""));
  return doc;
}

async function borrarDocumentoFila(env, d, hoja, fila) {
  if (fila["Drive ID"]) await G.borrarArchivo(env, fila["Drive ID"]).catch(() => {});
  await G.escribirRango(
    env, d.planillaId,
    HOJAS.documentos + "!A" + fila._fila + ":" + letraColumna(hoja.encabezados.length - 1) + fila._fila,
    [hoja.encabezados.map(() => "")]
  );
}

export async function borrarDocumento(env, docId) {
  const d = await destino(env);
  const hoja = await leerHoja(env, d.planillaId, HOJAS.documentos, COLUMNAS.Documentos);
  const f = hoja.datos.find((x) => x["ID"] === docId);
  if (!f) return false;
  await borrarDocumentoFila(env, d, hoja, f);
  return true;
}

export async function documentoPorId(env, docId) {
  const d = await destino(env);
  const hoja = await leerHoja(env, d.planillaId, HOJAS.documentos, COLUMNAS.Documentos);
  const f = hoja.datos.find((x) => x["ID"] === docId);
  return f ? aDocumento(f) : null;
}

/* ------------------------------ EPP ------------------------------ */

export async function guardarEpp(env, personaId, e) {
  const d = await destino(env);
  const hoja = await leerHoja(env, d.planillaId, HOJAS.epp, COLUMNAS.EPP);
  const reg = {
    "ID": nuevoId("E"), "PersonaID": personaId, "Equipo": e.equipo || "", "Detalle": e.detalle || "",
    "Fecha entrega": aISO(e.fechaEntrega), "Entregado": e.entregado ? SI : NO,
    "Fecha reposición": aISO(e.fechaReposicion), "Repuesto": e.repuesto ? SI : NO,
  };
  await G.agregarFila(env, d.planillaId, HOJAS.epp, hoja.encabezados.map((h) => reg[h] ?? ""));
  return reg["ID"];
}

export async function actualizarEpp(env, eppId, cambios) {
  const d = await destino(env);
  const hoja = await leerHoja(env, d.planillaId, HOJAS.epp, COLUMNAS.EPP);
  const f = hoja.datos.find((x) => x["ID"] === eppId);
  if (!f) throw new Error("No existe el registro de EPP");
  const actual = aEpp(f);
  const nuevo = { ...actual, ...cambios };
  const v = {
    "ID": eppId, "PersonaID": actual.personaId, "Equipo": nuevo.equipo, "Detalle": nuevo.detalle,
    "Fecha entrega": aISO(nuevo.fechaEntrega), "Entregado": nuevo.entregado ? SI : NO,
    "Fecha reposición": aISO(nuevo.fechaReposicion), "Repuesto": nuevo.repuesto ? SI : NO,
  };
  await G.escribirRango(env, d.planillaId, HOJAS.epp + "!A" + f._fila, [hoja.encabezados.map((h) => v[h] ?? "")]);
  return nuevo;
}

export async function borrarEpp(env, eppId) {
  const d = await destino(env);
  const hoja = await leerHoja(env, d.planillaId, HOJAS.epp, COLUMNAS.EPP);
  const f = hoja.datos.find((x) => x["ID"] === eppId);
  if (!f) return false;
  await G.escribirRango(
    env, d.planillaId,
    HOJAS.epp + "!A" + f._fila + ":" + letraColumna(hoja.encabezados.length - 1) + f._fila,
    [hoja.encabezados.map(() => "")]
  );
  return true;
}

/* ------------------------- importación inicial ------------------------- */

export async function importar(env, personas) {
  const d = await destino(env);
  const hoja = await leerHoja(env, d.planillaId, HOJAS.personal, COLUMNAS.Personal);
  if (hoja.datos.length) {
    throw new Error("La planilla ya tiene " + hoja.datos.length + " fichas. La importación solo corre sobre una planilla vacía.");
  }
  const filas = [];
  for (const x of personas) {
    const p = normalizar(x);
    p.id = nuevoId("P");
    const c = await G.crearCarpeta(env, nombreCarpeta(p), d.carpetaId);
    p.carpetaId = c.id;
    p.carpetaUrl = c.webViewLink || ("https://drive.google.com/drive/folders/" + c.id);
    filas.push(filaDePersona(p, hoja.encabezados));
  }
  if (filas.length) {
    await G.escribirRango(env, d.planillaId, HOJAS.personal + "!A2", filas);
  }
  return filas.length;
}
