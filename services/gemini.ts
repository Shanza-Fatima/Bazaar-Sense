import { AnalysisResult } from "../types.ts";

export const checkQuota = async (): Promise<{ success: boolean; message: string; isQuota: boolean; isConfig?: boolean; details?: string }> => {
  try {
    const customKey = localStorage.getItem("bazaar_gemini_key") || "";
    const response = await fetch("/api/check-quota", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        ...(customKey ? { "x-gemini-api-key": customKey } : {})
      }
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        message: "Server Error",
        isQuota: false,
        isConfig: response.status === 401 || (errorData.error && errorData.error.includes("key_not_configured")),
        details: errorData.error || `Failed to communicate with the server (Status ${response.status}).`
      };
    }
    return await response.json();
  } catch (err: any) {
    return {
      success: false,
      message: "Connection Error",
      isQuota: false,
      details: err?.message || "Failed to fetch quota info."
    };
  }
};

export const analyzeImage = async (
  base64Image: string, 
  location?: { latitude: number; longitude: number }
): Promise<AnalysisResult> => {
  const customKey = localStorage.getItem("bazaar_gemini_key") || "";
  const response = await fetch("/api/analyze-image", {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      ...(customKey ? { "x-gemini-api-key": customKey } : {})
    },
    body: JSON.stringify({ base64Image, location })
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMsg = errorData.error || `Server returned error status ${response.status}`;
    throw new Error(errorMsg);
  }
  return await response.json();
};

export interface BazaarTranslationResult {
  translation: string;
  phonetic: string;
  sellerQuickReplies?: Array<{ text: string; native: string }>;
  travelerQuickReplies?: Array<{ text: string; subtext: string }>;
}

export const bazaarTranslate = async (
  text: string,
  speaker: 'traveler' | 'seller' = 'traveler',
  targetLanguage: 'pashto' | 'urdu' = 'pashto',
  itemContext?: string
): Promise<BazaarTranslationResult> => {
  const response = await fetch("/api/bazaar-translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, speaker, targetLanguage, itemContext })
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Translation server error (${response.status})`);
  }
  return await response.json();
};

export const generateTTS = async (text: string, targetLanguageContext: string = "Pashto"): Promise<Uint8Array> => {
  const customKey = localStorage.getItem("bazaar_gemini_key") || "";
  const response = await fetch("/api/generate-tts", {
    method: "POST",
    headers: { 
      "Content-Type": "application/json",
      ...(customKey ? { "x-gemini-api-key": customKey } : {})
    },
    body: JSON.stringify({ text, targetLanguageContext })
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Server returned error status ${response.status}`);
  }
  const data = await response.json();
  if (!data.audioBase64) {
    throw new Error("No audio data returned from server.");
  }
  return decode(data.audioBase64);
};

export function encode(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function decode(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1,
): Promise<AudioBuffer> {
  // Try native AudioContext WAV decoding first (since gemini-3.8-flash-lite-tts returns a complete WAV file)
  try {
    const copyBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const decoded = await ctx.decodeAudioData(copyBuffer);
    if (decoded) return decoded;
  } catch (nativeErr) {
    // If native decoder failed, fall back to manual PCM decoding
    console.warn("Native WAV decoding fallback to PCM parser:", nativeErr);
  }

  // Fallback: Skip 44-byte WAV header if present, or parse raw PCM
  let offset = data.byteOffset;
  let length = data.byteLength;
  if (data.length > 44 && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) {
    // Has RIFF header, advance past 44 bytes
    offset += 44;
    length -= 44;
  }

  const dataInt16 = new Int16Array(data.buffer, offset, Math.floor(length / 2));
  const frameCount = Math.floor(dataInt16.length / numChannels);
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}
