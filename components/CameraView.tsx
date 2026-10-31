import React, { useRef, useEffect, useState, useCallback } from 'react';

interface CameraViewProps {
  onCapture: (base64: string) => void;
  isLoading: boolean;
}

// Generates high-quality authentic visual sample representations for instant 1-click testing
const generateSampleBazaarImage = (type: 'chappal' | 'samovar' | 'pakol' | 'dryfruits'): string => {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Background wooden texture
  const bgGrad = ctx.createLinearGradient(0, 0, 640, 480);
  bgGrad.addColorStop(0, '#2c1810');
  bgGrad.addColorStop(0.5, '#422415');
  bgGrad.addColorStop(1, '#1f100a');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 640, 480);

  // Decorative border
  ctx.strokeStyle = '#d97706';
  ctx.lineWidth = 6;
  ctx.strokeRect(20, 20, 600, 440);

  ctx.strokeStyle = 'rgba(217, 119, 6, 0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(28, 28, 584, 424);

  if (type === 'chappal') {
    // Leather sole
    ctx.fillStyle = '#1c1917';
    ctx.beginPath();
    ctx.ellipse(320, 270, 160, 80, -0.1, 0, Math.PI * 2);
    ctx.fill();

    // Leather Upper (Deep Mahogany)
    const upperGrad = ctx.createRadialGradient(310, 240, 20, 320, 250, 140);
    upperGrad.addColorStop(0, '#78350f');
    upperGrad.addColorStop(0.7, '#451a03');
    upperGrad.addColorStop(1, '#291004');
    ctx.fillStyle = upperGrad;
    ctx.beginPath();
    ctx.ellipse(310, 245, 130, 65, -0.15, 0, Math.PI * 2);
    ctx.fill();

    // Yellow double stitching lines
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.ellipse(310, 245, 120, 55, -0.15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Text label
    ctx.fillStyle = '#fef3c7';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PESHAWARI CHAPPAL', 320, 390);
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#fbbf24';
    ctx.fillText('Noruzi Cut • Jahangirpura Bazaar', 320, 415);
  } else if (type === 'samovar') {
    // Brass Kahwa Kettle
    const brassGrad = ctx.createLinearGradient(200, 140, 440, 340);
    brassGrad.addColorStop(0, '#fef08a');
    brassGrad.addColorStop(0.3, '#eab308');
    brassGrad.addColorStop(0.7, '#ca8a04');
    brassGrad.addColorStop(1, '#854d0e');
    ctx.fillStyle = brassGrad;

    // Body
    ctx.beginPath();
    ctx.ellipse(320, 260, 90, 110, 0, 0, Math.PI * 2);
    ctx.fill();

    // Spout
    ctx.beginPath();
    ctx.moveTo(390, 230);
    ctx.quadraticCurveTo(460, 200, 440, 280);
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#ca8a04';
    ctx.stroke();

    // Lid & Top knob
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(320, 140, 14, 0, Math.PI * 2);
    ctx.fill();

    // Text label
    ctx.fillStyle = '#fef3c7';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TRADITIONAL BRASS SAMOVAR', 320, 390);
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#fbbf24';
    ctx.fillText('Green Tea Kahwa • Qissa Khwani Bazaar', 320, 415);
  } else if (type === 'pakol') {
    // Wool Pakol Cap
    const woolGrad = ctx.createRadialGradient(320, 240, 30, 320, 240, 130);
    woolGrad.addColorStop(0, '#d6d3d1');
    woolGrad.addColorStop(0.6, '#a8a29e');
    woolGrad.addColorStop(1, '#57534e');
    ctx.fillStyle = woolGrad;

    // Crown
    ctx.beginPath();
    ctx.ellipse(320, 220, 120, 70, 0, 0, Math.PI * 2);
    ctx.fill();

    // Rolled woolen brim
    ctx.fillStyle = '#78716c';
    ctx.beginPath();
    ctx.ellipse(320, 260, 135, 45, 0, 0, Math.PI * 2);
    ctx.fill();

    // Text label
    ctx.fillStyle = '#fef3c7';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('AUTHENTIC CHITRALI PAKOL', 320, 390);
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#fbbf24';
    ctx.fillText('Pure Wool Cap • Khyber Bazaar', 320, 415);
  } else {
    // Chilgoza / Dry fruits
    const nutGrad = ctx.createRadialGradient(320, 240, 20, 320, 240, 120);
    nutGrad.addColorStop(0, '#fef3c7');
    nutGrad.addColorStop(0.5, '#d97706');
    nutGrad.addColorStop(1, '#78350f');
    ctx.fillStyle = nutGrad;

    // Bowl
    ctx.beginPath();
    ctx.ellipse(320, 260, 130, 70, 0, 0, Math.PI * 2);
    ctx.fill();

    // Pine nuts
    ctx.fillStyle = '#451a03';
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      const r = 35 + (i % 3) * 20;
      const x = 320 + Math.cos(angle) * r;
      const y = 250 + Math.sin(angle) * (r * 0.5);
      ctx.beginPath();
      ctx.ellipse(x, y, 10, 5, angle, 0, Math.PI * 2);
      ctx.fill();
    }

    // Text label
    ctx.fillStyle = '#fef3c7';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('KHYBER CHILGOZA PINE NUTS', 320, 390);
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#fbbf24';
    ctx.fillText('Dry Fruits & Saffron • Namak Mandi', 320, 415);
  }

  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
};

const CameraView: React.FC<CameraViewProps> = ({ onCapture, isLoading }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isFlashActive, setIsFlashActive] = useState(false);
  const [coolDown, setCoolDown] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  const startCamera = useCallback(async () => {
    setError(null);
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }

    try {
      // Use ideal facingMode to succeed on mobile as well as laptop webcams
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: { ideal: facingMode }, 
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
      console.warn("Camera access failed:", err);
      // Try again without facingMode constraint if first attempt failed
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        setStream(fallbackStream);
        if (videoRef.current) videoRef.current.srcObject = fallbackStream;
      } catch (finalErr: any) {
        setError('Camera access is unavailable on this device or permission was declined.');
      }
    }
  }, [facingMode]);

  useEffect(() => {
    startCamera();
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [startCamera]);

  const toggleCamera = () => {
    setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');
  };

  const handleCapture = useCallback(() => {
    if (coolDown || isLoading) return;
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      if (context && video.videoWidth > 0 && video.videoHeight > 0) {
        setIsFlashActive(true);
        setTimeout(() => setIsFlashActive(false), 150);
        setCoolDown(true);
        setTimeout(() => setCoolDown(false), 1500);

        const targetWidth = 1024;
        const scale = targetWidth / video.videoWidth;
        canvas.width = targetWidth;
        canvas.height = Math.round(video.videoHeight * scale);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        onCapture(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
      }
    }
  }, [onCapture, coolDown, isLoading]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      onCapture(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleSampleClick = (type: 'chappal' | 'samovar' | 'pakol' | 'dryfruits') => {
    if (isLoading) return;
    setIsFlashActive(true);
    setTimeout(() => setIsFlashActive(false), 150);
    const base64 = generateSampleBazaarImage(type);
    if (base64) {
      onCapture(base64);
    }
  };

  return (
    <div className="w-full space-y-4">
      <div className="relative w-full aspect-square md:aspect-video bg-stone-900 rounded-[2.5rem] overflow-hidden shadow-2xl border-[8px] border-white/70">
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted 
          className={`w-full h-full object-cover transition-all duration-700 ${isLoading ? 'blur-xl' : ''}`} 
        />
        <canvas ref={canvasRef} className="hidden" />
        <input 
          ref={fileInputRef} 
          type="file" 
          accept="image/*" 
          capture="environment" 
          onChange={handleFileUpload} 
          className="hidden" 
        />

        <div className={`absolute inset-0 bg-white transition-opacity duration-150 z-30 pointer-events-none ${isFlashActive ? 'opacity-100' : 'opacity-0'}`}></div>

        {/* Camera Control Overlays */}
        {!isLoading && (
          <div className="absolute top-4 right-4 flex items-center gap-2 z-40">
            <button
              onClick={toggleCamera}
              title="Flip camera"
              className="p-3 bg-black/40 hover:bg-black/60 backdrop-blur-md rounded-2xl text-white border border-white/20 transition-all active:scale-95 shadow-lg"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              title="Upload photo"
              className="p-3 bg-black/40 hover:bg-black/60 backdrop-blur-md rounded-2xl text-white border border-white/20 transition-all active:scale-95 shadow-lg"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </button>
          </div>
        )}

        {error && !stream && (
          <div className="absolute inset-0 bg-stone-900/90 backdrop-blur-md flex flex-col items-center justify-center p-8 text-center z-20">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500 mb-4">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <p className="text-stone-300 text-sm font-semibold mb-2">{error}</p>
            <p className="text-stone-400 text-xs max-w-sm mb-6">
              You can upload an existing picture or test with one of the authentic Peshawar bazaar samples below.
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => fileInputRef.current?.click()} 
                className="bg-amber-500 hover:bg-amber-600 text-stone-950 px-6 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] transition-colors shadow-lg"
              >
                Upload Photo
              </button>
              <button 
                onClick={startCamera} 
                className="bg-stone-800 hover:bg-stone-700 text-white px-6 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] transition-colors border border-stone-700"
              >
                Retry Camera
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="absolute inset-0 bg-teal-950/70 flex flex-col items-center justify-center backdrop-blur-md z-40">
            <div className="relative">
              <div className="w-20 h-20 border-4 border-teal-500/20 border-t-amber-500 rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-8 h-8 rounded-full bg-amber-500/20 animate-pulse"></div>
              </div>
            </div>
            <p className="text-white font-black uppercase tracking-[0.3em] text-xs mt-6">Consulting Bazaar Intelligence...</p>
            <p className="text-teal-300/70 text-[10px] uppercase tracking-widest mt-1">Cross-referencing Namak Mandi & Qissa Khwani prices</p>
          </div>
        ) : (
          <div className="absolute bottom-6 left-0 right-0 flex items-center justify-center gap-6 z-40">
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Upload Photo"
              className="p-4 bg-white/20 hover:bg-white/30 backdrop-blur-md rounded-2xl text-white border border-white/30 transition-all active:scale-90 shadow-xl"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>

            <button
              onClick={handleCapture}
              disabled={coolDown}
              className={`group w-20 h-20 md:w-24 md:h-24 rounded-full border-4 border-white p-1.5 transition-all active:scale-90 ${coolDown ? 'opacity-50 grayscale' : 'hover:scale-105 shadow-2xl'}`}
            >
              <div className="w-full h-full rounded-full bg-gradient-to-tr from-teal-700 to-amber-500 border-2 border-white/40 flex items-center justify-center shadow-lg group-hover:from-teal-600 group-hover:to-amber-400">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-white/30 border border-white/50"></div>
              </div>
            </button>

            <button
              onClick={toggleCamera}
              title="Flip Camera"
              className="p-4 bg-white/20 hover:bg-white/30 backdrop-blur-md rounded-2xl text-white border border-white/30 transition-all active:scale-90 shadow-xl"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Quick Test Samples Bar */}
      <div className="bg-white/70 backdrop-blur-md rounded-2xl p-4 border border-teal-100 shadow-sm">
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-[10px] font-black uppercase tracking-wider text-teal-900/60">
            Quick Test Authentic Bazaar Goods (1-Click)
          </span>
          <span className="text-[9px] font-bold text-amber-700 uppercase">Interactive Presets</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            onClick={() => handleSampleClick('chappal')}
            disabled={isLoading}
            className="p-2.5 rounded-xl bg-amber-50 hover:bg-amber-100/80 border border-amber-200/60 text-left transition-all active:scale-95 group disabled:opacity-50"
          >
            <div className="text-base mb-1">👞</div>
            <div className="text-xs font-black text-amber-950 group-hover:text-amber-700">Peshawari Chappal</div>
            <div className="text-[9px] text-amber-800/60 font-medium">Jahangirpura Leather</div>
          </button>

          <button
            onClick={() => handleSampleClick('samovar')}
            disabled={isLoading}
            className="p-2.5 rounded-xl bg-teal-50 hover:bg-teal-100/80 border border-teal-200/60 text-left transition-all active:scale-95 group disabled:opacity-50"
          >
            <div className="text-base mb-1">☕</div>
            <div className="text-xs font-black text-teal-950 group-hover:text-teal-700">Brass Samovar</div>
            <div className="text-[9px] text-teal-800/60 font-medium">Qissa Khwani Kahwa</div>
          </button>

          <button
            onClick={() => handleSampleClick('pakol')}
            disabled={isLoading}
            className="p-2.5 rounded-xl bg-stone-100 hover:bg-stone-200/80 border border-stone-300/60 text-left transition-all active:scale-95 group disabled:opacity-50"
          >
            <div className="text-base mb-1">🧢</div>
            <div className="text-xs font-black text-stone-900 group-hover:text-amber-800">Chitrali Pakol</div>
            <div className="text-[9px] text-stone-600 font-medium">Pure Wool Cap</div>
          </button>

          <button
            onClick={() => handleSampleClick('dryfruits')}
            disabled={isLoading}
            className="p-2.5 rounded-xl bg-orange-50 hover:bg-orange-100/80 border border-orange-200/60 text-left transition-all active:scale-95 group disabled:opacity-50"
          >
            <div className="text-base mb-1">🥜</div>
            <div className="text-xs font-black text-orange-950 group-hover:text-orange-700">Chilgoza Nuts</div>
            <div className="text-[9px] text-orange-800/60 font-medium">Namak Mandi Fruits</div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default CameraView;