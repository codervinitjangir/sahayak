import os

# Folders to completely skip walking inside
SKIP_DIRS = {
    "venv", ".venv", "env", ".env", ".git", "__pycache__", 
    "node_modules", ".idea", ".vscode", "build", "dist", 
    "site-packages", ".pytest_cache", ".mypy_cache", "htmlcov", 
    ".ruff_cache", "results"
}

# Code and config extensions whose content we want to read
CODE_EXTENSIONS = {
    ".py", ".md", ".txt", ".json", ".yaml", ".yml", 
    ".toml", ".ini", ".cfg", ".sh", ".bat", ".ps1", 
    ".html", ".css", ".js", ".sql"
}

# Exact filenames without extension (or special files) to include
EXACT_INCLUDE_FILES = {
    "Dockerfile", "requirements.txt"
}

# Secret exact filenames or files to never export
EXPLICIT_SECRETS = {
    "secrets.json", "credentials.json", "export_code.py", 
    "token.tmp", "load-context.json"
}

MAX_FILE_SIZE_BYTES = 500 * 1024  # Skip dumping files larger than 500 KB
OUTPUT_FILE = "sahayak_backend_context.txt"

def is_secret_file(filename: str) -> bool:
    """Check if file should be kept secret / skipped."""
    lower = filename.lower()
    # Check exact secret names
    if lower in EXPLICIT_SECRETS:
        return True
    # Ignore any .env file EXCEPT .env.example
    if lower.startswith(".env") and lower != ".env.example":
        return True
    # Ignore sensitive private keys and sqlite databases
    if lower.endswith((".key", ".pem", ".p12", ".db", ".sqlite", ".sqlite3")):
        return True
    return False

def is_code_file(filename: str) -> bool:
    """Check if file should be included in source code dump."""
    if filename in EXACT_INCLUDE_FILES:
        return True
    ext = os.path.splitext(filename)[1].lower()
    return ext in CODE_EXTENSIONS

def format_size(size_bytes: int) -> str:
    size = float(size_bytes)
    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024.0:
            return f"{size:.1f} {unit}"
        size /= 1024.0
    return f"{size:.1f} TB"

def export_project():
    root_dir = os.path.abspath(".")
    tree_lines = ["=== PROJECT DIRECTORY TREE (WITH FILE SIZES) ==="]
    code_files_to_read = []

    for current_path, dirs, files in os.walk(root_dir):
        # Remove skipped directories in-place so os.walk doesn't enter them
        dirs[:] = sorted([d for d in dirs if d not in SKIP_DIRS])
        
        rel_dir = os.path.relpath(current_path, root_dir)
        depth = 0 if rel_dir == "." else rel_dir.count(os.sep) + 1
        indent = "  " * depth
        
        if rel_dir != ".":
            tree_lines.append(f"{indent}[DIR] {os.path.basename(current_path)}/")

        for f in sorted(files):
            if f == OUTPUT_FILE:
                continue
            full_path = os.path.join(current_path, f)
            rel_path = os.path.relpath(full_path, root_dir)
            try:
                size = os.path.getsize(full_path)
            except OSError:
                size = 0
                
            tree_lines.append(f"{indent}  - {f} ({format_size(size)})")
            
            # Check eligibility for content inclusion
            if not is_secret_file(f) and is_code_file(f) and size <= MAX_FILE_SIZE_BYTES:
                code_files_to_read.append((rel_path, full_path))

    with open(OUTPUT_FILE, "w", encoding="utf-8", errors="ignore") as out:
        # 1. Write the full tree so the AI sees all models, assets, and structure
        out.write("\n".join(tree_lines))
        out.write("\n\n" + "=" * 60 + "\n")
        out.write("=== SOURCE CODE FILES ===\n")
        out.write("=" * 60 + "\n\n")

        # 2. Write the contents of each code file
        for rel_path, full_path in code_files_to_read:
            out.write(f"\n--- FILE: {rel_path} ---\n")
            try:
                with open(full_path, "r", encoding="utf-8", errors="replace") as src:
                    out.write(src.read())
            except Exception as e:
                out.write(f"[Error reading file: {e}]")
            out.write("\n")

    final_size = format_size(os.path.getsize(OUTPUT_FILE))
    print(f"[OK] Done! Extracted {len(code_files_to_read)} code files into '{OUTPUT_FILE}' ({final_size}).")

if __name__ == "__main__":
    export_project()
