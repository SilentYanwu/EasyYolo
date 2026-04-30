import os
import cv2
import shutil
import torch
import gc
from ultralytics import YOLO

from backend.app.core.config import settings

class YoloService:
    def __init__(self):
        self.model = None
        self._current_model_name = settings.DEFAULT_MODEL_NAME
        self._current_category = "raw"

    def unload_model(self):
        """
        显式释放当前推理模型占用的 GPU 显存。
        在训练前调用，防止 CUDA OOM。
        """
        if self.model is not None:
            del self.model
            self.model = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        print("GPU memory released for training.")

    def load_model(self, model_name: str, category: str = "raw"):
        """
        加载模型
        :param model_name: 模型文件名，如 'yolo11n.pt' 或 'steel_v1.pt'
        :param category: 模型类别 'raw', 'yolo', 'trained'
        """
        # 记录当前模型信息，训练后可自动重载
        self._current_model_name = model_name
        self._current_category = category

        # 1. 确定文件夹路径
        target_dir = settings.MODEL_DIRS.get(category)
        if not target_dir:
            raise ValueError(f"Unknown model category: {category}")
        
        model_path = os.path.join(target_dir, model_name)

        # 2. 检查文件是否存在
        if not os.path.exists(model_path):
            if category == "raw" and "yolo" in model_name: 
                # 让 ultralytics 自动下载，然后我们移动它
                print(f"Model not found at {model_path}, downloading...")
                temp_model = YOLO(model_name) 
                self.model = temp_model

                # 显式将下载的文件从当前运行目录移到对应的 raw 目录
                downloaded_file = os.path.join(os.getcwd(), model_name)
                if os.path.exists(downloaded_file):
                    os.makedirs(target_dir, exist_ok=True)
                    shutil.move(downloaded_file, model_path)
                    print(f"Successfully moved auto-downloaded model to {model_path}")
            else:
                raise FileNotFoundError(f"Model file not found: {model_path}")
        else:
            print(f"Loading model from: {model_path}")
            self.model = YOLO(model_path)

    def _ensure_model_loaded(self):
        if self.model is None:
            model_name = self._current_model_name or settings.DEFAULT_MODEL_NAME
            category = self._current_category or "raw"
            self.load_model(model_name, category)

    def predict_image(self, source_path: str, save_path: str, conf: float = 0.25):
        """
        执行推理并保存图片
        """
        self._ensure_model_loaded()

        # 推理
        results = self.model.predict(source=source_path, conf=conf)

        # 绘制结果（YOLO内部自带）
        result_img = results[0].plot()

        # 保存图片
        cv2.imwrite(save_path, result_img)

        return results[0].to_json()


    def predict_video_stream(self, source_path: str, save_path: str, conf: float = 0.25):
        """
        视频推理生成器：逐帧处理并 yield 进度
        """
        self._ensure_model_loaded()

        cap = cv2.VideoCapture(source_path)
        if not cap.isOpened():
            raise IOError(f"Cannot open video: {source_path}")

        # 获取视频属性
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        print(f"Video Info: {width}x{height}, {fps} FPS, {total_frames} frames")

        # 兜底：如果获取不到属性，设置默认值（避免报错导致整个生成器挂掉）
        if width == 0 or height == 0:
            width, height = 640, 480
        if fps == 0:
            fps = 30

        # 定义编码器候选列表
        codecs = ['avc1', 'mp4v', 'XVID']
        out = None
        
        for codec in codecs:
            try:
                fourcc = cv2.VideoWriter_fourcc(*codec)
                out = cv2.VideoWriter(save_path, fourcc, fps, (width, height))
                if out.isOpened():
                    print(f"Successfully initialized VideoWriter with codec: {codec}")
                    break
                else:
                    print(f"Codec {codec} failed to open.")
                    out.release()
            except Exception as e:
                print(f"Error trying codec {codec}: {e}")

        if not out or not out.isOpened():
            print(f"Critical Error: All codecs failed for {save_path}")
            cap.release()
            raise IOError("无法初始化视频写入器，请检查环境中的 OpenCV 编码支持。")

        frame_count = 0
        try:
            # 流式处理
            results = self.model.predict(source=source_path, conf=conf, stream=True)
            
            for result in results:
                frame_count += 1
                annotated_frame = result.plot()
                out.write(annotated_frame)
                # 每处理5帧或最后一帧，yield 进度
                if frame_count % 5 == 0 or frame_count == total_frames:
                    yield frame_count, total_frames

        except Exception as e:
            print(f"Streaming error: {e}")
            raise
        finally:
            cap.release()
            if out:
                out.release()

# 单例模式：全局共享一个服务实例，避免反复加载模型
yolo_service = YoloService()