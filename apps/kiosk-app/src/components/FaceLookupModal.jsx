import React, { useRef, useState, useEffect } from 'react';
import * as faceapi from '@vladmandic/face-api';
import { supabase } from '../lib/supabaseClient';
import { Camera, X, CheckCircle2, AlertCircle, Loader2, Scan, Zap, Users, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function FaceLookupModal({ isOpen, onClose, onUserFound }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [snapshotTaken, setSnapshotTaken] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('Initializing web camera...');
  const [autoDispense, setAutoDispense] = useState(true);

  useEffect(() => {
    let isMounted = true;

    if (isOpen) {
      setSnapshotTaken(false);
      setError(null);
      setProcessing(false);
      startCamera();
      loadModels();
    }

    async function loadModels() {
      try {
        const modelUrl = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
          faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl),
          faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl),
        ]);

        try {
          const dummyCanvas = document.createElement('canvas');
          dummyCanvas.width = 320;
          dummyCanvas.height = 320;
          await faceapi.detectSingleFace(
            dummyCanvas,
            new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
          );
        } catch (warmupErr) { }

        if (isMounted) {
          setModelsLoaded(true);
          setStatus('Neural models warmed up! Position face and tap Scan.');
        }
      } catch (err) {
        if (isMounted) setError('Failed to load neural models from CDN.');
      }
    }

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: false
        });
        if (!isMounted) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            if (isMounted && videoRef.current) videoRef.current.play();
          };
          setCameraActive(true);
          setStatus('Webcam active! Align face inside frame and click Scan.');
        }
      } catch (err) {
        if (isMounted) setError('Webcam device unavailable or permission denied.');
      }
    }

    return () => {
      isMounted = false;
      stopCamera();
    };
  }, [isOpen]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  if (!isOpen) return null;

  const computeEuclideanDistance = (vec1, vec2) => {
    if (!vec1 || !vec2 || !Array.isArray(vec1) || !Array.isArray(vec2) || vec1.length !== vec2.length) return 1.0;
    let sum = 0;
    for (let i = 0; i < vec1.length; i++) {
      const diff = Number(vec1[i]) - Number(vec2[i]);
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  };

  const handleExecuteLookup = async () => {
    if (!modelsLoaded || !videoRef.current || !cameraActive) return;

    setProcessing(true);
    setError(null);
    setStatus('📸 Snapshot captured! Extracting 128-point face vector...');

    const video = videoRef.current;
    const canvas = canvasRef.current;

    try {
      // Freeze frame
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setSnapshotTaken(true);

      const detection = await faceapi
        .detectSingleFace(
          canvas,
          new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
        )
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        throw new Error('No clear face detected! Align your face clearly in the camera frame.');
      }

      const liveDescriptor = Array.from(detection.descriptor);

      setStatus('Querying database for beneficiary match...');
      const { data: users, error: dbError } = await supabase
        .from('users')
        .select('*')
        .not('face_encoding', 'is', null);

      if (dbError || !users || users.length === 0) {
        throw new Error('No biometrically registered beneficiaries found in database.');
      }

      let bestMatch = null;
      let minDistance = Infinity;

      for (const candidate of users) {
        let storedVector = candidate.face_encoding;
        if (typeof storedVector === 'string') {
          try { storedVector = JSON.parse(storedVector); } catch (e) { continue; }
        }

        const dist = computeEuclideanDistance(liveDescriptor, storedVector);
        if (dist < minDistance) {
          minDistance = dist;
          bestMatch = candidate;
        }
      }

      // Threshold < 0.50 for secure 1-to-N Kiosk lookup
      if (bestMatch && minDistance < 0.50) {
        setStatus(`🔍 Checking monthly quota for ${bestMatch.name}...`);

        // Check current month's quota claims
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

        const { data: claims } = await supabase
          .from('bookings')
          .select('*')
          .eq('ration_id', bestMatch.ration_id)
          .gte('claimed_at', startOfMonth);

        const MONTHLY_QUOTA_LIMIT = 1000; // Allow 1000 dispenses per month for testing
        const hasClaimed = claims && claims.length >= MONTHLY_QUOTA_LIMIT;

        if (hasClaimed) {
          setStatus(`⚠️ ${bestMatch.name} - Monthly limit (${MONTHLY_QUOTA_LIMIT} dispenses) reached! Dispensing denied.`);
          setTimeout(() => {
            stopCamera();
            onUserFound(bestMatch);
            onClose();
          }, 2500);
          return;
        }

        const members = bestMatch.family_members || 1;
        const targetGrams = members * 100;
        const targetKg = targetGrams / 1000;

        // Quota is available -> Execute Auto-Dispense if toggled on
        if (autoDispense) {
          setStatus(`✅ Verified: ${bestMatch.name} | Auto-Dispensing ${targetGrams}g Rice on ESP32 (${members} Members)...`);

          // 1. Dispatch trigger to ESP32 local hardware with dynamic weight
          const esp32Ip = localStorage.getItem('esp32_ip') || '';
          if (esp32Ip.trim()) {
            const cleanIp = esp32Ip.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
            fetch(`http://${cleanIp}/dispense?weight=${targetGrams}`, { method: 'GET', mode: 'no-cors' }).catch(e => console.warn(e));
          }

          // 2. Insert cloud trigger into bookings table (detected by ESP32 in real time)
          await supabase.from('bookings').insert([{
            ration_id: bestMatch.ration_id,
            slot_time: new Date().toISOString(),
            status: 'PENDING_DISPENSE',
            target_grams: targetGrams,
            items_claimed: [{ item_name: 'Subsidized Rice', quantity: targetKg, unit: 'kg' }],
            claimed_at: new Date().toISOString()
          }]);

          setTimeout(() => {
            stopCamera();
            onUserFound(bestMatch);
            onClose();
          }, 2500);
        } else {
          setStatus(`✅ Verified Identity: ${bestMatch.name}`);
          setTimeout(() => {
            stopCamera();
            onUserFound(bestMatch);
            onClose();
          }, 1500);
        }
      } else {
        throw new Error(`Face scanned, but distance (${minDistance.toFixed(2)}) exceeded security match threshold. Not identified.`);
      }

    } catch (err) {
      console.error('Lookup Error:', err);
      setError(err.message);
      setStatus('Identification unsuccessful.');
      setProcessing(false);
    }
  };

  const handleRetryCamera = () => {
    setSnapshotTaken(false);
    setError(null);
    setStatus('Webcam active! Align face inside frame and click Scan.');
    setProcessing(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-2xl bg-white border border-gray-200 shadow-2xl rounded-3xl overflow-hidden relative flex flex-col max-h-[90vh]">
        {/* Top Header */}
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <span>Customer Face Lookup</span>
              </h3>
              <p className="text-xs font-mono text-gray-500">Identification by face</p>
            </div>
          </div>
          <button
            onClick={() => { stopCamera(); onClose(); }}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-900 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Viewport content */}
        <div className="p-6 flex-1 flex flex-col items-center overflow-y-auto">
          <div className="w-full max-w-lg aspect-video bg-gray-900 rounded-2xl border border-gray-200 overflow-hidden relative flex items-center justify-center shadow-inner">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover transform -scale-x-100 transition-opacity duration-300 ${snapshotTaken ? 'opacity-0 absolute pointer-events-none' : 'opacity-100'}`}
            />
            <canvas
              ref={canvasRef}
              className={`w-full h-full object-cover transform -scale-x-100 ${snapshotTaken ? 'opacity-100 relative z-10' : 'opacity-0 absolute inset-0 pointer-events-none'}`}
            />

            {/* Facial alignment overlay HUD */}
            {cameraActive && !snapshotTaken && (
              <div className="absolute inset-0 pointer-events-none rounded-2xl flex items-center justify-center z-20">
                {/* Sci-Fi HUD Brackets */}
                <div className="relative w-56 h-72">
                  <motion.div
                    className={`absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 ${processing ? 'border-orange-500' : 'border-blue-500'}`}
                    animate={{ x: [0, -5, 0], y: [0, -5, 0] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                  />
                  <motion.div
                    className={`absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 ${processing ? 'border-orange-500' : 'border-blue-500'}`}
                    animate={{ x: [0, 5, 0], y: [0, -5, 0] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                  />
                  <motion.div
                    className={`absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 ${processing ? 'border-orange-500' : 'border-blue-500'}`}
                    animate={{ x: [0, -5, 0], y: [0, 5, 0] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                  />
                  <motion.div
                    className={`absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 ${processing ? 'border-orange-500' : 'border-blue-500'}`}
                    animate={{ x: [0, 5, 0], y: [0, 5, 0] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                  />

                  {/* Sweeping Scanner Line */}
                  {!processing && (
                    <motion.div
                      className="absolute left-0 w-full h-[2px] bg-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.8)]"
                      animate={{ top: ['0%', '100%', '0%'] }}
                      transition={{ repeat: Infinity, duration: 3, ease: 'linear' }}
                    />
                  )}

                  <div className={`absolute inset-0 flex items-center justify-center transition-colors duration-500 ${processing ? 'bg-orange-500/10' : 'bg-transparent'}`}>
                    {processing && <Scan className="w-16 h-16 text-orange-400 animate-spin" style={{ animationDuration: '3s' }} />}
                  </div>
                </div>
              </div>
            )}

            {!cameraActive && !error && (
              <div className="flex flex-col items-center justify-center text-gray-500 p-8 text-center z-20">
                <Camera className="w-16 h-16 text-gray-400 mb-3 animate-pulse" />
                <span className="font-mono text-sm text-gray-200">
                  Connecting to live web camera...
                </span>
              </div>
            )}

            {/* Status indicator pill */}
            <div className="absolute bottom-3 left-3 right-3 bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-gray-200 text-xs flex items-center gap-2 text-gray-700 font-mono z-30 shadow-sm">
              {!modelsLoaded || processing ? (
                <Loader2 className="w-4 h-4 animate-spin text-blue-600 flex-shrink-0" />
              ) : error ? (
                <AlertCircle className="w-4 h-4 text-orange-500 flex-shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
              )}
              <span className="truncate">{status}</span>
            </div>
          </div>

          {error && (
            <div className="w-full max-w-lg mt-4 p-3.5 rounded-xl bg-orange-50 border border-orange-200 text-orange-800 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-orange-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <strong className="block mb-0.5 font-bold">Lookup Error:</strong>
                <span>{error}</span>
              </div>
              {snapshotTaken && (
                <button
                  onClick={handleRetryCamera}
                  className="px-3 py-1 rounded-lg bg-orange-100 hover:bg-orange-200 text-orange-900 font-bold text-[11px] transition-all self-center border border-orange-200"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {/* Action Footer Button Grid */}
          <div className="w-full max-w-lg mt-6 space-y-3">
            {/* Auto-Dispense Toggle & ESP32 Configuration */}
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoDispense}
                    onChange={(e) => setAutoDispense(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                  />
                  <span className="font-bold text-gray-800">
                    ⚡ Auto-Dispense 100g on Face Match
                  </span>
                </label>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-200">
                <div className="flex items-center gap-1.5 flex-1">
                  <span className="font-bold text-gray-600 font-mono text-[11px]">ESP32 IP:</span>
                  <input
                    type="text"
                    placeholder="e.g. 192.168.1.15"
                    defaultValue={localStorage.getItem('esp32_ip') || ''}
                    onChange={(e) => localStorage.setItem('esp32_ip', e.target.value.trim())}
                    className="px-2 py-1 rounded bg-white border border-gray-300 font-mono text-gray-800 text-xs w-36 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const ip = localStorage.getItem('esp32_ip') || '';
                    if (!ip.trim()) {
                      alert('Please enter your ESP32 IP address (from LCD screen) first!');
                      return;
                    }
                    const cleanIp = ip.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
                    try {
                      fetch(`http://${cleanIp}/test_servo`, { method: 'GET', mode: 'no-cors' });
                      alert(`✅ Signal sent to http://${cleanIp}/test_servo! Check ESP32 valve.`);
                    } catch (err) {
                      alert('Failed to send signal: ' + err.message);
                    }
                  }}
                  className="px-2.5 py-1 rounded bg-blue-100 hover:bg-blue-200 text-blue-800 font-bold text-[11px] transition-colors"
                >
                </button>
              </div>
            </div>

            {snapshotTaken && error ? (
              <button
                onClick={handleRetryCamera}
                disabled={processing}
                className="w-full py-3.5 rounded-xl bg-gray-100 hover:bg-gray-200 border border-gray-200 text-gray-700 font-semibold text-xs transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4 text-blue-600" />
                <span>Retake Face Snapshot</span>
              </button>
            ) : (
              <button
                onClick={handleExecuteLookup}
                disabled={!modelsLoaded || !cameraActive || processing}
                className="w-full py-3.5 rounded-xl bg-blue-800 hover:bg-blue-900 disabled:bg-gray-200 disabled:text-gray-400 text-white font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-sm"
              >
                {processing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Processing Quota & Dispensing...</span>
                  </>
                ) : (
                  <>
                    <Scan className="w-5 h-5" />
                    <span>Scan Face & Identify Beneficiary</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
