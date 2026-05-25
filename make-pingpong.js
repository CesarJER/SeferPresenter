import ffmpeg from "ffmpeg-static";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backgroundsDir = path.join(__dirname, "public", "backgrounds");
const excludeDir = path.join(backgroundsDir, "Fondos");

function scanDirectory(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      if (path.normalize(fullPath).toLowerCase() === path.normalize(excludeDir).toLowerCase()) {
        continue;
      }
      scanDirectory(fullPath);
    } else if (stat.isFile() && file.toLowerCase().endsWith(".mp4")) {
      if (file.toLowerCase().endsWith("-pingpong.mp4")) {
        continue;
      }
      
      const pingpongPath = path.join(dir, path.basename(file, path.extname(file)) + "-pingpong.mp4");
      
      if (!fs.existsSync(pingpongPath)) {
        console.log(`Generating ping-pong for ${file}...`);
        try {
          execFileSync(ffmpeg, [
            "-i", fullPath,
            "-filter_complex",
            "[0:v]reverse[r];[0:v][r]concat=n=2:v=1:a=0[v]",
            "-map", "[v]",
            "-an",
            "-movflags", "+faststart",
            "-y",
            pingpongPath
          ], { stdio: "inherit" });
          console.log(`Created ${pingpongPath}`);
        } catch (error) {
          console.error(`Failed to generate ping-pong for ${file}:`, error);
        }
      }
    }
  }
}

console.log("Scanning backgrounds for missing ping-pong videos...");
if (fs.existsSync(backgroundsDir)) {
  scanDirectory(backgroundsDir);
} else {
  console.log("Directory public/backgrounds does not exist.");
}
console.log("Done.");
