
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnalysisResult, HistoryItem } from '../types.ts';
import { 
  generateTTS, 
  decodeAudioData, 
  createPcmBlob, 
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
  const liveSessionRef = useRef<any>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollContainerRef.current) {
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
              sessionPromise.then(s => s.sendRealtimeInput({ media: createPcmBlob(inputData) }));
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
              const ctx = outAudioContextRef.current!;
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
          },
          onerror: (e) => setLiveStatus('error'),
          onclose: () => setLiveStatus('idle'),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `Bazaar Translator. Negotiation for ${result.objectName}. Seller: ${sellerLanguage}. Bridge English to ${sellerLanguage}.`,
        },
      });
    } catch (err) { setLiveStatus('error'); }
  };

  const stopLiveSession = () => {
    if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach(t => t.stop());
    if (liveSessionRef.current) {
      liveSessionRef.current.scriptProcessor.disconnect();
      liveSessionRef.current.inputCtx.close();
    }
    sourcesRef.current.forEach(s => s.stop());
    setLiveStatus('idle');
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
      <div className="bg-white rounded-[2.5rem] elegant-shadow p-12 text-center animate-in zoom-in-95">
        <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
        </div>
        <h2 className="text-xl font-bold text-stone-800 mb-2">Deal Finalized</h2>
        <p className="text-stone-400 text-xs mb-8">Acquisition saved to your records.</p>
        <button onClick={onReset} className="px-10 py-4 bg-stone-800 text-white rounded-xl font-bold text-[10px] uppercase tracking-widest btn-elegant">New Discovery</button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-[2.5rem] elegant-shadow p-6 md:p-16 animate-in fade-in zoom-in-95 duration-500 ease-out">
      <div className="flex justify-between items-start mb-8 md:mb-12">
        <div>
          <h2 className="text-lg md:text-3xl font-bold text-stone-800 tracking-tight mb-2">{result.objectName}</h2>
          <div className="flex items-center gap-2">
            <span className="text-stone-300 text-[10px] md:text-sm font-semibold uppercase tracking-widest">Market Value</span>
            <span className="text-stone-800 font-bold text-sm md:text-xl">{result.pricePKR}</span>
          </div>
        </div>
        <button onClick={onReset} className="p-2 text-stone-300 hover:text-stone-500 transition-colors active:scale-90">
          <svg className="w-5 h-5 md:w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      <div className="bg-stone-50/50 border border-stone-100/50 rounded-2xl p-4 md:p-8 mb-10 md:mb-16">
        <div className="text-[7px] md:text-[11px] font-black text-stone-300 uppercase tracking-[0.4em] mb-4">Merchant Insights</div>
        <div className="max-h-24 md:max-h-32 overflow-y-auto text-[11px] md:text-base text-stone-500 leading-relaxed custom-scrollbar font-normal italic text-left">
          {result.description}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:gap-8 mb-12 md:mb-20">
        <div className="group p-4 md:p-8 rounded-2xl bg-stone-50 border border-stone-100 hover:bg-white transition-all shadow-sm">
          <div className="text-[7px] md:text-[11px] font-black text-stone-300 uppercase tracking-widest mb-4">Urdu</div>
          <div className="text-xl md:text-2xl font-bold text-stone-800 mb-6" dir="rtl">{result.urdu.name}</div>
          <button onClick={() => playStaticAudio(result.urdu.name, "Urdu", "urdu")} className={`text-[8px] md:text-[12px] font-black uppercase text-stone-500 bg-white border border-stone-100 px-5 py-2.5 rounded-xl btn-elegant shadow-sm ${activeVoice === 'urdu' ? 'ring-2 ring-stone-800 text-stone-800' : ''}`}>Listen</button>
        </div>
        <div className="group p-4 md:p-8 rounded-2xl bg-stone-50 border border-stone-100 hover:bg-white transition-all shadow-sm">
          <div className="text-[7px] md:text-[11px] font-black text-stone-300 uppercase tracking-widest mb-4">Pashto</div>
          <div className="text-xl md:text-2xl font-bold text-stone-800 mb-6" dir="rtl">{result.pashto.name}</div>
          <button onClick={() => playStaticAudio(result.pashto.name, "Pashto", "pashto")} className={`text-[8px] md:text-[12px] font-black uppercase text-stone-500 bg-white border border-stone-100 px-5 py-2.5 rounded-xl btn-elegant shadow-sm ${activeVoice === 'pashto' ? 'ring-2 ring-stone-800 text-stone-800' : ''}`}>Listen</button>
        </div>
      </div>

      <div className="mb-10">
        <div className="flex justify-center gap-4">
          <button onClick={() => setSellerLanguage('urdu')} disabled={liveStatus !== 'idle'} className={`flex-1 py-4 md:py-6 rounded-2xl text-[9px] md:text-sm font-black uppercase tracking-[0.3em] transition-all border ${sellerLanguage === 'urdu' ? 'bg-stone-800 text-white border-stone-800 shadow-2xl' : 'bg-stone-50 text-stone-400 border-stone-100'}`}>Urdu Speaker</button>
          <button onClick={() => setSellerLanguage('pashto')} disabled={liveStatus !== 'idle'} className={`flex-1 py-4 md:py-6 rounded-2xl text-[9px] md:text-sm font-black uppercase tracking-[0.3em] transition-all border ${sellerLanguage === 'pashto' ? 'bg-stone-800 text-white border-stone-800 shadow-2xl' : 'bg-stone-50 text-stone-400 border-stone-100'}`}>Pashto Speaker</button>
        </div>
      </div>

      <div className="bg-stone-900 rounded-[2.5rem] p-6 md:p-12 mb-16 shadow-2xl h-[350px] md:h-[500px] flex flex-col relative border border-stone-800">
        <div className="flex justify-between items-center mb-8 px-1">
          <span className="text-stone-600 text-[8px] md:text-[12px] font-black uppercase tracking-[0.5em]">Language Bridge</span>
          {liveStatus !== 'idle' && <div className="flex gap-2"><span className="w-1.5 h-1.5 bg-stone-500 rounded-full animate-pulse"></span><span className="w-1.5 h-1.5 bg-stone-500 rounded-full animate-pulse delay-100"></span><span className="w-1.5 h-1.5 bg-stone-500 rounded-full animate-pulse delay-200"></span></div>}
        </div>
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto space-y-6 pr-2 custom-scrollbar">
          {chatHistory.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-stone-700 text-[11px] md:text-base italic font-light space-y-6">
              <div className="w-12 h-12 md:w-16 md:h-16 border border-stone-800 rounded-full flex items-center justify-center opacity-30">
                <svg className="w-6 h-6 md:w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
              </div>
              <span>Tap below to bridge the gap with the merchant...</span>
            </div>
          ) : (
            chatHistory.map((msg) => (
              <div key={msg.id} className={`flex flex-col ${msg.role === 'traveler' ? 'items-start' : 'items-end'} animate-in slide-in-from-bottom-2 duration-300`}>
                <span className="text-[7px] md:text-[10px] text-stone-600 uppercase font-black mb-2 tracking-widest">{msg.role === 'traveler' ? 'You' : `${sellerLanguage} Master`}</span>
                <div className={`max-w-[85%] p-4 md:p-7 rounded-2xl text-[11px] md:text-base leading-relaxed font-medium ${msg.role === 'traveler' ? 'bg-stone-800 text-stone-300 rounded-tl-none border border-stone-700/50 shadow-inner' : 'bg-stone-700 text-stone-200 rounded-tr-none shadow-inner'}`}>{msg.text}</div>
              </div>
            ))
          )}
        </div>
        <div className="mt-8 pt-6 border-t border-stone-800/50">
          {liveStatus === 'idle' || liveStatus === 'error' ? (
            <button onClick={startLiveSession} className="w-full py-5 md:py-8 rounded-2xl bg-white text-stone-800 font-black text-[10px] md:text-sm uppercase tracking-[0.4em] shadow-2xl btn-elegant">Activate Bridge</button>
          ) : (
            <button onClick={stopLiveSession} className="w-full py-5 md:py-8 rounded-2xl bg-rose-950/20 text-rose-500 border border-rose-900/40 font-black text-[10px] md:text-sm uppercase tracking-[0.4em] btn-elegant">Stop Bridge</button>
          )}
        </div>
      </div>

      <div className="pt-10 border-t border-stone-100">
        <div className="grid grid-cols-2 gap-6 md:gap-10">
          <button 
            onClick={() => handleConclusion(true)} 
            className="py-4 md:py-6 rounded-2xl bg-stone-800 text-white font-black text-[9px] md:text-sm uppercase tracking-[0.3em] btn-elegant border border-stone-800 shadow-2xl"
          >
            Successful Buy
          </button>
          <button 
            onClick={() => handleConclusion(false)} 
            className="py-4 md:py-6 rounded-2xl bg-stone-100 text-stone-400 font-black text-[9px] md:text-sm uppercase tracking-[0.3em] btn-elegant"
          >
            No Acquisition
          </button>
        </div>
      </div>
    </div>
  );
};

export default AnalysisResultView;
