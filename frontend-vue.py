
import os
import subprocess
import sys
import webbrowser
import time
import threading
import socket
import random

def find_available_port(start_port=5173, max_attempts=100):
    """查找可用的端口"""
    for i in range(max_attempts):
        port = start_port + i
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('localhost', port))
                return port
        except OSError:
            continue
    raise Exception("无法找到可用端口")

def start_frontend():
    # 获取当前脚本所在目录
    script_dir = os.path.dirname(os.path.abspath(__file__))
    # frontend-vue目录路径
    frontend_dir = os.path.join(script_dir, 'frontend-vue')

    # 检查frontend-vue目录是否存在
    if not os.path.exists(frontend_dir):
        print(f"错误: 找不到 {frontend_dir} 目录")
        sys.exit(1)

    # 检查node_modules是否存在，如果不存在则提示安装依赖
    node_modules_path = os.path.join(frontend_dir, 'node_modules')
    if not os.path.exists(node_modules_path):
        print("检测到未安装依赖，正在安装依赖...")
        subprocess.run(['npm', 'install'], cwd=frontend_dir, shell=True)

    # 查找可用端口
    port = find_available_port()
    print(f"🔌 使用端口: {port}")

    # 启动开发服务器
    print("🚀 正在启动 frontend-vue 开发服务器...")
    print(f"📂 项目路径: {frontend_dir}")
    
    # 定义打开浏览器的函数
    def open_browser():
        # 等待服务器启动
        time.sleep(1)
        # 打开浏览器访问开发服务器，添加时间戳避免缓存
        timestamp = int(time.time())
        webbrowser.open(f"http://localhost:{port}/?_t={timestamp}")
    
    # 在新线程中打开浏览器
    browser_thread = threading.Thread(target=open_browser)
    browser_thread.daemon = True
    browser_thread.start()
    
    try:
        subprocess.run(['npm', 'run', 'dev'], cwd=frontend_dir, shell=True)
    except KeyboardInterrupt:
        print("\n开发服务器已停止")
    except Exception as e:
        print(f"启动失败: {e}")
        sys.exit(1)

if __name__ == "__main__":
    start_frontend()
