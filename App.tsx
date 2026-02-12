
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

  // Check for API key on mount
  useEffect(() => {
    const checkApiKey = async () => {
      // 1. Check if injected via process.env
      const envKey = process.env.API_KEY;
      if (envKey && envKey !== "" && !envKey.includes("your_actual")) {
        setState(AppState.IDLE);
        return;
      }

      // 2. Check if platform selection is available
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
          setState(AppState.CONFIG_REQUIRED);
        }
      } else {
        // Fallback if not in AI Studio environment and no env key
        if (!envKey) setState(AppState.CONFIG_REQUIRED);
      }
    };
    checkApiKey();
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => {
      setIsOnline(false);
      if (state === AppState.CAPTURING || state === AppState.ANALYZING) {
        setError({ message: "Connection lost. Please check your internet.", isQuota: false });
        setState(AppState.ERROR);
      }
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [state]);

  useEffect(() => {
    const saved = localStorage.getItem('bazaar_history');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('bazaar_history', JSON.stringify(history));
  }, [history]);

  const handleOpenConfig = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      // Assume success as per guidelines to avoid race conditions
      setState(AppState.IDLE);
    } else {
      // Direct hardcode/prompt fallback for local dev if not in studio
      const key = prompt("Please enter your Gemini API Key (from AI Studio):");
      if (key) {
        process.env.API_KEY = key;
        setState(AppState.IDLE);
      }
    }
  };

  const getCurrentLocation = (): Promise<{ latitude: number; longitude: number } | undefined> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(undefined);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        },
        () => resolve(undefined),
        { timeout: 5000 }
      );
    });
  };

  const handleCapture = useCallback(async (base64: string) => {
    if (!navigator.onLine) {
      setError({ message: "You are currently offline. Bazaar-Sense requires internet.", isQuota: false });
      setState(AppState.ERROR);
      return;
    }

    try {
      setState(AppState.ANALYZING);
      setError(null);
      
      const location = await getCurrentLocation();
      const analysis = await analyzeImage(base64, location);
      setResult(analysis);
      setState(AppState.RESULT);
    } catch (err: any) {
      console.error('Analysis Error:', err);
      const errMsg = err?.message || JSON.stringify(err) || "";
      
      const isQuota = errMsg.includes('429') || errMsg.toLowerCase().includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED');
      const isPermission = errMsg.toLowerCase().includes('permission') || errMsg.toLowerCase().includes('notallowed') || errMsg.includes('INVALID_API_KEY');
      const isEntityNotFound = errMsg.includes("Requested entity was not found.");
      
      if (isEntityNotFound) {
        // Reset key selection if the entity was not found (possible key mismatch)
        setState(AppState.CONFIG_REQUIRED);
        setError({ message: "Connection lost. Please re-select your API key.", isQuota: false, isConfig: true });
        return;
      }

      setError({
        message: isPermission 
          ? "Permission or API Key rejected. Please check your credentials."
          : isQuota 
            ? "Rate limit exceeded. Please wait a moment." 
            : `Connection error: ${errMsg.slice(0, 100)}`,
        isQuota,
        isPermission,
        isConfig: errMsg.includes('KEY_NOT_CONFIGURED')
      });
      setState(AppState.ERROR);
    }
  }, []);

  const handleSaveToHistory = useCallback((item: HistoryItem) => {
    setHistory(prev => [item, ...prev]);
  }, []);

  const handleReset = () => {
    setResult(null);
    setError(null);
    setState(AppState.IDLE);
  };

  if (state === AppState.CONFIG_REQUIRED) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white max-w-md w-full p-10 rounded-[2.5rem] shadow-2xl border border-indigo-50 text-center animate-in zoom-in-95 duration-700">
          <div className="w-20 h-20 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-8 shadow-inner">
            <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <h1 className="text-3xl font-black text-indigo-900 mb-4">Connect Gemini</h1>
          <p className="text-slate-500 text-sm mb-10 leading-relaxed font-medium">
            To bargaining like a local, you need to connect your Gemini API Key. Use a paid project key for the best experience.
          </p>
          <button
            onClick={handleOpenConfig}
            className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-indigo-100 hover:bg-indigo-700 active:scale-95 transition-all"
          >
            Connect API Key
          </button>
          <div className="mt-8 text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-loose">
            Check <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="text-indigo-600 underline">Billing Docs</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center p-4 md:p-8">
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 bg-amber-600 text-white text-[10px] font-black uppercase tracking-[0.2em] py-2 text-center z-[100] animate-in slide-in-from-top duration-300 flex items-center justify-center gap-2">
          <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>
          Offline Mode
        </div>
      )}

      <header className="w-full max-w-2xl mb-8 flex items-center justify-between animate-in fade-in slide-in-from-top-4 duration-1000 mt-4">
        <div className="text-left">
          <h1 className="text-3xl font-extrabold text-indigo-900 flex items-center gap-2 cursor-pointer" onClick={handleReset}>
            <span className="text-emerald-600">Bazaar</span>
            <span className="bg-indigo-100 px-3 py-1 rounded-xl">Sense</span>
          </h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest mt-1">Peshawar Edition</p>
        </div>
        
        <button 
          onClick={() => setState(state === AppState.HISTORY ? AppState.IDLE : AppState.HISTORY)}
          className={`p-3 rounded-2xl transition-all active:scale-95 ${state === AppState.HISTORY ? 'bg-indigo-600 text-white shadow-indigo-200 shadow-lg' : 'bg-white text-indigo-600 border border-indigo-100 shadow-sm'}`}
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      </header>

      <main className="w-full max-w-2xl relative">
        {state === AppState.HISTORY && (
          <div className="bg-white rounded-[2.5rem] shadow-xl p-8 border border-indigo-50 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-2xl font-black text-gray-900 mb-6">Recent Deals</h2>
            {history.length === 0 ? (
              <p className="text-slate-400 text-sm italic text-center py-10">No deals saved yet.</p>
            ) : (
              <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                {history.map((item) => (
                  <div key={item.id} className="p-4 rounded-2xl border border-slate-100 bg-slate-50 flex justify-between items-center">
                    <div>
                      <h3 className="font-bold text-gray-800">{item.objectName}</h3>
                      <p className="text-[10px] text-slate-400">{new Date(item.timestamp).toLocaleDateString()}</p>
                    </div>
                    <div className="text-emerald-600 font-black">{item.pricePKR}</div>
                  </div>
                ))}
              </div>
            )}
            <button onClick={handleReset} className="w-full mt-8 py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest">Back</button>
          </div>
        )}

        {(state === AppState.IDLE || state === AppState.ANALYZING) && (
          <div className="space-y-6">
            <div className="text-center mb-10 px-4">
              <h2 className="text-4xl md:text-5xl font-black text-indigo-900 mb-4 leading-tight">
                Shop Like <span className="text-emerald-600">a Local</span>
              </h2>
              <p className="text-slate-500 text-sm max-w-md mx-auto font-medium">
                Identify items and bargain in <span className="text-indigo-600 font-bold">Pashto</span> & <span className="text-indigo-600 font-bold">Urdu</span> with AI support.
              </p>
            </div>
            <CameraView onCapture={handleCapture} isLoading={state === AppState.ANALYZING} />
          </div>
        )}

        {state === AppState.RESULT && result && (
          <AnalysisResultView result={result} onReset={handleReset} onSaveHistory={handleSaveToHistory} />
        )}

        {state === AppState.ERROR && error && (
          <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl text-center border-2 border-red-50">
            <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <h2 className="text-2xl font-black text-gray-900 mb-3">Something went wrong</h2>
            <p className="text-gray-500 mb-8 text-sm">{error.message}</p>
            <div className="flex flex-col gap-3">
              {error.isConfig ? (
                <button onClick={handleOpenConfig} className="w-full py-4 rounded-2xl font-black uppercase text-xs text-white bg-indigo-600">Reconnect Key</button>
              ) : (
                <button onClick={handleReset} className="w-full py-4 rounded-2xl font-black uppercase text-xs text-white bg-indigo-600">Try Again</button>
              )}
            </div>
          </div>
        )}
      </main>
      <footer className="mt-auto py-10 text-center text-slate-400 text-[10px] uppercase tracking-[0.2em] font-bold">
        Bazaar-Sense • Peshawar Shopping Companion
      </footer>
    </div>
  );
};

export default App;
