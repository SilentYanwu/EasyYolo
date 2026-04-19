import uvicorn
from backend.app.api import app

if __name__ == "__main__":
    # 启动 FastAPI 服务
    print("=" * 50)
    print("正在启动 YOLOv11 Web 系统后端口...")
    print("=" * 50)
    print("\n服务信息:")
    print(f"  - 访问地址: http://localhost:8000")
    print(f"  - API 文档: http://localhost:8000/docs")
    print(f"  - Swagger UI: http://localhost:8000/docs")
    print(f"  - ReDoc: http://localhost:8000/redoc")
    print("\n操作提示:")
    print("  - 按 Ctrl+C 停止服务")
    print("=" * 50)
    print("\n")
    
    uvicorn.run(app, host="0.0.0.0", port=8000)
