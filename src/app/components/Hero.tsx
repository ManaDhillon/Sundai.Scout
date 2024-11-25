'use client'

import React, { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'

// Updated Type definitions for Web Speech API
interface SpeechRecognitionResult {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionAlternative {
  [index: number]: SpeechRecognitionResult;
  isFinal: boolean;
}

interface SpeechRecognitionResults {
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResults;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

// Extend Window interface to include Speech Recognition
declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
  }
}

const OPENAI_API_KEY = "";

const Hero: React.FC = () => {
  const [isClient, setIsClient] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [audioResponse, setAudioResponse] = useState<HTMLAudioElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const recognitionRef = useRef<any>(null);
  const [interimTranscript, setInterimTranscript] = useState('');

  useEffect(() => {
    setIsClient(true);
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // Initialize speech recognition
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      
      recognitionRef.current.onresult = (event: SpeechRecognitionEvent) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          if (result[0].confidence > 0) {
            if (result.isFinal) {
              finalTranscript += result[0].transcript;
            } else {
              interimTranscript += result[0].transcript;
            }
          }
        }

        setInterimTranscript(interimTranscript);
        
        if (finalTranscript) {
          setTranscript(prev => prev + ' ' + finalTranscript);
        }
      };

      recognitionRef.current.onend = () => {
        // Clear interim transcript when recognition ends
        setInterimTranscript('');
      };
    }
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    }
  }, []);

  const playAudioChunk = async (base64Audio: string) => {
    try {
      // Convert base64 to audio buffer
      const audioData = atob(base64Audio);
      const arrayBuffer = new ArrayBuffer(audioData.length);
      const view = new Uint8Array(arrayBuffer);
      
      for (let i = 0; i < audioData.length; i++) {
        view[i] = audioData.charCodeAt(i);
      }

      // Create and play audio
      const audioContext = audioContextRef.current;
      if (!audioContext) return;

      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start(0);
    } catch (error) {
      console.error('Error playing audio:', error);
    }
  };

  const startWebSocket = () => {
    wsRef.current = new WebSocket("wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01");
    
    wsRef.current.onopen = async () => {
      console.log("WebSocket connected");
      
      if (audioChunksRef.current.length > 0) {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm;codecs=opus' });
        const reader = new FileReader();
        
        reader.onload = async () => {
          const base64Audio = (reader.result as string).split(',')[1];
          
          // Send audio to OpenAI
          const createConversationEvent = {
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_audio",
                  audio: base64Audio,
                },
              ],
            },
          };
          wsRef.current?.send(JSON.stringify(createConversationEvent));

          // Request both text and audio response
          const createResponseEvent = {
            type: "response.create",
            response: {
              modalities: ["text", "audio"],
              instructions: 'Speak to me as if you are a recruiter',
            },
          };
          wsRef.current?.send(JSON.stringify(createResponseEvent));
        };

        reader.readAsDataURL(audioBlob);
      }
    };

    wsRef.current.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log("Received message:", message);

        switch (message.type) {
          case "response.audio.delta":
            // Play the audio chunk
            console.log("Playing audio chunk");
            playAudioChunk(message.delta);
            break;
          case "response.text.delta":
            // Update text response
            setResponse(prev => prev + message.delta);
            break;
          case "response.audio.done":
            console.log("Audio playback complete");
            break;
          case "response.text.done":
            console.log("Text response complete");
            break;
          default:
            console.log("Unknown message type:", message.type);
        }
      } catch (error) {
        console.error("Error processing message:", error);
      }
    };

    wsRef.current.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    wsRef.current.onclose = (event) => {
      console.log("WebSocket closed:", event);
    };
  };

  const getSupportedMimeType = () => {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
      'audio/mpeg',
      'audio/wav'
    ];
    
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log('Using MIME type:', type);
        return type;
      }
    }
    return 'audio/webm'; // Fallback
  };

  const startListening = async () => {
    try {
      if (isListening) {
        if (mediaRecorderRef.current) {
          mediaRecorderRef.current.stop();
        }
        setIsListening(false);
        return;
      }

      // Reset states
      setTranscript('');
      setResponse('');
      setInterimTranscript('');

      // Initialize audio context on user interaction
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        } 
      });

      // Get supported MIME type
      const mimeType = getSupportedMimeType();
      console.log('Selected MIME type:', mimeType);

      try {
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType,
          audioBitsPerSecond: 16000
        });
        
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = () => {
          stream.getTracks().forEach(track => track.stop());
          startWebSocket();
        };

        mediaRecorder.start(1000); // Collect data every second
        setIsListening(true);

      } catch (err) {
        console.error('MediaRecorder error:', err);
        // Try without specifying mimeType if it fails
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
          }
        };

        mediaRecorder.onstop = () => {
          stream.getTracks().forEach(track => track.stop());
          startWebSocket();
        };

        mediaRecorder.start(1000);
        setIsListening(true);
      }

    } catch (error) {
      console.error('Error:', error);
      setResponse('Error: Could not access microphone. Please ensure you have granted microphone permissions.');
    }
  };

  if (!isClient) {
    return null; // or a loading state
  }

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden">
      {/* Animated background */}
      <div className="absolute inset-0 bg-black">
        {/* Stars */}
        {isClient && [...Array(50)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-1 bg-white rounded-full"
            initial={{
              x: `${Math.random() * 100}%`,
              y: `${Math.random() * 100}%`,
              scale: Math.random() * 0.5 + 0.5,
              opacity: Math.random() * 0.5 + 0.25
            }}
            animate={{
              opacity: [null, 0, 1],
              scale: [null, 1.2, 1]
            }}
            transition={{
              duration: Math.random() * 3 + 2,
              repeat: Infinity,
              repeatType: "reverse"
            }}
          />
        ))}

        {/* Animated nebula effects */}
        {isClient && (
          <motion.div
            className="absolute inset-0 opacity-30"
            initial={{ backgroundPosition: '0% 0%' }}
            animate={{ backgroundPosition: '100% 100%' }}
            transition={{ duration: 20, repeat: Infinity, repeatType: "reverse" }}
            style={{
              background: 'radial-gradient(circle at 50% 50%, rgba(76, 0, 255, 0.1) 0%, transparent 50%)',
            }}
          />
        )}
        
        {/* Floating orbs */}
        {isClient && [...Array(3)].map((_, i) => (
          <motion.div
            key={`orb-${i}`}
            className="absolute w-64 h-64 rounded-full"
            initial={{
              x: `${Math.random() * 100}%`,
              y: `${Math.random() * 100}%`,
              scale: 0.5,
            }}
            animate={{
              x: `${Math.random() * 100}%`,
              y: `${Math.random() * 100}%`,
              scale: [0.5, 0.8, 0.5],
            }}
            transition={{
              duration: 15,
              repeat: Infinity,
              repeatType: "reverse",
              delay: i * 2,
            }}
            style={{
              background: `radial-gradient(circle at 50% 50%, ${
                ['rgba(147, 51, 234, 0.1)', 'rgba(59, 130, 246, 0.1)', 'rgba(16, 185, 129, 0.1)'][i]
              } 0%, transparent 70%)`,
              filter: 'blur(40px)',
            }}
          />
        ))}
      </div>

      {/* Main content */}
      <div className="z-10 text-center px-4 max-w-4xl mx-auto w-full">
        {/* Logo */}
        <motion.div
          className="mb-8"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <h2 className="text-2xl md:text-3xl font-bold text-primary tracking-widest">
            SCOUT
          </h2>
          <motion.div 
            className="h-0.5 w-16 bg-gradient-to-r from-primary to-transparent mx-auto mt-2"
            animate={{
              x: [-50, 50],
              opacity: [0.5, 1, 0.5]
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              repeatType: "reverse",
              ease: "easeInOut"
            }}
          />
        </motion.div>

        <motion.h1
          className="text-4xl md:text-6xl font-bold mb-12 text-transparent bg-clip-text bg-gradient-to-r from-white to-white/50"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          Voice AI Assistant
        </motion.h1>

        <div className="flex flex-col items-center justify-center">
          {/* Microphone button with glow effect */}
          <motion.button 
            className={`w-24 h-24 md:w-32 md:h-32 rounded-full backdrop-blur-xl flex items-center justify-center
              ${isListening 
                ? 'bg-red-500/20 border-red-500/40 shadow-[0_0_30px_rgba(239,68,68,0.3)]' 
                : 'bg-primary/10 border-primary/20 shadow-[0_0_30px_rgba(0,255,157,0.2)]'} 
              border-2 transition-all duration-300`}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={startListening}
          >
            <motion.svg 
              xmlns="http://www.w3.org/2000/svg" 
              className={`h-10 w-10 md:h-12 md:w-12 ${isListening ? 'text-red-500' : 'text-primary'}`}
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
              animate={isListening ? {
                scale: [1, 1.2, 1],
                opacity: [1, 0.8, 1]
              } : {}}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: "easeInOut"
              }}
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" 
              />
            </motion.svg>
          </motion.button>

          <motion.p 
            className="mt-6 text-white/60 text-lg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            {isListening ? 'Listening... (click again to stop)' : 'Click the microphone to speak'}
          </motion.p>

          {/* Updated transcript display with interim results */}
          {(transcript || interimTranscript || response) && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-8 p-6 rounded-lg bg-white/5 backdrop-blur-xl border border-white/10 w-full max-w-2xl mx-auto shadow-[0_0_30px_rgba(255,255,255,0.1)]"
            >
              <div className="space-y-4">
                {(transcript || interimTranscript) && (
                  <div className="flex items-start gap-3">
                    <span className="font-semibold text-white/90">You:</span>
                    <div className="text-lg">
                      <span className="text-white/80">{transcript}</span>
                      {interimTranscript && (
                        <span className="text-white/50 italic">
                          {' '}{interimTranscript}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {response && (
                  <div className="flex items-start gap-3">
                    <span className="font-semibold text-primary">Assistant:</span>
                    <p className="text-lg text-primary/90 whitespace-pre-wrap">{response}</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Hero 