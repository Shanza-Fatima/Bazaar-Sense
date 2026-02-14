import React, { useState, useCallback, useEffect } from 'react';
import CameraView from './components/CameraView.tsx';
import AnalysisResultView from './components/AnalysisResultView.tsx';
import { analyzeImage } from './services/gemini.ts';
import { AnalysisResult, AppState, HistoryItem } from './types.ts';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState<{ message: string; isQuota: boolean; isConfig?: boolean; isPermission?: boolean } | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const checkApiKey = async () => {
      const envKey = process.env.API_KEY;
      if (envKey && envKey !== "" && !envKey.includes("your_actual")) {
        setState(AppState.IDLE);
        return;
      }
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) setState(AppState.CONFIG_REQUIRED);
      } else if (!envKey) setState(AppState.CONFIG_REQUIRED);
    };
    checkApiKey();
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('bazaar_history');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) { console.error("History load error", e); }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('bazaar_history', JSON.stringify(history));
  }, [history]);

  const handleOpenConfig = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setState(AppState.IDLE);
    } else {
      const key = prompt("Enter Gemini API Key:");
      if (key) {
        process.env.API_KEY = key;
        setState(AppState.IDLE);
      }
    }
  };

  const handleCapture = useCallback(async (base64: string) => {
    if (!navigator.onLine) {
      setError({ message: "You appear to be offline.", isQuota: false });
      setState(AppState.ERROR);
      return;
    }
    try {
      setState(AppState.ANALYZING);
      setError(null);
      const analysis = await analyzeImage(base64);
      setResult(analysis);
      setState(AppState.RESULT);
    } catch (err: any) {
      console.error('Analysis Error:', err);
      const errMsg = err?.message || "Unknown error";
      if (errMsg.includes("Requested entity was not found.")) {
        setState(AppState.CONFIG_REQUIRED);
        return;
      }
      setError({ message: `Connection error: ${errMsg.slice(0, 50)}...`, isQuota: errMsg.includes('429'), isConfig: errMsg.includes('KEY_NOT_CONFIGURED') });
      setState(AppState.ERROR);
    }
  }, []);

  const handleReset = () => {
    setResult(null);
    setError(null);
    setState(AppState.IDLE);
  };

  if (state === AppState.CONFIG_REQUIRED) {
    return (
      <div className="min-h-screen bg-teal-950 flex items-center justify-center p-6">
        <div className="bg-white max-w-sm w-full p-10 rounded-[3rem] elegant-shadow text-center animate-in zoom-in-95 duration-500 border-4 border-teal-900/10">
          <div className="w-20 h-20 bg-teal-50 text-teal-600 rounded-3xl flex items-center justify-center mx-auto mb-8 rotate-3 shadow-sm">
            <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
          </div>
          <h1 className="text-3xl font-black text-teal-900 mb-3 tracking-tight">Access Key Required</h1>
          <p className="text-teal-900/50 text-sm mb-10 font-medium leading-relaxed">Securely connect your Gemini API key to unlock real-time bazaar intelligence and language translation.</p>
          <button onClick={handleOpenConfig} className="w-full py-5 bg-teal-800 text-white rounded-2xl font-bold text-xs uppercase tracking-[0.3em] btn-elegant shadow-xl shadow-teal-900/20">Connect Securely</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center p-6 md:p-10 max-w-5xl mx-auto">
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 bg-rose-600 text-white text-[10px] font-black tracking-[0.4em] py-2 text-center z-[100] animate-in slide-in-from-top uppercase shadow-lg">Network Interrupted</div>
      )}

      <header className="w-full flex items-center justify-between mb-8 md:mb-12 px-4 py-3 bg-white/40 backdrop-blur-md rounded-[2rem] border border-white/60 elegant-shadow">
        <div className="cursor-pointer group flex items-center gap-4" onClick={handleReset}>
          <div className="w-10 h-10 bg-teal-800 rounded-xl flex items-center justify-center text-white shadow-lg shadow-teal-900/10 group-hover:rotate-6 transition-transform">
             <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10z"/></svg>
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-black tracking-tighter text-teal-900 leading-none">
              Bazaar<span className="text-amber-600">Sense</span>
            </h1>
            <p className="text-[8px] uppercase font-black tracking-[0.5em] text-teal-900/30 mt-1">Peshawar Authenticated</p>
          </div>
        </div>
        
        <button 
          onClick={() => setState(state === AppState.HISTORY ? AppState.IDLE : AppState.HISTORY)}
          className={`p-3.5 rounded-2xl transition-all active:scale-90 ${state === AppState.HISTORY ? 'bg-amber-500 text-white shadow-xl shadow-amber-200' : 'bg-white text-teal-400 border border-teal-50 shadow-sm'}`}
        >
          <svg className="w-5 h-5 md:w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </button>
      </header>

      <main className="w-full max-w-3xl relative">
        {state === AppState.HISTORY && (
          <div className="bg-white rounded-[3rem] elegant-shadow p-8 md:p-12 animate-in fade-in slide-in-from-bottom-4 duration-500 border border-teal-50">
            <div className="flex items-center gap-4 mb-10">
               <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-600">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
               </div>
               <h2 className="text-2xl md:text-4xl font-black text-teal-900 tracking-tight">Acquisition Log</h2>
            </div>
            {history.length === 0 ? (
              <div className="text-center py-24 px-10">
                 <p className="text-teal-900/30 text-sm font-bold uppercase tracking-widest mb-4">No records found</p>
                 <p className="text-teal-900/50 text-xs italic">Capture items in the market to build your catalog.</p>
              </div>
            ) : (
              <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-3 custom-scrollbar">
                {history.map((item) => (
                  <div key={item.id} className="p-6 rounded-[2rem] border border-teal-50 bg-teal-50/20 flex justify-between items-center transition-all hover:bg-teal-50/50 group">
                    <div className="flex items-center gap-5">
                      <div className="w-12 h-12 rounded-2xl bg-white border border-teal-100 flex items-center justify-center text-teal-800 shadow-sm group-hover:scale-110 transition-transform">
                         <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                      </div>
                      <div>
                        <h3 className="text-base font-black text-teal-900">{item.objectName}</h3>
                        <p className="text-[10px] font-bold text-teal-400 mt-0.5 uppercase tracking-widest">{new Date(item.timestamp).toLocaleDateString(undefined, { dateStyle: 'medium' })}</p>
                      </div>
                    </div>
                    <div className="text-amber-600 text-lg font-black">{item.pricePKR}</div>
                  </div>
                ))}
              </div>
            )}
            <button onClick={handleReset} className="w-full mt-10 py-6 bg-teal-900 text-white rounded-3xl font-black text-xs uppercase tracking-[0.4em] btn-elegant shadow-2xl shadow-teal-900/20">Resume Discovery</button>
          </div>
        )}

        {(state === AppState.IDLE || state === AppState.ANALYZING) && (
          <div className="space-y-10">
            <div className="text-center px-4 animate-in fade-in duration-700 max-w-xl mx-auto">
              <div className="inline-block px-5 py-2 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black uppercase tracking-[0.3em] mb-6 shadow-sm">
                 V3.0 Smart Companion
              </div>
              <h2 className="text-3xl md:text-5xl font-black text-teal-950 tracking-tighter mb-4 leading-tight">
                Market Prices <span className="text-teal-600">at Your Fingertips.</span>
              </h2>
              <div className="text-teal-900/40 text-sm md:text-base font-semibold leading-relaxed max-w-md mx-auto space-y-1">
                <p>Find fair PKR prices. Negotiate deals easily.</p>
                <p>Real-time bridge translation.</p>
              </div>
            </div>
            
            <CameraView onCapture={handleCapture} isLoading={state === AppState.ANALYZING} />
          </div>
        )}

        {state === AppState.RESULT && result && (
          <AnalysisResultView 
            result={result} 
            onReset={handleReset} 
            onSaveHistory={(item) => setHistory(prev => [item, ...prev])} 
          />
        )}

        {state === AppState.ERROR && error && (
          <div className="bg-white p-12 md:p-16 rounded-[3rem] elegant-shadow text-center animate-in zoom-in-95 duration-300 border-4 border-rose-50">
            <div className="w-24 h-24 bg-rose-50 text-rose-500 rounded-[2.5rem] flex items-center justify-center mx-auto mb-8 shadow-xl shadow-rose-100/50 rotate-6">
              <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <h2 className="text-3xl font-black text-teal-950 mb-3 tracking-tighter">Exploration Paused</h2>
            <p className="text-teal-900/50 mb-12 text-sm font-medium leading-relaxed max-w-xs mx-auto italic">"{error.message}"</p>
            <button onClick={handleReset} className="w-full max-w-xs py-6 rounded-3xl font-black uppercase text-xs tracking-[0.3em] text-white bg-teal-900 btn-elegant shadow-2xl shadow-teal-900/30 mx-auto block">Reset Systems</button>
          </div>
        )}
      </main>

      <footer className="mt-auto py-12 text-center">
        <div className="flex items-center justify-center gap-4 mb-4 opacity-20">
           <div className="w-8 h-[1px] bg-teal-900"></div>
           <div className="w-2 h-2 rounded-full bg-teal-900"></div>
           <div className="w-8 h-[1px] bg-teal-900"></div>
        </div>
        <p className="text-teal-900/20 text-[10px] uppercase tracking-[0.6em] font-black">Bazaar-Sense &bull; Prestige Analytics</p>
      </footer>
    </div>
  );
};

export default App;