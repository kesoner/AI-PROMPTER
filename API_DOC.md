# AI 語音提詞器 - API 與日誌文件 (API & Log Documentation)

這份文件記錄了前後端溝通的 WebSocket API 規格，以及伺服器端的運作日誌說明。

---

## 1. WebSocket 即時音訊串流 API

前端麥克風擷取語音後，會透過此 WebSocket 端點將原始音訊流傳送給 Python 後端進行 Faster-Whisper 辨識。

### 📌 端點資訊
- **連線 URL**：`ws://localhost:8000/ws/audio`
- **通訊協定**：WebSocket (WS)

### 📤 請求格式 (Client -> Server)
前端必須以**二進位 (Binary Data)** 格式持續傳送音訊緩衝區 (Buffer)。
為了確保 Whisper 模型的辨識準確度，音訊必須符合以下規格：
- **取樣率 (Sample Rate)**：16,000 Hz (16kHz)
- **聲道 (Channels)**：1 (單聲道 Mono)
- **編碼格式 (Format)**：16-bit PCM (Int16 陣列)

> [!IMPORTANT]
> 後端伺服器預設會將收到的二進位資料累積約 **2秒 (64,000 bytes)** 的長度後，才會送入 AI 模型進行推論。

### 📥 回應格式 (Server -> Client)
當後端模型成功辨識出語音片段後，會透過 WebSocket 非同步回傳 **JSON 格式** 的字串。
如果辨識結果為空（例如純雜音或靜音），則不會回傳。

**JSON 結構**：
\`\`\`json
{
  "text": "辨識出的中文文字內容"
}
\`\`\`

**成功回應範例**：
\`\`\`json
{
  "text": "大家好歡迎來到今天的簡報"
}
\`\`\`

---

## 2. 系統日誌 (System Logs)

Python 後端 (`server.py`) 執行時，會在終端機輸出以下日誌，供開發與除錯使用：

### 啟動日誌
- \`Loading Whisper model 'base'...\`：開始將 Faster-Whisper 模型載入記憶體。
- \`Model loaded successfully on CUDA.\`：模型已成功載入獨立顯卡 (GPU)，將啟用加速運算。
- \`Model loaded successfully on CPU.\`：(若無顯卡或 CUDA 未設定) 模型降級至 CPU 執行。
- \`Application startup complete.\`：FastAPI 伺服器已啟動並準備好接受連線。

### 運行與通訊日誌
- \`Client connected\`：前端網頁成功建立 WebSocket 連線。
- \`Recognized: [辨識文字]\`：模型成功將一段音訊轉換為文字，並準備推播給前端。此日誌可作為比對延遲的參考基準。
- \`Client disconnected\`：前端網頁主動關閉連線 (例如停止提詞或關閉網頁)。
- \`Error: [錯誤訊息]\`：WebSocket 傳輸過程中發生異常或音訊解析失敗。

---

## 3. 未來擴充建議 (API Roadmap)

目前為 MVP 階段，僅有一支 WebSocket API。未來若需增加進階功能，建議擴充下列端點：
1. **`GET /api/status`**：確認伺服器與 GPU 狀態。
2. **`POST /api/settings`**：允許前端動態調整 Whisper 的 `chunk_size`、`beam_size` 或切換模型大小 (如 `base` 切換至 `small`)。
3. **`WS /ws/control`**：建立獨立的控制通道，傳送「暫停辨識」、「清空緩衝區」等控制指令。
