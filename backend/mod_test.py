from faster_whisper import WhisperModel
import logging

# 初始化 Faster-Whisper 模型
MODEL_SIZE = "base"
logging.info(f"Loading Whisper model '{MODEL_SIZE}'...")
try:
    model = WhisperModel(MODEL_SIZE, device="cuda", compute_type="float16")
    logging.info("Model loaded successfully on CUDA.")
except Exception as e:
    logging.warning(f"CUDA load failed, falling back to CPU: {e}")
    model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
    logging.info("Model loaded successfully on CPU.")
