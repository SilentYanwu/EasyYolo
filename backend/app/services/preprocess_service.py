# preprocess_service.py - 定义图像预处理函数，支持 CLAHE、锐化、去噪和伽马校正等操作
import cv2
import numpy as np


def apply_clahe(img: np.ndarray, clip_limit: float = 2.0, tile_grid_size: int = 8) -> np.ndarray:
    """
    自适应直方图均衡化（CLAHE）
    在 LAB 色彩空间的 L 通道上执行，避免颜色失真
    """
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(
        clipLimit=clip_limit,
        tileGridSize=(tile_grid_size, tile_grid_size)
    )
    l = clahe.apply(l)
    lab = cv2.merge((l, a, b))
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


def apply_median_filter(img: np.ndarray, kernel_size: int = 3) -> np.ndarray:
    """
    中值滤波 — 去除椒盐噪声
    kernel_size 必须为奇数（默认 3）
    """
    k = kernel_size if kernel_size % 2 == 1 else kernel_size + 1
    return cv2.medianBlur(img, k)


def apply_sharpen(img: np.ndarray, strength: float = 1.0) -> np.ndarray:
    """
    拉普拉斯算子锐化
    strength 越大锐化越强（0 = 不锐化，推荐 0.5 ~ 2.0）
    """
    # 拉普拉斯核：中心权重 = 4 + strength
    kernel = np.array([
        [0, -1, 0],
        [-1, 4 + strength, -1],
        [0, -1, 0]
    ], dtype=np.float32)
    sharpened = cv2.filter2D(img, -1, kernel)
    return np.clip(sharpened, 0, 255).astype(np.uint8)


def apply_gamma_correction(img: np.ndarray, gamma: float = 1.0) -> np.ndarray:
    """
    伽马校正
    gamma < 1 → 提亮暗部
    gamma > 1 → 压暗过曝区域
    范围 0.5 ~ 2.0
    """
    inv_gamma = 1.0 / gamma
    table = np.array(
        [((i / 255.0) ** inv_gamma) * 255 for i in range(256)]
    ).astype("uint8")
    return cv2.LUT(img, table)


def preprocess_image(img: np.ndarray, config: dict) -> np.ndarray:
    """
    按配置依次执行启用的预处理步骤。
    处理顺序：CLAHE → 中值滤波 → 锐化 → 伽马校正
    这一顺序确保：先增强对比度 → 去噪 → 再锐化边缘 → 最后调亮度
    """
    if config.get("clahe_enabled", False):
        img = apply_clahe(
            img,
            clip_limit=config.get("clahe_clip", 2.0),
            tile_grid_size=config.get("clahe_tile", 8),
        )
    if config.get("median_enabled", False):
        img = apply_median_filter(
            img,
            kernel_size=config.get("median_kernel", 3),
        )
    if config.get("sharpen_enabled", False):
        img = apply_sharpen(
            img,
            strength=config.get("sharpen_strength", 1.0),
        )
    if config.get("gamma_enabled", False):
        img = apply_gamma_correction(
            img,
            gamma=config.get("gamma_value", 1.0),
        )
    return img
