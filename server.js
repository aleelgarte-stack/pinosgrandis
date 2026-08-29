/*
 * Legajo Pinos Grandis — servidor.
 * Sirve la aplicación web y la API que habla con Google Drive y Sheets.
 * Pensado para correr en Render como Web Service de Node.
 */

import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

import * as Auth from "./auth.js";
import * as D from "./datos.js";
import * as G from "./google.js";

const env = process.env;
const aqui = path.dirname(fileURLToPath(import.meta.url));
const PUERTO = env.PORT || 3000;

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
});

/* Render entra por HTTPS; en desarrollo local, por HTTP. */
const esSeguro = (req) => (req.headers["x-forwarded-proto"] || req.protocol) === "https";

/* ---------------------------- estáticos ----------------------------
 * Lista explícita: todos los archivos viven en la misma carpeta que este
 * archivo, y solo se entregan los que están acá. El código del servidor
 * nunca se sirve.
 */
const ESTATICOS = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/clave.html": ["clave.html", "text/html; charset=utf-8"],
  "/legajo.js": ["legajo.js", "text/javascript; charset=utf-8"],
  "/estilos.css": ["estilos.css", "text/css; charset=utf-8"],
  "/marca.png": ["marca.png", "image/png"],
  "/lockup.png": ["lockup.png", "image/png"],
  "/datos-iniciales.json": ["datos-iniciales.json", "application/json; charset=utf-8"],
};

/* Páginas públicas: no exigen sesión y describen la aplicación. Google las
 * pide para poder publicar la app (página principal y política de privacidad).
 * Se les inyecta, si está configurada, la etiqueta de verificación de Search
 * Console y el correo de contacto. */
const PUBLICAS = { "/inicio": "inicio.html", "/privacidad": "privacidad.html" };
const cachePublicas = {};

function paginaPublica(archivo) {
  if (cachePublicas[archivo]) return cachePublicas[archivo];
  let html = fs.readFileSync(path.join(aqui, archivo), "utf8");
  const v = env.GOOGLE_SITE_VERIFICATION;
  html = html.replace(
    "<!--VERIFICACION-->",
    v ? '<meta name="google-site-verification" content="' + escaparHtml(v) + '">' : ""
  );
  const correo = env.CORREO_CONTACTO;
  html = html.replace(
    "<!--CORREO-->",
    correo ? ", a <a href=\"mailto:" + escaparHtml(correo) + '">' + escaparHtml(correo) + "</a>" : ""
  );
  cachePublicas[archivo] = html;
  return html;
}

app.get(["/inicio", "/privacidad"], (req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-cache");
  res.send(paginaPublica(PUBLICAS[req.path]));
});

/* Verificación de propiedad del sitio por archivo, si se usa ese método:
 * la variable GOOGLE_VERIFICACION_ARCHIVO lleva el nombre que da Google,
 * por ejemplo google1a2b3c4d5e6f.html */
app.get(/^\/google[0-9a-z]+\.html$/, (req, res) => {
  const nombre = env.GOOGLE_VERIFICACION_ARCHIVO;
  if (nombre && req.path === "/" + nombre) {
    res.setHeader("content-type", "text/html; charset=utf-8");
    return res.send("google-site-verification: " + nombre);
  }
  res.status(404).send("No encontrado");
});

app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  const e = ESTATICOS[req.path];
  if (!e) return next();
  res.setHeader("content-type", e[1]);
  /* Las imágenes se pueden cachear; el código y las páginas no, para que un
     cambio publicado se vea enseguida sin tener que forzar la recarga. */
  const imagen = /\.(png|jpg|jpeg|svg|ico|woff2?)$/.test(e[0]);
  res.setHeader("cache-control", imagen ? "public, max-age=86400" : "no-cache");
  res.sendFile(path.join(aqui, e[0]));
});

/* ---------------------------- salud ---------------------------- */
app.get("/api/salud", (req, res) => {
  const faltan = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "SESSION_SECRET", "USUARIOS"]
    .filter((k) => !env[k]);
  let usuarios;
  try {
    usuarios = Auth.usuariosDe(env).map((u) => u.usuario);
  } catch (e) {
    usuarios = "La variable USUARIOS está mal escrita: tiene que ser el texto completo que da /clave.html, en un solo renglón.";
  }
  res.json({ ok: faltan.length === 0, faltan, usuarios });
});

/* ---------------------------- sesión ---------------------------- */
app.post("/api/login", async (req, res, next) => {
  try {
    const { usuario, clave } = req.body || {};

    let lista;
    try {
      lista = Auth.usuariosDe(env);
    } catch (e) {
      return res.status(500).json({
        error: "La variable USUARIOS está mal escrita. Generala de nuevo en /clave.html y pegala completa, en un solo renglón.",
      });
    }
    if (!lista.length) {
      return res.status(500).json({
        error: "Todavía no hay usuarios cargados. Falta la variable USUARIOS en Render (se genera en /clave.html).",
      });
    }
    if (!env.SESSION_SECRET) {
      return res.status(500).json({
        error: "Falta la variable SESSION_SECRET en Render (se genera en /clave.html).",
      });
    }

    const u = Auth.buscarUsuario(lista, usuario);
    if (!u) {
      return res.status(401).json({
        error: 'No existe el usuario "' + String(usuario || "").trim() + '". Los cargados son: ' +
               lista.map((x) => x.usuario).join(", ") + ".",
      });
    }
    if (!(await Auth.verificar(u, clave))) {
      return res.status(401).json({ error: 'La contraseña no coincide para "' + u.usuario + '".' });
    }

    const s = { usuario: u.usuario, nombre: u.nombre || u.usuario };
    res.setHeader("set-cookie", await Auth.cookieSesion(env, s, esSeguro(req)));
    res.json({ sesion: s });
  } catch (e) { next(e); }
});

app.post("/api/logout", (req, res) => {
  res.setHeader("set-cookie", Auth.cookieSalida(esSeguro(req)));
  res.json({ ok: true });
});

/* Todo lo que sigue exige sesión. */
app.use("/api", async (req, res, next) => {
  try {
    const s = await Auth.sesionDe(env, req.headers.cookie);
    if (!s) return res.status(401).json({ error: "Sin sesión" });
    req.sesion = s;
    next();
  } catch (e) { next(e); }
});

app.get("/api/sesion", (req, res) => res.json({ sesion: req.sesion }));

/* ------------------- conexión con Google desde la web -------------------
 * Evita tener que usar la terminal: se entra al sistema, se toca el botón
 * de conectar y Google devuelve el token para pegar en Render.
 */
const faltanGoogle = () =>
  ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"].filter((k) => !env[k]);

const vuelta = (req) =>
  (req.headers["x-forwarded-proto"] || req.protocol) + "://" + req.headers.host + "/api/oauth/vuelta";

app.get("/api/estado", (req, res) => res.json({ faltan: faltanGoogle() }));

app.get("/api/oauth/inicio", (req, res) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return res.status(400).send(pagina(
      "Faltan datos",
      "<p>Todavía no están cargadas <b>GOOGLE_CLIENT_ID</b> y <b>GOOGLE_CLIENT_SECRET</b> en Render.</p>"
    ));
  }
  res.redirect(
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: vuelta(req),
      response_type: "code",
      scope: "https://www.googleapis.com/auth/drive.file",
      access_type: "offline",
      prompt: "consent",
    })
  );
});

app.get("/api/oauth/vuelta", async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send(pagina("Sin autorización",
      "<p>Google no devolvió el código. Probá de nuevo desde el sistema.</p>"));
  }
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: vuelta(req), grant_type: "authorization_code",
    }),
  });
  const j = await r.json();
  if (!j.refresh_token) {
    return res.status(400).send(pagina("Google no devolvió el token permanente",
      "<p>Suele pasar cuando ya habías autorizado antes con esta cuenta. Quitá el permiso en " +
      '<a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">myaccount.google.com/permissions</a>' +
      " y volvé a intentar.</p><pre>" + escaparHtml(JSON.stringify(j, null, 2)) + "</pre>"));
  }
  res.send(pagina("Último paso",
    "<p>Copiá este valor y pegalo en Render, en <b>Environment</b>, como variable " +
    "<b>GOOGLE_REFRESH_TOKEN</b>. El servicio se reinicia solo y ya queda conectado.</p>" +
    '<div class="token" id="t">' + escaparHtml(j.refresh_token) + "</div>" +
    '<button class="btn" onclick="navigator.clipboard.writeText(document.getElementById(\'t\').textContent);this.textContent=\'Copiado\'">Copiar</button>'
  ));
});

function escaparHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function pagina(titulo, cuerpo) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escaparHtml(titulo)}</title>
<style>
body{margin:0;background:#F5F8F4;color:#14201A;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;
 display:grid;place-items:center;min-height:100vh;padding:24px}
.caja{background:#fff;border:1px solid #DCE5DA;border-radius:14px;padding:30px;max-width:560px;
 box-shadow:0 1px 2px rgba(20,32,26,.05),0 12px 30px -18px rgba(20,32,26,.3)}
h1{font-size:22px;margin:0 0 12px}
.token{font-family:ui-monospace,Consolas,monospace;font-size:13px;background:#F2F5F0;border:1px solid #DCE5DA;
 border-radius:9px;padding:14px;word-break:break-all;margin:16px 0}
pre{background:#F2F5F0;border:1px solid #DCE5DA;border-radius:9px;padding:12px;overflow-x:auto;font-size:12px}
.btn{background:#006838;color:#fff;border:none;border-radius:8px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer}
a{color:#004F2A}
</style></head><body><div class="caja"><h1>${escaparHtml(titulo)}</h1>${cuerpo}</div></body></html>`;
}

/* ---------------------------- datos ---------------------------- */
app.get("/api/datos", async (req, res, next) => {
  try {
    if (faltanGoogle().length) {
      return res.status(409).json({
        error: "Todavía falta conectar el sistema con Google.",
        codigo: "SIN_GOOGLE",
        faltan: faltanGoogle(),
      });
    }
    const d = await D.leerTodo(env);
    res.json({
      sesion: req.sesion,
      planillaUrl: d.destino.planillaUrl,
      carpetaUrl: d.destino.carpetaUrl,
      personas: d.personas.map(limpiar),
    });
  } catch (e) { next(e); }
});

app.post("/api/personas", async (req, res, next) => {
  try {
    if (!String(req.body.nombre || "").trim()) return res.status(400).json({ error: "Falta el nombre de la persona." });
    const p = await D.crearPersona(env, req.body);
    res.json({ ok: true, id: p.id, carpetaUrl: p.carpetaUrl });
  } catch (e) { next(e); }
});

app.put("/api/personas/:id", async (req, res, next) => {
  try {
    if (!String(req.body.nombre || "").trim()) return res.status(400).json({ error: "Falta el nombre de la persona." });
    await D.actualizarPersona(env, req.params.id, req.body);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.delete("/api/personas/:id", async (req, res, next) => {
  try {
    await D.bajaPersona(env, req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ---------------------------- documentos ---------------------------- */
app.post("/api/personas/:id/documentos", subida.single("archivo"), async (req, res, next) => {
  try {
    const a = req.file;
    if (!a) return res.status(400).json({ error: "No llegó ningún archivo." });
    const mime = a.mimetype || "application/octet-stream";
    if (!/^image\//.test(mime) && mime !== "application/pdf") {
      return res.status(400).json({ error: "Solo se aceptan archivos PDF o imagen." });
    }
    const doc = await D.guardarDocumento(env, req.params.id, {
      tipo: req.body.tipo || "otros",
      etiqueta: req.body.etiqueta || "",
      fecha: req.body.fecha || "",
      nombre: Buffer.from(a.originalname, "latin1").toString("utf8"),
      mime,
      datos: a.buffer,
    });
    res.json({ ok: true, documento: doc });
  } catch (e) { next(e); }
});

app.delete("/api/documentos/:id", async (req, res, next) => {
  try {
    await D.borrarDocumento(env, req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* Vista previa: el servidor trae el archivo de Drive y lo entrega al navegador. */
app.get("/api/documentos/:id/archivo", async (req, res, next) => {
  try {
    const doc = await D.documentoPorId(env, req.params.id);
    if (!doc || !doc.driveId) return res.status(404).json({ error: "Documento no encontrado" });
    const r = await G.descargarArchivo(env, doc.driveId);
    res.setHeader("content-type", doc.mime || r.headers.get("content-type") || "application/octet-stream");
    res.setHeader("content-disposition", 'inline; filename="' + encodeURIComponent(doc.nombre) + '"');
    res.setHeader("cache-control", "private, max-age=300");
    Readable.fromWeb(r.body).pipe(res);
  } catch (e) { next(e); }
});

/* ---------------------------- EPP ---------------------------- */
app.post("/api/personas/:id/epp", async (req, res, next) => {
  try {
    const id = await D.guardarEpp(env, req.params.id, req.body);
    res.json({ ok: true, id });
  } catch (e) { next(e); }
});

app.put("/api/epp/:id", async (req, res, next) => {
  try {
    await D.actualizarEpp(env, req.params.id, req.body);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.delete("/api/epp/:id", async (req, res, next) => {
  try {
    await D.borrarEpp(env, req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ---------------------- importación inicial ---------------------- */
app.post("/api/importar", async (req, res, next) => {
  try {
    const n = await D.importar(env, (req.body && req.body.personas) || []);
    res.json({ ok: true, importadas: n });
  } catch (e) { next(e); }
});

/* ---------------------------- cierre ---------------------------- */
app.use("/api", (req, res) => res.status(404).json({ error: "Ruta no encontrada: " + req.path }));
app.get("*", (req, res) => res.sendFile(path.join(aqui, "index.html")));

app.use((e, req, res, next) => {
  console.error(e);
  if (e && e.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "El archivo supera los 15 MB." });
  res.status(500).json({ error: (e && e.message) || "Error inesperado" });
});

function limpiar(p) {
  const { _fila, ...resto } = p;
  const doc = (d) => (d ? { ...d, _fila: undefined } : null);
  return {
    ...resto,
    salud: { ...p.salud, archivo: doc(p.salud.archivo) },
    moto: { ...p.moto, archivo: doc(p.moto.archivo) },
    libH: { ...p.libH, archivo: doc(p.libH.archivo) },
    libA: { ...p.libA, archivo: doc(p.libA.archivo) },
    pa: { ...p.pa, archivo: doc(p.pa.archivo) },
    bps: { ...p.bps, archivo: doc(p.bps.archivo) },
    archivos: p.archivos.map(doc),
    epp: p.epp.map((e) => ({ ...e, _fila: undefined })),
  };
}

app.listen(PUERTO, () => {
  const faltan = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "SESSION_SECRET", "USUARIOS"]
    .filter((k) => !env[k]);
  console.log("Legajo Pinos Grandis escuchando en el puerto " + PUERTO);
  if (faltan.length) console.warn("Faltan variables de entorno: " + faltan.join(", "));
});
