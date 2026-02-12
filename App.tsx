
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
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => {
      setIsOnline(false);
      if (state === AppState.CAPTURING || state === AppState.ANALYZING) {
        setError({ message: "Network connection lost. Switch to history mode to see previous deals.", isQuota: false });
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
      setError({ message: "You are currently offline. Bazaar-Sense requires internet to analyze new items.", isQuota: false });
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
      const isConfig = errMsg.includes('MISSING_API_KEY') || errMsg.includes('process is not defined');
      
      setError({
        message: isConfig 
          ? "API Key Missing: Ensure 'API_KEY' is added to Vercel and you have clicked 'Redeploy'."
          : isPermission 
            ? errMsg.includes('INVALID') ? "Your API Key was rejected by Google. Check it in Google AI Studio." : "Camera or Location permission was denied."
            : isQuota 
              ? "Rate limit exceeded. Please wait 60 seconds." 
              : `Connection error. Please check your internet and API settings.`,
        isQuota,
        isPermission,
        isConfig
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

  const clearHistory = () => {
    if (window.confirm("Clear all purchase history?")) {
      setHistory([]);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center p-4 md:p-8">
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 bg-amber-600 text-white text-[10px] font-black uppercase tracking-[0.2em] py-2 text-center z-[100] animate-in slide-in-from-top duration-300 flex items-center justify-center gap-2">
          <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>
          Offline Mode • History Only
        </div>
      )}

      <header className="w-full max-w-2xl mb-8 flex items-center justify-between animate-in fade-in slide-in-from-top-4 duration-1000 mt-4">
        <div className="text-left">
          <h1 className="text-3xl font-extrabold text-indigo-900 flex items-center gap-2 cursor-pointer" onClick={handleReset}>
            <span className="text-emerald-600">Bazaar</span>
            <span className="bg-indigo-100 px-3 py-1 rounded-xl">Sense</span>
          </h1>
          <div className="flex items-center gap-2 mt-1">
             <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest">Peshawar Edition</p>
             {isOnline ? (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-100">
                  <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span className="text-emerald-600 text-[8px] font-bold uppercase tracking-widest">Online</span>
                </div>
             ) : (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200">
                  <svg className="w-2.5 h-2.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                  </svg>
                  <span className="text-slate-500 text-[8px] font-bold uppercase">Offline</span>
                </div>
             )}
          </div>
        </div>
        
        <button 
          onClick={() => setState(state === AppState.HISTORY ? AppState.IDLE : AppState.HISTORY)}
          className={`p-3 rounded-2xl transition-all active:scale-95 ${state === AppState.HISTORY ? 'bg-indigo-600 text-white shadow-indigo-200 shadow-lg' : 'bg-white text-indigo-600 border border-indigo-100 shadow-sm'}`}
          title="View History"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      </header>

      <main className="w-full max-w-2xl relative">
        {state === AppState.HISTORY && (
          <div className="bg-white rounded-[2.5rem] shadow-xl p-8 border border-indigo-50 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-black text-gray-900">Purchase History</h2>
              {history.length > 0 && (
                <button onClick={clearHistory} className="text-red-500 text-[10px] font-bold uppercase tracking-widest hover:underline">Clear All</button>
              )}
            </div>
            
            {history.length === 0 ? (
              <div className="py-12 text-center">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                   <svg className="w-8 h-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>
                </div>
                <p className="text-slate-400 text-sm italic">No history yet. Point the camera to an item to start.</p>
              </div>
            ) : (
              <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                {history.map((item) => (
                  <div key={item.id} className="p-4 rounded-2xl border border-slate-100 bg-slate-50 flex justify-between items-center hover:bg-white hover:shadow-md transition-all group">
                    <div>
                      <h3 className="font-bold text-gray-800">{item.objectName}</h3>
                      <p className="text-[10px] text-slate-400">{new Date(item.timestamp).toLocaleDateString()}</p>
                    </div>
                    <div className="text-emerald-600 font-black text-sm">{item.pricePKR}</div>
                  </div>
                ))}
              </div>
            )}
            
            <button
              onClick={handleReset}
              className="w-full mt-8 py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-indigo-100 hover:bg-indigo-700 active:scale-95 transition-all"
            >
              Back to Camera
            </button>
          </div>
        )}

        {(state === AppState.IDLE || state === AppState.ANALYZING) && (
          <div className="space-y-6">
            {!isOnline ? (
              <div className="bg-white p-10 rounded-[2.5rem] shadow-xl text-center border-2 border-amber-50 animate-in zoom-in-95 duration-500">
                <div className="w-16 h-16 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-6">
                   <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-3.536 5 5 0 015-5c.916 0 1.78.245 2.525.674M3 3l18 18" /></svg>
                </div>
                <h2 className="text-xl font-black text-gray-900 mb-2">Offline Mode</h2>
                <p className="text-slate-500 text-sm mb-6">Internet connection required to identify items. You can still browse your local history.</p>
                <button 
                   onClick={() => setState(AppState.HISTORY)}
                   className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg"
                >
                   Browse History
                </button>
              </div>
            ) : (
              <>
                <div className="text-center mb-10 animate-in fade-in duration-1000 delay-200 fill-mode-both px-4">
                  <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-indigo-900 mb-4 leading-tight">
                    Bargain Like <span className="text-emerald-600 underline decoration-indigo-200 underline-offset-8">a Local</span>
                  </h2>
                  <p className="text-slate-500 text-sm md:text-base max-w-md mx-auto leading-relaxed font-medium">
                    Point your camera at any item in the bazaar. We'll identify it, find the fair price, and help you negotiate in <span className="text-indigo-600 font-bold">Pashto</span> & <span className="text-indigo-600 font-bold">Urdu</span>.
                  </p>
                </div>
                <CameraView 
                  onCapture={handleCapture} 
                  isLoading={state === AppState.ANALYZING} 
                />
              </>
            )}
          </div>
        )}

        {state === AppState.RESULT && result && (
          <AnalysisResultView 
            result={result} 
            onReset={handleReset}
            onSaveHistory={handleSaveToHistory}
          />
        )}

        {state === AppState.ERROR && error && (
          <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl text-center border-2 border-red-50 animate-in zoom-in-95 duration-500">
            <div className={`w-20 h-20 ${error.isConfig ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600'} rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm`}>
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-2xl font-black text-gray-900 mb-3">
              {error.isConfig ? 'Setup Required' : error.isQuota ? 'Server Busy' : 'Connection Error'}
            </h2>
            <p className="text-gray-500 mb-8 leading-relaxed max-w-xs mx-auto text-sm">{error.message}</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={handleReset}
                className="w-full py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all shadow-lg active:scale-95 text-white bg-indigo-600 hover:bg-indigo-700"
              >
                Try Again
              </button>
              <button 
                onClick={() => setState(AppState.HISTORY)}
                className="text-indigo-600 font-bold text-xs uppercase tracking-widest"
              >
                Go to History
              </button>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-auto pt-16 concert-8 text-center text-slate-400 text-[10px] max-w-sm uppercase tracking-[0.2em] font-bold">
        <p className="mb-2">Bazaar-Sense v3.0 • Diagnostics Enhanced</p>
        <p>Your Peshawar Shopping Companion</p>
      </footer>
    </div>
  );
};

export default App;
