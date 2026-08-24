import os
import shutil
import subprocess
from PIL import Image

PROJECT_DIR = r"c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter"
PUBLIC_DIR = os.path.join(PROJECT_DIR, "public")
LEGACY_DIR = os.path.join(PROJECT_DIR, "legacy")
DATA_DIR = os.path.abspath(os.environ.get("SEFER_DATA_DIR", os.path.join(PROJECT_DIR, "data.local")))
FFMPEG_PATH = os.path.join(PROJECT_DIR, "node_modules/ffmpeg-static/ffmpeg.exe")

def backup_and_optimize_images():
    print("--- OPTIMIZING IMAGES ---")
    modified_names = {}
    
    for root, dirs, files in os.walk(PUBLIC_DIR):
        for file in files:
            if file.lower().endswith(".png"):
                full_path = os.path.join(root, file)
                size_mb = os.path.getsize(full_path) / (1024 * 1024)
                
                # Optimize PNG files in backgrounds or videos folders
                if "backgrounds" in root or "videos" in root:
                    rel_path = os.path.relpath(full_path, PUBLIC_DIR)
                    legacy_path = os.path.join(LEGACY_DIR, "public", rel_path)
                    
                    os.makedirs(os.path.dirname(legacy_path), exist_ok=True)
                    
                    print(f"Backing up {file} ({size_mb:.2f} MB) to legacy...")
                    shutil.copy2(full_path, legacy_path)
                    
                    base_name, _ = os.path.splitext(file)
                    webp_file = base_name + ".webp"
                    webp_full_path = os.path.join(root, webp_file)
                    
                    print(f"Optimizing to WebP: {webp_file}...")
                    try:
                        with Image.open(full_path) as img:
                            if img.width > 1920:
                                new_height = int(img.height * (1920 / img.width))
                                img = img.resize((1920, new_height), Image.Resampling.LANCZOS)
                            img.save(webp_full_path, "WEBP", quality=80)
                        
                        os.remove(full_path)
                        
                        rel_dir = os.path.relpath(root, PUBLIC_DIR).replace("\\", "/")
                        old_rel_url = f"/{rel_dir}/{file}".replace("//", "/")
                        new_rel_url = f"/{rel_dir}/{webp_file}".replace("//", "/")
                        modified_names[old_rel_url] = new_rel_url
                        print(f"Success: {old_rel_url} -> {new_rel_url}")
                    except Exception as e:
                        print(f"Error optimizing {file}: {e}")
                        
    return modified_names

def is_nvenc_available():
    try:
        cmd = [FFMPEG_PATH, "-encoders"]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, check=True)
        return "h264_nvenc" in result.stdout
    except Exception:
        return False

def backup_and_optimize_videos():
    print("\n--- OPTIMIZING VIDEOS ---")
    use_nvenc = is_nvenc_available()
    if use_nvenc:
        print("NVIDIA NVENC hardware acceleration is available and will be used.")
    else:
        print("NVIDIA NVENC is not available. Using CPU encoder (libx264).")
    
    for root, dirs, files in os.walk(PUBLIC_DIR):
        for file in files:
            if file.lower().endswith(".mp4"):
                full_path = os.path.join(root, file)
                size_mb = os.path.getsize(full_path) / (1024 * 1024)
                
                # Compress MP4 files larger than 15MB
                if size_mb > 15.0:
                    rel_path = os.path.relpath(full_path, PUBLIC_DIR)
                    legacy_path = os.path.join(LEGACY_DIR, "public", rel_path)
                    
                    os.makedirs(os.path.dirname(legacy_path), exist_ok=True)
                    
                    print(f"Backing up heavy video {file} ({size_mb:.2f} MB) to legacy...")
                    shutil.copy2(full_path, legacy_path)
                    
                    temp_compressed_path = full_path + ".tmp.mp4"
                    
                    cmd_cpu = [
                        FFMPEG_PATH,
                        "-y",
                        "-i", full_path,
                        "-vf", "scale=1280:-2",
                        "-vcodec", "libx264",
                        "-crf", "28",
                        "-preset", "fast",
                        "-acodec", "aac",
                        "-b:a", "128k",
                        temp_compressed_path
                    ]
                    
                    cmd_nvenc = [
                        FFMPEG_PATH,
                        "-y",
                        "-i", full_path,
                        "-vf", "scale=1280:-2",
                        "-vcodec", "h264_nvenc",
                        "-qp", "28",
                        "-preset", "fast",
                        "-acodec", "aac",
                        "-b:a", "128k",
                        temp_compressed_path
                    ]
                    
                    try:
                        cmd_used = "CPU"
                        if use_nvenc:
                            print(f"Compressing video {file} (Targeting 720p @ NVENC QP 28)...")
                            try:
                                subprocess.run(cmd_nvenc, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                                cmd_used = "NVENC"
                            except Exception as nvenc_err:
                                print(f"NVENC failed, falling back to CPU: {nvenc_err}")
                                print(f"Compressing video {file} (Targeting 720p @ CPU CRF 28)...")
                                subprocess.run(cmd_cpu, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        else:
                            print(f"Compressing video {file} (Targeting 720p @ CPU CRF 28)...")
                            subprocess.run(cmd_cpu, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                            
                        os.replace(temp_compressed_path, full_path)
                        new_size_mb = os.path.getsize(full_path) / (1024 * 1024)
                        print(f"Compressed {file} ({cmd_used}): {size_mb:.2f} MB -> {new_size_mb:.2f} MB")
                    except Exception as e:
                        print(f"Error compressing {file}: {e}")
                        if os.path.exists(temp_compressed_path):
                            os.remove(temp_compressed_path)


def update_presentations_json(modified_names):
    if not modified_names:
        print("\nNo image references to update in presentations.json")
        return
        
    print("\n--- UPDATING PRESENTATIONS.JSON ---")
    presentations_path = os.path.join(DATA_DIR, "presentations.json")
    
    if not os.path.exists(presentations_path):
        print("presentations.json not found")
        return
        
    try:
        with open(presentations_path, "r", encoding="utf-8") as f:
            content = f.read()
            
        original_content = content
        for old_url, new_url in modified_names.items():
            old_variants = [
                old_url,
                old_url.replace("/", "\\"),
                "public" + old_url,
                "public" + old_url.replace("/", "\\"),
                "/public" + old_url,
                "/public" + old_url.replace("/", "\\")
            ]
            for variant in old_variants:
                content = content.replace(f'"{variant}"', f'"{new_url}"')
                content = content.replace(f'"{variant.lstrip("/")}"', f'"{new_url.lstrip("/")}"')
                
        if content != original_content:
            os.makedirs(LEGACY_DIR, exist_ok=True)
            shutil.copy2(presentations_path, os.path.join(LEGACY_DIR, "presentations.json.bak"))
            with open(presentations_path, "w", encoding="utf-8") as f:
                f.write(content)
            print("Successfully updated image references in presentations.json!")
        else:
            print("No matching references found/updated in presentations.json")
    except Exception as e:
        print(f"Error updating presentations.json: {e}")

if __name__ == "__main__":
    modified_images = backup_and_optimize_images()
    backup_and_optimize_videos()
    update_presentations_json(modified_images)
    print("\n--- OPTIMIZATION COMPLETE ---")
