import cv2
import numpy as np
from PIL import Image


def load_image_as_cv2(image_bytes: bytes) -> np.ndarray:
    np_arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image. Is this a valid image file?")
    return img


def to_grayscale(img: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def deskew(img: np.ndarray) -> np.ndarray:
    coords = np.column_stack(np.where(img < 128))
    if len(coords) == 0:
        return img

    rect = cv2.minAreaRect(coords)
    angle = rect[-1]

    if angle < -45:
        angle = -(90 + angle)
    elif angle > 45:
        angle = 90 - angle
    else:
        angle = -angle

    MAX_REASONABLE_SKEW_DEGREES = 15
    if abs(angle) > MAX_REASONABLE_SKEW_DEGREES:
        return img

    (h, w) = img.shape[:2]
    center = (w // 2, h // 2)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    rotated = cv2.warpAffine(
        img, matrix, (w, h),
        flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )
    return rotated


def preprocess_pipeline(image_bytes: bytes) -> Image.Image:
    img = load_image_as_cv2(image_bytes)
    gray = to_grayscale(img)
    norm_img = cv2.normalize(gray, None, alpha=0, beta=255, norm_type=cv2.NORM_MINMAX)
    deskewed = deskew(norm_img)
    return Image.fromarray(deskewed)