import ffmpeg from "ffmpeg-static";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
  console.log(`
Uso: node scripts/make-pingpong.js <archivo1.mp4> [archivo2.mp4 ...]
     npm run pingpong -- <archivo1.mp4> [archivo2.mp4 ...]

Descripción:
  Genera un vídeo bucle continuo (efecto ping-pong: adelante + reversa)
  para los archivos de vídeo MP4 seleccionados mediante FFmpeg.

Argumentos:
  <archivos>   Ruta relativa o absoluta a uno o más vídeos .mp4

Ejemplo:
  node scripts/make-pingpong.js public/backgrounds/fondo1.mp4
`);
  process.exit(args.includes("-h") || args.includes("--help") ? 0 : 1);
}

for (const inputArg of args) {
  const fullPath = path.resolve(inputArg);

  if (!fs.existsSync(fullPath)) {
    console.error(`[ERROR] El archivo no existe: ${inputArg}`);
    continue;
  }

  const stat = fs.statSync(fullPath);
  if (!stat.isFile()) {
    console.error(`[ERROR] La ruta no es un archivo regular: ${inputArg}`);
    continue;
  }

  const ext = path.extname(fullPath).toLowerCase();
  if (ext !== ".mp4") {
    console.error(`[AVISO] Omitiendo archivo no MP4: ${inputArg}`);
    continue;
  }

  const basename = path.basename(fullPath, ext);
  if (basename.toLowerCase().endsWith("-pingpong")) {
    console.log(`[OMITIDO] El archivo ya es un vídeo ping-pong: ${inputArg}`);
    continue;
  }

  const dir = path.dirname(fullPath);
  const pingpongPath = path.join(dir, `${basename}-pingpong.mp4`);

  console.log(`\nProcesando efecto ping-pong para: ${path.basename(fullPath)}...`);
  try {
    execFileSync(
      ffmpeg,
      [
        "-i",
        fullPath,
        "-filter_complex",
        "[0:v]reverse[r];[0:v][r]concat=n=2:v=1:a=0[v]",
        "-map",
        "[v]",
        "-an",
        "-movflags",
        "+faststart",
        "-y",
        pingpongPath,
      ],
      { stdio: "inherit" }
    );
    console.log(`[ÉXITO] Generado: ${pingpongPath}`);
  } catch (error) {
    console.error(`[FALLO] No se pudo generar ping-pong para ${inputArg}:`, error.message);
  }
}

console.log("\nProceso finalizado.");
