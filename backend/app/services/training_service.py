import os
import shutil
import json
import zipfile
import threading
import time
import gc
import torch
from datetime import datetime
from fastapi import UploadFile, HTTPException
from ultralytics import YOLO

from backend.app.core.config import settings
from backend.app.services.db_service import db_service

# 全局训练状态单例 (只允许同时跑一个训练任务)
training_state = {
    "model_name": None,       # 正在训练的新模型名字
    "status": "idle",         # 'idle', 'training', 'success', 'error', 'stopped'
    "progress": 0,            # 当前 Epoch
    "total": 0,               # 总 Epochs
    "metrics": {},            # 实时指标 (如 box_loss, mAP50)
    "eta": "计算中...",       # 预计剩余时间
    "error_msg": "",          # 错误信息
    "start_time": 0,          # 训练开始时间戳
    "last_epoch_time": 0,     # 上一轮结束时间戳
    "early_stopped": False,   # 是否早停完成
    "early_stop_epoch": 0     # 早停时的轮次
}

# 训练停止事件
stop_training_event = threading.Event()

class TrainingService:

    def __init__(self):
        # 确保目录存在
        os.makedirs(settings.DATASETS_DIR, exist_ok=True)
        os.makedirs(settings.TRAINCHART_DIR, exist_ok=True)

    def extract_and_validate_dataset(self, file: UploadFile) -> str:
        """
        保存上传的 zip 文件，解压到 datasets 目录，校验是否包含 data.yaml
        返回数据集目录名
        """
        # 获取不含后缀的名字作为目录名
        dataset_name = os.path.splitext(file.filename)[0]
        dataset_path = os.path.join(settings.DATASETS_DIR, dataset_name)
        zip_path = os.path.join(settings.DATASETS_DIR, file.filename)

        # 1. 保存 zip
        with open(zip_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        try:
            # 2. 解压 zip
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                # 为了防止 zip 内部自带一层同名文件夹，如果解压后 data.yaml 不在根目录而在子目录
                # 会较难处理。这里简单解压到指定目录。
                zip_ref.extractall(dataset_path)
            
            # 删除原始压缩包
            os.remove(zip_path)

            # 3. 寻找 data.yaml
            # 可能是 datasets/coco/data.yaml，也可能是 datasets/coco/coco/data.yaml
            data_yaml = None
            for root, dirs, files in os.walk(dataset_path):
                if "data.yaml" in files:
                    data_yaml = os.path.join(root, "data.yaml")
                    break

            if not data_yaml:
                # 校验失败，删除无效的数据集目录
                shutil.rmtree(dataset_path, ignore_errors=True)
                raise HTTPException(status_code=400, detail="未找到 data.yaml！请确保压缩包格式正确且为有效的 YOLO 数据集。")
            
            # 返回实际包含 data.yaml 的相对于 DATASETS_DIR 的路径
            # 为了后续训练方便，直接使用包含 data.yaml 的绝对目录
            actual_dataset_dir = os.path.dirname(data_yaml)
            return actual_dataset_dir.replace("\\", "/")

        except zipfile.BadZipFile:
            os.remove(zip_path)
            raise HTTPException(status_code=400, detail="压缩包损坏或不是有效的 zip 文件。")
        except Exception as e:
            if os.path.exists(zip_path):
                os.remove(zip_path)
            raise HTTPException(status_code=500, detail=f"数据集处理失败: {str(e)}")

    def start_training_task(self, model_name: str, base_model: str, dataset_yaml_path: str, params: dict, description: str = ""):
        """
        启动后台训练线程
        """
        if training_state["status"] == "training":
            raise HTTPException(status_code=400, detail="已有训练任务正在进行，请稍后再试")

        # 重置状态
        training_state["model_name"] = model_name
        training_state["status"] = "training"
        training_state["progress"] = 0
        training_state["total"] = int(params.get("epochs", 50))
        training_state["metrics"] = {}
        training_state["eta"] = "计算中..."
        training_state["error_msg"] = ""
        training_state["start_time"] = time.time()
        training_state["last_epoch_time"] = time.time()
        training_state["early_stopped"] = False
        training_state["early_stop_epoch"] = 0

        # 重置停止事件
        global stop_training_event
        stop_training_event.clear()

        # 启动后台线程执行 YOLO.train 以免阻塞事件循环
        t = threading.Thread(
            target=self._run_yolo_training, 
            args=(model_name, base_model, dataset_yaml_path, params, description)
        )
        t.start()
        # 立即返回响应，前端可以通过 /training_progress 接口轮询获取训练状态
        return {"status": "success", "message": "训练任务已启动"}

    def _run_yolo_training(self, model_name: str, base_model: str, dataset_yaml_path: str, params: dict, description: str):
        
        # 导入推理服务单例 (延迟导入避免循环引用)
        from backend.app.services.yolo_service import yolo_service

        # 0. 先释放推理模型占用的 GPU 显存，否则双模型会 OOM
        saved_model_name = yolo_service._current_model_name
        saved_category = yolo_service._current_category
        yolo_service.unload_model()

        # 定义临时运行目录，用于成功或失败后的清理
        run_dir = os.path.join(settings.BASE_DIR, "runs", "detect", model_name)

        try:
            # 1. 找到基础模型路径
            # 先猜 base_model 可能在哪个目录 (raw, yolo, trained)
            base_model_path = None
            for dir_path in settings.MODEL_DIRS.values():
                p = os.path.join(dir_path, base_model)
                if os.path.exists(p):
                    base_model_path = p
                    break
            
            if not base_model_path:
                raise Exception(f"未找到基础模型文件: {base_model}")

            # 2. 准备 YOLO 实例
            model = YOLO(base_model_path)

            # 辅助函数：模糊匹配指标字典中的 key
            # 不同版本的 YOLO 可能使用不同的 key 名 (如 metrics/mAP50(B) vs fitness/mAP50)
            # 此函数按关键词顺序查找，找到第一个包含关键词的 key 就返回其值
            def _fuzzy_get(metrics_dict, keywords, default=0):
                """在 metrics_dict 中按关键词模糊匹配，返回第一个命中的值"""
                for keyword in keywords:
                    for k, v in metrics_dict.items():
                        if keyword.lower() in k.lower():
                            try:
                                return round(float(v), 4)
                            except (TypeError, ValueError):
                                continue
                return default

            # 注册回调函数
            def _stop_now():
                global stop_training_event
                if stop_training_event.is_set():
                    training_state["status"] = "stopped"
                    training_state["error_msg"] = "训练被用户终止"
                    training_state["eta"] = "已停止"
                    raise RuntimeError("Training stopped by user")
            # 计算 ETA 的函数，根据每轮时间和剩余轮数估算
            def _compute_eta(current_epoch):
                """根据已用 epoch 时间计算预计剩余时间"""
                now = time.time()
                epoch_time = now - training_state["last_epoch_time"]
                training_state["last_epoch_time"] = now

                remaining_epochs = training_state["total"] - current_epoch
                eta_seconds = int(epoch_time * remaining_epochs)

                if eta_seconds > 3600:
                    return f"{eta_seconds // 3600}小时 {(eta_seconds % 3600) // 60}分钟"
                elif eta_seconds > 60:
                    return f"{eta_seconds // 60}分钟 {eta_seconds % 60}秒"
                return f"{eta_seconds}秒"
            
            # 提取训练指标
            def _extract_metrics(trainer):
                """从 trainer 中提取训练指标"""
                m = getattr(trainer, "metrics", {})

                tloss = getattr(trainer, "tloss", [0, 0, 0])
                if not isinstance(tloss, list) and not isinstance(tloss, tuple) and not type(tloss).__name__ == 'Tensor':
                    tloss = [0, 0, 0]

                box_loss = round(float(tloss[0]), 4) if len(tloss) > 0 else 0.0
                cls_loss = round(float(tloss[1]), 4) if len(tloss) > 1 else 0.0
                dfl_loss = round(float(tloss[2]), 4) if len(tloss) > 2 else 0.0

                return {
                    "mAP50": _fuzzy_get(m, ["mAP50(B)", "mAP50"], 0),
                    "mAP50-95": _fuzzy_get(m, ["mAP50-95(B)", "mAP50-95"], 0),
                    "Precision": _fuzzy_get(m, ["precision(B)", "precision"], 0),
                    "Recall": _fuzzy_get(m, ["recall(B)", "recall"], 0),
                    "Box Loss": box_loss,
                    "Cls Loss": cls_loss,
                    "Dfl Loss": dfl_loss,
                }

            # 回调函数中每batch开始的时候检查是否需要停止训练
            def on_train_batch_start(trainer):
                _ = trainer
                _stop_now()

            # 每epoch结束时更新进度和指标，并计算 ETA
            def on_train_epoch_end(trainer):
                current_epoch = getattr(trainer, "epoch", 0) + 1
                training_state["progress"] = current_epoch
                training_state["metrics"] = _extract_metrics(trainer)
                training_state["eta"] = _compute_eta(current_epoch)
                _stop_now()

            # 绑定回调
            model.add_callback("on_train_batch_start", on_train_batch_start)
            model.add_callback("on_train_epoch_end", on_train_epoch_end)

            # 3. 开始训练
            # 设置 output 跑在 runs 目录下，每个任务单独一个项目名，就叫 model_name
            actual_dataset_yaml_path = os.path.join(dataset_yaml_path, "data.yaml").replace("\\", "/")
            
            # 使用项目和名字参数，比如 runs/detect/model_name
            project_dir = os.path.join(settings.BASE_DIR, "runs", "detect").replace("\\", "/")
            training_kwargs = {
                "data": actual_dataset_yaml_path,
                "project": project_dir,
                "name": model_name,
                "exist_ok": True,
                "plots": True,  # 强制生成所有图表 (F1/P/R/PR 曲线 + labels_correlogram)
            }
            # 合并用户参数 (params里的字典解包)
            # 要确保 params 类型正确
            # 过滤掉无法序列化或无意义的选项
            for key in list(params.keys()):
                if params[key] == "":
                    del params[key]

            int_params = ["epochs", "patience", "batch", "imgsz", "workers", "seed"]
            float_params = ["lr0", "lrf", "momentum", "weight_decay", "warmup_epochs", "warmup_momentum", 
                           "hsv_h", "hsv_s", "hsv_v", "degrees", "translate", "scale", "shear", 
                           "perspective", "flipud", "fliplr", "mosaic", "mixup", "copy_paste"]
            bool_params = ["cos_lr", "amp"]

            for p in int_params:
                if p in params: params[p] = int(params[p])
            for p in float_params:
                if p in params: params[p] = float(params[p])
            for p in bool_params:
                if p in params:
                    # 前端传来的是布尔值或字符串形式的布尔
                    if isinstance(params[p], str):
                        params[p] = params[p].lower() == 'true'
                    else:
                        params[p] = bool(params[p])

            training_kwargs.update(params)
            
            # 执行耗时的训练
            results = model.train(**training_kwargs)

            # 检测是否早停完成：实际完成轮次 < 设定总轮次 说明 patience 触发了早停
            actual_epochs = training_state["progress"]
            target_epochs = training_state["total"]
            if actual_epochs > 0 and actual_epochs < target_epochs:
                training_state["early_stopped"] = True
                training_state["early_stop_epoch"] = actual_epochs
                print(f"[早停检测] 训练在第 {actual_epochs}/{target_epochs} 轮早停完成")

            # 4. 训练结束，用权威的 results 对象回填最终指标
            # 验证指标 mAP/Precision/Recall 尚未就绪），因此在此处用 YOLO 返回的最终结果覆盖，确保指标准确。
            try:
                if results is not None:
                    # results.results_dict 是 YOLO 训练完成后最权威的指标字典
                    results_dict = getattr(results, "results_dict", None)
                    if results_dict and isinstance(results_dict, dict):
                        # 从权威字典中提取指标，覆盖回调中可能为 0 的值
                        authoritative_metrics = {
                            "mAP50": _fuzzy_get(results_dict, ["mAP50(B)", "mAP50"], 0),
                            "mAP50-95": _fuzzy_get(results_dict, ["mAP50-95(B)", "mAP50-95"], 0),
                            "Precision": _fuzzy_get(results_dict, ["precision(B)", "precision"], 0),
                            "Recall": _fuzzy_get(results_dict, ["recall(B)", "recall"], 0),
                        }
                        # 只覆盖为 0 或缺失的验证指标，保留回调中已有的损失值
                        existing = training_state.get("metrics", {})
                        for key, val in authoritative_metrics.items():
                            if val > 0 and existing.get(key, 0) == 0:
                                existing[key] = val
                        training_state["metrics"] = existing
                        print(f"[训练指标回填] 使用 results 权威数据覆盖完毕: {training_state['metrics']}")
                    else:
                        # 兜底：尝试从 results.box 属性中获取
                        box = getattr(results, "box", None)
                        if box is not None:
                            existing = training_state.get("metrics", {})
                            fallback_map = {
                                "mAP50": getattr(box, "map50", 0),
                                "mAP50-95": getattr(box, "map", 0),
                                "Precision": getattr(box, "mp", 0),
                                "Recall": getattr(box, "mr", 0),
                            }
                            for key, val in fallback_map.items():
                                val_f = round(float(val), 4) if val else 0
                                if val_f > 0 and existing.get(key, 0) == 0:
                                    existing[key] = val_f
                            training_state["metrics"] = existing
                            print(f"[训练指标回填] 使用 results.box 兜底数据覆盖完毕: {training_state['metrics']}")
            except Exception as backfill_err:
                print(f"[训练指标回填] 回填过程出现异常(不影响训练结果): {backfill_err}")

            # 5. 处理训练产物
            # ultralytics 的保存目录 (已在上方定义)
            best_pt_path = os.path.join(run_dir, "weights", "best.pt")
            
            if not os.path.exists(best_pt_path):
                raise Exception("训练未生成 best.pt，可能中途异常或数据不足")

            # A. 拷贝 best.pt 到 trained 模型目录，并重命名为 model_name (强制加 .pt)
            final_model_filename = model_name if model_name.endswith(".pt") else f"{model_name}.pt"
            dest_pt_path = os.path.join(settings.MODEL_DIRS["trained"], final_model_filename)
            shutil.copy(best_pt_path, dest_pt_path)

            # B. 拷贝图表到 backend/trainchart/{model_name}/
            # 防止重叠，将后缀 .pt 去掉做图表目录名
            chart_folder_name = final_model_filename.replace(".pt", "")
            chart_dest_dir = os.path.join(settings.TRAINCHART_DIR, chart_folder_name)
            os.makedirs(chart_dest_dir, exist_ok=True)

            charts_to_copy = [
                "results.png", "confusion_matrix.png", "confusion_matrix_normalized.png",
                "F1_curve.png", "P_curve.png", "PR_curve.png", "R_curve.png",
                "BoxF1_curve.png", "BoxP_curve.png", "BoxPR_curve.png", "BoxR_curve.png",
                "labels.jpg", "labels_correlogram.jpg"
            ]
            for chart in charts_to_copy:
                src_chart = os.path.join(run_dir, chart)
                if os.path.exists(src_chart):
                    shutil.copy(src_chart, os.path.join(chart_dest_dir, chart))
            
            # C. 记录到数据库
            # dataset 可能只是个 yaml 路径字符串，前端发过来的是纯名字或带 data.yaml，这里保留纯名字
            dataset_name_clean = os.path.basename(dataset_yaml_path)
            
            # 将经过回填校正后的最终指标序列化为 JSON 存入数据库
            final_metrics_json = json.dumps(training_state.get("metrics", {}), ensure_ascii=False)

            db_service.add_training_record(
                model_name=final_model_filename,
                base_model=base_model,
                dataset=dataset_name_clean,
                parameters=json.dumps(params, ensure_ascii=False),
                description=description,
                final_metrics=final_metrics_json,
                early_stopped=1 if training_state.get("early_stopped") else 0,
                early_stop_epoch=training_state.get("early_stop_epoch", 0)
            )

            # D. 清理临时 runs 目录 (因为我们已经把产物迁移到了 models/trained 和 trainchart 里)
            if os.path.exists(run_dir):
                shutil.rmtree(run_dir, ignore_errors=True)
                print(f"Successfully cleaned up temporary run directory: {run_dir}")

            # 更新状态为成功
            training_state["status"] = "success"
            if training_state.get("early_stopped"):
                training_state["eta"] = f"早停完成 (第 {training_state['early_stop_epoch']}/{target_epochs} 轮)"
            else:
                training_state["eta"] = "已完成"

        except Exception as e:
            global stop_training_event
            if stop_training_event.is_set():
                # 用户主动停止训练，不打印完整 traceback
                print(f"Training stopped by user at epoch {training_state['progress']}/{training_state['total']}")
                training_state["status"] = "stopped"
                training_state["error_msg"] = "训练被用户终止"
                training_state["eta"] = "已停止"
            else:
                # 其他错误，打印 traceback 以便调试
                import traceback
                traceback.print_exc()
                training_state["status"] = "error"
                training_state["error_msg"] = str(e)
                training_state["eta"] = "训练错误"

            # 训练失败/停止时也清理临时目录
            if os.path.exists(run_dir):
                shutil.rmtree(run_dir, ignore_errors=True)
                print(f"Cleaned up temporary run directory after failure/stop: {run_dir}")

        # 5. 最后执行的代码块
        finally:
            # A. 释放训练模型的 GPU 显存
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

            # B. 重新加载之前的推理模型
            try:
                if saved_model_name and saved_category:
                    yolo_service.load_model(saved_model_name, saved_category)
                    print(f"Inference model reloaded: {saved_model_name} ({saved_category})")
            except Exception as reload_err:
                print(f"Warning: Failed to reload inference model: {reload_err}")

    def get_progress(self):
        """前端获取进度的只读接口"""
        return training_state

    def stop_training(self):
        """停止当前训练任务"""
        global stop_training_event
        if training_state["status"] == "training":
            stop_training_event.set()
            return {"status": "success", "message": "停止训练信号已发送"}
        else:
            return {"status": "error", "message": "当前没有正在进行的训练任务"}

training_service = TrainingService()
