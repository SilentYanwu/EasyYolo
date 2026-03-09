import os

class Settings:
    # 1. 定位项目根目录 YoloWebSystem/
    # __file__ 是 config.py，往上找 3 层到达 backend 外面
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

    # 2. 定义模型相关路径
    MODELS_ROOT = os.path.join(BASE_DIR, "models")
    MODEL_DIRS = {
        "raw": os.path.join(MODELS_ROOT, "raw"),       # 原始权重 (yolo11n.pt)
        "yolo": os.path.join(MODELS_ROOT, "yolo"),     # 内置特定模型
        "trained": os.path.join(MODELS_ROOT, "trained") # 用户训练的模型
    }

    # 3. 定义静态资源路径 (用于图片上传和结果)
    # 这里保持在 backend/static
    BACKEND_DIR = os.path.join(BASE_DIR, "backend")
    STATIC_DIR = os.path.join(BACKEND_DIR, "static")
    UPLOAD_DIR = os.path.join(STATIC_DIR, "uploads")
    RESULT_DIR = os.path.join(STATIC_DIR, "results")

    # 4. 默认模型
    DEFAULT_MODEL_NAME = "yolo11n.pt"

settings = Settings()

# 自动创建必要的文件夹，防止报错
for path in settings.MODEL_DIRS.values():
    os.makedirs(path, exist_ok=True)
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
os.makedirs(settings.RESULT_DIR, exist_ok=True)