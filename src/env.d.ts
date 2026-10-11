/// <reference types="vite/client" />
interface Window {
  SpeechRecognition?: new () => SpeechRecognitionLocal;
  webkitSpeechRecognition?: new () => SpeechRecognitionLocal;
}
interface SpeechRecognitionLocal {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: (event: {resultIndex:number;results:ArrayLike<{isFinal:boolean;0:{transcript:string}}>}) => void;
  onend: () => void;
  onerror: (event: {error:string}) => void;
  start(): void; stop(): void; abort(): void;
}
