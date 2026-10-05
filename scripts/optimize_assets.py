"""Optional media optimizer. Importing this module never changes files or env."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

PROJECT_DIR = Path(__file__).resolve().parent.parent
IMAGE_PRESET = "webp-q80-max1920-v1"
VIDEO_PRESET = "h264-720p-q28-aac128-v1"


def configured_data_dir():
    if os.environ.get("SEFER_DATA_DIR"):
        return os.environ["SEFER_DATA_DIR"]
    for name in (".env.local", ".env"):
        file = PROJECT_DIR / name
        if not file.exists():
            continue
        for line in file.read_text(encoding="utf-8-sig").splitlines():
            key, sep, value = line.strip().removeprefix("export ").partition("=")
            if sep and key.strip() == "SEFER_DATA_DIR":
                value = value.strip()
                if value[:1] in ('"', "'") and value:
                    value = value[1:value.rfind(value[0])]
                else:
                    value = value.split(" #", 1)[0].strip()
                if value:
                    return value
    return None


def digest(file):
    sha = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(chunk)
    return sha.hexdigest()


def write_json(file, data):
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=file.parent,
                                         suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, file)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


class AssetOptimizer:
    def __init__(self, data_dir=None, dry_run=False, backup=True):
        configured = data_dir or configured_data_dir()
        self.data_dir = (PROJECT_DIR / (configured or "data.local")).resolve()
        self.public_dir = self.data_dir / "public"
        self.legacy_dir = self.data_dir / "legacy"
        if not configured and not self.public_dir.is_dir():
            self.public_dir = PROJECT_DIR / "public"
            self.legacy_dir = PROJECT_DIR / "legacy"
        if not self.public_dir.is_dir():
            raise ValueError("No existe la carpeta de medios: " + str(self.public_dir))
        self.dry_run = dry_run
        self.backup = backup
        self.errors = 0
        self.index_file = self.data_dir / "asset-optimization.txt"
        self.index = {"version": 1, "files": {}}
        if self.index_file.exists():
            self.index = json.loads(self.index_file.read_text(encoding="utf-8"))
            if (not isinstance(self.index, dict) or self.index.get("version") != 1
                    or not isinstance(self.index.get("files"), dict)
                    or any(not isinstance(entry, dict) for entry in self.index["files"].values())):
                raise ValueError("Índice inválido; se conserva sin volver a optimizar: " + str(self.index_file))
        self.ffmpeg = PROJECT_DIR / "node_modules" / "ffmpeg-static" / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")

    def url(self, file):
        return "/" + file.relative_to(self.public_dir).as_posix()

    def indexed(self, file, preset):
        entry = self.index["files"].get(self.url(file), {})
        return entry.get("preset") == preset and entry.get("sha256") == digest(file)

    def record(self, file, preset, content=None, **extra):
        self.index["files"][self.url(file)] = {"sha256": digest(content or file), "preset": preset, **extra}
        write_json(self.index_file, self.index)

    def backup_file(self, file, destination):
        if self.backup and not destination.exists():
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, destination)

    def optimize_images(self):
        renamed = {}
        for source in sorted(self.public_dir.rglob("*")):
            if source.suffix.lower() != ".png" or not source.is_file():
                continue
            if not {"backgrounds", "videos"}.intersection(source.relative_to(self.public_dir).parts[:-1]):
                continue
            target = source.with_suffix(".webp")
            if self.indexed(source, IMAGE_PRESET):
                print("Omitido (ya evaluado): " + self.url(source))
                continue
            source_hash = digest(source)
            if target.exists():
                entry = self.index["files"].get(self.url(target), {})
                if entry.get("sourceSha256") == source_hash and self.indexed(target, IMAGE_PRESET):
                    renamed[self.url(source)] = self.url(target)
                    continue
                print("No se sobrescribe un WebP existente: " + self.url(target))
                continue
            if self.dry_run:
                print("Optimizaría imagen: " + self.url(source))
                continue
            temporary = None
            try:
                from PIL import Image
                with tempfile.NamedTemporaryFile(dir=source.parent, suffix=".webp", delete=False) as stream:
                    temporary = Path(stream.name)
                with Image.open(source) as image:
                    if image.width > 1920:
                        image = image.resize((1920, int(image.height * 1920 / image.width)), Image.Resampling.LANCZOS)
                    image.save(temporary, "WEBP", quality=80)
                if temporary.stat().st_size >= source.stat().st_size:
                    self.record(source, IMAGE_PRESET, result="unchanged")
                    print("Sin reducción: " + self.url(source))
                    continue
                self.backup_file(source, self.legacy_dir / "public" / source.relative_to(self.public_dir))
                # Persist the expected output hash first: interruption cannot cause
                # another lossy pass; a failed replace leaves a hash mismatch.
                self.record(target, IMAGE_PRESET, temporary, sourceSha256=source_hash, result="optimized")
                os.replace(temporary, target)
                renamed[self.url(source)] = self.url(target)
                print("Imagen optimizada: " + self.url(target))
            except Exception as error:
                self.errors += 1
                print("Error optimizando imagen: " + str(error))
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
        return renamed

    def optimize_videos(self):
        candidates = []
        for source in sorted(self.public_dir.rglob("*")):
            if source.suffix.lower() != ".mp4" or not source.is_file() or source.name.endswith(".tmp.mp4"):
                continue
            if self.indexed(source, VIDEO_PRESET):
                print("Omitido (ya optimizado): " + self.url(source))
            elif source.stat().st_size > 15 * 1024 * 1024:
                candidates.append(source)
        if not candidates:
            return
        if self.dry_run:
            for source in candidates:
                print("Optimizaría vídeo: " + self.url(source))
            return
        if not self.ffmpeg.is_file():
            raise ValueError("FFmpeg no disponible: " + str(self.ffmpeg))
        encoders = subprocess.run([str(self.ffmpeg), "-encoders"], capture_output=True, text=True, check=True).stdout
        use_nvenc = "h264_nvenc" in encoders
        for source in candidates:
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=source.parent, suffix=".tmp.mp4", delete=False) as stream:
                    temporary = Path(stream.name)
                common = [str(self.ffmpeg), "-y", "-i", str(source), "-vf", "scale=1280:-2"]
                tail = ["-preset", "fast", "-acodec", "aac", "-b:a", "128k", str(temporary)]
                cpu = common + ["-vcodec", "libx264", "-crf", "28"] + tail
                if use_nvenc:
                    try:
                        subprocess.run(common + ["-vcodec", "h264_nvenc", "-qp", "28"] + tail, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    except subprocess.CalledProcessError:
                        subprocess.run(cpu, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else:
                    subprocess.run(cpu, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                original_size = source.stat().st_size
                if temporary.stat().st_size == 0:
                    raise ValueError("FFmpeg generó un archivo vacío")
                if temporary.stat().st_size >= original_size:
                    self.record(source, VIDEO_PRESET, result="unchanged")
                    print("Sin reducción: " + self.url(source))
                    continue
                self.backup_file(source, self.legacy_dir / "public" / source.relative_to(self.public_dir))
                self.record(source, VIDEO_PRESET, temporary, result="optimized")
                os.replace(temporary, source)
                print(f"Vídeo optimizado: {self.url(source)} ({original_size} -> {source.stat().st_size} bytes)")
            except Exception as error:
                self.errors += 1
                print("Error optimizando vídeo: " + str(error))
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)

    def update_presentations(self, renamed):
        if not renamed:
            return True
        catalog = self.data_dir / "presentations.json"
        if not catalog.exists():
            print("No existe presentations.json; se conservan los PNG hasta confirmar sus referencias.")
            return False
        def replace(value):
            if isinstance(value, dict):
                return {key: replace(item) for key, item in value.items()}
            if isinstance(value, list):
                return [replace(item) for item in value]
            if isinstance(value, str):
                path = value.replace("\\", "/")
                path = path.removeprefix("/public/").removeprefix("public/")
                target = renamed.get("/" + path.lstrip("/"))
                if target:
                    return target if value.startswith(("/", "public/", "public\\")) else target.lstrip("/")
            return value
        try:
            original = json.loads(catalog.read_text(encoding="utf-8"))
            updated = replace(original)
            if updated != original:
                self.backup_file(catalog, self.legacy_dir / "presentations.json.bak")
                write_json(catalog, updated)
            for old_url in renamed:
                (self.public_dir / old_url.lstrip("/")).unlink(missing_ok=True)
            return True
        except Exception as error:
            print("Error actualizando catálogo; se conservan los PNG: " + str(error))
            return False


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure") and str(sys.stdout.encoding).lower() != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Optimiza medios con índice de texto; no repite archivos cuyo contenido no cambió.")
    parser.add_argument("--only", choices=("all", "images", "videos"), default="all")
    parser.add_argument("--data-dir", help="Carpeta de datos; prioridad sobre SEFER_DATA_DIR y .env.local/.env")
    parser.add_argument("--dry-run", action="store_true", help="Muestra candidatos sin escribir archivos ni ejecutar FFmpeg")
    parser.add_argument("--no-backup", action="store_true", help="No genera copias legacy; el índice sigue evitando repeticiones")
    args = parser.parse_args(argv)
    try:
        optimizer = AssetOptimizer(args.data_dir, args.dry_run, not args.no_backup)
        print("Medios: " + str(optimizer.public_dir))
        if args.only in ("all", "images"):
            renamed = optimizer.optimize_images()
            if not args.dry_run and not optimizer.update_presentations(renamed):
                return 1
        if args.only in ("all", "videos"):
            optimizer.optimize_videos()
        return int(optimizer.errors > 0)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print("No se pudo completar la optimización: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
