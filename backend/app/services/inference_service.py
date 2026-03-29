"""
inference_service.py — 识别流程封装服务

职责：
1.识别单张图片
2.识别多张图片

"""

import os
import json
import shutil
import asyncio
from datetime import datetime
from fastapi import UploadFile

from core.config import settings
from services.yolo_service import yolo_service
from services.db_service import db_service


async def save_upload_file(file: UploadFile) -> tuple[str, str]:
    """
    保存上传文件到 uploads 目录，返回 (文件磁盘路径, 唯一文件名)
    """
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
    unique_filename = f"{timestamp}_{file.filename}"
    file_path = os.path.join(settings.UPLOAD_DIR, unique_filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return file_path, unique_filename


def predict_single(file_path: str, unique_filename: str, conf: float = 0.25) -> dict:
    """
    同步推理单张图片
    返回包含 URL 和检测结果的字典
    """
    result_filename = f"result_{unique_filename}"
    result_path = os.path.join(settings.RESULT_DIR, result_filename)

    original_url = f"http://127.0.0.1:8000/inferecord/uploads/{unique_filename}"
    result_url = f"http://127.0.0.1:8000/inferecord/results/{result_filename}"

    detections_json = yolo_service.predict_image(
        source_path=file_path,
        save_path=result_path,
        conf=conf
    )

    return {
        "original_url": original_url,
        "result_url": result_url,
        "detections": detections_json,
    }


async def handle_single_predict(file: UploadFile, model_name: str, conf: float = 0.25) -> dict:
    """
    封装单张图片的完整流程：保存 -> 推理 -> 存库
    """
    # 1. 保存文件
    file_path, unique_filename = await save_upload_file(file)

    # 2. 推理 (使用 to_thread 防止阻塞主线程)
    result = await asyncio.to_thread(
        predict_single, file_path, unique_filename, conf
    )

    # 3. 写入数据库
    db_service.add_record(
        model_name,
        result["original_url"],
        result["result_url"]
    )

    return result


async def batch_predict_generator(
    files: list[UploadFile],
    model_name: str,
):
    """
    生产者-消费者批量推理生成器，作为 SSE 事件流输出。

    流程：
      - 生产者：将所有文件对象放入 asyncio.Queue
      - 消费者：逐个取出 → 保存 → 推理(线程) → 写DB → yield SSE 事件

    每条事件格式（JSON）：
      成功: {"current": 3, "total": 10, "original_url": "...", "result_url": "..."}
      失败: {"current": 3, "total": 10, "error": "错误信息", "filename": "xxx.jpg"}
      完成: {"done": true, "total": 10}
    """
    total = len(files)
    queue: asyncio.Queue[UploadFile] = asyncio.Queue()

    # 生产者：将所有文件放入队列
    for file in files:
        await queue.put(file)

    # 消费者：逐个取出处理
    for i in range(1, total + 1):
        file = await queue.get()

        try:
            # 保存文件
            file_path, unique_filename = await save_upload_file(file)

            # 在线程中执行 CPU/GPU 密集的推理
            result = await asyncio.to_thread(
                predict_single, file_path, unique_filename
            )

            # 写入数据库
            db_service.add_record(
                model_name,
                result["original_url"],
                result["result_url"]
            )

            # SSE 事件：成功
            event_data = {
                "current": i,
                "total": total,
                "original_url": result["original_url"],
                "result_url": result["result_url"],
            }
            yield f"data: {json.dumps(event_data, ensure_ascii=False)}\n\n"
            # 处理单个文件的结果，在循环中多次执行

        except Exception as e:
            # SSE 事件：单张失败，不中断批次
            event_data = {
                "current": i,
                "total": total,
                "error": str(e),
                "filename": file.filename or "unknown",
            }
            yield f"data: {json.dumps(event_data, ensure_ascii=False)}\n\n"

        finally:
            queue.task_done()

    # SSE 事件：全部完成，通知前端
    yield f"data: {json.dumps({'done': True, 'total': total})}\n\n"


async def video_predict_generator(file: UploadFile, model_name: str, conf: float = 0.25):
    """
    视频识别生成器 (SSE)
    """
    print(f"Received video upload: {file.filename}, type: {file.content_type}")
    # 1. 保存上传的原始视频
    file_path, unique_filename = await save_upload_file(file)
    print(f"Video saved to: {file_path}")
    
    result_filename = f"result_{unique_filename}"
    # 强制后缀为 .mp4 以便浏览器播放 (CV2 VideoWriter 指定了 mp4v)
    if not result_filename.endswith(".mp4"):
        result_filename = os.path.splitext(result_filename)[0] + ".mp4"
    
    result_path = os.path.join(settings.RESULT_DIR, result_filename)
    
    original_url = f"http://127.0.0.1:8000/inferecord/uploads/{unique_filename}"
    result_url = f"http://127.0.0.1:8000/inferecord/results/{result_filename}"

    try:
        # 2. 在线程中运行视频处理生成器
        print("Starting video processing...")
        
        for current, total in yolo_service.predict_video_stream(file_path, result_path, conf):
            percent = int((current / total) * 100) if total > 0 else 0
            # SSE 事件：进度更新
            event_data = {
                "current_frame": current,
                "total_frames": total,
                "percent": percent,
                "status": "processing"
            }

            # 稍微停顿一下，让事件能发出去，给前端机会更新 UI
            await asyncio.sleep(0.02)
            yield f"data: {json.dumps(event_data, ensure_ascii=False)}\n\n"


        # 3. 处理完成后存入数据库
        db_service.add_record(
            model_name,
            original_url,
            result_url
        )

        # 4. 发送已完成事件
        final_data = {
            "done": True,
            "original_url": original_url,
            "result_url": result_url,
            "status": "completed"
        }
        yield f"data: {json.dumps(final_data, ensure_ascii=False)}\n\n"

    except Exception as e:
        import traceback
        traceback.print_exc()
        yield f"data: {json.dumps({'error': str(e), 'status': 'failed'})}\n\n"
