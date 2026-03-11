import os
import shutil
import uuid
from typing import List
from datetime import datetime 
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from fastapi import Body
from fastapi import Form

# 引入配置和业务服务
from core.config import settings
from services.yolo_service import yolo_service
from services.db_service import db_service
from services.inference_service import batch_predict_generator, handle_single_predict


current_model_name = settings.DEFAULT_MODEL_NAME # 当前模型名称
app = FastAPI(title="YOLOv11 Web System")

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载静态目录
app.mount("/static", StaticFiles(directory=settings.STATIC_DIR), name="static")

@app.get("/models")
def get_models():
    """扫描文件夹，返回所有可用模型"""
    models = {
        "raw": [],
        "yolo": [],
        "trained": []
    }
    
    # 遍历配置好的文件夹
    for category, path in settings.MODEL_DIRS.items():
        if os.path.exists(path):
            files = [f for f in os.listdir(path) if f.endswith('.pt')]
            models[category] = files
            
    return {"models": models, "current_model": current_model_name}

@app.post("/switch_model")
def switch_model(model_name: str = Form(...), category: str = Form(...)):
    """切换模型"""
    global current_model_name
    try:
        yolo_service.load_model(model_name, category)
        current_model_name = model_name # 更新全局状态
        return {"status": "success", "current_model": current_model_name}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# 根目录
@app.get("/")
def read_root():
    return {"message": "YOLO System Ready", "models_path": settings.MODELS_ROOT}

@app.post("/upload_model")
async def upload_model(file: UploadFile = File(...), custom_name: str = Form(...)):
    """上传并重命名模型到 yolo 目录"""
    # 强制加上 .pt 后缀
    if not custom_name.endswith(".pt"):
        custom_name += ".pt"
    
    save_path = os.path.join(settings.MODEL_DIRS['yolo'], custom_name)
    
    # 保存文件
    with open(save_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    return {"status": "success", "filename": custom_name}

@app.post("/rename_model")
def rename_model(
    old_name: str = Body(...), 
    new_name: str = Body(...), 
    category: str = Body(...)
):
    """重命名模型文件"""
    # 1. 安全检查：禁止重命名 raw 目录下的官方模型
    if category == "raw":
        raise HTTPException(status_code=403, detail="禁止修改内置基础模型")
    
    # 2. 检查后缀
    if not new_name.endswith(".pt"):
        new_name += ".pt"
        
    # 3. 获取路径
    dir_path = settings.MODEL_DIRS.get(category)
    if not dir_path:
        raise HTTPException(status_code=400, detail="未知类别")
        
    old_path = os.path.join(dir_path, old_name)
    new_path = os.path.join(dir_path, new_name)
    
    # 4. 执行重命名
    if not os.path.exists(old_path):
        raise HTTPException(status_code=404, detail="原模型文件不存在")
        
    if os.path.exists(new_path):
        raise HTTPException(status_code=400, detail="新名称已存在，请换一个")
        
    try:
        os.rename(old_path, new_path)
        
        # 如果当前正在使用的模型被改名了，更新全局变量
        global current_model_name
        if current_model_name == old_name:
            current_model_name = new_name
            
        # 数据库里的历史记录也要同步更新 model_name 字段！
        from services.db_service import db_service
        # 调用更新方法
        db_service.update_model_name(old_name, new_name)
            
        return {"status": "success", "new_name": new_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/delete_model")
def delete_model(model_name: str, category: str):
    """删除模型文件"""
    if category == "raw":
        raise HTTPException(status_code=403, detail="禁止删除内置基础模型")
        
    dir_path = settings.MODEL_DIRS.get(category)
    file_path = os.path.join(dir_path, model_name)
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="模型文件不存在")
        
    try:
        os.remove(file_path)
        
        # 如果删除了当前模型，重置为默认模型
        global current_model_name
        if current_model_name == model_name:
            current_model_name = settings.DEFAULT_MODEL_NAME
            # 重新加载默认模型
            yolo_service.load_model(current_model_name, "raw")
            
        # 删除对应的数据库历史记录
        db_service.clear_history(model_name)
            
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 历史记录接口
@app.get("/history")
def get_history_api(model_name: str):
    return db_service.get_history(model_name)

# 清空历史记录接口
@app.delete("/history")
def clear_history_api(model_name: str):
    db_service.clear_history(model_name)
    return {"status": "all cleared"}

@app.delete("/history/{record_id}")
def delete_single_history(record_id: int):
    """删除单条历史记录"""
    try:
        db_service.delete_record(record_id)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 单张图片推理接口
@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    # 1. 验证
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File is not an image")

    try:
        # 2. 调用封装好的服务函数（包含保存、推理和存库）
        result = await handle_single_predict(file, current_model_name)
        return result
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

# 批量推理接口
@app.post("/predict_batch")
async def predict_batch(files: List[UploadFile] = File(...)):
    """
    批量推理接口（生产者-消费者模式 + SSE 实时推送）
    上限 99 张图片，逐张推理并推送进度
    """
    # 校验数量上限
    if len(files) > 99:
        raise HTTPException(
            status_code=400,
            detail="单次最多支持 99 张图片"
        )

    # 过滤非图片文件
    valid_files = []
    for f in files:
        if f.content_type and f.content_type.startswith("image/"):
            valid_files.append(f)

    if not valid_files:
        raise HTTPException(status_code=400, detail="未找到有效的图片文件")

    return StreamingResponse(
        batch_predict_generator(valid_files, current_model_name),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )

# 切换模型的接口
@app.post("/switch_model")
async def switch_model(model_name: str, category: str):
    """
    前端点击侧边栏模型时调用此接口
    """
    try:
        yolo_service.load_model(model_name, category)
        return {"message": f"Successfully switched to {model_name} ({category})"}
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)