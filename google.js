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

async function api(env, url, opciones = {}) {
  const t = await token(env);
  const h = new Headers(opciones.headers || {});
  h.set("authorization", "Bearer " + t);
  const r = await fetch(url, { ...opciones, headers: h });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error("Google respondió " + r.status + ": " + txt.slice(0, 400));
  }
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

export async function subirArchivo(env, { nombre, mime, datos, carpeta }) {
  const limite = "----legajo" + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: nombre, parents: [carpeta] });

  const cabecera =
    "--" + limite + "\r\n" +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" + meta + "\r\n" +
    "--" + limite + "\r\n" +
    "Content-Type: " + (mime || "application/octet-stream") + "\r\n\r\n";
  const pie = "\r\n--" + limite + "--\r\n";

  const enc = new TextEncoder();
  const a = enc.encode(cabecera), b = new Uint8Array(datos), c = enc.encode(pie);
  const cuerpo = new Uint8Array(a.length + b.length + c.length);
  cuerpo.set(a, 0); cuerpo.set(b, a.length); cuerpo.set(c, a.length + b.length);

  return json(
    env,
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,size,mimeType",
    {
      method: "POST",
      headers: { "content-type": "multipart/related; boundary=" + limite },
      body: cuerpo,
    }
  );
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
