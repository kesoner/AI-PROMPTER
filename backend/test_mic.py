import sounddevice as sd
import numpy as np
import time
import sys
import io

# 強制設定輸出編碼為 utf-8
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

def audio_callback(indata, frames, time_info, status):
    if status:
        print(status)
    # 計算這個音訊區塊的最大音量 (Peak Amplitude)
    # indata 是一個 numpy 陣列，數值介於 -1 到 1 之間
    peak = np.max(np.abs(indata))
    
    # 為了畫面顯示，我們將音量放大並畫成長條圖 (最多 50 格)
    # 一般說話的 peak 約在 0.1 ~ 0.8 之間
    level = int(min(peak * 50, 50))
    bar = "█" * level + "-" * (50 - level)
    
    # \r 讓游標回到行首，覆蓋上一行的輸出
    print(f"\r麥克風音量: [{bar}] 數值: {peak:.4f}", end="", flush=True)

def test_mic():
    print("="*50)
    print("麥克風收音測試工具")
    print("==================================================")
    print("請開始對著麥克風說話，觀察下方的音量條是否有跳動。")
    print("如果音量數值一直維持在 0.0000，代表系統沒有抓到您的麥克風聲音！")
    print("按下 [Ctrl + C] 即可結束測試。\n")
    
    try:
        # 開啟麥克風音訊流
        with sd.InputStream(channels=1, samplerate=16000, callback=audio_callback):
            while True:
                time.sleep(0.1)
    except KeyboardInterrupt:
        print("\n\n測試結束。")
    except Exception as e:
        print(f"\n\n[錯誤] 無法存取麥克風: {e}")

if __name__ == "__main__":
    test_mic()
