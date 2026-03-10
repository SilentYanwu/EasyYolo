"""
batch_service.py — 批量推理服务（生产者-消费者队列）

职责：
  1. 接收多张图片文件，放入 asyncio.Queue（生产者）
  2. 逐张取出推理并写入数据库（消费者）
  3. 通过 SSE 实时推送进度和结果
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


async def _save_upload_file(file: UploadFile) -> tuple[str, str]:
    """
    保存上传文件到 uploads 目录，返回 (文件磁盘路径, 唯一文件名)
    """
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
    unique_filename = f"{timestamp}_{file.filename}"
    file_path = os.path.join(settings.UPLOAD_DIR, unique_filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return file_path, unique_filename


def _predict_single(file_path: str, unique_filename: str, conf: float = 0.25) -> dict:
    """
    同步推理单张图片（将在线程中执行）
    返回包含 URL 和检测结果的字典
    """
    result_filename = f"result_{unique_filename}"
    result_path = os.path.join(settings.RESULT_DIR, result_filename)

    original_url = f"http://127.0.0.1:8000/static/uploads/{unique_filename}"
    result_url = f"http://127.0.0.1:8000/static/results/{result_filename}"

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

    # --- 生产者：将所有文件放入队列 ---
    for file in files:
        await queue.put(file)

    # --- 消费者：逐个取出处理 ---
    for i in range(1, total + 1):
        file = await queue.get()

        try:
            # 保存文件
            file_path, unique_filename = await _save_upload_file(file)

            # 在线程中执行 CPU/GPU 密集的推理
            result = await asyncio.to_thread(
                _predict_single, file_path, unique_filename
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

    # SSE 事件：全部完成
    yield f"data: {json.dumps({'done': True, 'total': total})}\n\n"
