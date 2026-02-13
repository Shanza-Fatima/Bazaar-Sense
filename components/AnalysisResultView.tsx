import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnalysisResult, HistoryItem } from '../types.ts';
import { 
  generateTTS, 
  decodeAudioData, 
  decode, 
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
  const liveSessionRef = useRef<{ inputCtx: AudioContext; scriptProcessor: ScriptProcessorNode } | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [chatHistory]);

  const stopLiveSession = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }

    if (liveSessionRef.current) {
      const { inputCtx, scriptProcessor } = liveSessionRef.current;
      try {
        scriptProcessor.disconnect();
      } catch (e) {
        console.debug('ScriptProcessor already disconnected');
      }
      
      if (inputCtx.state !== 'closed') {
        inputCtx.close().catch(err => console.error("Error closing inputCtx:", err));
      }
      liveSessionRef.current = null;
    }

    if (outAudioContextRef.current) {
      if (outAudioContextRef.current.state !== 'closed') {
        outAudioContextRef.current.close().catch(err => console.error("Error closing outputCtx:", err));
      }
      outAudioContextRef.current = null;
    }

    sourcesRef.current.forEach(source => {
      try {
        source.stop();
      } catch (e) {
        // Source might already be stopped
      }
    });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    setLiveStatus('idle');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopLiveSession();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [stopLiveSession]);

  const playStaticAudio = useCallback(async (text: string, context: string, type: 'urdu' | 'pashto') => {
    try {
      setActiveVoice(type);
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      } else if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
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

  const createPcmBlob = (data: Float32Array) => {
    const int16 = new Int16Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const s = Math.max(-1, Math.min(1, data[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    const encode = (bytes: Uint8Array) => {
      let b = '';
      for (let i = 0; i < bytes.length; i++) b += String.fromCharCode(bytes[i]);
      return btoa(b);
    };
    return {
      data: encode(new Uint8Array(int16.buffer)),
      mimeType: 'audio/pcm;rate=16000',
    };
  };

  const startLiveSession = async () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      setLiveErrorMessage("Key missing.");
      setLiveStatus('error');
      return;
    }
    setLiveStatus('connecting');
    setLiveErrorMessage("");
    setChatHistory([]);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const ai = new GoogleGenAI({ apiKey });
      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      outAudioContextRef.current = outputCtx;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setLiveStatus('listening');
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              sessionPromise.then(s => {
                // Ensure context is still alive before sending
                if (inputCtx.state !== 'closed') {
                  s.sendRealtimeInput({ media: createPcmBlob(inputData) });
                }
              });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
            liveSessionRef.current = { inputCtx, scriptProcessor };
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              setChatHistory(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'traveler' && !last.isFinal) return [...prev.slice(0, -1), { ...last, text: last.text + text }];
                return [...prev, { id: Date.now().toString(), role: 'traveler', text, isFinal: false }];
              });
            }
            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              setChatHistory(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'seller' && !last.isFinal) return [...prev.slice(0, -1), { ...last, text: last.text + text }];
                return [...prev, { id: Date.now().toString(), role: 'seller', text, isFinal: false }];
              });
            }
            if (message.serverContent?.turnComplete) setChatHistory(prev => prev.map(m => ({ ...m, isFinal: true })));

            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData) {
              setLiveStatus('speaking');
              const ctx = outAudioContextRef.current;
              if (ctx && ctx.state !== 'closed') {
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                const audioBuffer = await decodeAudioData(decode(audioData), ctx);
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
            }
          },
          onerror: (e) => {
            console.error('Live API Error:', e);
            setLiveStatus('error');
          },
          onclose: () => {
            setLiveStatus('idle');
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `You are a PASSIVE BRIDGE TRANSLATOR in a Peshawar Bazaar. 
          
          RULES:
          1. DO NOT initiate conversation. 
          2. DO NOT negotiate or add your own thoughts. 
          3. STRICT TRANSLATION ONLY:
             - If you hear English, translate it to AUTHENTIC PURE PESHAWARI ${sellerLanguage.toUpperCase()}.
             - If you hear ${sellerLanguage.toUpperCase()}, translate it to English.
          4. For Pashto, use the local PURE Peshawar/Yousafzai dialect. No Kabuli words.
          5. Wait for the user or merchant to speak. Do not generate sentences by yourself.
          
          Context: The user is looking at a ${result.objectName}.`,
        },
      });
    } catch (err) { 
      console.error('Start Live Session Error:', err);
      setLiveStatus('error'); 
    }
  };

  const handleConclusion = (success: boolean) => {
    stopLiveSession();
    if (success) {
      onSaveHistory({ id: Date.now().toString(), objectName: result.objectName, pricePKR: result.pricePKR, timestamp: Date.now() });
      setDealStatus('success');
    } else onReset();
  };

  if (dealStatus === 'success') {
    return (
      <div className="bg-white rounded-[3rem] elegant-shadow p-12 text-center animate-in zoom-in-95">
        <div className="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
        </div>
        <h2 className="text-2xl font-black text-emerald-900 mb-2">Deal Finalized!</h2>
        <p className="text-emerald-700/60 text-sm mb-10 font-medium tracking-tight">Your successful acquisition has been recorded.</p>
        <button onClick={onReset} className="px-12 py-5 bg-teal-800 text-white rounded-2xl font-bold text-xs uppercase tracking-[0.2em] btn-elegant shadow-xl shadow-teal-100">Next Discovery</button>
      </div>
    );
  }

  return (
    <div className="bg-white/90 backdrop-blur-xl rounded-[2.5rem] elegant-shadow p-6 md:p-10 animate-in fade-in slide-in-from-bottom-6 duration-700 ease-out border border-white/50">
      {/* Compact Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
             <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
             <span className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Peshawar Authenticated</span>
          </div>
          <h2 className="text-2xl md:text-4xl font-extrabold text-teal-900 tracking-tight">{result.objectName}</h2>
        </div>
        <div className="flex items-center justify-between md:justify-end gap-6 bg-teal-50/50 px-5 py-3 rounded-2xl border border-teal-100/50">
          <div className="flex flex-col">
            <span className="text-[9px] font-bold text-teal-600 uppercase tracking-[0.2em]">Estimated Value</span>
            <span className="text-xl md:text-2xl font-black text-teal-900">{result.pricePKR}</span>
          </div>
          <button onClick={onReset} className="p-2.5 bg-white text-teal-400 hover:text-rose-500 rounded-xl transition-all shadow-sm active:scale-90 border border-teal-50">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      {/* Tighter Description Section */}
      <div className="bg-gradient-to-br from-amber-50/40 to-orange-50/20 border border-amber-100/40 rounded-3xl p-5 mb-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-5">
           <svg className="w-16 h-16" fill="currentColor" viewBox="0 0 24 24"><path d="M13 14h-2V9h2v5zm0 4h-2v-2h2v2zM1 21h22L12 2 1 21z"/></svg>
        </div>
        <div className="text-[10px] font-black text-amber-700/40 uppercase tracking-[0.3em] mb-2 flex items-center gap-2">
           <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
           Merchant Intelligence
        </div>
        <p className="text-sm md:text-base text-teal-900/70 leading-relaxed font-medium italic pr-4">
          "{result.description}"
        </p>
      </div>

      {/* Translation Grid - Tighter & More Vibrant */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="group p-5 md:p-6 rounded-[2rem] bg-rose-50/50 border border-rose-100/50 hover:bg-white transition-all shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[9px] font-black text-rose-300 uppercase tracking-widest mb-1">Urdu</div>
            <div className="text-2xl font-bold text-rose-900" dir="rtl">{result.urdu.name}</div>
          </div>
          <button onClick={() => playStaticAudio(result.urdu.name, "Urdu", "urdu")} className={`p-4 rounded-2xl btn-elegant ${activeVoice === 'urdu' ? 'bg-rose-600 text-white shadow-lg' : 'bg-white text-rose-400 border border-rose-100 shadow-sm'}`}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
          </button>
        </div>
        <div className="group p-5 md:p-6 rounded-[2rem] bg-teal-50/50 border border-teal-100/50 hover:bg-white transition-all shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[9px] font-black text-teal-300 uppercase tracking-widest mb-1">Pashto</div>
            <div className="text-2xl font-bold text-teal-900" dir="rtl">{result.pashto.name}</div>
          </div>
          <button onClick={() => playStaticAudio(result.pashto.name, "Pashto", "pashto")} className={`p-4 rounded-2xl btn-elegant ${activeVoice === 'pashto' ? 'bg-teal-600 text-white shadow-lg' : 'bg-white text-teal-400 border border-teal-100 shadow-sm'}`}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
          </button>
        </div>
      </div>

      {/* Language Toggle - Compact */}
      <div className="flex bg-teal-900/5 p-1.5 rounded-2xl mb-6 max-w-sm mx-auto">
        <button onClick={() => setSellerLanguage('urdu')} disabled={liveStatus !== 'idle'} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${sellerLanguage === 'urdu' ? 'bg-white text-teal-900 shadow-md' : 'text-teal-900/40'}`}>Urdu Speaker</button>
        <button onClick={() => setSellerLanguage('pashto')} disabled={liveStatus !== 'idle'} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${sellerLanguage === 'pashto' ? 'bg-white text-teal-900 shadow-md' : 'text-teal-900/40'}`}>Pashto Speaker</button>
      </div>

      {/* Chat Bridge - Fresh Design */}
      <div className="bg-teal-950 rounded-[2.5rem] p-5 md:p-8 mb-8 shadow-2xl h-[380px] md:h-[450px] flex flex-col relative border border-teal-900 ring-4 ring-teal-900/20">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 rounded-lg bg-teal-900 border border-teal-800 flex items-center justify-center text-teal-400">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
             </div>
             <div>
                <span className="text-teal-400/60 text-[10px] font-black uppercase tracking-[0.4em] block">Translation Hub</span>
                <span className="text-teal-500/30 text-[8px] font-bold uppercase tracking-[0.2em]">Passive Bridge Active</span>
             </div>
          </div>
          {liveStatus !== 'idle' && (
             <div className="flex items-center gap-1.5 bg-teal-900/50 px-3 py-1.5 rounded-full border border-teal-800">
               <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-ping"></span>
               <span className="text-[8px] font-black text-amber-400 uppercase tracking-widest">{liveStatus === 'listening' ? 'Listening' : 'Speaking'}</span>
             </div>
          )}
        </div>

        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto space-y-5 pr-2 custom-scrollbar">
          {chatHistory.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-teal-700/50 text-center px-10">
              <div className="w-14 h-14 border-2 border-dashed border-teal-900 rounded-full flex items-center justify-center mb-4">
                <svg className="w-6 h-6 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
              </div>
              <span className="text-xs font-medium tracking-tight">The AI is waiting. Speak in English or {sellerLanguage.charAt(0).toUpperCase() + sellerLanguage.slice(1)}...</span>
            </div>
          ) : (
            chatHistory.map((msg) => (
              <div key={msg.id} className={`flex flex-col ${msg.role === 'traveler' ? 'items-start' : 'items-end'} animate-in slide-in-from-bottom-2`}>
                <span className={`text-[8px] font-black uppercase mb-1.5 tracking-widest ${msg.role === 'traveler' ? 'text-teal-500' : 'text-amber-500'}`}>
                  {msg.role === 'traveler' ? 'English' : `${sellerLanguage.toUpperCase()} (Peshawar)`}
                </span>
                <div className={`max-w-[85%] p-4 rounded-2xl text-xs md:text-sm leading-relaxed font-semibold transition-all shadow-lg ${msg.role === 'traveler' ? 'bg-teal-900 text-teal-100 rounded-tl-none border-l-4 border-teal-500' : 'bg-teal-800 text-white rounded-tr-none border-r-4 border-amber-500'}`}>
                  {msg.text}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-6 pt-4 border-t border-teal-900/50">
          {liveStatus === 'idle' || liveStatus === 'error' ? (
            <button onClick={startLiveSession} className="w-full py-4 md:py-6 rounded-2xl bg-white text-teal-900 font-black text-xs uppercase tracking-[0.4em] shadow-xl hover:bg-teal-50 transition-colors btn-elegant">Activate Voice Bridge</button>
          ) : (
            <button onClick={stopLiveSession} className="w-full py-4 md:py-6 rounded-2xl bg-rose-500/10 text-rose-400 border-2 border-rose-500/20 font-black text-xs uppercase tracking-[0.4em] hover:bg-rose-500/20 btn-elegant">Halt Connection</button>
          )}
        </div>
      </div>

      {/* Tighter Footer Actions */}
      <div className="flex gap-4">
        <button 
          onClick={() => handleConclusion(true)} 
          className="flex-1 py-5 rounded-2xl bg-gradient-to-r from-teal-800 to-teal-900 text-white font-black text-[10px] md:text-xs uppercase tracking-[0.3em] btn-elegant border border-teal-700 shadow-2xl"
        >
          Successful Buy
        </button>
        <button 
          onClick={() => handleConclusion(false)} 
          className="px-10 py-5 rounded-2xl bg-white text-teal-400 font-black text-[10px] md:text-xs uppercase tracking-[0.3em] btn-elegant border border-teal-100 shadow-sm"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
};

export default AnalysisResultView;