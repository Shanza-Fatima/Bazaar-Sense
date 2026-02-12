
import React, { useRef, useEffect, useState, useCallback } from 'react';

interface CameraViewProps {
  onCapture: (base64: string) => void;
  isLoading: boolean;
}

const CameraView: React.FC<CameraViewProps> = ({ onCapture, isLoading }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFlashActive, setIsFlashActive] = useState(false);
  const [coolDown, setCoolDown] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const stopTracks = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  }, [stream]);

  const startCamera = useCallback(async () => {
    setError(null);
    setPermissionDenied(false);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false,
      });
      
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err: any) {
      console.error('Camera Access Error:', err);
      const errName = err.name || '';
      const errMsg = err.message || String(err);
      
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError' || errMsg.toLowerCase().includes('permission')) {
        setPermissionDenied(true);
        setError('Camera access was denied. Please click the camera icon in your browser address bar to "Allow" access and click retry.');
      } else {
        setError(`Could not access camera: ${errMsg}`);
      }
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [startCamera]);

  const handleCapture = useCallback(() => {
    if (coolDown || isLoading) return;

    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      if (context && video.readyState === 4) {
        setIsFlashActive(true);
        setTimeout(() => setIsFlashActive(false), 150);

        setCoolDown(true);
        setTimeout(() => setCoolDown(false), 2000);

        const targetWidth = 1024;
        const scale = targetWidth / video.videoWidth;
        canvas.width = targetWidth;
        canvas.height = video.videoHeight * scale;
        
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        const base64 = dataUrl.split(',')[1];
        onCapture(base64);
      }
    }
  }, [onCapture, coolDown, isLoading]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-80 bg-white border-2 border-indigo-100 rounded-[2.5rem] p-8 text-center animate-in zoom-in-95 duration-500 shadow-xl">
        <div className={`w-16 h-16 ${permissionDenied ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600'} rounded-full flex items-center justify-center mb-6 shadow-sm`}>
           <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
           </svg>
        </div>
        <h3 className="text-gray-900 font-black text-lg mb-2">{permissionDenied ? 'Camera Blocked' : 'Camera Error'}</h3>
        <p className="text-slate-500 font-medium mb-8 text-xs leading-relaxed max-w-xs">{error}</p>
        <div className="flex flex-col gap-3 w-full max-w-[220px]">
          <button 
            onClick={startCamera}
            className="bg-indigo-600 text-white px-6 py-3.5 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-indigo-100 transition-all hover:bg-indigo-700 active:scale-95"
          >
            Enable Camera
          </button>
          <button 
            onClick={() => window.location.reload()}
            className="text-slate-400 font-bold text-[10px] uppercase tracking-widest hover:text-indigo-600 transition-colors"
          >
            Refresh App
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full aspect-square md:aspect-video bg-black rounded-[2.5rem] overflow-hidden shadow-2xl border-[12px] border-white animate-in zoom-in-95 duration-1000">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`w-full h-full object-cover transition-transform duration-1000 ${isLoading ? 'scale-110 blur-md grayscale' : 'scale-100'}`}
      />
      <canvas ref={canvasRef} className="hidden" />
      
      <div className={`absolute inset-0 bg-white transition-opacity duration-150 z-30 pointer-events-none ${isFlashActive ? 'opacity-100' : 'opacity-0'}`}></div>

      {isLoading && (
        <div className="absolute inset-0 bg-indigo-900/40 flex flex-col items-center justify-center backdrop-blur-md z-40 animate-in fade-in duration-500">
          <div className="relative">
            <div className="w-20 h-20 border-4 border-white/20 border-t-white rounded-full animate-spin"></div>
            <div className="absolute inset-0 flex items-center justify-center">
               <div className="w-10 h-10 bg-white rounded-full animate-ping opacity-50"></div>
            </div>
          </div>
          <p className="text-white font-black uppercase tracking-[0.3em] text-[10px] mt-8 text-center px-4">Consulting Bazaar Experts...</p>
        </div>
      )}

      {!isLoading && (
        <div className="absolute bottom-10 left-0 right-0 flex flex-col items-center gap-4 px-4 z-50">
          <button
            onClick={handleCapture}
            disabled={isLoading || coolDown}
            className={`
              group relative w-24 h-24 rounded-full border-4 border-white flex items-center justify-center transition-all duration-300 active:scale-90
              ${isLoading || coolDown ? 'bg-white/20 cursor-not-allowed opacity-50' : 'bg-white/10 hover:bg-white/30 backdrop-blur-md shadow-2xl'}
            `}
            aria-label="Capture image"
          >
            <div className={`w-18 h-18 rounded-full border-2 border-white flex items-center justify-center transition-all duration-500 ${coolDown ? 'bg-transparent' : 'bg-indigo-600 group-hover:bg-indigo-500 shadow-xl'}`}>
               <div className={`w-14 h-14 rounded-full border-2 border-white/30 ${coolDown ? 'animate-pulse bg-gray-400' : ''}`}></div>
            </div>
          </button>
          {coolDown && (
             <span className="text-white text-[10px] font-bold uppercase tracking-widest bg-black/40 px-3 py-1 rounded-full backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2">
                Cooling Down...
             </span>
          )}
        </div>
      )}

      <div className="absolute inset-0 pointer-events-none border-[1px] border-white/10 flex flex-col justify-between">
          <div className="flex justify-between p-4">
             <div className="w-5 h-5 border-t-2 border-l-2 border-white/60 rounded-tl-sm"></div>
             <div className="w-5 h-5 border-t-2 border-r-2 border-white/60 rounded-tr-sm"></div>
          </div>
          <div className="flex justify-between p-4">
             <div className="w-5 h-5 border-b-2 border-l-2 border-white/60 rounded-bl-sm"></div>
             <div className="w-5 h-5 border-b-2 border-r-2 border-white/60 rounded-br-sm"></div>
          </div>
      </div>
    </div>
  );
};

export default CameraView;
