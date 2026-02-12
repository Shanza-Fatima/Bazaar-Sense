
# Bazaar-Sense 🏺

**Bazaar-Sense** is a world-class AI shopping companion designed for travelers navigating the vibrant bazaars of Pakistan, specifically optimized for the Peshawar region. It leverages state-of-the-art Multimodal AI to identify items, suggest fair market prices in PKR, and act as a real-time linguistic bridge between travelers and local sellers.

---

## 🌟 Key Features

- **Visual Item Identification**: Snap a photo of any item—from Peshawari Chappals to intricate handicrafts—to instantly identify it.
- **Fair Price Estimation**: Get typical local market prices in Pakistani Rupees (PKR) to help you bargain effectively.
- **Regional Dialect Support**: Access authentic translations and audio pronunciations in both **Urdu** and **Pashto**.
- **Live Translation Bridge**: A real-time, speech-to-speech translation mode. Select whether the seller speaks Urdu or Pashto, and the app will translate your English speech into their language and vice-versa.
- **Deal History**: Keep a digital log of your successful purchases and prices paid.
- **Offline Ready**: Built as a PWA (Progressive Web App) with service worker support for basic functionality in low-connectivity environments.

---

## 🛠 Technology Stack

- **Frontend**: React 19 (ES6+ Modules)
- **Styling**: Tailwind CSS
- **AI Core**: Google Gemini API
  - `gemini-3-flash-preview`: For rapid visual analysis and grounding.
  - `gemini-2.5-flash-native-audio-preview-12-2025`: Powers the low-latency Live Audio Bridge.
  - `gemini-2.5-flash-preview-tts`: For high-quality text-to-speech in Urdu/Pashto.
- **Deployment**: Optimized for modern static hosting (Vercel, Netlify, etc.).

---

## 🚀 Getting Started

### Prerequisites

1. **Google AI Studio API Key**: Obtain a key from [Google AI Studio](https://aistudio.google.com/).
2. **Environment Variable**: Ensure the API key is available as `process.env.API_KEY` (or injected into the window context as `window.API_KEY`).

### Installation

1. Clone the repository to your local machine.
2. Open `index.html` in a local development server or deploy to a modern cloud provider.
3. Grant permissions for **Camera**, **Microphone**, and **Location** when prompted.

---

## 📸 How to Use

1. **Identify**: On the home screen, point your camera at an item and tap the capture button.
2. **Analyze**: The AI identifies the object, provides typical pricing, and offers local names.
3. **Select Language**: Choose **Urdu Speaker** or **Pashto Speaker** based on the local merchant.
4. **Negotiate**: Tap **"Activate Bridge"**. Speak in English, and the app will translate your words into the chosen language. When the seller speaks back, it translates their response into English for you.
5. **Finalize**: Once a deal is struck, click "Successful Buy" to save the transaction to your history.

---

## 🛡 Security & Permissions

- **Privacy**: Photos and audio are processed via the Google Gemini API. No data is stored on external servers other than your local browser history.
- **Permissions**:
  - `Camera`: Required for item recognition.
  - `Microphone`: Required for the Live Translation Bridge.
  - `Location`: Used to provide more accurate local pricing based on bazaar proximity.

---

## 📜 Metadata & Versioning

- **Version**: 2.9 (Peshawar Edition)
- **Status**: Production Ready / PWA Supported
- **Target Region**: Peshawar, Khyber Pakhtunkhwa, Pakistan.
