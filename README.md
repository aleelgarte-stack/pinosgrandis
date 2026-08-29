# Legajo Pinos Grandis

Sistema de legajos de personal: una ficha por persona con sus vencimientos y sus
documentos escaneados. Corre en **Render**, guarda los datos en una **planilla de
Google Sheets** y los documentos en **carpetas de Google Drive**, una por persona.

- La planilla es la base de datos. Se puede abrir y editar a mano en Drive.
- Al crear una ficha se crea automáticamente su carpeta en Drive.
- Cada documento (carné de salud, libretas, motosierrista, primeros auxilios,
  alta BPS) puede tener el PDF o la foto adjunta, y se sube a esa carpeta.
- Los vencimientos se marcan con colores: vencido, 30 días, 60 días, vigente.

Guía completa paso a paso: **`GUIA.html`** — abrila en el navegador.

## Puesta en marcha, en resumen

```bash
npm install

# 1. Usuarios del sistema (uno por persona que vaya a entrar)
npm run clave -- rrhh "RRHH" tuContraseñaLarga

# 2. Permiso permanente de Google (ver la guía para crear el cliente OAuth)
npm run token
```

Después: subir el repositorio a GitHub, crear el Web Service en Render apuntando
a ese repositorio, y cargar las variables de entorno en **Environment**:

| Variable | De dónde sale |
|---|---|
| `GOOGLE_CLIENT_ID` | Cliente OAuth de Google Cloud |
| `GOOGLE_CLIENT_SECRET` | Cliente OAuth de Google Cloud |
| `GOOGLE_REFRESH_TOKEN` | `npm run token` |
| `SESSION_SECRET` | Cualquier texto largo al azar |
| `USUARIOS` | `npm run clave` |

Con el servicio en línea, cargar las 28 personas una sola vez:

```bash
npm run importar -- https://TU-SERVICIO.onrender.com rrhh tuContraseñaLarga
```

## Probar en tu computadora

```bash
cp .env.ejemplo .env     # y completá los valores
npm run dev              # queda en http://localhost:3000
```

## Lo que crea en Drive

```
Pinos Grandis — Legajos/          ← carpeta raíz
├── BD PERSONAL                   ← la planilla
├── 45641566 — CARLOS DANIEL FERREIRA NOBLE/
├── 42655352 — EDERSON FABRICIO TEJERA MARIN/
└── …
```

## Permisos que se le dan a Google

Uno solo: `drive.file`. La aplicación **solo ve los archivos que ella misma
crea**. No puede leer ni tocar el resto del Drive de esa cuenta.

## Estructura

```
server.js        Servidor Express: rutas de la API y la web
src/google.js    Conexión con Drive y Sheets
src/datos.js     Modelo sobre la planilla: leer, escribir, carpetas, documentos
src/auth.js      Ingreso con usuario y contraseña, sesión firmada
public/          La aplicación web (HTML, CSS, JS, logo)
scripts/         Utilidades de configuración e importación
render.yaml      Configuración del servicio en Render
```

## La planilla

Hoja **Personal** — una fila por persona. Las columnas se ubican por su nombre,
así que se pueden reordenar; lo que no hay que cambiar es el texto del
encabezado ni la columna `ID`.

| Columna | Contenido |
|---|---|
| ID | Identificador interno. No tocar. |
| Empresa, Servicio | Pinos Grandis / Vandes · FYMNSA, LUMIN, DIRECTOR |
| Nombre, Documento | |
| F. Nacimiento, Ingreso | Fechas: `2026-08-29` o `29/08/2026` |
| Categoría, Función, Estado | Estado: `Activo` o `Baja` |
| C. Salud, C. Motosierrista, Libreta H, Libreta A, Primeros Auxilios | Fecha de vencimiento |
| … N/A | Poner `N/A` cuando no aplica a esa persona |
| Dictado por | Empresa que dictó primeros auxilios |
| Alta BPS, Nº BPS, Fecha alta BPS | `SI` en Alta BPS si está presentada |
| Carpeta Drive, Enlace carpeta | Los completa el sistema |

Hojas **Documentos** y **EPP** — las maneja el sistema; conviene no editarlas a mano.

## Costo

El plan gratuito de Render alcanza, con una salvedad: duerme el servicio después
de 15 minutos sin visitas, y la primera carga después de la siesta tarda cerca de
un minuto. El plan Starter (7 USD por mes) lo mantiene despierto. Google Drive y
Sheets no cobran por esto.

## Mantenimiento

- **Cambiar la web**: editar `public/`, `git push`, y Render publica solo.
- **Agregar un usuario**: correr `npm run clave` de nuevo y actualizar la
  variable `USUARIOS` con todos los objetos en el mismo arreglo.
- **Ver errores**: pestaña *Logs* del servicio en Render.
