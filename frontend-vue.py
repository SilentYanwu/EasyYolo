# frontend-vue.py - 启动 Vue 前端开发服务器，自动安装依赖并打开浏览器
import os
import subprocess
import sys
import webbrowser
import time
import threading
import socket
import random
import hashlib

# 生成基于时间的缓存破坏标识符
def cache_buster():
    """生成防缓存标识符：时间戳 + 随机数，确保每次启动都唯一"""
    now = str(time.time()).encode()
    rand = str(random.randint(0, 99999)).encode()
    return hashlib.md5(now + rand).hexdigest()[:12]

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
    # 生成本次启动的防缓存标识
    bust = cache_buster()

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

        # 安装element-plus和axios
        print("正在安装 element-plus 和 axios...")
        subprocess.run(['npm', 'install', 'element-plus', 'axios'], cwd=frontend_dir, shell=True)

    # 查找可用端口
    port = find_available_port()
    print(f"缓存标识: {bust}")
    print(f"使用端口: {port}")

    # 启动开发服务器
    print("正在启动 frontend-vue 开发服务器...")
    print(f"项目路径: {frontend_dir}")

    # 定义打开浏览器的函数
    def open_browser():
        time.sleep(1.5)
        # 双重防缓存：时间戳 + 哈希标识
        url = f"http://localhost:{port}/?_t={bust}"
        print(f"打开浏览器: {url}")
        webbrowser.open(url)

    # 在新线程中打开浏览器
    browser_thread = threading.Thread(target=open_browser)
    browser_thread.daemon = True
    browser_thread.start()

    try:
        # 设置 VITE_CACHE_BUSTER 环境变量，Vite 可在 index.html 中引用
        env = os.environ.copy()
        env['VITE_CACHE_BUSTER'] = bust
        subprocess.run(['npm', 'run', 'dev'], cwd=frontend_dir, env=env, shell=True)
    except KeyboardInterrupt:
        print("\n开发服务器已停止")
    except Exception as e:
        print(f"启动失败: {e}")
        sys.exit(1)

if __name__ == "__main__":
    start_frontend()
