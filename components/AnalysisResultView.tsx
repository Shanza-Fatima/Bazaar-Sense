import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnalysisResult, HistoryItem } from '../types.ts';
import { 
  generateTTS, 
  decodeAudioData, 
  bazaarTranslate,
  BazaarTranslationResult 
} from '../services/gemini.ts';

interface ChatMessage {
  id: string;
  role: 'traveler' | 'seller';
  text: string;
  nativeTranslation?: string;
  phonetic?: string;
  audioBase64?: string;
  timestamp: number;
}

interface AnalysisResultViewProps {
  result: AnalysisResult;
  onReset: () => void;
  onSaveHistory: (item: HistoryItem) => void;
}

const floatTo16BitPCMBase64 = (float32Array: Float32Array): string => {
  const int16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  let binary = '';
  const bytes = new Uint8Array(int16.buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const AnalysisResultView: React.FC<AnalysisResultViewProps> = ({ result, onReset, onSaveHistory }) => {
  const [activeVoice, setActiveVoice] = useState<'urdu' | 'pashto' | string | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [travelerInput, setTravelerInput] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [dealStatus, setDealStatus] = useState<'none' | 'success'>('none');
  const [sellerLanguage, setSellerLanguage] = useState<'pashto' | 'urdu'>('pashto');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [quickReplies, setQuickReplies] = useState<Array<{ text: string; native?: string; subtext?: string }>>([]);

  // Live WebSocket state
  const [liveStatus, setLiveStatus] = useState<'idle' | 'connecting' | 'listening' | 'speaking' | 'error'>('idle');
  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const pcmSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  const staticAudioCtxRef = useRef<AudioContext | null>(null);
  const recognitionRef = useRef<any>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [chatHistory, isTranslating, liveStatus]);

  // Stop Live Session Cleanly
  const stopLiveSession = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    if (scriptProcessorRef.current) {
      try { scriptProcessorRef.current.disconnect(); } catch {}
      scriptProcessorRef.current = null;
    }
    if (inputAudioCtxRef.current && inputAudioCtxRef.current.state !== 'closed') {
      inputAudioCtxRef.current.close().catch(() => {});
      inputAudioCtxRef.current = null;
    }
    if (outputAudioCtxRef.current && outputAudioCtxRef.current.state !== 'closed') {
      outputAudioCtxRef.current.close().catch(() => {});
      outputAudioCtxRef.current = null;
    }
    pcmSourcesRef.current.forEach(s => { try { s.stop(); } catch {} });
    pcmSourcesRef.current = [];
    nextStartTimeRef.current = 0;

    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
    setLiveStatus('idle');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopLiveSession();
      if (staticAudioCtxRef.current && staticAudioCtxRef.current.state !== 'closed') {
        staticAudioCtxRef.current.close().catch(() => {});
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
    };
  }, [stopLiveSession]);

  // Start Live Audio Streaming via Server WebSocket Bridge
  const startLiveSession = async () => {
    if (!navigator.onLine) {
      alert("Live Voice Bridge requires an internet connection.");
      return;
    }

    setLiveStatus('connecting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });
      mediaStreamRef.current = stream;

      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      inputAudioCtxRef.current = inputCtx;

      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      outputAudioCtxRef.current = outputCtx;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/live?lang=${sellerLanguage}&item=${encodeURIComponent(result.objectName)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("Connected to server Live API WebSocket");
        setLiveStatus('listening');

        // Pipe microphone input into 16kHz PCM chunks
        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        scriptProcessorRef.current = processor;

        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const float32 = e.inputBuffer.getChannelData(0);
          const pcmBase64 = floatTo16BitPCMBase64(float32);
          ws.send(JSON.stringify({ type: 'audio', data: pcmBase64 }));
        };

        source.connect(processor);
        processor.connect(inputCtx.destination);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'ready') {
            setLiveStatus('listening');
          } else if (msg.type === 'inputTranscription' && msg.text) {
            const rawText = msg.text.trim();
            if (rawText) {
              setChatHistory(prev => {
                const last = prev[prev.length - 1];
                if (last && last.role === 'traveler') {
                  return [...prev.slice(0, -1), { ...last, text: last.text + ' ' + rawText }];
                }
                return [...prev, {
                  id: 'live-in-' + Date.now(),
                  role: 'traveler',
                  text: rawText,
                  timestamp: Date.now()
                }];
              });
            }
          } else if (msg.type === 'outputTranscription' && msg.text) {
            const rawText = msg.text.trim();
            if (rawText) {
              setChatHistory(prev => {
                const last = prev[prev.length - 1];
                if (last && last.role === 'seller') {
                  return [...prev.slice(0, -1), { ...last, text: last.text + ' ' + rawText }];
                }
                return [...prev, {
                  id: 'live-out-' + Date.now(),
                  role: 'seller',
                  text: rawText,
                  timestamp: Date.now()
                }];
              });
            }
          } else if (msg.type === 'audio' && msg.data) {
            setLiveStatus('speaking');
            playLivePcmChunk(outputCtx, msg.data);
          } else if (msg.type === 'interrupted') {
            pcmSourcesRef.current.forEach(s => { try { s.stop(); } catch {} });
            pcmSourcesRef.current = [];
            nextStartTimeRef.current = 0;
            setLiveStatus('listening');
          } else if (msg.type === 'turnComplete') {
            setTimeout(() => {
              if (pcmSourcesRef.current.length === 0) {
                setLiveStatus('listening');
              }
            }, 300);
          } else if (msg.type === 'error') {
            console.error("Live Bridge WS error:", msg.error);
            setLiveStatus('error');
          }
        } catch (parseErr) {
          console.error("WS message parse error:", parseErr);
        }
      };

      ws.onerror = (e) => {
        console.error("WebSocket connection error:", e);
        setLiveStatus('error');
        const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
        if (!isLocal) {
          alert("Live voice needs the Node server and is not available on this hosted version. Run the app locally with 'npm run dev' to use it. The text translation and scan features still work here.");
        }
      };

      ws.onclose = () => {
        console.log("WebSocket bridge closed");
        setLiveStatus('idle');
      };

    } catch (err: any) {
      console.error("Failed to start Live session:", err);
      alert("Microphone permission was denied or live audio could not be initialized.");
      setLiveStatus('error');
    }
  };

  const playLivePcmChunk = (ctx: AudioContext, base64Pcm: string) => {
    try {
      if (ctx.state === 'suspended') ctx.resume();
      const binary = atob(base64Pcm);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0;
      }
      const buffer = ctx.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      const now = ctx.currentTime;
      if (nextStartTimeRef.current < now) {
        nextStartTimeRef.current = now;
      }
      source.start(nextStartTimeRef.current);
      nextStartTimeRef.current += buffer.duration;
      pcmSourcesRef.current.push(source);

      source.onended = () => {
        pcmSourcesRef.current = pcmSourcesRef.current.filter(s => s !== source);
        if (pcmSourcesRef.current.length === 0 && liveStatus === 'speaking') {
          setLiveStatus('listening');
        }
      };
    } catch (err) {
      console.error("PCM Chunk decode error:", err);
    }
  };

  const getStaticAudioContext = () => {
    if (!staticAudioCtxRef.current || staticAudioCtxRef.current.state === 'closed') {
      staticAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    if (staticAudioCtxRef.current.state === 'suspended') {
      staticAudioCtxRef.current.resume();
    }
    return staticAudioCtxRef.current;
  };

  const playAudioBytes = useCallback(async (audioBytes: Uint8Array, idTag: string) => {
    try {
      setActiveVoice(idTag);
      const ctx = getStaticAudioContext();
      const audioBuffer = await decodeAudioData(audioBytes, ctx);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => setActiveVoice(null);
      source.start();
    } catch (err) {
      console.error('Audio Playback Error:', err);
      setActiveVoice(null);
    }
  }, []);

  const playStaticAudio = useCallback(async (text: string, contextLanguage: string, type: 'urdu' | 'pashto') => {
    if (!navigator.onLine) {
      alert("Pronunciation audio requires an internet connection. The native script and valuation details remain accessible offline!");
      return;
    }
    try {
      setActiveVoice(type);
      const audioBytes = await generateTTS(text, contextLanguage);
      await playAudioBytes(audioBytes, type);
    } catch (err) {
      console.error('TTS Error:', err);
      setActiveVoice(null);
    }
  }, [playAudioBytes]);

  // Handle Traveler Sending a message (Text or Speech)
  const handleSendTravelerMessage = async (customText?: string) => {
    const textToSend = (customText || travelerInput).trim();
    if (!textToSend || isTranslating) return;

    setTravelerInput('');

    // If live session is active, send directly to server Live API via WebSocket
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'text', text: textToSend }));
      return;
    }

    // Otherwise use server-side translate endpoint
    setIsTranslating(true);
    const tempId = 'msg-' + Date.now().toString();

    try {
      const res: BazaarTranslationResult = await bazaarTranslate(
        textToSend,
        'traveler',
        sellerLanguage,
        result.objectName
      );

      const newMsg: ChatMessage = {
        id: tempId,
        role: 'traveler',
        text: textToSend,
        nativeTranslation: res.translation,
        phonetic: res.phonetic,
        timestamp: Date.now(),
      };

      setChatHistory(prev => [...prev, newMsg]);

      if (res.sellerQuickReplies && res.sellerQuickReplies.length > 0) {
        setQuickReplies(res.sellerQuickReplies.map(r => ({ text: r.text, native: r.native })));
      } else {
        setQuickReplies([]);
      }

      // Automatically speak the Pashto/Urdu translation aloud to the merchant
      if (res.translation) {
        try {
          const audioBytes = await generateTTS(res.translation, sellerLanguage === 'pashto' ? 'Pashto' : 'Urdu');
          playAudioBytes(audioBytes, tempId);
        } catch (audioErr) {
          console.warn("TTS auto-speak skipped:", audioErr);
        }
      }
    } catch (err: any) {
      console.error("Translation error:", err);
      alert("Translation failed: " + (err?.message || "Please check network connection."));
    } finally {
      setIsTranslating(false);
    }
  };

  // Handle Merchant Responding
  const handleSendSellerReply = async (replyText: string, nativeScript?: string) => {
    if (isTranslating) return;
    setIsTranslating(true);

    const tempId = 'msg-' + Date.now().toString();
    const promptText = nativeScript || replyText;

    try {
      const res: BazaarTranslationResult = await bazaarTranslate(
        promptText,
        'seller',
        sellerLanguage,
        result.objectName
      );

      const newMsg: ChatMessage = {
        id: tempId,
        role: 'seller',
        text: res.translation,
        nativeTranslation: nativeScript || promptText,
        phonetic: res.phonetic,
        timestamp: Date.now(),
      };

      setChatHistory(prev => [...prev, newMsg]);

      if (res.travelerQuickReplies && res.travelerQuickReplies.length > 0) {
        setQuickReplies(res.travelerQuickReplies.map(r => ({ text: r.text, subtext: r.subtext })));
      } else {
        setQuickReplies([]);
      }
    } catch (err: any) {
      console.error("Seller translation error:", err);
    } finally {
      setIsTranslating(false);
    }
  };

  // Web Speech API Voice Dictation for English
  const startVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Voice speech recognition is not supported in this browser. You can type in English or tap Start Live Voice Bridge above.");
      return;
    }

    try {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }

      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => setIsListening(true);
      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) handleSendTravelerMessage(transcript);
      };
      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.warn("Could not start speech recognition:", err);
      setIsListening(false);
    }
  };

  const isInconclusive = result.objectName.toLowerCase().includes("not identified");

  const handleSuccessfulBuy = () => {
    onSaveHistory({ 
      id: Date.now().toString(), 
      objectName: result.objectName, 
      pricePKR: result.pricePKR, 
      timestamp: Date.now(),
      result: result
    });
    setDealStatus('success');
  };

  const copyDiscountCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2500);
  };

  if (dealStatus === 'success') {
    return (
      <div className="bg-white/95 backdrop-blur-2xl rounded-[3rem] elegant-shadow p-8 md:p-14 text-center border-4 border-emerald-100 max-w-lg mx-auto animate-in zoom-in-95">
        <div className="w-20 h-20 bg-emerald-100 text-emerald-700 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-inner">
          <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <span className="text-[10px] font-black uppercase tracking-[0.4em] text-emerald-600 block mb-2">Deal Concluded</span>
        <h2 className="text-2xl md:text-3xl font-black text-teal-950 mb-3 tracking-tight">Mubarak! Acquisition Logged</h2>
        <p className="text-teal-900/60 text-xs md:text-sm font-medium mb-8 leading-relaxed max-w-sm mx-auto">
          <strong>{result.objectName}</strong> valued at <strong>{result.pricePKR}</strong> has been archived to your offline acquisition history.
        </p>
        <button 
          onClick={onReset} 
          className="w-full py-5 bg-teal-900 hover:bg-teal-850 text-white rounded-2xl font-black text-xs uppercase tracking-[0.3em] shadow-xl btn-elegant"
        >
          Scan Next Bazaar Item
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white/95 backdrop-blur-2xl rounded-[2.5rem] elegant-shadow p-5 md:p-8 animate-in fade-in duration-700 border border-white/60 w-full max-w-full overflow-hidden box-border space-y-6">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 w-full min-w-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={`w-2 h-2 rounded-full shrink-0 ${isInconclusive ? 'bg-amber-400' : 'bg-emerald-500'}`}></span>
            <span className="text-[10px] font-black text-teal-900/50 uppercase tracking-[0.2em]">
              {isInconclusive ? 'Scan Inconclusive' : 'Verified Peshawar Bazaar Commodity'}
            </span>
            {!navigator.onLine && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 text-[8px] font-black uppercase tracking-wider border border-amber-200">
                Offline Cache
              </span>
            )}
          </div>
          <h2 className="text-xl md:text-3xl font-black text-teal-950 leading-tight break-words [overflow-wrap:anywhere]">
            {result.objectName}
          </h2>
        </div>
        
        {!isInconclusive && (
          <div className="bg-gradient-to-br from-teal-50 to-amber-50/40 border border-teal-100/70 px-5 py-3 rounded-2xl text-left sm:text-right shrink-0">
            <span className="text-[9px] font-black text-teal-600 block uppercase tracking-wider mb-0.5">Estimated Price (PKR)</span>
            <div className="text-xl sm:text-2xl md:text-3xl font-black text-amber-700 tracking-tight leading-tight">
              {result.pricePKR}
            </div>
          </div>
        )}
      </div>

      {/* Description Box */}
      <div className="bg-gradient-to-br from-amber-50/30 to-teal-50/30 border border-amber-100/50 rounded-2xl p-4">
        <p className="text-xs md:text-sm font-medium text-teal-950/80 leading-relaxed italic">
          "{result.description}"
        </p>
        {result.locationTips && (
          <div className="mt-3 pt-3 border-t border-amber-200/40 flex items-start gap-2 text-[11px] text-teal-900/70 font-semibold">
            <span className="text-amber-600 shrink-0">📍 Tip:</span>
            <span>{result.locationTips}</span>
          </div>
        )}
      </div>

      {!isInconclusive && (
        <>
          {/* Dual Pronunciation Vocabulary Badges */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Urdu Card */}
            <div className="p-4 rounded-2xl bg-rose-50/50 border border-rose-100 flex items-center justify-between shadow-sm">
              <div className="min-w-0 flex-1 pr-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[8px] font-black uppercase tracking-wider bg-rose-200/60 text-rose-800 px-2 py-0.5 rounded-full">
                    Urdu • اردو
                  </span>
                  {result.urdu.phonetic && (
                    <span className="text-[10px] text-rose-700/70 font-mono italic">
                      ({result.urdu.phonetic})
                    </span>
                  )}
                </div>
                <div className="text-base md:text-lg font-black text-rose-950 break-words" dir="rtl">
                  {result.urdu.name}
                </div>
              </div>
              <button 
                onClick={() => playStaticAudio(result.urdu.name, "Urdu", "urdu")} 
                title="Play Urdu pronunciation"
                disabled={activeVoice === 'urdu'}
                className={`p-3 rounded-xl transition-all active:scale-90 shadow-sm shrink-0 ${
                  activeVoice === 'urdu' 
                    ? 'bg-rose-600 text-white animate-pulse' 
                    : 'bg-white hover:bg-rose-50 text-rose-600 border border-rose-200'
                }`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              </button>
            </div>

            {/* Pashto Card */}
            <div className="p-4 rounded-2xl bg-teal-50/50 border border-teal-100 flex items-center justify-between shadow-sm">
              <div className="min-w-0 flex-1 pr-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[8px] font-black uppercase tracking-wider bg-teal-200/60 text-teal-800 px-2 py-0.5 rounded-full">
                    Pashto • پښتو
                  </span>
                  {result.pashto.phonetic && (
                    <span className="text-[10px] text-teal-700/70 font-mono italic">
                      ({result.pashto.phonetic})
                    </span>
                  )}
                </div>
                <div className="text-base md:text-lg font-black text-teal-950 break-words" dir="rtl">
                  {result.pashto.name}
                </div>
              </div>
              <button 
                onClick={() => playStaticAudio(result.pashto.name, "Pashto", "pashto")} 
                title="Play Pashto pronunciation"
                disabled={activeVoice === 'pashto'}
                className={`p-3 rounded-xl transition-all active:scale-90 shadow-sm shrink-0 ${
                  activeVoice === 'pashto' 
                    ? 'bg-teal-700 text-white animate-pulse' 
                    : 'bg-white hover:bg-teal-50 text-teal-700 border border-teal-200'
                }`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Bazaar Voice Bridge: Live API Streaming & Real-Time Negotiation */}
          <div className="bg-teal-950 rounded-[2rem] p-5 shadow-2xl flex flex-col border border-teal-900 text-white">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-teal-800/80 gap-3">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${
                  liveStatus === 'listening' ? 'bg-emerald-400 animate-pulse' :
                  liveStatus === 'speaking' ? 'bg-amber-400 animate-pulse' :
                  liveStatus === 'connecting' ? 'bg-blue-400 animate-spin' :
                  'bg-teal-700'
                }`}></span>
                <span className="text-[10px] font-black uppercase tracking-widest text-teal-200">
                  Bazaar Voice Bridge &bull; {liveStatus !== 'idle' ? 'Live API Streaming' : 'Ready'}
                </span>
              </div>

              <div className="flex items-center gap-1.5 self-start sm:self-auto bg-teal-900/60 p-1 rounded-xl border border-teal-800">
                <span className="text-[9px] font-bold text-teal-400 uppercase px-1.5">Translate to:</span>
                {(['pashto', 'urdu'] as const).map((lang) => (
                  <button
                    key={lang}
                    onClick={() => {
                      if (liveStatus !== 'idle') stopLiveSession();
                      setSellerLanguage(lang);
                    }}
                    className={`px-3 py-1 text-[9px] font-black uppercase rounded-lg transition-all ${
                      sellerLanguage === lang
                        ? 'bg-amber-500 text-stone-950 shadow-md font-bold'
                        : 'text-teal-300 hover:text-white'
                    }`}
                  >
                    {lang === 'pashto' ? 'پښتو (Pashto)' : 'اردو (Urdu)'}
                  </button>
                ))}
              </div>
            </div>

            {/* Conversation Log Container */}
            <div ref={scrollContainerRef} className="h-64 overflow-y-auto space-y-3.5 my-4 pr-1.5 custom-scrollbar">
              {chatHistory.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-teal-400/60">
                  <div className="w-12 h-12 rounded-2xl bg-teal-900/40 border border-teal-800/60 flex items-center justify-center text-teal-300 mb-3">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <p className="text-xs font-bold text-teal-200">Start Negotiating with the Merchant</p>
                  <p className="text-[10px] text-teal-400/80 max-w-xs mt-1">
                    Connect the live voice bridge or use the quick bargaining phrases below. Translates English to {sellerLanguage === 'pashto' ? 'Pashto' : 'Urdu'} and speaks it aloud naturally.
                  </p>
                </div>
              ) : (
                chatHistory.map((msg) => {
                  const isSeller = msg.role === 'seller';
                  const isPashto = sellerLanguage === 'pashto';
                  return (
                    <div key={msg.id} className={`flex flex-col ${isSeller ? 'items-end' : 'items-start'}`}>
                      <span className={`text-[8px] font-black uppercase mb-1 tracking-wider ${isSeller ? 'text-amber-400' : 'text-teal-300'}`}>
                        {isSeller ? `Merchant (${isPashto ? 'پښتو' : 'اردو'})` : 'Traveler (English)'}
                      </span>
                      <div 
                        className={`max-w-[88%] p-3.5 rounded-2xl text-xs md:text-sm font-semibold break-words leading-relaxed shadow-md ${
                          isSeller 
                            ? 'bg-amber-950/70 border border-amber-600/40 text-amber-100 rounded-tr-none' 
                            : 'bg-teal-900/90 border border-teal-700/60 text-teal-50 rounded-tl-none'
                        }`}
                      >
                        <div>{msg.text}</div>

                        {msg.nativeTranslation && (
                          <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between gap-3">
                            <div className="text-right flex-1" dir="rtl">
                              <span className="text-sm md:text-base font-black text-amber-300 font-serif block">
                                {msg.nativeTranslation}
                              </span>
                              {msg.phonetic && (
                                <span className="text-[10px] font-mono text-teal-300/80 block mt-0.5" dir="ltr">
                                  Pronunciation: {msg.phonetic}
                                </span>
                              )}
                            </div>
                            <button
                              onClick={() => playStaticAudio(msg.nativeTranslation!, isPashto ? "Pashto" : "Urdu", 'msg-' + msg.id)}
                              title="Listen to translation"
                              className="p-2 rounded-lg bg-teal-800/80 hover:bg-teal-700 text-teal-200 transition-colors shrink-0"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}

              {isTranslating && (
                <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold py-2">
                  <div className="w-4 h-4 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin"></div>
                  <span>Translating & generating native voice...</span>
                </div>
              )}
            </div>

            {/* Live Streaming Toggle Button */}
            <div className="pb-3 border-b border-teal-800/80">
              {liveStatus === 'idle' || liveStatus === 'error' ? (
                <button
                  onClick={startLiveSession}
                  className="w-full py-3.5 rounded-xl bg-amber-500 hover:bg-amber-450 text-stone-950 font-black text-xs uppercase tracking-widest shadow-lg transition-all flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  <span>Start Live Voice Bridge (Hands-Free)</span>
                </button>
              ) : (
                <button
                  onClick={stopLiveSession}
                  className="w-full py-3.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500 text-rose-300 font-black text-xs uppercase tracking-widest shadow-lg transition-all flex items-center justify-center gap-2"
                >
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
                  <span>Halt Live Connection ({liveStatus === 'speaking' ? 'Speaking' : 'Listening'})</span>
                </button>
              )}
            </div>

            {/* Quick Negotiation Chips */}
            <div className="space-y-2 pt-3">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold text-teal-400 uppercase tracking-wider">
                  Quick Negotiation Phrases
                </span>
                {quickReplies.length > 0 && (
                  <span className="text-[8px] text-amber-300 font-semibold">Suggested counter-replies ready</span>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto custom-scrollbar">
                {quickReplies.length > 0 ? (
                  quickReplies.map((qr, idx) => (
                    <button
                      key={idx}
                      onClick={() => qr.native ? handleSendSellerReply(qr.text, qr.native) : handleSendTravelerMessage(qr.text)}
                      className="px-2.5 py-1 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-[10px] font-bold text-amber-200 transition-colors text-left"
                    >
                      <span>{qr.text}</span>
                      {qr.native && <span className="text-amber-400 font-serif ml-1.5">({qr.native})</span>}
                    </button>
                  ))
                ) : (
                  [
                    `What is your final price for this ${result.objectName}?`,
                    "Is this authentic handmade Peshawar quality?",
                    "Can you give a discount if I buy two pieces?",
                    "Please pack it carefully for an airplane journey.",
                    "Deal! Mubarak, thank you very much!"
                  ].map((phrase, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSendTravelerMessage(phrase)}
                      className="px-2.5 py-1 rounded-xl bg-teal-900/60 hover:bg-teal-800 border border-teal-700/60 text-[10px] font-medium text-teal-200 transition-colors text-left"
                    >
                      {phrase}
                    </button>
                  ))
                )}
              </div>

              {/* Input Form */}
              <div className="flex items-center gap-2 pt-1.5">
                <button
                  type="button"
                  onClick={startVoiceInput}
                  title="Speak in English"
                  className={`p-3 rounded-xl border transition-all active:scale-95 shrink-0 ${
                    isListening 
                      ? 'bg-rose-600 text-white border-rose-500 animate-pulse' 
                      : 'bg-teal-900 text-teal-300 border-teal-700 hover:text-white'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </button>

                <input
                  type="text"
                  value={travelerInput}
                  onChange={(e) => setTravelerInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSendTravelerMessage(); }}
                  placeholder={`Say or type English to speak in ${sellerLanguage === 'pashto' ? 'Pashto' : 'Urdu'}...`}
                  className="flex-1 px-4 py-3 rounded-xl bg-teal-900/60 border border-teal-700 text-xs text-white placeholder-teal-400/60 focus:outline-none focus:border-amber-400"
                />

                <button
                  type="button"
                  onClick={() => handleSendTravelerMessage()}
                  disabled={!travelerInput.trim() || isTranslating}
                  className="px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-450 disabled:opacity-50 text-stone-950 font-black text-xs uppercase tracking-wider transition-colors shrink-0"
                >
                  Translate
                </button>
              </div>
            </div>
          </div>

          {/* Verified Bazaar Shops Section */}
          {result.verifiedShops && result.verifiedShops.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black uppercase tracking-wider text-teal-950 flex items-center gap-2">
                  <span className="text-amber-600">🏛</span>
                  Verified Peshawar Bazaar Merchants
                </h3>
                <span className="text-[10px] font-bold text-teal-700">Recommended Sellers</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {result.verifiedShops.map((shop, idx) => (
                  <div key={idx} className="p-4 rounded-2xl bg-teal-50/40 border border-teal-100 flex flex-col justify-between space-y-3">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-black text-teal-950 text-sm">{shop.name}</h4>
                        <div className="flex items-center gap-1 bg-amber-100 px-2 py-0.5 rounded-full text-amber-900 text-[10px] font-black shrink-0">
                          <span>★</span>
                          <span>{shop.rating || 5}.0</span>
                        </div>
                      </div>
                      <p className="text-[11px] text-teal-800/80 font-medium mt-1">📍 {shop.location}</p>
                      <p className="text-[11px] text-teal-900/60 mt-0.5 italic">Specialty: {shop.specialty}</p>
                    </div>

                    {shop.discountCode && (
                      <div className="pt-2 border-t border-teal-200/50 flex items-center justify-between">
                        <span className="text-[9px] font-black uppercase text-teal-700">Bazaar Voucher</span>
                        <button
                          onClick={() => copyDiscountCode(shop.discountCode)}
                          className="px-2.5 py-1 rounded-lg bg-teal-900 text-amber-300 font-mono text-xs font-bold hover:bg-teal-800 transition-colors flex items-center gap-1.5"
                        >
                          <span>{shop.discountCode}</span>
                          <span className="text-[9px] uppercase text-teal-300 font-sans">
                            {copiedCode === shop.discountCode ? '✓ Copied' : 'Copy'}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Grounding Sources (Google Search Citations) */}
          {result.groundingSources && result.groundingSources.length > 0 && (
            <div className="pt-2">
              <span className="text-[9px] font-black uppercase tracking-wider text-teal-900/50 block mb-1.5">
                Market Grounding Citations
              </span>
              <div className="flex flex-wrap gap-2">
                {result.groundingSources.map((source, idx) => (
                  <a
                    key={idx}
                    href={source.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white border border-teal-100 hover:border-teal-300 text-[10px] text-teal-800 font-medium transition-colors shadow-sm"
                  >
                    <span>🔗</span>
                    <span className="truncate max-w-[200px]">{source.title || "Web Reference"}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Action Footer */}
      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        {!isInconclusive && (
          <button 
            onClick={handleSuccessfulBuy} 
            className="flex-1 py-4 md:py-5 rounded-2xl bg-teal-900 hover:bg-teal-850 text-white font-black text-xs uppercase tracking-[0.25em] shadow-xl btn-elegant flex items-center justify-center gap-2"
          >
            <span>✓</span>
            <span>Confirm Successful Deal</span>
          </button>
        )}
        <button 
          onClick={onReset} 
          className={`py-4 md:py-5 rounded-2xl bg-stone-100 hover:bg-stone-200 text-teal-900 font-black text-xs uppercase tracking-[0.25em] border border-stone-200 transition-colors ${
            isInconclusive ? 'flex-1' : 'px-8 sm:px-10'
          }`}
        >
          {isInconclusive ? 'Rescan Item' : 'New Scan'}
        </button>
      </div>
    </div>
  );
};

export default AnalysisResultView;
