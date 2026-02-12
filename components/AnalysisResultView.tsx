
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnalysisResult, HistoryItem } from '../types.ts';
import { 
  generateTTS, 
  decodeAudioData, 
  createPcmBlob, 
  decode, 
  encode 
} from '../services/gemini.ts';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';

interface ChatMessage {
  id: string;
  role: 'traveler' | 'seller';
  text: string;
  isFinal: boolean;
}

interface AnalysisResultViewProps {
  result: AnalysisResult;
  onReset: () => void;
  onSaveHistory: (item: HistoryItem) => void;
}

const AnalysisResultView: React.FC<AnalysisResultViewProps> = ({ result, onReset, onSaveHistory }) => {
  const [activeVoice, setActiveVoice] = useState<'urdu' | 'pashto' | 'live' | null>(null);
  const [liveStatus, setLiveStatus] = useState<'idle' | 'connecting' | 'listening' | 'speaking' | 'error'>('idle');
  const [liveErrorMessage, setLiveErrorMessage] = useState<string>("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [dealStatus, setDealStatus] = useState<'none' | 'success'>('none');
  const [sellerLanguage, setSellerLanguage] = useState<'urdu' | 'pashto'>('pashto');

  const audioContextRef = useRef<AudioContext | null>(null);
  const outAudioContextRef = useRef<AudioContext | null>(null);
  const liveSessionRef = useRef<any>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (container) {
      const isBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 100;
      isAtBottomRef.current = isBottom;
    }
  };

  useEffect(() => {
    if (isAtBottomRef.current && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [chatHistory]);

  const playStaticAudio = useCallback(async (text: string, context: string, type: 'urdu' | 'pashto') => {
    try {
      setActiveVoice(type);
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      
      const audioBytes = await generateTTS(text, context);
      const audioBuffer = await decodeAudioData(audioBytes, audioContextRef.current);
      
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      source.onended = () => setActiveVoice(null);
      source.start();
    } catch (err) {
      console.error('TTS Error:', err);
      setActiveVoice(null);
    }
  }, []);

  const startLiveSession = async () => {
    if (liveStatus !== 'idle') return;
    
    const apiKey = process.env.API_KEY;
    if (!apiKey || apiKey === "" || apiKey.includes("your_actual")) {
      setLiveErrorMessage("API Key not found. Please configure 'API_KEY' in Vercel.");
      setLiveStatus('error');
      return;
    }

    setLiveStatus('connecting');
    setLiveErrorMessage("");
    setChatHistory([]);
    isAtBottomRef.current = true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      mediaStreamRef.current = stream;

      const ai = new GoogleGenAI({ apiKey });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      outAudioContextRef.current = outputCtx;

      const targetLang = sellerLanguage === 'urdu' ? 'URDU' : 'PASHTO';

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setLiveStatus('listening');
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
            liveSessionRef.current = { sessionPromise, inputCtx, scriptProcessor };
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              setChatHistory(prev => {
                const last = prev[prev.length - 1];
                if (last && last.role === 'traveler' && !last.isFinal) {
                  return [...prev.slice(0, -1), { ...last, text: last.text + text }];
                }
                return [...prev, { id: Date.now().toString(), role: 'traveler', text, isFinal: false }];
              });
            }

            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              setChatHistory(prev => {
                const last = prev[prev.length - 1];
                if (last && last.role === 'seller' && !last.isFinal) {
                  return [...prev.slice(0, -1), { ...last, text: last.text + text }];
                }
                return [...prev, { id: Date.now().toString(), role: 'seller', text, isFinal: false }];
              });
            }

            if (message.serverContent?.turnComplete) {
              setChatHistory(prev => prev.map(m => ({ ...m, isFinal: true })));
            }

            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData) {
              setLiveStatus('speaking');
              const ctx = outAudioContextRef.current!;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const audioBuffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              source.onended = () => {
                sourcesRef.current.delete(source);
                if (sourcesRef.current.size === 0) setLiveStatus('listening');
              };
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }
          },
          onerror: (e: any) => {
            console.error('Bridge Error:', e);
            setLiveErrorMessage(e?.message || "Connection to Live API failed.");
            setLiveStatus('error');
          },
          onclose: () => setLiveStatus('idle'),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `YOU ARE A BAZAAR TRANSLATOR. 
          Context: Negotiating for "${result.objectName}". Seller speaks ${targetLang}. 
          Bridge Traveler's English to ${targetLang} and Seller's ${targetLang} to English.`,
        },
      });
    } catch (err: any) {
      console.error('Session failed:', err);
      setLiveErrorMessage(err?.message || "Internal Bridge Error.");
      setLiveStatus('error');
    }
  };

  const stopLiveSession = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    if (liveSessionRef.current) {
      const { inputCtx, scriptProcessor } = liveSessionRef.current;
      scriptProcessor.disconnect();
      inputCtx.close();
      liveSessionRef.current = null;
    }
    sourcesRef.current.forEach(s => s.stop());
    sourcesRef.current.clear();
    setLiveStatus('idle');
  };

  const handleConclusion = (success: boolean) => {
    stopLiveSession();
    if (success) {
      onSaveHistory({
        id: Math.random().toString(36).substr(2, 9),
        objectName: result.objectName,
        pricePKR: result.pricePKR,
        timestamp: Date.now()
      });
      setDealStatus('success');
    } else {
      onReset();
    }
  };

  if (dealStatus === 'success') {
    return (
      <div className="bg-white rounded-[2.5rem] shadow-2xl p-10 text-center border border-emerald-50 animate-in zoom-in-95 duration-500">
        <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce">
          <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
        </div>
        <h2 className="text-3xl font-black text-gray-900 mb-2">Deal Saved!</h2>
        <p className="text-slate-500 mb-8 font-medium italic">You closed the deal for {result.objectName} at {result.pricePKR}.</p>
        <button onClick={onReset} className="px-10 py-4 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg hover:bg-emerald-700 active:scale-95 transition-all">Back to Camera</button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-[2.5rem] shadow-2xl p-6 md:p-8 border border-indigo-50 animate-in fade-in zoom-in-95 duration-700 ease-out relative">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-3xl md:text-4xl font-black text-gray-900 leading-tight">{result.objectName}</h2>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-indigo-600 font-black text-2xl">{result.pricePKR}</p>
            <span className="bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest border border-emerald-100">Deal Expert</span>
          </div>
        </div>
        <button onClick={onReset} className="p-2 text-gray-300 hover:text-gray-500 rounded-xl active:scale-90 transition-all">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
        <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-100 flex flex-col items-start gap-2">
          <div className="text-[10px] font-black text-indigo-400 uppercase">Urdu Name</div>
          <div className="text-xl font-bold text-gray-800" dir="rtl">{result.urdu.name}</div>
          <button onClick={() => playStaticAudio(result.urdu.name, "Urdu", "urdu")} className={`mt-1 text-[10px] font-black uppercase text-indigo-600 bg-white px-4 py-2 rounded-full border border-indigo-100 shadow-sm active:scale-95 transition-all ${activeVoice === 'urdu' ? 'ring-2 ring-indigo-400' : ''}`}>Play Voice</button>
        </div>

        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-100 flex flex-col items-start gap-2">
          <div className="text-[10px] font-black text-emerald-400 uppercase">Pashto Name</div>
          <div className="text-xl font-bold text-gray-800" dir="rtl">{result.pashto.name}</div>
          <button onClick={() => playStaticAudio(result.pashto.name, "Pashto", "pashto")} className={`mt-1 text-[10px] font-black uppercase text-emerald-600 bg-white px-4 py-2 rounded-full border border-emerald-100 shadow-sm active:scale-95 transition-all ${activeVoice === 'pashto' ? 'ring-2 ring-emerald-400' : ''}`}>Play Voice</button>
        </div>
      </div>

      <div className="mb-4">
        <p className="text-center text-[10px] text-indigo-600 font-black uppercase tracking-[0.2em] mb-3">
          1. Select Seller's Language
        </p>
        <div className="flex justify-center gap-2">
          <button 
            onClick={() => setSellerLanguage('urdu')}
            disabled={liveStatus !== 'idle'}
            className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all flex-1 ${sellerLanguage === 'urdu' ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg scale-105 z-10' : 'bg-slate-50 text-slate-400 border-slate-200'}`}
          >
            Urdu Speaker
          </button>
          <button 
            onClick={() => setSellerLanguage('pashto')}
            disabled={liveStatus !== 'idle'}
            className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border transition-all flex-1 ${sellerLanguage === 'pashto' ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg scale-105 z-10' : 'bg-slate-50 text-slate-400 border-slate-200'}`}
          >
            Pashto Speaker
          </button>
        </div>
      </div>

      <div className="bg-slate-900 rounded-[2.5rem] p-5 md:p-6 mb-8 shadow-xl flex flex-col h-[400px] relative border-4 border-indigo-50">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-white text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${liveStatus === 'idle' ? 'bg-slate-600' : 'bg-red-500 animate-pulse'}`}></span>
            Bridge Output ({sellerLanguage.toUpperCase()})
          </h3>
          {liveStatus !== 'idle' && (
            <div className="flex gap-1">
              <span className="w-1 h-1 bg-white/30 rounded-full animate-bounce"></span>
              <span className="w-1 h-1 bg-white/30 rounded-full animate-bounce delay-100"></span>
              <span className="w-1 h-1 bg-white/30 rounded-full animate-bounce delay-200"></span>
            </div>
          )}
        </div>

        <div 
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto space-y-4 pr-1 custom-scrollbar scroll-smooth"
        >
          {chatHistory.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
               {liveStatus === 'error' ? (
                 <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 max-w-xs mx-auto">
                    <p className="text-red-400 text-[10px] font-black uppercase mb-1">Bridge Error</p>
                    <p className="text-white text-xs">{liveErrorMessage || "Could not connect."}</p>
                 </div>
               ) : (
                 <>
                   <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mb-4">
                     <svg className="w-6 h-6 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                     </svg>
                   </div>
                   <p className="text-slate-500 text-xs font-medium max-w-[220px]">Choose a language and click "Activate Bridge".</p>
                 </>
               )}
            </div>
          ) : (
            chatHistory.map((msg) => (
              <div key={msg.id} className={`flex flex-col ${msg.role === 'traveler' ? 'items-start' : 'items-end'} animate-in slide-in-from-bottom-2 duration-300`}>
                <span className={`text-[8px] font-black uppercase mb-1 tracking-widest ${msg.role === 'traveler' ? 'text-indigo-400' : 'text-emerald-400'}`}>
                  {msg.role === 'traveler' ? 'Traveler (English)' : `Seller (${sellerLanguage.toUpperCase()})`}
                </span>
                <div className={`
                  max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed shadow-sm
                  ${msg.role === 'traveler' ? 'bg-indigo-600/10 text-white border border-indigo-500/20 rounded-tl-none' : 'bg-emerald-600/10 text-white border border-emerald-500/20 rounded-tr-none text-right'}
                  ${!msg.isFinal ? 'opacity-70 animate-pulse' : 'opacity-100'}
                `}>
                  {msg.text}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-5 pt-5 border-t border-white/10">
          {liveStatus === 'idle' || liveStatus === 'error' ? (
            <button 
              onClick={startLiveSession} 
              className={`w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-3 ${liveStatus === 'error' ? 'bg-red-600 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
            >
              {liveStatus === 'error' ? 'Retry Bridge' : `2. Activate Bridge (${sellerLanguage.toUpperCase()})`}
            </button>
          ) : (
            <div className="space-y-3">
               <div className="flex items-center justify-center gap-4 py-3 bg-white/5 rounded-xl border border-white/10">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${liveStatus === 'speaking' ? 'bg-emerald-500 animate-pulse' : 'bg-indigo-500'}`}></span>
                    <span className="text-white text-[9px] font-black uppercase tracking-widest">
                      {liveStatus === 'speaking' ? 'Translating Speech...' : 'Listening...'}
                    </span>
                  </div>
               </div>
               <button 
                onClick={stopLiveSession} 
                className="w-full py-4 rounded-2xl bg-red-500/10 text-red-500 border border-red-500/20 font-black text-xs uppercase tracking-widest hover:bg-red-500/20 active:scale-95 transition-all"
               >
                  Stop Bridge
               </button>
            </div>
          )}
        </div>
      </div>

      <div className="pt-6 border-t border-slate-100 animate-in fade-in slide-in-from-top-4 duration-500">
        <p className="text-center text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">3. Finalize Selection</p>
        <div className="grid grid-cols-2 gap-4">
          <button 
            onClick={() => handleConclusion(true)} 
            className="py-4 rounded-2xl bg-emerald-50 text-emerald-700 border border-emerald-100 font-black text-xs uppercase tracking-widest hover:bg-emerald-100 active:scale-95 transition-all shadow-sm"
          >
            Successful Buy
          </button>
          <button 
            onClick={() => handleConclusion(false)} 
            className="py-4 rounded-2xl bg-slate-50 text-slate-500 border border-slate-100 font-black text-xs uppercase tracking-widest hover:bg-slate-100 active:scale-95 transition-all shadow-sm"
          >
            No Deal
          </button>
        </div>
      </div>
    </div>
  );
};

export default AnalysisResultView;
