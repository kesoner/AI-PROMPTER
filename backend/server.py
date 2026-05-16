import asyncio
import json
import logging
import os
import numpy as np

# 自動將 pip 安裝的 CUDA 函式庫路徑加入 DLL 搜尋路徑與環境變數 PATH
try:
    import nvidia.cublas
    import nvidia.cudnn
    cublas_bin = os.path.join(nvidia.cublas.__path__[0], "bin")
    cudnn_bin = os.path.join(nvidia.cudnn.__path__[0], "bin")
    if os.path.exists(cublas_bin):
        os.add_dll_directory(cublas_bin)
        os.environ["PATH"] = cublas_bin + os.pathsep + os.environ.get("PATH", "")
    if os.path.exists(cudnn_bin):
        os.add_dll_directory(cudnn_bin)
        os.environ["PATH"] = cudnn_bin + os.pathsep + os.environ.get("PATH", "")
except Exception as e:
    logging.warning(f"CUDA DLL path setup error: {e}")

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel

# 設定日誌紀錄 (寫入檔案與終端機)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler("api_record.log", encoding="utf-8"),
        logging.StreamHandler()
    ]
)

app = FastAPI()

# 允許跨域請求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 初始化 Faster-Whisper 模型
MODEL_SIZE = "medium"
logging.info(f"Loading Whisper model '{MODEL_SIZE}'...")
try:
    model = WhisperModel(MODEL_SIZE, device="cuda", compute_type="float16")
    logging.info("Model loaded successfully on CUDA.")
    logging.info("Warming up CUDA kernels...")
    model.transcribe(np.random.uniform(-0.1, 0.1, 16000).astype(np.float32), language="zh", vad_filter=False)
    logging.info("Warmup complete. Ready for real-time inference.")
except Exception as e:
    logging.warning(f"CUDA load failed, falling back to CPU: {e}")
    model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
    logging.info("Model loaded successfully on CPU.")

@app.get("/")
def read_root():
    return {"status": "Whisper STT Server is running"}

@app.websocket("/ws/audio")
async def websocket_audio_endpoint(websocket: WebSocket):
    await websocket.accept()
    client_ip = websocket.client.host
    logging.info(f"Client connected from {client_ip}")
    
    # 用於累積音訊的 buffer
    audio_buffer = bytearray()
    
    # 預期的音訊格式： 16kHz, 單聲道, 16-bit PCM
    # 每次收到多少資料才進行一次辨識？例如 1 秒 = 16000 samples = 32000 bytes
    CHUNK_SIZE = 32000 * 1  # 縮短為 1 秒以達到更即時的 STT 體驗
    
    try:
        while True:
            # 接收前端傳來的音訊資料 (二進位)
            data = await websocket.receive_bytes()
            audio_buffer.extend(data)
            
            # 如果累積的音訊長度達到設定的 chunk size，就進行辨識
            if len(audio_buffer) >= CHUNK_SIZE:
                # 將 bytes 轉為 numpy array (int16)
                audio_data_int16 = np.frombuffer(audio_buffer, dtype=np.int16)
                # 轉為 float32 並正規化到 [-1.0, 1.0]
                audio_data_float32 = audio_data_int16.astype(np.float32) / 32768.0
                
                # 執行語音辨識 (這裡可以調整參數，例如開啟 vad_filter 來過濾無聲段落)
                # 記錄我們正在推論
                logging.info(f"Processing audio chunk of size {len(audio_buffer)} bytes")
                segments, info = model.transcribe(
                    audio_data_float32, 
                    language="zh",
                    beam_size=5,
                    vad_filter=True,
                    vad_parameters=dict(min_silence_duration_ms=500)
                )
                
                text_result = ""
                for segment in segments:
                    text_result += segment.text
                
                if text_result.strip():
                    logging.info(f"Recognized: {text_result.strip()}")
                    # 回傳辨識結果
                    await websocket.send_json({"text": text_result.strip()})
                else:
                    # 如果辨識為空，可以稍微印個提示 (不傳給前端)
                    logging.debug("Processed chunk, but no speech detected (or filtered by VAD).")
                
                # 保留未處理完的殘餘資料，並建立新的 bytearray 物件
                # 這樣可以避免 numpy array 鎖定舊記憶體導致的 "object cannot be re-sized" 錯誤
                audio_buffer = audio_buffer[CHUNK_SIZE:]

    except WebSocketDisconnect:
        logging.info("Client disconnected")
    except Exception as e:
        logging.error(f"Error: {e}")
        try:
            await websocket.close()
        except:
            pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
