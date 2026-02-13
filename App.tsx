
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
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
        <div className="bg-white max-w-sm w-full p-10 rounded-[2rem] elegant-shadow text-center animate-in zoom-in-95 duration-500">
          <div className="w-16 h-16 bg-stone-50 text-stone-400 rounded-full flex items-center justify-center mx-auto mb-8">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
          </div>
          <h1 className="text-2xl font-semibold text-stone-800 mb-3">Begin Your Journey</h1>
          <p className="text-stone-400 text-sm mb-10 font-light">Connect your Gemini API key to start exploring the bazaar with AI intelligence.</p>
          <button onClick={handleOpenConfig} className="w-full py-4 bg-stone-800 text-white rounded-xl font-medium text-xs uppercase tracking-widest btn-elegant shadow-lg shadow-stone-200">Connect Key</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center p-6 md:p-12 max-w-5xl mx-auto">
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 bg-stone-800 text-white text-[10px] font-medium tracking-[0.2em] py-2 text-center z-[100] animate-in slide-in-from-top">Offline Mode</div>
      )}

      <header className="w-full flex items-center justify-between mb-12 md:mb-16 px-2">
        <div className="cursor-pointer group" onClick={handleReset}>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-stone-800 transition-colors group-hover:text-stone-600">
            Bazaar<span className="text-stone-400 font-light">Sense</span>
          </h1>
          <p className="text-[9px] md:text-[10px] uppercase tracking-[0.3em] text-stone-300 font-semibold mt-1">Peshawar Edition</p>
        </div>
        
        <button 
          onClick={() => setState(state === AppState.HISTORY ? AppState.IDLE : AppState.HISTORY)}
          className={`p-3 md:p-4 rounded-xl transition-all active:scale-95 ${state === AppState.HISTORY ? 'bg-stone-800 text-white shadow-xl shadow-stone-200' : 'bg-white text-stone-400 elegant-shadow border border-stone-50'}`}
        >
          <svg className="w-5 h-5 md:w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </button>
      </header>

      <main className="w-full max-w-3xl relative">
        {state === AppState.HISTORY && (
          <div className="bg-white rounded-[2.5rem] elegant-shadow p-8 md:p-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-xl md:text-3xl font-bold text-stone-800 mb-8 tracking-tight">Records</h2>
            {history.length === 0 ? (
              <p className="text-stone-400 text-sm italic text-center py-20">Your collection is empty.</p>
            ) : (
              <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-3 custom-scrollbar">
                {history.map((item) => (
                  <div key={item.id} className="p-5 rounded-2xl border border-stone-100 bg-stone-50/50 flex justify-between items-center transition-all hover:bg-stone-50">
                    <div>
                      <h3 className="text-sm md:text-base font-semibold text-stone-700">{item.objectName}</h3>
                      <p className="text-[10px] text-stone-400 mt-1">{new Date(item.timestamp).toLocaleDateString(undefined, { dateStyle: 'medium' })}</p>
                    </div>
                    <div className="text-stone-800 text-sm md:text-base font-bold">{item.pricePKR}</div>
                  </div>
                ))}
              </div>
            )}
            <button onClick={handleReset} className="w-full mt-10 py-5 bg-stone-800 text-white rounded-2xl font-bold text-[11px] uppercase tracking-[0.2em] btn-elegant shadow-xl shadow-stone-200">Return to Exploration</button>
          </div>
        )}

        {(state === AppState.IDLE || state === AppState.ANALYZING) && (
          <div className="space-y-12">
            <div className="text-center px-4 animate-in fade-in duration-700 max-w-xl mx-auto">
              <h2 className="text-xl md:text-3xl font-extrabold text-stone-800 uppercase tracking-[0.15em] mb-4">
                Discover The Bazaar
              </h2>
              <p className="text-stone-400 text-xs md:text-sm font-medium leading-relaxed max-w-md mx-auto">
                Snap a photo of any artifact to unveil its heritage, fair market value, and local dialect.
              </p>
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
          <div className="bg-white p-12 md:p-20 rounded-[2.5rem] elegant-shadow text-center animate-in zoom-in-95 duration-300">
            <div className="w-20 h-20 bg-rose-50 text-rose-400 rounded-full flex items-center justify-center mx-auto mb-8 shadow-sm">
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <h2 className="text-2xl font-bold text-stone-800 mb-4">Discovery Paused</h2>
            <p className="text-stone-400 mb-12 text-sm md:text-base font-medium leading-relaxed max-w-xs mx-auto">{error.message}</p>
            <button onClick={handleReset} className="w-full max-w-xs py-5 rounded-2xl font-bold uppercase text-[11px] tracking-[0.2em] text-white bg-stone-800 btn-elegant shadow-lg shadow-stone-200 mx-auto block">Try Again</button>
          </div>
        )}
      </main>

      <footer className="mt-auto py-12 md:py-16 text-center text-stone-300 text-[9px] md:text-[10px] uppercase tracking-[0.5em] font-bold">
        Bazaar-Sense &bull; Finest Insights
      </footer>
    </div>
  );
};

export default App;
