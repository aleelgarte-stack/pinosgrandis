/*
 * Conexión con Google: token de acceso, Drive y Sheets.
 * Se usa el scope drive.file, que da acceso únicamente a los archivos
 * que crea esta aplicación. No puede ver ni tocar el resto del Drive.
 */

const CARPETA = "application/vnd.google-apps.folder";
const PLANILLA = "application/vnd.google-apps.spreadsheet";

/* El token de acceso dura una hora; se guarda en memoria del isolate. */
let cacheToken = { valor: null, vence: 0 };

export async function token(env) {
  const ahora = Date.now();
  if (cacheToken.valor && ahora < cacheToken.vence - 60000) return cacheToken.valor;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    throw new Error(
      "No se pudo renovar el acceso a Google (" + (j.error_description || j.error || r.status) + "). " +
      "Revisá GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REFRESH_TOKEN."
    );
  }
  cacheToken = { valor: j.access_token, vence: ahora + (j.expires_in || 3600) * 1000 };
  return cacheToken.valor;
}

/* Traduce la respuesta de error de Google a algo legible. A veces devuelve
 * una página HTML entera, que no sirve de nada mostrarla. */
export function mensajeDeError(estado, texto) {
  try {
    const j = JSON.parse(texto);
    const m = (j.error && (j.error.message || j.error)) || null;
    if (m) return "Google respondió " + estado + ": " + (typeof m === "string" ? m : JSON.stringify(m));
  } catch (e) { /* no era JSON */ }
  if (/^\s*</.test(texto)) {
    return "Google devolvió un error " + estado + " sin explicación (una página en vez de una respuesta). " +
           "Suele ser momentáneo: esperá un momento y probá de nuevo.";
  }
  return "Google respondió " + estado + ": " + String(texto).slice(0, 300);
}

async function api(env, url, opciones = {}) {
  const t = await token(env);
  const h = new Headers(opciones.headers || {});
  h.set("authorization", "Bearer " + t);
  const r = await fetch(url, { ...opciones, headers: h });
  if (!r.ok) throw new Error(mensajeDeError(r.status, await r.text()));
  return r;
}
async function json(env, url, opciones) {
  return (await api(env, url, opciones)).json();
}

/* ------------------------------ Drive ------------------------------ */

export async function buscar(env, consulta) {
  const u =
    "https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent(consulta) +
    "&fields=" + encodeURIComponent("files(id,name,mimeType,webViewLink,parents)") +
    "&pageSize=100&spaces=drive";
  const j = await json(env, u);
  return j.files || [];
}

export async function crearCarpeta(env, nombre, padre) {
  const cuerpo = { name: nombre, mimeType: CARPETA };
  if (padre) cuerpo.parents = [padre];
  return json(env, "https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
}

export async function renombrar(env, id, nombre) {
  return json(env, "https://www.googleapis.com/drive/v3/files/" + id + "?fields=id,name", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: nombre }),
  });
}

/* Subida en dos pasos (la que Google recomienda): primero se anuncia el
 * archivo y Google devuelve una dirección temporal; después se mandan los
 * bytes ahí. Es más robusto que armar un cuerpo multipart a mano y no tiene
 * problemas con archivos grandes ni con nombres con acentos. */
export async function subirArchivo(env, { nombre, mime, datos, carpeta }) {
  const t = await token(env);
  const bytes = datos instanceof Uint8Array ? datos : new Uint8Array(datos);
  const tipo = mime || "application/octet-stream";

  const inicio = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,size,mimeType",
    {
      method: "POST",
      headers: {
        authorization: "Bearer " + t,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": tipo,
        "x-upload-content-length": String(bytes.length),
      },
      body: JSON.stringify({ name: nombre, parents: [carpeta] }),
    }
  );
  if (!inicio.ok) throw new Error(mensajeDeError(inicio.status, await inicio.text()));

  const destino = inicio.headers.get("location");
  if (!destino) throw new Error("Google no indicó dónde subir el archivo. Probá de nuevo.");

  const r = await fetch(destino, {
    method: "PUT",
    headers: { authorization: "Bearer " + t, "content-type": tipo },
    body: bytes,
  });
  if (!r.ok) throw new Error(mensajeDeError(r.status, await r.text()));
  return r.json();
}

export async function descargarArchivo(env, id) {
  return api(env, "https://www.googleapis.com/drive/v3/files/" + id + "?alt=media");
}

export async function borrarArchivo(env, id) {
  const t = await token(env);
  const r = await fetch("https://www.googleapis.com/drive/v3/files/" + id, {
    method: "DELETE",
    headers: { authorization: "Bearer " + t },
  });
  return r.ok || r.status === 404;
}

/* ------------------------------ Sheets ------------------------------ */

export async function leerRango(env, planillaId, rango) {
  const u = "https://sheets.googleapis.com/v4/spreadsheets/" + planillaId +
    "/values/" + encodeURIComponent(rango) + "?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE";
  const j = await json(env, u);
  return j.values || [];
}

export async function escribirRango(env, planillaId, rango, filas) {
  const u = "https://sheets.googleapis.com/v4/spreadsheets/" + planillaId +
    "/values/" + encodeURIComponent(rango) + "?valueInputOption=RAW";
  return json(env, u, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ values: filas }),
  });
}

export async function agregarFila(env, planillaId, hoja, fila) {
  const u = "https://sheets.googleapis.com/v4/spreadsheets/" + planillaId +
    "/values/" + encodeURIComponent(hoja + "!A1") +
    "?valueInputOption=RAW&insertDataOption=INSERT_ROWS";
  return json(env, u, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ values: [fila] }),
  });
}

export async function crearPlanilla(env, nombre, carpetaId, hojas) {
  const archivo = await json(env, "https://www.googleapis.com/drive/v3/files?fields=id,webViewLink", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: nombre, mimeType: PLANILLA, parents: [carpetaId] }),
  });

  const peticiones = [];
  hojas.forEach((h, i) => {
    if (i === 0) {
      peticiones.push({ updateSheetProperties: { properties: { sheetId: 0, title: h.titulo }, fields: "title" } });
    } else {
      peticiones.push({ addSheet: { properties: { title: h.titulo } } });
    }
  });
  await json(env, "https://sheets.googleapis.com/v4/spreadsheets/" + archivo.id + ":batchUpdate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requests: peticiones }),
  });

  for (const h of hojas) {
    await escribirRango(env, archivo.id, h.titulo + "!A1", [h.encabezados]);
  }
  await json(env, "https://sheets.googleapis.com/v4/spreadsheets/" + archivo.id + ":batchUpdate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requests: hojas.map((h, i) => ({
        repeatCell: {
          range: { sheetId: i === 0 ? 0 : undefined, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: "userEnteredFormat.textFormat.bold",
        },
      })).filter((r) => r.repeatCell.range.sheetId === 0),
    }),
  }).catch(() => {});

  return archivo;
}

export const MIME = { CARPETA, PLANILLA };
