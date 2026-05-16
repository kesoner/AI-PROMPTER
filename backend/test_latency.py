import time
import sys
import io
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
    print(f"CUDA DLL path setup error: {e}")

from faster_whisper import WhisperModel

# 強制設定輸出編碼為 utf-8，避免 Windows cmd 下產生 sys.excepthook 錯誤
# 加入 line_buffering=True 確保發生錯誤時訊息不會被吃掉
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', line_buffering=True)
from faster_whisper import WhisperModel

def test_model_latency():
    print("="*50)
    print("開始測試 Faster-Whisper 模型的反應時間與輸出...")
    print("="*50)

    # 1. 初始化模型並計算載入時間
    start_load = time.time()
    # 模型設定
    MODEL_SIZE = "large-v2" # 可更換為 "tiny", "base", "small", "medium", "large-v2" 等)
    print(f"1. 正在載入模型 '{MODEL_SIZE}'...")
    
    try:
        model = WhisperModel(MODEL_SIZE, device="cuda", compute_type="float16")
        print("   -> 成功載入至 CUDA (GPU加速)")
        print("   -> 正在進行模型暖機 (Warmup)...")
        # 進行一次隨機噪音的推論，強迫 CUDA 載入所有核心 (不開啟 VAD 以確保跑過模型)
        model.transcribe(np.random.uniform(-0.1, 0.1, 16000).astype(np.float32), language="zh", vad_filter=False)
        print("   -> 暖機完成！")
    except Exception as e:
        print(f"   -> CUDA 載入失敗，切換至 CPU: {e}")
        model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
        print("   -> 成功載入至 CPU")
        
    load_time = time.time() - start_load
    print(f"   [時間] 模型載入耗時: {load_time:.2f} 秒\n")

    # 2. 測試用的音訊資料
    # 我們可以嘗試錄製一段聲音，或者為了方便，直接在此生成 1 秒鐘的「空音訊」或要求安裝 sounddevice 錄音。
    # 這裡示範如果您要從麥克風收音，我們使用 sounddevice 模組
    try:
        import sounddevice as sd
        SAMPLE_RATE = 16000
        DURATION = 3  # 錄製 3 秒
        
        print(f"2. 準備錄音測試 ({DURATION} 秒)...")
        print("   -> 請對著麥克風說幾句話 (例如：『這是一個測試』)...")
        
        try:
            # 開始錄音
            audio_data = sd.rec(int(DURATION * SAMPLE_RATE), samplerate=SAMPLE_RATE, channels=1, dtype='float32')
            sd.wait()  # 等待錄音結束
            print("   -> 錄音結束！\n")
            # sounddevice 回傳的形狀是 (frames, channels)，我們要轉成 1D 陣列
            audio_array = audio_data.flatten()
        except Exception as e:
            print(f"\n[錯誤] 無法存取麥克風設備: {e}")
            raise ImportError("觸發後備機制")
            
    except ImportError:
        print("2. 找不到 sounddevice 模組，無法使用麥克風。")
        print("   -> 將使用 2 秒鐘的「隨機噪音」進行推理速度測試。")
        print("   -> 若要測試真實語音，請先執行: pip install sounddevice")
        SAMPLE_RATE = 16000
        DURATION = 2
        # 生成隨機噪音 (float32, 範圍 -1 到 1)
        audio_array = np.random.uniform(-1, 1, size=(SAMPLE_RATE * DURATION)).astype(np.float32)
        print("\n")

    print("3. 開始進行語音辨識推論 (Inference)...")
    start_infer = time.time()
    
    text_result = ""
    try:
        segments, info = model.transcribe(
            audio_array,
            language="zh",
            beam_size=5,
            vad_filter=True
        )
        
        # 注意：faster-whisper 的 segments 是一個 generator，要將它轉為 list 才會真正執行推論
        for segment in segments:
            text_result += segment.text
            
    except Exception as e:
        print(f"\n[錯誤] 模型推論失敗: {e}")
        return

    infer_time = time.time() - start_infer
    
    print("\n" + "="*50)
    print("【 測試結果 】")
    print(f"輸入音訊長度 : {DURATION} 秒")
    print(f"推論反應時間 : {infer_time:.4f} 秒 (從輸入到產出文字)")
    
    # 計算即時率 (Real Time Factor, RTF)
    # RTF < 1 代表處理速度比講話速度快，越小越即時
    rtf = infer_time / DURATION
    print(f"即時率 (RTF) : {rtf:.4f} (小於 1 代表可即時處理)")
    
    print(f"\n辨識輸出文字 : 「{text_result.strip()}」")
    print("="*50)

if __name__ == "__main__":
    test_model_latency()
