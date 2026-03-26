import uvicorn
from api import app

if __name__ == "__main__":
    # 启动 FastAPI 服务
    print("正在启动 YOLOv11 Web 系统后端口...")
    uvicorn.run(app, host="0.0.0.0", port=8000)