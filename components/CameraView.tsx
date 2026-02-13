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

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      setStream(mediaStream);
      if (videoRef.current) videoRef.current.srcObject = mediaStream;
    } catch (err: any) {
      setError('Could not access camera.');
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => stream?.getTracks().forEach(track => track.stop());
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
        setTimeout(() => setCoolDown(false), 1500);

        const targetWidth = 1024;
        const scale = targetWidth / video.videoWidth;
        canvas.width = targetWidth;
        canvas.height = video.videoHeight * scale;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        onCapture(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
      }
    }
  }, [onCapture, coolDown, isLoading]);

  if (error) {
    return (
      <div className="h-80 bg-white border-2 border-teal-100 rounded-[2.5rem] flex flex-col items-center justify-center p-8 text-center shadow-xl">
        <p className="text-teal-900/40 text-xs mb-6">{error}</p>
        <button onClick={startCamera} className="bg-teal-800 text-white px-8 py-3 rounded-2xl font-black uppercase tracking-widest text-[10px]">Retry</button>
      </div>
    );
  }

  return (
    <div className="relative w-full aspect-square md:aspect-video bg-black rounded-[2.5rem] overflow-hidden shadow-2xl border-[8px] border-white/50">
      <video ref={videoRef} autoPlay playsInline muted className={`w-full h-full object-cover transition-all duration-700 ${isLoading ? 'blur-xl' : ''}`} />
      <canvas ref={canvasRef} className="hidden" />
      <div className={`absolute inset-0 bg-white transition-opacity duration-150 z-30 pointer-events-none ${isFlashActive ? 'opacity-100' : 'opacity-0'}`}></div>

      {isLoading ? (
        <div className="absolute inset-0 bg-teal-900/40 flex flex-col items-center justify-center backdrop-blur-md z-40">
          <div className="w-16 h-16 border-4 border-white/20 border-t-amber-500 rounded-full animate-spin"></div>
          <p className="text-white font-black uppercase tracking-[0.3em] text-[10px] mt-8">Consulting Experts...</p>
        </div>
      ) : (
        <div className="absolute bottom-8 left-0 right-0 flex justify-center z-50">
          <button
            onClick={handleCapture}
            disabled={coolDown}
            className={`group w-24 h-24 rounded-full border-4 border-white p-1.5 transition-all active:scale-90 ${coolDown ? 'opacity-50 grayscale' : 'hover:scale-105 shadow-2xl animate-pulse'}`}
          >
            <div className="w-full h-full rounded-full bg-gradient-to-tr from-teal-700 to-amber-500 border-2 border-white/40 flex items-center justify-center shadow-lg">
               <div className="w-12 h-12 rounded-full bg-white/20 border border-white/30"></div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
};

export default CameraView;