import React, { useState, useCallback, useEffect } from 'react';
import CameraView from './components/CameraView.tsx';
import AnalysisResultView from './components/AnalysisResultView.tsx';
import { analyzeImage, checkQuota } from './services/gemini.ts';
import { AnalysisResult, AppState, HistoryItem } from './types.ts';

const createThumbnail = (base64: string, maxDim: number = 160): Promise<string> => {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.65));
        } else {
          resolve('');
        }
      };
      img.onerror = () => resolve('');
      img.src = base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`;
    } catch {
      resolve('');
    }
  });
};

// Turns raw server/Google errors into a clear instruction.
const explainError = (raw: string): string => {
  const m = raw.toLowerCase();
  if (m.includes('key_not_configured')) return 'The server has no Gemini API key. Create a file named .env.local in the project folder containing GEMINI_API_KEY=your_key, then stop and restart "npm run dev".';
  if (m.includes('api key not valid') || m.includes('api_key_invalid')) return 'Google rejected your API key. Create a new key at aistudio.google.com/apikey, put it in .env.local, and restart the server.';
  if (m.includes('permission_denied') || m.includes('403')) return 'Your key is blocked or this model is not allowed for it. Create a new key at aistudio.google.com/apikey and restart the server.';
  if (m.includes('server returned error status 404') || m.includes('failed to fetch')) return 'The backend is not running. Start the app with "npm run dev" (not "vite"), then open http://localhost:3000.';
  if (m.includes('timeout')) return 'Google took too long to answer. Check your internet connection and try again.';
  if (m.includes('not_found') || m.includes('404')) return 'A Gemini model name used by the server is no longer available. Update the model lists at the top of server.ts.';
  return raw;
};

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState<{ message: string; isQuota: boolean; details?: string } | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [quotaInfo, setQuotaInfo] = useState<{ message: string; status: 'healthy' | 'warning' | 'error' | 'checking' }>({ message: 'Live', status: 'healthy' });

  const verifyQuota = useCallback(async () => {
    setQuotaInfo({ message: 'Verifying...', status: 'checking' });
    const res = await checkQuota();
    if (res.success) {
      setQuotaInfo({ message: 'Live Intelligence', status: 'healthy' });
    } else {
      setQuotaInfo({ 
        message: res.message, 
        status: res.isQuota ? 'error' : 'warning' 
      });
    }
  }, []);

  useEffect(() => {
    verifyQuota();
  }, [verifyQuota]);

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
      } catch (e) { 
        console.error("History load error", e); 
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('bazaar_history', JSON.stringify(history));
  }, [history]);

  const handleSelectHistoryItem = (item: HistoryItem) => {
    if (item.result) {
      setResult(item.result);
    } else {
      setResult({
        objectName: item.objectName,
        pricePKR: item.pricePKR,
        urdu: { name: item.objectName, phonetic: "" },
        pashto: { name: item.objectName, phonetic: "" },
        description: "Saved scan from your local offline cache.",
      });
    }
    setState(AppState.RESULT);
  };

  const handleClearHistory = () => {
    if (window.confirm("Clear all locally cached scans?")) {
      setHistory([]);
      localStorage.removeItem('bazaar_history');
    }
  };

  const handleCapture = useCallback(async (base64: string) => {
    if (!navigator.onLine) {
      setError({ 
        message: "Network Offline", 
        isQuota: false, 
        details: "Live camera scanning requires internet, but you can inspect all previous scans stored in your offline Acquisition Log." 
      });
      setState(AppState.ERROR);
      return;
    }

    try {
      setState(AppState.ANALYZING);
      setError(null);
      const analysis = await analyzeImage(base64);
      setResult(analysis);
      setState(AppState.RESULT);

      // Automatically cache scan details and thumbnail into local storage
      try {
        const thumb = await createThumbnail(base64, 160);
        const newItem: HistoryItem = {
          id: Date.now().toString(),
          objectName: analysis.objectName,
          pricePKR: analysis.pricePKR,
          timestamp: Date.now(),
          imageThumbnail: thumb || undefined,
          result: analysis
        };
        setHistory(prev => {
          const filtered = prev.filter(h => h.objectName.toLowerCase() !== analysis.objectName.toLowerCase());
          return [newItem, ...filtered].slice(0, 40);
        });
      } catch (cacheErr) {
        console.warn("Could not cache thumbnail:", cacheErr);
      }
    } catch (err: any) {
      console.error('Analysis Error:', err);
      const errMsg = (err?.message || "Unknown error").toLowerCase();
      const isQuota = errMsg.includes('429') || errMsg.includes('resource_exhausted') || errMsg.includes('quota');

      setError({ 
        message: isQuota ? "High Demand / Quota Limit" : "Analysis Failed", 
        isQuota, 
        details: explainError(err?.message || "Please try again or select one of the instant bazaar presets.")
      });
      setState(AppState.ERROR);
      if (isQuota) setQuotaInfo({ message: 'Quota Busy', status: 'error' });
    }
  }, []);

  const handleReset = () => {
    setResult(null);
    setError(null);
    setState(AppState.IDLE);
  };

  return (
    <div className="min-h-screen flex flex-col items-center p-4 sm:p-6 md:p-10 max-w-5xl mx-auto selection:bg-amber-200">
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 bg-rose-600 text-white text-[10px] font-black tracking-[0.3em] py-2 text-center z-[100] uppercase shadow-lg">
          Network Interrupted &bull; Offline Mode Active
        </div>
      )}

      {/* Main App Navigation Bar */}
      <header className="w-full flex items-center justify-between mb-6 md:mb-10 px-4 py-3 bg-white/70 backdrop-blur-md rounded-[2rem] border border-white/70 elegant-shadow">
        <div className="cursor-pointer group flex items-center gap-3" onClick={handleReset}>
          <div className="w-10 h-10 bg-gradient-to-br from-teal-800 to-teal-950 rounded-xl flex items-center justify-center text-white shadow-lg group-hover:rotate-6 transition-transform overflow-hidden relative">
            <div className="absolute inset-0 bg-amber-500/20 mix-blend-overlay"></div>
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg md:text-2xl font-black tracking-tighter text-teal-950 leading-none">
              Bazaar<span className="text-amber-600">Sense</span>
            </h1>
            <p className="text-[8px] uppercase font-black tracking-[0.35em] text-teal-800/50 mt-1">Peshawar Edition</p>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          <button 
            onClick={verifyQuota}
            title="Click to refresh connection status"
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all active:scale-95 ${
              quotaInfo.status === 'healthy' ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60' :
              quotaInfo.status === 'error' ? 'bg-rose-50 text-rose-600 border-rose-200' :
              quotaInfo.status === 'checking' ? 'bg-stone-50 text-stone-500 border-stone-200' :
              'bg-amber-50 text-amber-700 border-amber-200'
            }`}
          >
            <div className={`w-2 h-2 rounded-full ${
              quotaInfo.status === 'healthy' ? 'bg-emerald-500 animate-pulse' :
              quotaInfo.status === 'error' ? 'bg-rose-500' :
              quotaInfo.status === 'checking' ? 'bg-stone-400 animate-spin' :
              'bg-amber-500'
            }`}></div>
            <span className="text-[9px] font-black uppercase tracking-wider hidden sm:inline">{quotaInfo.message}</span>
          </button>
          
          <button 
            onClick={() => setState(state === AppState.HISTORY ? AppState.IDLE : AppState.HISTORY)}
            title="View Acquisition Log"
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl transition-all active:scale-90 font-black text-xs uppercase tracking-wider ${
              state === AppState.HISTORY 
                ? 'bg-amber-500 text-stone-950 shadow-md font-bold' 
                : 'bg-white hover:bg-teal-50 text-teal-800 border border-teal-100 shadow-sm'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="hidden sm:inline">Log ({history.length})</span>
          </button>
        </div>
      </header>

      {/* Main View Area */}
      <main className="w-full max-w-3xl relative">
        {state === AppState.HISTORY && (
          <div className="bg-white/95 backdrop-blur-2xl rounded-[3rem] elegant-shadow p-6 md:p-10 animate-in fade-in slide-in-from-bottom-4 duration-500 border border-white/60">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span className="text-[9px] font-black text-teal-600 uppercase tracking-widest">Offline Ready &bull; Local Cache</span>
                </div>
                <h2 className="text-2xl md:text-3xl font-black text-teal-950 tracking-tight">Acquisition Log</h2>
                <p className="text-teal-900/60 text-xs font-medium mt-1">
                  {history.length} {history.length === 1 ? 'item' : 'items'} archived. Tap any item to inspect its valuation, location tips & pronunciations.
                </p>
              </div>

              {history.length > 0 && (
                <button 
                  onClick={handleClearHistory}
                  className="px-3 py-1.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-[10px] font-bold uppercase tracking-wider hover:bg-rose-100 transition-colors self-start sm:self-auto"
                >
                  Clear Cache
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="text-center py-16 bg-teal-50/30 rounded-2xl border border-dashed border-teal-200/70">
                <div className="w-12 h-12 rounded-full bg-teal-100/60 flex items-center justify-center mx-auto mb-3 text-teal-600">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <p className="text-teal-950 font-bold text-sm">No Scans Cached Yet</p>
                <p className="text-teal-900/50 text-[11px] font-medium mt-1 max-w-xs mx-auto">
                  Take photos or tap one of the instant bazaar presets to build your Peshawar market knowledge base.
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-2 custom-scrollbar">
                {history.map((item) => (
                  <div 
                    key={item.id} 
                    onClick={() => handleSelectHistoryItem(item)}
                    className="p-4 rounded-2xl border border-teal-100 bg-teal-50/20 flex items-center justify-between transition-all hover:bg-teal-50/60 hover:border-teal-300/60 hover:shadow-sm cursor-pointer group gap-4"
                  >
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      {item.imageThumbnail ? (
                        <img 
                          src={item.imageThumbnail} 
                          alt={item.objectName} 
                          className="w-12 h-12 rounded-xl object-cover border border-teal-200/60 shadow-sm shrink-0" 
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-xl bg-teal-100/70 border border-teal-200 flex items-center justify-center text-teal-700 shrink-0">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-black text-teal-950 group-hover:text-amber-700 transition-colors break-words">
                            {item.objectName}
                          </h3>
                          {item.result && (
                            <span className="text-[8px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded shrink-0">
                              Full Details
                            </span>
                          )}
                        </div>
                        <p className="text-[9px] font-bold text-teal-600 uppercase tracking-widest mt-0.5">
                          {new Date(item.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>

                    <div className="text-right shrink-0 max-w-[40%]">
                      <div className="text-amber-700 text-sm md:text-base font-black break-words leading-tight">{item.pricePKR}</div>
                      <span className="text-[9px] font-black uppercase text-teal-600 group-hover:translate-x-0.5 transition-transform inline-block mt-0.5">
                        Inspect &rarr;
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button 
              onClick={handleReset} 
              className="w-full mt-6 py-4 bg-teal-900 hover:bg-teal-850 text-white rounded-2xl font-black text-xs uppercase tracking-[0.3em] btn-elegant shadow-xl"
            >
              Back to Camera
            </button>
          </div>
        )}

        {(state === AppState.IDLE || state === AppState.ANALYZING) && (
          <div className="space-y-6">
            <div className="text-center px-4 animate-in fade-in duration-700 max-w-xl mx-auto">
              <h2 className="text-2xl sm:text-4xl font-black text-teal-950 tracking-tight mb-2 leading-tight">
                Scan Goods. <span className="text-amber-600">Know Fair Prices.</span>
              </h2>
              <p className="text-teal-900/60 text-xs md:text-sm font-medium">
                Peshawar bazaar intelligence for Namak Mandi, Qissa Khwani, and Khyber Bazaar.
              </p>
            </div>

            <CameraView onCapture={handleCapture} isLoading={state === AppState.ANALYZING} />
          </div>
        )}

        {state === AppState.RESULT && result && (
          <AnalysisResultView 
            result={result} 
            onReset={handleReset} 
            onSaveHistory={(item) => setHistory(prev => {
              const exists = prev.find(h => h.id === item.id);
              if (exists) return prev;
              return [{ ...item, result: result }, ...prev];
            })} 
          />
        )}

        {state === AppState.ERROR && error && (
          <div className="bg-white/95 backdrop-blur-2xl p-8 md:p-12 rounded-[3rem] elegant-shadow text-center animate-in zoom-in-95 border-4 border-rose-100 max-w-lg mx-auto">
            <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-inner">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-2xl font-black text-teal-950 mb-2 tracking-tight uppercase">{error.message}</h2>
            <p className="text-teal-900/60 mb-8 text-xs md:text-sm font-medium leading-relaxed max-w-sm mx-auto">
              {error.details}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              {history.length > 0 && (
                <button 
                  onClick={() => setState(AppState.HISTORY)} 
                  className="py-4 px-6 rounded-2xl font-black uppercase text-xs tracking-wider text-teal-900 bg-teal-50 border border-teal-200 hover:bg-teal-100 transition-colors shadow-sm"
                >
                  Browse Saved Scans ({history.length})
                </button>
              )}
              <button 
                onClick={handleReset} 
                className="py-4 px-8 rounded-2xl font-black uppercase text-xs tracking-[0.25em] text-white bg-teal-900 hover:bg-teal-850 btn-elegant shadow-xl"
              >
                Try Again
              </button>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-auto py-8 text-center">
        <p className="text-teal-900/30 text-[9px] uppercase tracking-[0.5em] font-black">
          Bazaar-Sense &bull; Peshawar Heritage & Market Companion
        </p>
      </footer>
    </div>
  );
};

export default App;
