import React, { useState, useEffect, useRef } from 'react';

const DEFAULT_SCRIPT = `大家好，歡迎來到今天的簡報。
這是一個基於 AI 語音辨識的自動提詞器。
當您說話時，系統會自動捕捉您的聲音，
並透過本地端的 Whisper 模型轉換為文字。
接著，網頁會自動比對您讀到的段落，
讓畫面平滑地往下捲動。
這樣一來，您就不必手動控制提詞機，
可以更專注於您的演講表現。
謝謝大家的聆聽！`;

export default function App() {
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [isPrompterMode, setIsPrompterMode] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAIFollowEnabled, setIsAIFollowEnabled] = useState(false);
  
  const [fontSize, setFontSize] = useState<number>(48);
  const [autoPlaySpeed, setAutoPlaySpeed] = useState<number>(30);
  const [isMirror, setIsMirror] = useState<boolean>(false);
  
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [recognizedText, setRecognizedText] = useState("");
  
  const prompterBoxRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const animationIdRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const currentScrollRef = useRef<number>(0);
  const searchStartIndexRef = useRef(0);
  const clearTimerRef = useRef<NodeJS.Timeout | null>(null);

  const scriptLines = script.split('\n').filter(l => l.trim() !== '');

  // 更新 Highlight 邏輯
  const updateHighlight = () => {
    if (!prompterBoxRef.current) return;
    const boxTop = prompterBoxRef.current.scrollTop;
    const boxHeight = prompterBoxRef.current.clientHeight;
    const boxMid = boxTop + (boxHeight / 2);

    let closestIndex = -1;
    let minDist = Infinity;

    segmentRefs.current.forEach((seg, index) => {
      if (!seg) return;
      const segMid = seg.offsetTop + (seg.offsetHeight / 2);
      const dist = Math.abs(boxMid - segMid);
      const threshold = 160; 
      if (dist < threshold) {
        seg.classList.add('active');
      } else {
        seg.classList.remove('active');
      }

      // 找出視覺上最接近中央（被選中框框住）的段落
      if (dist < minDist) {
        minDist = dist;
        closestIndex = index;
      }
    });

    // 將 AI 的檢索起點完全同步為畫面方框選中的段落
    if (closestIndex !== -1 && closestIndex !== searchStartIndexRef.current) {
      searchStartIndexRef.current = closestIndex;
      setCurrentLineIndex(closestIndex);
    }
  };

  // Jump to specific index (used by AI follow)
  const jumpTo = (index: number) => {
    if (!prompterBoxRef.current || !segmentRefs.current[index]) return;
    const target = segmentRefs.current[index]!;
    const boxHeight = prompterBoxRef.current.clientHeight;
    const targetPos = target.offsetTop - (boxHeight / 2) + (target.offsetHeight / 2);
    
    prompterBoxRef.current.scrollTo({ top: targetPos, behavior: 'smooth' });
    currentScrollRef.current = targetPos;
    setTimeout(updateHighlight, 300);
  };

  const matchAndScroll = (newText: string) => {
    const cleanText = newText.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
    if (cleanText.length < 2) return;
    
    // 取最後 12 個字作為特徵
    const searchPart = cleanText.length > 12 ? cleanText.slice(-12) : cleanText;
    let bestMatchIndex = -1;
    let highestScore = 0.3; 
    
    // 動態計算滑動視窗：確保搜尋範圍內至少包含 3 個「內容不重複」的有效行
    let distinctLines = 0;
    let maxSearch = searchStartIndexRef.current;
    const seenTexts = new Set<string>();
    
    while (maxSearch < scriptLines.length && distinctLines < 3) {
      const cleanLine = scriptLines[maxSearch].replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
      if (cleanLine.length > 0) {
        if (!seenTexts.has(cleanLine)) {
          seenTexts.add(cleanLine);
          distinctLines++;
        }
      }
      maxSearch++;
    }
    
    // 在動態視窗內進行比對
    for (let i = searchStartIndexRef.current; i < maxSearch; i++) {
      const cleanLine = scriptLines[i].replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
      if (cleanLine.length === 0) continue;

      let matchCount = 0;
      let totalBigrams = Math.max(1, searchPart.length - 1);
      
      for (let j = 0; j < searchPart.length - 1; j++) {
        const bigram = searchPart.substring(j, j + 2);
        if (cleanLine.includes(bigram)) matchCount++;
      }
      
      if (searchPart.length < 3) {
        matchCount = 0;
        totalBigrams = searchPart.length;
        for (let char of searchPart) {
          if (cleanLine.includes(char)) matchCount++;
        }
      }

      const score = matchCount / totalBigrams;
      if (score > highestScore) {
        highestScore = score;
        bestMatchIndex = i;
      }
    }

    if (bestMatchIndex !== -1) {
      setCurrentLineIndex(bestMatchIndex);
      searchStartIndexRef.current = bestMatchIndex;
      jumpTo(bestMatchIndex);
    }
  };

  const scrollLoop = (time: number) => {
    if (!isPlaying || isAIFollowEnabled) return;
    if (!prompterBoxRef.current) return;

    if (!lastTimeRef.current) lastTimeRef.current = time;
    const dt = time - lastTimeRef.current;
    lastTimeRef.current = time;

    const speedFactor = autoPlaySpeed * 0.05;
    if (speedFactor > 0) {
      currentScrollRef.current += (speedFactor * dt) / 16;
      prompterBoxRef.current.scrollTop = currentScrollRef.current;
      updateHighlight();
    }

    if (currentScrollRef.current < prompterBoxRef.current.scrollHeight) {
      animationIdRef.current = requestAnimationFrame(scrollLoop);
    } else {
      setIsPlaying(false);
    }
  };

  useEffect(() => {
    if (isPlaying && !isAIFollowEnabled) {
      lastTimeRef.current = 0;
      if (prompterBoxRef.current) {
        currentScrollRef.current = prompterBoxRef.current.scrollTop;
      }
      animationIdRef.current = requestAnimationFrame(scrollLoop);
    } else {
      if (animationIdRef.current) cancelAnimationFrame(animationIdRef.current);
    }
    return () => {
      if (animationIdRef.current) cancelAnimationFrame(animationIdRef.current);
    };
  }, [isPlaying, isAIFollowEnabled, autoPlaySpeed]);

  const togglePlay = () => {
    if (isAIFollowEnabled) stopAIFollow();
    setIsPlaying(!isPlaying);
  };

  const startAIFollow = async () => {
    try {
      if (isPlaying) setIsPlaying(false);
      
      wsRef.current = new WebSocket('ws://localhost:8000/ws/audio');
      wsRef.current.onopen = () => console.log("WebSocket Connected");
      wsRef.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.text) {
          console.log("收到辨識結果:", data.text);
          setRecognizedText(prev => {
             // 這裡我們只顯示「當前這句話」。當使用者停頓時，定時器會清空 prev，
             // 所以這會自然形成「一句話一句話顯示」的效果，不會無限變長。
             const combined = prev + data.text;
             return combined.length > 40 ? "..." + combined.slice(-40) : combined;
          });
          
          // 重新設定清除計時器（例如 2.5 秒後沒有收到新字串，就清空顯示）
          if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
          clearTimerRef.current = setTimeout(() => {
             setRecognizedText("");
          }, 2500);

          // 恢復使用單次 data.text 進行比對，確保 Bi-gram 的分母不會異常膨脹
          matchAndScroll(data.text);
        }
      };
      wsRef.current.onclose = () => {
        console.log("WebSocket Disconnected");
        stopAIFollow();
      };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000 } });
      streamRef.current = stream;

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      source.connect(processor);
      processor.connect(audioContext.destination);

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const int16Data = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
            let s = Math.max(-1, Math.min(1, inputData[i]));
            int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(int16Data.buffer);
        }
      };

      setIsAIFollowEnabled(true);
    } catch (err) {
      console.error("啟動收音失敗:", err);
      alert("無法啟動麥克風或連線到伺服器。請確定後端已啟動。");
      setIsAIFollowEnabled(false);
    }
  };

  const stopAIFollow = () => {
    if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null; }
    if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(track => track.stop()); streamRef.current = null; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    setIsAIFollowEnabled(false);
  };

  const toggleAIFollow = () => {
    if (isAIFollowEnabled) stopAIFollow();
    else startAIFollow();
  };

  const startPrompter = () => {
    const lines = script.split('\n').filter(l => l.trim() !== '');
    if (lines.length === 0) return;
    setCurrentLineIndex(0);
    searchStartIndexRef.current = 0;
    setRecognizedText("");
    setIsPrompterMode(true);
    resetPrompter();
  };

  const resetPrompter = () => {
    if (prompterBoxRef.current) {
      prompterBoxRef.current.scrollTop = 0;
      currentScrollRef.current = 0;
    }
    if (isPlaying) setIsPlaying(false);
    setTimeout(updateHighlight, 100);
  };

  const exitPrompter = () => {
    setIsPrompterMode(false);
    if (isPlaying) setIsPlaying(false);
    if (isAIFollowEnabled) stopAIFollow();
  };

  const handleScroll = () => {
    if (!isPlaying && prompterBoxRef.current) {
      currentScrollRef.current = prompterBoxRef.current.scrollTop;
      updateHighlight();
    }
  };

  useEffect(() => {
    if (isPrompterMode) {
      setTimeout(updateHighlight, 100);
    }
  }, [isPrompterMode, fontSize]);

  const autoFormatText = () => {
    if (!script) return;
    
    // 1. 保留使用者原本的段落結構 (以換行為界)
    const paragraphs = script.split(/\n+/);
    const formattedLines: string[] = [];
    
    // 複合標點正則：
    // 匹配 1：連續的基礎標點 (如 ！？ 或 。。。) 加上可選的右側括號/引號 (如 。」 或 ！）)
    // 匹配 2：英文刪節號 (...) 或中文刪節號 (……)
    const punctuationRegex = /([。！？；!?;，、,]+[」”’）)\]}]*|\.{3,}|…+)/g;
    
    // 強斷句正則：判斷是否為句子的絕對終點
    const strongEndRegex = /([。！？；!?;]+[」”’）)\]}]*|\.{3,}|…+)\s*$/;

    paragraphs.forEach(para => {
      // 2. 在標點符號群組後方插入隱藏的分割標記「|」
      const clauses = para
        .replace(punctuationRegex, '$1|')
        .split('|')
        .filter(c => c.trim().length > 0);
        
      let currentLine = "";
      
      clauses.forEach(clause => {
        if (currentLine.length === 0) {
          currentLine = clause.trimStart();
        } else {
          const currentIsStrongEnd = strongEndRegex.test(currentLine);
          const combinedLength = currentLine.replace(/\s/g, '').length + clause.replace(/\s/g, '').length;
          
          // 放寬字數閾值至 26 字，適合習慣將字體調小或螢幕較寬的使用者
          if (!currentIsStrongEnd && combinedLength <= 26) {
             currentLine += clause; 
          } else {
            formattedLines.push(currentLine.trimEnd());
            currentLine = clause.trimStart();
          }
        }
      });
      
      if (currentLine.trim().length > 0) {
        formattedLines.push(currentLine.trimEnd());
      }
    });
    
    setScript(formattedLines.join('\n'));
  };

  return (
    <>
      {/* 編輯介面 */}
      <div id="editor-overlay" className={`fixed inset-0 flex flex-col p-6 transition-all duration-700 ${isPrompterMode ? 'opacity-0 pointer-events-none scale-105' : 'opacity-100 scale-100'}`}>
          <div className="max-w-2xl mx-auto w-full flex flex-col h-full justify-center">
              <div className="mb-8 text-center">
                  <h1 className="text-5xl font-black tracking-tighter mb-2 text-white uppercase italic">Prompter</h1>
                  <p className="text-zinc-600 text-sm font-light tracking-[0.4em] uppercase">Intelligence Vision</p>
              </div>
              
              <textarea 
                id="text-input" 
                className="flex-1 glass-panel p-6 text-lg outline-none focus:border-blue-500/30 transition-all resize-none shadow-2xl mb-8 leading-relaxed text-white border-white/5" 
                placeholder="在此貼上您的一整段講稿，我們將協助您排版..."
                value={script}
                onChange={(e) => setScript(e.target.value)}
              ></textarea>
              
              <div className="flex justify-between items-center px-2">
                  <button onClick={autoFormatText} className="flex items-center space-x-2 text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 px-6 py-4 rounded-2xl font-bold transition-all active:scale-95 border border-white/10">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12H3"/><path d="M21 6H3"/><path d="M21 18H3"/><path d="M17 22V14"/><path d="m14 17 3-3 3 3"/></svg>
                      <span>自動斷句排版</span>
                  </button>

                  <button onClick={startPrompter} className="px-12 py-4 bg-white text-black rounded-full text-xl font-bold transition-all hover:scale-105 active:scale-95 shadow-[0_15px_40px_rgba(255,255,255,0.1)] uppercase italic tracking-tighter">
                      進入提詞
                  </button>
              </div>
          </div>

          {/* 組織版權與開發者資訊 Footer */}
          <div className="absolute bottom-6 left-0 w-full flex flex-col items-center justify-center text-zinc-500 text-xs gap-3">
              <div className="flex items-center gap-3">
                  <img src="/scuai-logo.png" alt="SCUAI Logo" className="h-8 w-auto opacity-70 hover:opacity-100 transition-opacity" />
                  <span className="font-medium tracking-widest uppercase">Powered by kesoner & SCUAI</span>
              </div>
              <a href="mailto:kesoner666@com" className="hover:text-blue-400 transition-colors tracking-widest">kesoner666@com</a>
          </div>
      </div>

      {/* 提詞區域包裝 */}
      <div className="prompter-wrapper">
          <div className="vignette"></div>
          <div className="fixed-focus-overlay">
              <div className="guide-line guide-left"></div>
              <div className="guide-line guide-right"></div>
          </div>

          <div className="prompter-container" id="prompter-box" ref={prompterBoxRef} onScroll={handleScroll}>
              <div id="scrolling-content" className={`scrolling-content text-center font-bold ${isMirror ? 'mirror-mode' : ''}`} style={{ fontSize: `${fontSize}px` }}>
                  {scriptLines.map((line, idx) => (
                    <span 
                      key={idx} 
                      className="text-segment px-4"
                      ref={el => segmentRefs.current[idx] = el}
                    >
                      {line}
                    </span>
                  ))}
              </div>
          </div>
      </div>

      {/* 底部顯示目前的辨識狀態 */}
      {isAIFollowEnabled && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 px-6 py-2 bg-zinc-900/80 border border-white/10 rounded-full backdrop-blur-md z-[70] text-center shadow-xl">
          <p className="text-xs text-zinc-400 font-mono flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
            <span className="shrink-0 text-blue-400 font-bold tracking-widest">LIVE</span> 
            <span className="text-white font-medium max-w-[300px] truncate">{recognizedText || "等待語音輸入..."}</span>
          </p>
        </div>
      )}

      {/* 懸浮控制列 */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 flex items-center p-4 glass-panel z-[80] shadow-2xl space-x-4">
          
          {/* 滾動速度 */}
          <div className="flex flex-col px-3 space-y-1.5">
              <div className="flex items-center space-x-2 text-[9px] text-zinc-500 font-bold uppercase tracking-[0.2em]">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                  <span>Speed</span>
              </div>
              <input id="speed-slider" type="range" min="0" max="100" value={autoPlaySpeed} onChange={(e) => setAutoPlaySpeed(Number(e.target.value))} className="w-24" />
          </div>

          {/* 字體大小 */}
          <div className="flex flex-col px-3 space-y-1.5 border-l border-white/10">
              <div className="flex items-center space-x-2 text-[9px] text-zinc-500 font-bold uppercase tracking-[0.2em]">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
                  <span>Size</span>
              </div>
              <input id="size-slider" type="range" min="24" max="160" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="w-24" />
          </div>

          {/* 按鈕組 */}
          <div className="flex items-center space-x-2 border-l border-white/10 pl-2">
              <button id="ai-btn" onClick={toggleAIFollow} className={`glass-btn ${isAIFollowEnabled ? 'bg-blue-600/30 border-blue-500/50 animate-pulse' : ''}`} title="AI 跟讀">
                  <svg id="ai-icon" xmlns="http://www.w3.org/2000/svg" className={`transition-colors ${isAIFollowEnabled ? 'text-blue-400' : 'text-zinc-400'}`} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>
              </button>
              
              <button onClick={() => setIsMirror(!isMirror)} className={`glass-btn ${isMirror ? 'border-white/40 bg-white/10' : ''}`} title="鏡像模式">
                  <svg xmlns="http://www.w3.org/2000/svg" className={`transition-colors ${isMirror ? 'text-white' : 'text-zinc-400'}`} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/><path d="M7 8h2"/><path d="M7 12h2"/><path d="M7 16h2"/><path d="M15 8h2"/><path d="M15 12h2"/><path d="M15 16h2"/></svg>
              </button>

              <button onClick={resetPrompter} className="glass-btn" title="重置">
                  <svg xmlns="http://www.w3.org/2000/svg" className="text-zinc-400 transition-colors" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              </button>
          </div>

          {/* 播放控制 */}
          <button id="play-btn" onClick={togglePlay} className={`w-14 h-14 flex items-center justify-center rounded-2xl hover:scale-105 active:scale-90 transition-all shadow-xl ${isPlaying ? 'bg-white text-black shadow-white/30' : 'bg-blue-600 text-white shadow-blue-600/30 hover:bg-blue-500'}`}>
              {isPlaying ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="5" width="3" height="14"></rect><rect x="14" y="5" width="3" height="14"></rect></svg>
              ) : (
                <svg id="play-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              )}
          </button>

          {/* 退出 */}
          <button onClick={exitPrompter} className="glass-btn border-red-500/20 hover:bg-red-500/10 ml-2" title="退出">
              <svg xmlns="http://www.w3.org/2000/svg" className="text-zinc-500 hover:text-red-500 transition-colors" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>
      </div>
    </>
  );
}
