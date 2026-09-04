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


def denoise(img: np.ndarray) -> np.ndarray:
    return cv2.fastNlMeansDenoising(img, h=10)

def binarize(img: np.ndarray) -> np.ndarray:
    _, thresh = cv2.threshold(
        img, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
    )
    return thresh

def deskew(img: np.ndarray) -> np.ndarray:
    coords = np.column_stack(np.where(img == 0))
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
    img = to_grayscale(img)
    img = denoise(img)
    img = binarize(img)
    img = deskew(img)
    return Image.fromarray(img)
