#!/usr/bin/env python3
"""
项目结构生成脚本
运行方式: python generate_structure.py
"""

import os
from pathlib import Path
import datetime

# 配置项
OUTPUT_FILE = "项目结构.txt"  # 输出文件名
IGNORE_FOLDERS = {  # 要忽略的文件夹
    '__pycache__',
    'venv',
    '.venv',
    'env',
    '.env',
    'node_modules',
    '.git',
    '.idea',
    '.vscode',
    'dist',
    'build',
    '*.egg-info',
    '.pytest_cache',
    '.mypy_cache',
    '.tox'
}

IGNORE_FILES = {  # 要忽略的文件
    '.DS_Store',
    '*.pyc',
    '*.pyo',
    '*.pyd',
    '.gitignore',
    '.env.example',
    '*.log',
    '*.tmp',
    '*.temp'
}

def should_ignore(name, is_dir=False):
    """检查是否应该忽略该文件/文件夹"""
    if is_dir:
        return name in IGNORE_FOLDERS
    else:
        # 检查文件是否匹配忽略模式
        if name in IGNORE_FILES:
            return True
        # 检查通配符模式
        for pattern in IGNORE_FILES:
            if pattern.startswith('*') and name.endswith(pattern[1:]):
                return True
    return False

def get_tree_structure(start_path, prefix=""):
    """
    递归生成树形结构
    """
    if not os.path.exists(start_path):
        return ""
    
    items = []
    try:
        # 获取所有项目并排序（文件夹在前，文件在后）
        all_items = sorted(os.listdir(start_path))
        
        # 分离文件夹和文件
        dirs = []
        files = []
        for item in all_items:
            full_path = os.path.join(start_path, item)
            if os.path.isdir(full_path):
                if not should_ignore(item, is_dir=True):
                    dirs.append(item)
            else:
                if not should_ignore(item, is_dir=False):
                    files.append(item)
        
        # 合并：先文件夹，后文件
        sorted_items = dirs + files
        
        for i, item in enumerate(sorted_items):
            full_path = os.path.join(start_path, item)
            is_last = (i == len(sorted_items) - 1)
            
            # 选择连接符号
            if is_last:
                connector = "└── "
                new_prefix = prefix + "    "
            else:
                connector = "├── "
                new_prefix = prefix + "│   "
            
            # 添加当前项
            if os.path.isdir(full_path):
                items.append(f"{prefix}{connector}{item}/")
                # 递归处理子目录
                items.extend(get_tree_structure(full_path, new_prefix))
            else:
                # 获取文件大小
                size = os.path.getsize(full_path)
                size_str = format_file_size(size)
                items.append(f"{prefix}{connector}{item} ({size_str})")
    
    except PermissionError:
        items.append(f"{prefix}└── [权限不足]")
    
    return items

def format_file_size(size_bytes):
    """格式化文件大小"""
    if size_bytes == 0:
        return "0 B"
    
    size_names = ["B", "KB", "MB", "GB", "TB"]
    i = 0
    while size_bytes >= 1024 and i < len(size_names) - 1:
        size_bytes /= 1024.0
        i += 1
    
    return f"{size_bytes:.1f} {size_names[i]}"

def count_files_and_folders(start_path):
    """统计文件和文件夹数量"""
    file_count = 0
    folder_count = 0
    
    for root, dirs, files in os.walk(start_path):
        # 过滤忽略的文件夹
        dirs[:] = [d for d in dirs if not should_ignore(d, is_dir=True)]
        
        # 统计文件夹
        folder_count += len(dirs)
        
        # 统计文件
        for file in files:
            if not should_ignore(file, is_dir=False):
                file_count += 1
    
    return folder_count, file_count

def generate_project_structure():
    """生成项目结构文件"""
    
    # 获取当前目录
    current_dir = os.getcwd()
    project_name = os.path.basename(current_dir)
    
    # 生成树形结构
    print(f"正在生成 {project_name} 的项目结构...")
    
    tree_lines = get_tree_structure(current_dir)
    
    # 统计文件数量
    folder_count, file_count = count_files_and_folders(current_dir)
    
    # 写入文件
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        # 写入头部信息
        f.write("=" * 60 + "\n")
        f.write(f"项目结构: {project_name}\n")
        f.write(f"生成时间: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"统计信息: {folder_count} 个文件夹, {file_count} 个文件\n")
        f.write("=" * 60 + "\n\n")
        
        # 写入树形结构
        f.write(f"{project_name}/\n")
        for line in tree_lines:
            f.write(line + "\n")
        
        # 写入忽略说明
        f.write("\n" + "=" * 60 + "\n")
        f.write("忽略的文件夹/文件:\n")
        f.write(f"文件夹: {', '.join(sorted(IGNORE_FOLDERS))}\n")
        f.write(f"文件: {', '.join(sorted(IGNORE_FILES))}\n")
        f.write("=" * 60 + "\n")
    
    print(f"✅ 项目结构已生成到 {OUTPUT_FILE}")
    print(f"📊 统计: {folder_count} 个文件夹, {file_count} 个文件")

def main():
    """主函数"""
    try:
        generate_project_structure()
        
        # 询问是否查看文件内容
        response = input("\n是否要查看生成的文件内容？(y/n): ").lower()
        if response == 'y':
            print("\n" + "=" * 60)
            print(f"📄 {OUTPUT_FILE} 内容预览:")
            print("=" * 60)
            
            with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
                content = f.read()
                # 只显示前500个字符
                if len(content) > 500:
                    print(content[:500])
                    print("... (内容已截断)")
                else:
                    print(content)
    
    except Exception as e:
        print(f"❌ 生成失败: {e}")

if __name__ == "__main__":
    main()