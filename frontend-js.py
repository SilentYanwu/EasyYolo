import http.server
import socketserver
import os
import webbrowser
import sys
import random

# 设置前端目录路径
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "frontend")
PORT = 5500

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # 强制切换到前端目录
        # 使用 os.path.abspath 确保路径绝对正确
        super().__init__(*args, directory=os.path.abspath(FRONTEND_DIR), **kwargs)

    def end_headers(self):
        # 解决某些环境下的 CORS 问题 (虽然前端通常不需要，但为了保险)
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

def run_server():
    if not os.path.exists(FRONTEND_DIR):
        print(f"❌ 错误: 找不到前端目录 {FRONTEND_DIR}")
        return

    # 生成20个可用端口列表
    available_ports = list(range(PORT, PORT + 20))
    # 随机打乱端口顺序
    random.shuffle(available_ports)
    
    httpd = None
    used_port = None

    for port in available_ports:
        try:
            # 允许地址重用，减少 "端口被占用" 的报错
            socketserver.TCPServer.allow_reuse_address = True
            httpd = socketserver.TCPServer(("", port), Handler)
            used_port = port
            break
        except OSError:
            print(f"⚠️ 端口 {port} 已被占用，尝试下一个...")
            continue

    if not httpd:
        print(f"❌ 错误: 无法启动服务器，端口范围 {PORT}-{PORT+19} 均被占用。请手动关闭占用端口的进程，或更改 PORT 变量。")
        return

    print(f"🚀 EasyYolo 前端服务器启动成功！")
    print(f"📂 正在提供服务: {os.path.abspath(FRONTEND_DIR)}")
    print(f"🔗 访问地址: http://localhost:{used_port}")
    print(f"💡 随机端口机制已启用，有助于避免浏览器缓存问题")
    
    webbrowser.open(f"http://localhost:{used_port}")

    try:
        print("\n提示: 按 Ctrl+C 可停止服务器")
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n\n🛑 正在停止服务器...")
        httpd.shutdown()
        httpd.server_close()
        print("✅ 服务器已成功停止")
        sys.exit(0)

if __name__ == "__main__":
    run_server()
