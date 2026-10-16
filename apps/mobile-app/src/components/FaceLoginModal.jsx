import React, { useRef, useState, useEffect } from 'react';
import * as faceapi from '@vladmandic/face-api';
import { supabase } from '../lib/supabaseClient';
import { Camera, X, CheckCircle2, AlertCircle, Loader2, RefreshCw, Scan, Sparkles, ShieldCheck, UserCheck } from 'lucide-react';

export default function FaceLoginModal({ isOpen, user, onClose, onUserLogin }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [snapshotTaken, setSnapshotTaken] = useState(false);
  const [authStatus, setAuthStatus] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [matchedBeneficiary, setMatchedBeneficiary] = useState(null);

  useEffect(() => {
    let isMounted = true;

    if (isOpen) {
      setSnapshotTaken(false);
      setAuthStatus('Initializing biometric face engine...');
      setErrorMessage('');
      setMatchedBeneficiary(null);

      // 1. Immediately start front webcam stream for zero latency
      const startCamera = async () => {
        try {
          // Request front selfie camera on smartphones, default webcam on laptops
          const constraints = {
            video: {
              facingMode: 'user',
              width: { ideal: 640 },
              height: { ideal: 480 },
            },
          };
          let stream;
          try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
          } catch (err) {
            // Fallback to basic video if facingMode is unsupported by driver
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
          }

          if (!isMounted) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }

          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.onloadedmetadata = () => {
              if (isMounted && videoRef.current) {
                videoRef.current.play().catch((e) => console.warn('Play error:', e));
                setCameraActive(true);
              }
            };
          }
        } catch (err) {
          console.error('Webcam initialization error:', err);
          if (isMounted) {
            setErrorMessage('Camera permission denied or device inaccessible. You can still test via Demo Quick Authentication below.');
          }
        }
      };

      // 2. Parallel CDN Neural Model Download and GPU Warm-up
      const loadModels = async () => {
        try {
          const modelUrl = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
          await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
            faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl),
            faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl),
          ]);

          // Run silent warmup calculation to pre-compile WebGL shaders and prevent capture lag
          const dummyCanvas = document.createElement('canvas');
          dummyCanvas.width = 100;
          dummyCanvas.height = 100;
          const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.5 });
          await faceapi.detectSingleFace(dummyCanvas, options);

          if (isMounted) {
            setModelsLoaded(true);
            setAuthStatus('Neural face engine active & ready! Position face within frame and tap Scan.');
          }
        } catch (err) {
          console.error('Neural model loading failed:', err);
          if (isMounted) {
            setErrorMessage('Failed to load neural recognition models from CDN. Check network or use demo authentication.');
          }
        }
      };

      startCamera();
      loadModels();
    }

    return () => {
      isMounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Euclidean Distance math algorithm for 128-dimensional biometric matching
  const computeEuclideanDistance = (vec1, vec2) => {
    if (!vec1 || !vec2 || !Array.isArray(vec1) || !Array.isArray(vec2) || vec1.length !== vec2.length) {
      return 1.0; // Return maximum mismatch distance if formats differ
    }
    let sum = 0;
    for (let i = 0; i < vec1.length; i++) {
      const diff = Number(vec1[i]) - Number(vec2[i]);
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  };

  const handleExecuteBiometricScan = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    setErrorMessage('');
    setProcessing(true);
    setAuthStatus('Freezing snapshot & running 128-pt neural authentication...');

    try {
      // 1. Instant Snapshot Freeze to prevent movement distortion during processing
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setSnapshotTaken(true);

      // 2. Extract live facial vector descriptor from frozen canvas frame
      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 });
      const detection = await faceapi.detectSingleFace(canvas, options).withFaceLandmarks().withFaceDescriptor();

      if (!detection) {
        throw new Error('No clear face detected in snapshot! Ensure good lighting, remove face coverings, and keep centered.');
      }

      const liveDescriptor = Array.from(detection.descriptor);

      // 3. Validate against the specific user (1-to-1 Matching)
      setAuthStatus('Comparing 128-pt biometric vector against your registered profile...');

      if (!user || !user.face_encoding) {
        throw new Error('No biometric data found for this account. Please register your face at a kiosk first.');
      }

      let storedVector = user.face_encoding;
      if (typeof storedVector === 'string') {
        try { storedVector = JSON.parse(storedVector); } catch (e) { }
      }

      const distance = computeEuclideanDistance(liveDescriptor, storedVector);
      console.log(`Biometric audit: 1-to-1 match Euclidean distance: ${distance.toFixed(4)}`);

      // Stricter biometric identity confirmation threshold (< 0.45 for 1-to-1)
      if (distance < 0.45) {
        const confidencePct = Math.max(0, Math.min(99.9, (1 - distance / 1.0) * 100)).toFixed(1);
        setMatchedBeneficiary(user);
        setAuthStatus(`✅ Identity Verified: ${user.name} (Match Confidence: ${confidencePct}%)`);

        // Short pause so citizen can see their verified badge before entering portal
        setTimeout(() => {
          onUserLogin(user);
          onClose();
        }, 1500);
      } else {
        throw new Error(`Face recognized, but vector distance (${distance.toFixed(2)}) exceeded security threshold. Identity mismatch.`);
      }
    } catch (err) {
      console.error('Biometric login failure:', err);
      setErrorMessage(err.message);
      setAuthStatus('Biometric authentication failed. Tap Retry below to unlock camera.');
      setProcessing(false);
    }
  };

  const handleRetryCamera = () => {
    setSnapshotTaken(false);
    setErrorMessage('');
    setAuthStatus('Camera unlocked! Center your face and tap Scan again.');
    setProcessing(false);
  };

  // Instant demo fallback so presentations never stall in dark presentation rooms
  const handleSimulateDemoLogin = () => {
    const demoVerifiedUser = {
      ration_id: 'RAT-9999',
      name: 'Anjali Sharma (Biometric Demo)',
      phone: '+91 9123456789',
      face_encoding: Array(128).fill(0.123),
      is_demo: true,
    };
    setAuthStatus('⚡ Demo Biometric Match confirmed! Accessing portal...');
    setMatchedBeneficiary(demoVerifiedUser);
    setTimeout(() => {
      onUserLogin(demoVerifiedUser);
      onClose();
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4 sm:p-6 overflow-y-auto">
      <div className="relative w-full max-w-lg bg-white border border-gray-200 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-fadeIn">

        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-gray-50 border-b border-gray-200">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-100 border border-blue-200 text-blue-800">
              <Scan className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="text-lg font-extrabold text-gray-900 flex items-center gap-2">
                <span>Biometric Face Login</span>
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-900 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Video / Snapshot Viewport */}
        <div className="relative w-full bg-gray-900 aspect-[4/3] flex items-center justify-center overflow-hidden">
          {/* Always render video component to guarantee React DOM refs */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover transform scale-x-[-1] transition-opacity duration-300 ${snapshotTaken ? 'opacity-0 absolute inset-0' : 'opacity-100'}`}
          />
          <canvas
            ref={canvasRef}
            className={`w-full h-full object-cover transform scale-x-[-1] transition-opacity duration-300 ${snapshotTaken ? 'opacity-100 relative z-10' : 'opacity-0 absolute inset-0 pointer-events-none'}`}
          />

          {!cameraActive && !errorMessage && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/90 text-gray-700 space-y-3 p-6 text-center">
              <Loader2 className="w-9 h-9 animate-spin text-blue-600" />
              <span className="font-mono text-sm font-semibold">Initializing selfie webcam & neural shaders...</span>
            </div>
          )}

          {/* Biometric Alignment HUD Frame */}
          {cameraActive && !snapshotTaken && (
            <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center p-8">
              <div className="w-64 h-64 border-2 border-blue-400/60 rounded-full flex items-center justify-center relative shadow-[0_0_50px_rgba(37,99,235,0.15)]">
                <div className="absolute inset-0 rounded-full border border-dashed border-blue-300/40 animate-spin-slow" />
                <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-blue-400 to-transparent animate-pulse opacity-70" />
                <span className="absolute bottom-4 text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-white/80 text-blue-800 border border-blue-200">
                  Align Face Centrally
                </span>
              </div>
            </div>
          )}

          {/* Success Overlay Badge */}
          {matchedBeneficiary && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm p-6 text-center animate-fadeIn">
              <UserCheck className="w-16 h-16 text-blue-600 mb-3 animate-bounce" />
              <h4 className="text-2xl font-black text-gray-900">Identity Confirmed!</h4>
              <p className="text-sm font-mono text-gray-700 mt-1">Welcome, {matchedBeneficiary.name}</p>
              <div className="mt-3 px-3 py-1 rounded-full bg-blue-100 border border-blue-200 text-xs font-mono text-blue-800">
                🔒 Access Granted via 128-pt Face ID
              </div>
            </div>
          )}
        </div>

        {/* Status Bar */}
        <div className="px-6 py-3 bg-gray-50 border-t border-b border-gray-200 flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2 text-gray-700 truncate pr-2">
            <Sparkles className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
            <span className="truncate">{authStatus}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${modelsLoaded ? 'bg-green-500 animate-ping' : 'bg-orange-400 animate-pulse'}`} />
            <span className="text-[11px] uppercase tracking-wider text-gray-500">
              {modelsLoaded ? 'AI READY' : 'AI LOADING'}
            </span>
          </div>
        </div>

        {/* Error Notification */}
        {errorMessage && (
          <div className="mx-6 mt-4 p-3.5 rounded-2xl bg-red-500/15 border border-red-500/40 text-red-300 text-xs font-mono flex items-start gap-2 animate-fadeIn">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold">Biometric Match Exception:</p>
              <p className="mt-0.5 text-slate-300">{errorMessage}</p>
            </div>
            {snapshotTaken && (
              <button
                onClick={handleRetryCamera}
                className="px-3 py-1 rounded-lg bg-red-500 hover:bg-red-400 text-slate-950 font-bold text-[11px] transition-all self-center"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {/* Footer Actions */}
        <div className="p-6 bg-white flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            {snapshotTaken && !matchedBeneficiary ? (
              <button
                onClick={handleRetryCamera}
                disabled={processing}
                className="flex-1 py-3 px-4 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold text-xs transition-all flex items-center justify-center gap-2 border border-gray-200"
              >
                <RefreshCw className="w-4 h-4 text-blue-600" />
                <span>Retake Face Snapshot</span>
              </button>
            ) : (
              <button
                onClick={handleExecuteBiometricScan}
                disabled={!cameraActive || !modelsLoaded || processing || matchedBeneficiary !== null}
                className="flex-1 py-3.5 px-4 rounded-xl bg-blue-800 hover:bg-blue-900 disabled:bg-gray-200 disabled:text-gray-400 text-white font-extrabold text-sm shadow-md transition-all flex items-center justify-center gap-2"
              >
                {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Scan className="w-5 h-5" />}
                <span>{processing ? 'Matching Biometric Vectors...' : 'Scan & Authenticate Face'}</span>
              </button>
            )}

            <button
              onClick={onClose}
              disabled={processing && !matchedBeneficiary}
              className="px-5 py-3.5 rounded-xl bg-gray-100 hover:bg-gray-200 border border-gray-200 text-gray-600 text-xs font-mono transition-all"
            >
              Cancel
            </button>
          </div>

          {/* Quick Demo Launch button for effortless university evaluations */}
          <div className="pt-2 border-t border-gray-200">
            <button
              onClick={handleSimulateDemoLogin}
              className="w-full py-2 px-3 rounded-xl bg-orange-50 hover:bg-orange-100 text-orange-800 border border-orange-200 font-mono text-xs font-bold transition-all flex items-center justify-center gap-2"
            >
              <Sparkles className="w-3.5 h-3.5 text-orange-600" />
              <span>⚡ Demo: Instant Biometric Login (Anjali Sharma)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
