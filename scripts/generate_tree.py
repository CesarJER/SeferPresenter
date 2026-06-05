import os

def format_size(size_in_bytes):
    if size_in_bytes < 1024:
        return f"{size_in_bytes} B"
    elif size_in_bytes < 1024 * 1024:
        return f"{size_in_bytes / 1024:.1f} KB"
    else:
        return f"{size_in_bytes / (1024 * 1024):.1f} MB"

def generate_tree(dir_path, exclude_dirs=None, exclude_files=None):
    if exclude_dirs is None:
        exclude_dirs = {'.git', 'node_modules', 'dist', '__pycache__'}
    if exclude_files is None:
        exclude_files = {'.DS_Store', 'thumbs.db'}
        
    lines = []
    
    def walk(current_dir, prefix=""):
        try:
            items = sorted(os.listdir(current_dir))
        except PermissionError:
            return
            
        # Filter items
        filtered_items = []
        for item in items:
            full_path = os.path.join(current_dir, item)
            if os.path.isdir(full_path):
                if item in exclude_dirs:
                    continue
            else:
                if item in exclude_files:
                    continue
            filtered_items.append(item)
            
        count = len(filtered_items)
        for i, item in enumerate(filtered_items):
            full_path = os.path.join(current_dir, item)
            is_last = (i == count - 1)
            connector = "└── " if is_last else "├── "
            
            if os.path.isdir(full_path):
                lines.append(f"{prefix}{connector}{item}/")
                extension = "    " if is_last else "│   "
                walk(full_path, prefix + extension)
            else:
                try:
                    size = os.path.getsize(full_path)
                    size_str = f" ({format_size(size)})"
                except Exception:
                    size_str = ""
                lines.append(f"{prefix}{connector}{item}{size_str}")
                
    lines.append(os.path.basename(os.path.normpath(dir_path)) + "/")
    walk(dir_path)
    return "\n".join(lines)

if __name__ == "__main__":
    project_path = r"c:/Users/cesae/Desktop/Tanaj/SeferProyect/SeferPresenter"
    tree_text = generate_tree(project_path)
    
    output_path = os.path.join(project_path, "legacy/estructura_ficheros.txt")
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(tree_text)
        
    print(f"Tree structure with sizes successfully written to {output_path}")
