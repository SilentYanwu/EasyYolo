import os
import shutil
import json
import zipfile
import glob
import threading
import time
import gc
import random
import torch
import torch.nn.functional as F
import yaml
from datetime import datetime
from fastapi import UploadFile, HTTPException
from ultralytics import YOLO

from backend.app.core.config import settings
from backend.app.services.db_service import db_service


class CustomAugCallback:
    """自定义数据增强回调：在训练 batch 上追加高斯噪声与高斯模糊"""

    def __init__(self, noise_prob=0.0, noise_var_min=0.001, noise_var_max=0.01,
                 blur_prob=0.0, blur_kernels=(3,)):
        self.noise_prob = noise_prob
        self.noise_var_min = noise_var_min
        self.noise_var_max = noise_var_max
        self.blur_prob = blur_prob
        self.blur_kernels = blur_kernels
        self._enabled = noise_prob > 0 or blur_prob > 0

    def apply(self, imgs):
        """对已预处理的图像 batch 追加高斯噪声与高斯模糊 (imgs: (B, C, H, W), 归一化 [0, 1])"""
        if not self._enabled:
            return
        B = imgs.shape[0]
        device = imgs.device

        for i in range(B):
            img = imgs[i]

            if self.noise_prob > 0 and torch.rand(1, device=device).item() < self.noise_prob:
                var = self.noise_var_min + torch.rand(1, device=device).item() * (self.noise_var_max - self.noise_var_min)
                noise = torch.randn_like(img).mul_(var ** 0.5)
                img = (img + noise).clamp_(0, 1)

            if self.blur_prob > 0 and torch.rand(1, device=device).item() < self.blur_prob:
                k = self.blur_kernels[torch.randint(0, len(self.blur_kernels), (1,), device=device).item()]
                sigma = 0.3 * ((k - 1) * 0.5 - 1) + 0.8
                ax = torch.arange(k, dtype=torch.float32, device=device) - (k - 1) / 2
                xx, yy = torch.meshgrid(ax, ax, indexing='ij')
                kernel = torch.exp(-(xx * xx + yy * yy) / (2.0 * sigma * sigma))
                kernel = kernel / kernel.sum()
                kernel = kernel.view(1, 1, k, k).expand(img.shape[0], 1, k, k)
                padded = F.pad(img.unsqueeze(0), (k // 2, k // 2, k // 2, k // 2), mode='reflect')
                img = F.conv2d(padded, kernel, groups=img.shape[0]).squeeze_(0).clamp_(0, 1)

            imgs[i] = img

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
    "early_stop_epoch": 0,    # 早停时的轮次
    "best_metrics": {},       # 训练过程中最佳一轮的指标
    "best_epoch": 0,          # 最佳一轮是第几轮
    "best_fitness": -1.0      # 最佳 fitness 值，用于比较
}

# 训练停止事件
stop_training_event = threading.Event()

# 训练状态读写锁（get_progress 在主线程读，训练线程在写）
training_lock = threading.Lock()

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
        with training_lock:
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
            training_state["best_metrics"] = {}
            training_state["best_epoch"] = 0
            training_state["best_fitness"] = -1.0

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
                    with training_lock:
                        training_state["status"] = "stopped"
                        training_state["error_msg"] = "训练被用户终止"
                        training_state["eta"] = "已停止"
                    raise RuntimeError("Training stopped by user")
            # 计算 ETA 的函数，根据每轮时间和剩余轮数估算
            def _compute_eta(current_epoch):
                """根据已用 epoch 时间计算预计剩余时间"""
                now = time.time()
                with training_lock:
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

            # 从验证集标签文件中统计每类图片数和实例数
            def _count_val_labels(data_yaml_path, class_names):
                images_per_cls = {}
                instances_per_cls = {}
                try:
                    with open(data_yaml_path, 'r', encoding='utf-8') as f:
                        data_yaml = yaml.safe_load(f)
                    base_path = data_yaml.get('path', '') or ''
                    val_rel = data_yaml.get('val', '') or ''
                    if not val_rel:
                        print("[EvalTable] YAML 中无 val 字段，跳过标签统计")
                        return images_per_cls, instances_per_cls
                    yaml_dir = os.path.dirname(os.path.abspath(data_yaml_path))

                    # 解析验证集图片目录的绝对路径
                    if base_path and os.path.isabs(base_path):
                        val_img_dir = os.path.join(base_path, val_rel)
                    elif base_path:
                        val_img_dir = os.path.join(yaml_dir, base_path, val_rel)
                    else:
                        val_img_dir = os.path.join(yaml_dir, val_rel)
                    val_img_dir = os.path.normpath(val_img_dir)

                    # 候选 labels 目录列表
                    candidates = []
                    # 1) images -> labels 替换
                    candidates.append(val_img_dir.replace('images', 'labels'))
                    # 2) 同级 labels 目录下的 val 子目录
                    candidates.append(os.path.join(os.path.dirname(val_img_dir), 'labels', os.path.basename(val_img_dir)))
                    # 3) 数据集的根目录下的 labels 目录（NEU-DET 常见结构）
                    if base_path and os.path.isabs(base_path):
                        dataset_root = base_path
                    else:
                        dataset_root = yaml_dir
                    candidates.append(os.path.join(dataset_root, 'labels', os.path.basename(val_img_dir)))

                    label_dir = None
                    for cand in candidates:
                        cand = os.path.normpath(cand)
                        if os.path.isdir(cand):
                            label_dir = cand
                            break
                    if not label_dir:
                        print(f"[EvalTable] 未找到 labels 目录, 尝试的路径: {candidates[:3]}")
                        return images_per_cls, instances_per_cls

                    label_files = glob.glob(os.path.join(label_dir, '*.txt'))
                    if not label_files:
                        print(f"[EvalTable] labels 目录为空: {label_dir}")
                        return images_per_cls, instances_per_cls

                    for lf in label_files:
                        classes_in_image = set()
                        with open(lf, 'r') as lf_handle:
                            for line in lf_handle:
                                parts = line.strip().split()
                                if parts:
                                    try:
                                        cls_id = int(parts[0])
                                        cls_name = class_names.get(cls_id)
                                        if cls_name:
                                            instances_per_cls[cls_name] = instances_per_cls.get(cls_name, 0) + 1
                                            classes_in_image.add(cls_name)
                                    except ValueError:
                                        pass
                        for cn in classes_in_image:
                            images_per_cls[cn] = images_per_cls.get(cn, 0) + 1
                    print(f"[EvalTable] 从 {len(label_files)} 个标签文件统计: {sum(instances_per_cls.values())} 个实例")
                except Exception as e:
                    print(f"[EvalTable] 统计标签失败: {e}")
                return images_per_cls, instances_per_cls

            # 从训练结果中提取每类评估指标表
            def _extract_eval_table(results, model, data_yaml_path):
                results_dict = getattr(results, 'results_dict', {}) or {}
                class_names = dict(model.names) if model.names else {}
                print(f"[EvalTable] results_dict keys: {sorted(results_dict.keys())}")

                def _get_metric(metrics_dict, key_patterns, default=0):
                    for pattern in key_patterns:
                        for k, v in metrics_dict.items():
                            if pattern.lower() in k.lower():
                                try:
                                    return round(float(v), 4)
                                except (TypeError, ValueError):
                                    pass
                    return default

                def _get_per_class_array(metrics_dict, key_patterns):
                    for pattern in key_patterns:
                        for k, v in metrics_dict.items():
                            if pattern.lower() in k.lower() and hasattr(v, '__iter__') and not isinstance(v, str):
                                try:
                                    return [round(float(x), 4) for x in v]
                                except (TypeError, ValueError):
                                    pass
                    return None

                # 尝试从 results_dict 中提取 per-class 数组
                per_class_p = _get_per_class_array(results_dict, ['precision(B)_per_class', 'precision_per_class'])
                per_class_r = _get_per_class_array(results_dict, ['recall(B)_per_class', 'recall_per_class'])
                per_class_map50 = _get_per_class_array(results_dict, ['mAP50(B)_per_class', 'mAP50_per_class'])
                per_class_map50_95 = _get_per_class_array(results_dict, ['mAP50-95(B)_per_class', 'mAP50-95_per_class'])

                # Fallback 1: results.maps / results.box / results.ap 等对象属性
                box = getattr(results, 'box', None)
                if per_class_p is None and box is not None:
                    try:
                        arr = getattr(box, 'p', None)
                        if arr is not None and hasattr(arr, '__iter__') and not isinstance(arr, str):
                            per_class_p = [round(float(x), 4) for x in arr]
                            print(f"[EvalTable] 从 results.box.p 提取 per-class P: {per_class_p}")
                    except Exception:
                        pass
                if per_class_r is None and box is not None:
                    try:
                        arr = getattr(box, 'r', None)
                        if arr is not None and hasattr(arr, '__iter__') and not isinstance(arr, str):
                            per_class_r = [round(float(x), 4) for x in arr]
                            print(f"[EvalTable] 从 results.box.r 提取 per-class R: {per_class_r}")
                    except Exception:
                        pass
                if per_class_map50 is None and box is not None:
                    ap50_arr = getattr(box, 'ap50', None)
                    if ap50_arr is not None:
                        try:
                            # BaseTensor 兼用 .cpu().numpy() / .tolist() / 直接 float()
                            vals = ap50_arr
                            if hasattr(vals, 'cpu'):
                                vals = vals.cpu()
                            if hasattr(vals, 'numpy'):
                                vals = vals.numpy()
                            if hasattr(vals, 'tolist'):
                                vals = vals.tolist()
                            # 现在 vals 应该是 Python list 或类似
                            if isinstance(vals, (list, tuple)):
                                per_class_map50 = [round(float(x), 4) for x in vals]
                            else:
                                # 可能是标量，用 float()
                                per_class_map50 = [round(float(vals), 4)]
                            print(f"[EvalTable] 从 results.box.ap50 提取 per-class mAP50: {per_class_map50}")
                        except Exception as e:
                            print(f"[EvalTable] results.box.ap50 提取失败: {e}")
                if per_class_map50_95 is None:
                    maps_attr = getattr(results, 'maps', None)
                    if maps_attr is not None:
                        try:
                            per_class_map50_95 = [round(float(x), 4) for x in maps_attr]
                            print(f"[EvalTable] 从 results.maps 提取 per-class mAP50-95: {per_class_map50_95}")
                        except (TypeError, ValueError):
                            pass
                if per_class_map50_95 is None and box is not None:
                    try:
                        arr = getattr(box, 'maps', None) or getattr(box, 'ap', None)
                        if arr is not None and hasattr(arr, '__iter__') and not isinstance(arr, str):
                            per_class_map50_95 = [round(float(x), 4) for x in arr]
                            print(f"[EvalTable] 从 results.box 提取 per-class mAP50-95: {per_class_map50_95}")
                    except Exception:
                        pass

                # 从验证集标签统计 Images/Instances
                images_per_cls, instances_per_cls = _count_val_labels(data_yaml_path, class_names)

                rows = []
                total_images = sum(images_per_cls.values())
                total_instances = sum(instances_per_cls.values())

                overall_p = _get_metric(results_dict, ['precision(B)', 'precision'])
                overall_r = _get_metric(results_dict, ['recall(B)', 'recall'])
                overall_map50 = _get_metric(results_dict, ['mAP50(B)', 'mAP50'])
                overall_map50_95 = _get_metric(results_dict, ['mAP50-95(B)', 'mAP50-95'])

                rows.append({
                    'class': 'all',
                    'images': total_images,
                    'instances': total_instances,
                    'p': overall_p,
                    'r': overall_r,
                    'map50': overall_map50,
                    'map50_95': overall_map50_95
                })

                for cls_id in sorted(class_names.keys()):
                    cls_name = class_names[cls_id]
                    row = {
                        'class': cls_name,
                        'images': images_per_cls.get(cls_name, 0),
                        'instances': instances_per_cls.get(cls_name, 0),
                        'p': per_class_p[cls_id] if per_class_p and cls_id < len(per_class_p) else 0,
                        'r': per_class_r[cls_id] if per_class_r and cls_id < len(per_class_r) else 0,
                        'map50': per_class_map50[cls_id] if per_class_map50 and cls_id < len(per_class_map50) else 0,
                        'map50_95': per_class_map50_95[cls_id] if per_class_map50_95 and cls_id < len(per_class_map50_95) else 0
                    }
                    rows.append(row)

                # 如果上面的 per-class 都没取到，尝试逐个 key 匹配
                has_per_class = any(a is not None for a in [per_class_p, per_class_r, per_class_map50, per_class_map50_95])
                if not has_per_class:
                    for i, (cls_id, cls_name) in enumerate(class_names.items()):
                        row = rows[i + 1]
                        for metric_key in ['mAP50(B)', 'mAP50-95(B)', 'precision(B)', 'recall(B)']:
                            for suffix in [f'/{cls_name}', f'/class_{cls_id}', f'_{cls_id}']:
                                full_key = f'metrics/{metric_key}{suffix}'
                                if full_key in results_dict:
                                    val = round(float(results_dict[full_key]), 4)
                                    if 'mAP50-95' in metric_key:
                                        row['map50_95'] = val
                                    elif 'mAP50' in metric_key:
                                        row['map50'] = val
                                    elif 'precision' in metric_key.lower():
                                        row['p'] = val
                                    elif 'recall' in metric_key.lower():
                                        row['r'] = val

                print(f"[EvalTable] 提取完成: {len(rows)} 行 (含 all)")
                return json.dumps(rows, ensure_ascii=False)

            # 每epoch结束时更新进度和指标，并计算 ETA
            def on_train_epoch_end(trainer):
                current_epoch = getattr(trainer, "epoch", 0) + 1
                eta = _compute_eta(current_epoch)
                current_metrics = _extract_metrics(trainer)
                # 追踪最佳一轮：比较 fitness 值
                current_fitness = float(getattr(trainer, "fitness", 0) or 0)
                with training_lock:
                    training_state["progress"] = current_epoch
                    training_state["metrics"] = current_metrics
                    training_state["eta"] = eta
                    if current_fitness > training_state["best_fitness"]:
                        training_state["best_fitness"] = current_fitness
                        training_state["best_epoch"] = current_epoch
                        training_state["best_metrics"] = dict(current_metrics)
                _stop_now()

            # 3. 处理训练参数
            # 过滤掉无法序列化或无意义的选项
            for key in list(params.keys()):
                if params[key] == "":
                    del params[key]

            int_params = ["epochs", "patience", "batch", "imgsz", "workers", "seed", "close_mosaic"]
            float_params = ["lr0", "lrf", "momentum", "weight_decay", "warmup_epochs", "warmup_momentum",
                           "warmup_bias_lr",
                           "hsv_h", "hsv_s", "hsv_v", "degrees", "translate", "scale", "shear",
                           "perspective", "flipud", "fliplr", "mosaic", "mixup", "copy_paste",
                           "gaussian_noise", "gaussian_blur"]
            bool_params = ["cos_lr", "amp"]

            for p in int_params:
                if p in params: params[p] = int(params[p])
            for p in float_params:
                if p in params: params[p] = float(params[p])
            for p in bool_params:
                if p in params:
                    if isinstance(params[p], str):
                        params[p] = params[p].lower() == 'true'
                    else:
                        params[p] = bool(params[p])

            # 提取自定义增强参数（不传给 ultralytics，由 CustomAugCallback 自行消费）
            noise_prob = float(params.pop("gaussian_noise", 0))
            blur_prob = float(params.pop("gaussian_blur", 0))

            # ---- EasyYolo 自定义增强 (monkey-patch preprocess_batch) ----
            # 恢复为 ultralytics 出厂行为：删除从 aug_callback = ... 到
            # model.add_callback("on_train_start", _patch_preprocess_batch) 为止的代码，
            # 并将下方的 on_train_batch_start 回调恢复为仅做 _stop_now()
            aug_callback = CustomAugCallback(noise_prob=noise_prob, blur_prob=blur_prob)

            def _patch_preprocess_batch(trainer):
                """训练开始前将自定义增强注入 preprocess_batch"""
                _orig = trainer.preprocess_batch

                def _augmented(batch):
                    batch = _orig(batch)
                    aug_callback.apply(batch['img'])
                    return batch

                trainer.preprocess_batch = _augmented

            model.add_callback("on_train_start", _patch_preprocess_batch)

            # 训练终止检查
            def on_train_batch_start(trainer):
                _stop_now()

            model.add_callback("on_train_batch_start", on_train_batch_start)
            model.add_callback("on_train_epoch_end", on_train_epoch_end)

            # 4. 开始训练
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

            training_kwargs.update(params)
            
            # 执行耗时的训练
            results = model.train(**training_kwargs)

            # 检测是否早停完成：实际完成轮次 < 设定总轮次 说明 patience 触发了早停
            with training_lock:
                actual_epochs = training_state["progress"]
                target_epochs = training_state["total"]
            if actual_epochs > 0 and actual_epochs < target_epochs:
                with training_lock:
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
                        with training_lock:
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
                            with training_lock:
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

            # 提取每类评估指标表
            eval_table_json = _extract_eval_table(results, model, actual_dataset_yaml_path)

            # 写回自定义增强参数以便数据库记录完整
            params["gaussian_noise"] = noise_prob
            params["gaussian_blur"] = blur_prob

            db_service.add_training_record(
                model_name=final_model_filename,
                base_model=base_model,
                dataset=dataset_name_clean,
                parameters=json.dumps(params, ensure_ascii=False),
                description=description,
                best_metrics=json.dumps(training_state.get("best_metrics", {}), ensure_ascii=False),
                best_epoch=training_state.get("best_epoch", 0),
                early_stopped=1 if training_state.get("early_stopped") else 0,
                early_stop_epoch=training_state.get("early_stop_epoch", 0),
                eval_table=eval_table_json
            )

            # D. 清理临时 runs 目录 (因为我们已经把产物迁移到了 models/trained 和 trainchart 里)
            if os.path.exists(run_dir):
                shutil.rmtree(run_dir, ignore_errors=True)
                print(f"Successfully cleaned up temporary run directory: {run_dir}")

            # 更新状态为成功
            with training_lock:
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
                with training_lock:
                    training_state["status"] = "stopped"
                    training_state["error_msg"] = "训练被用户终止"
                    training_state["eta"] = "已停止"
            else:
                # 其他错误，打印 traceback 以便调试
                import traceback
                traceback.print_exc()
                with training_lock:
                    training_state["status"] = "error"
                    training_state["error_msg"] = str(e)
                    training_state["eta"] = "训练错误"

            # 训练失败/停止时也清理临时目录
            if os.path.exists(run_dir):
                shutil.rmtree(run_dir, ignore_errors=True)
                print(f"Cleaned up temporary run directory after failure/stop: {run_dir}")

        # 5. 最后执行的代码块
        finally:
            # A. 显式释放训练模型及所有引用，确保 gc 能回收
            del model
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
        """前端获取进度的只读接口（加锁保证读到一致快照）"""
        with training_lock:
            return dict(training_state)

    def stop_training(self):
        """停止当前训练任务"""
        global stop_training_event
        with training_lock:
            if training_state["status"] == "training":
                stop_training_event.set()
                return {"status": "success", "message": "停止训练信号已发送"}
            else:
                return {"status": "error", "message": "当前没有正在进行的训练任务"}

training_service = TrainingService()
