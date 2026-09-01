/*
 * Ingreso con usuario y contraseña.
 *
 * Los usuarios se guardan en la variable de entorno USUARIOS, como JSON:
 *   [{"usuario":"rrhh","nombre":"RRHH","sal":"...","hash":"..."}]
 * El hash se genera con `npm run clave` (PBKDF2-SHA256, 200.000 vueltas).
 * La sesión viaja en una cookie firmada; no se guarda nada en el servidor.
 */

import { webcrypto as crypto } from "node:crypto";

const DURACION = 12 * 60 * 60; // 12 horas
const COOKIE = "legajo_sesion";

const b64 = {
  a: (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  de: (s) => new Uint8Array(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64")),
};

export async function derivar(clave, sal) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(clave), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: b64.de(sal), iterations: 200000 },
    material, 256
  );
  return b64.a(bits);
}

function iguales(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* Lee la variable USUARIOS. Lanza error si está mal escrita, para poder
 * avisarlo con claridad en vez de decir "contraseña incorrecta". */
export function usuariosDe(env) {
  const crudo = String(env.USUARIOS || "").trim();
  if (!crudo) return [];
  let l;
  try {
    l = JSON.parse(crudo);
  } catch (e) {
    throw new Error("FORMATO");
  }
  if (!Array.isArray(l)) throw new Error("FORMATO");
  for (const u of l) {
    if (!u || !u.usuario || !u.sal || !u.hash) throw new Error("FORMATO");
  }
  /* Sin rol declarado, el usuario es administrador: así los usuarios
   * antiguos siguen funcionando igual que antes. */
  return l.map((u) => ({ ...u, rol: u.rol === "lectura" ? "lectura" : "admin" }));
}

export function buscarUsuario(lista, usuario) {
  const q = String(usuario || "").trim().toLowerCase();
  return lista.find((x) => String(x.usuario || "").toLowerCase() === q) || null;
}

export async function verificar(u, clave) {
  const hash = await derivar(clave, u.sal);
  return iguales(hash, u.hash);
}

function usuarios(env) {
  try {
    return usuariosDe(env);
  } catch (e) {
    console.error("USUARIOS no tiene un formato válido. Revisá la variable de entorno.");
    return [];
  }
}

async function firmar(env, texto) {
  const k = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.SESSION_SECRET || ""),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return b64.a(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texto)));
}

export async function entrar(env, usuario, clave) {
  const lista = usuarios(env);
  if (!lista.length) throw new Error("No hay usuarios configurados. Falta la variable USUARIOS.");
  const u = lista.find((x) => String(x.usuario || "").toLowerCase() === String(usuario || "").trim().toLowerCase());
  if (!u) return null;
  const hash = await derivar(clave, u.sal);
  if (!iguales(hash, u.hash)) return null;
  return { usuario: u.usuario, nombre: u.nombre || u.usuario, rol: u.rol };
}

export async function cookieSesion(env, sesion, seguro) {
  const cuerpo = b64.a(new TextEncoder().encode(JSON.stringify({
    u: sesion.usuario, n: sesion.nombre, r: sesion.rol || "admin",
    exp: Math.floor(Date.now() / 1000) + DURACION,
  })));
  const valor = cuerpo + "." + (await firmar(env, cuerpo));
  return COOKIE + "=" + valor + "; HttpOnly; SameSite=Lax; Path=/; Max-Age=" + DURACION + (seguro ? "; Secure" : "");
}

export function cookieSalida(seguro) {
  return COOKIE + "=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" + (seguro ? "; Secure" : "");
}

export async function sesionDe(env, cabeceraCookie) {
  const m = String(cabeceraCookie || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
  if (!m) return null;
  const partes = m[1].split(".");
  if (partes.length !== 2) return null;
  const esperada = await firmar(env, partes[0]);
  if (!iguales(esperada, partes[1])) return null;
  try {
    const d = JSON.parse(Buffer.from(b64.de(partes[0])).toString("utf8"));
    if (!d.exp || d.exp < Math.floor(Date.now() / 1000)) return null;
    return { usuario: d.u, nombre: d.n, rol: d.r === "lectura" ? "lectura" : "admin" };
  } catch (e) {
    return null;
  }
}
