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

## Instalación, en resumen

Todo se hace desde el navegador, sin instalar nada:

1. Subir estos archivos a un repositorio de GitHub.
2. Crear un Web Service en Render apuntando a ese repositorio.
3. Abrir `TU-SITIO.onrender.com/clave.html` para generar los usuarios y la clave
   de sesión, y cargarlos en Render como variables de entorno.
4. Crear el cliente OAuth en Google Cloud y cargar sus dos valores en Render.
5. Entrar al sistema, tocar **Conectar con Google** y pegar el token que devuelve
   en la variable `GOOGLE_REFRESH_TOKEN`.
6. Tocar **Cargar las 28 personas**.

### Variables de entorno

| Variable | De dónde sale |
|---|---|
| `GOOGLE_CLIENT_ID` | Cliente OAuth de Google Cloud |
| `GOOGLE_CLIENT_SECRET` | Cliente OAuth de Google Cloud |
| `GOOGLE_REFRESH_TOKEN` | Botón **Conectar con Google** dentro del sistema |
| `SESSION_SECRET` | Página `/clave.html` |
| `USUARIOS` | Página `/clave.html` |

## Estructura

Todos los archivos van sueltos en la raíz del repositorio, sin subcarpetas.

**Servidor** — nunca se sirve al navegador:

```
server.js      Rutas de la API, estáticos y conexión OAuth con Google
google.js      Llamadas a Drive y Sheets
datos.js       Modelo sobre la planilla: leer, escribir, carpetas, documentos
auth.js        Ingreso con usuario y contraseña, sesión firmada
```

**Web** — lo que ve el navegador:

```
index.html             La aplicación
legajo.js              Su código
estilos.css            Sus estilos
clave.html             Generador de usuarios y clave de sesión
marca.png, lockup.png  El logo
datos-iniciales.json   Las 28 personas de BD PERSONAL 2025
```

**Configuración**: `package.json`, `render.yaml`, `.gitignore`, `.env.ejemplo`.

## Probar en tu computadora

Hace falta Node 20 o superior. No es necesario para usar el sistema.

```bash
npm install
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
