import React, { useEffect, useRef, useState, useCallback } from 'react';
import axios from 'axios';
import * as mpHands from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import './Dashboard.css';

export default function Dashboard({ onModelsUpdate }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const [currentCategory, setCurrentCategory] = useState('vocales');
  const [label, setLabel] = useState('A');
  const [samplesInfo, setSamplesInfo] = useState({});
  const [modelName, setModelName] = useState('lenguaje_senas_v1');
  const [models, setModels] = useState([]);
  const [prediction, setPrediction] = useState(null);
  const [confidence, setConfidence] = useState(0);
  const [allPredictions, setAllPredictions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [activeTab, setActiveTab] = useState('capture');
  const [isDetectingHand, setIsDetectingHand] = useState(false);
  const [status, setStatus] = useState("Esperando detección...");
  const [handsDetected, setHandsDetected] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMediaPipeInitialized, setIsMediaPipeInitialized] = useState(false);
  
  // NUEVOS ESTADOS PARA GRABACIÓN
  const [isRecording, setIsRecording] = useState(false);
  const [capturesCount, setCapturesCount] = useState(0);
  const [recordingLabel, setRecordingLabel] = useState('A');
  const [recordingInterval, setRecordingInterval] = useState(1000); // ms entre capturas
  const recordingIntervalRef = useRef(null);
  const capturesQueueRef = useRef([]);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);

  const handsRef = useRef(null);

  // Definición de categorías y símbolos
  const categories = {
    vocales: {
      name: 'Vocales',
      symbols: ['A', 'E', 'I', 'O', 'U'],
      icon: '🔤',
      color: '#3B82F6'
    },
    abecedario: {
      name: 'Abecedario',
      symbols: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
      icon: '🔡',
      color: '#10B981'
    },
    numeros: {
      name: 'Números',
      symbols: '0123456789'.split(''),
      icon: '🔢',
      color: '#F59E0B'
    },
    operaciones: {
      name: 'Operaciones',
      symbols: ['+', '-', '×', '÷', '=', '%'],
      icon: '➕',
      color: '#EF4444'
    }
  };

  // Limpiar mensajes después de un tiempo
  useEffect(() => {
    if (error || success) {
      const timer = setTimeout(() => {
        setError(null);
        setSuccess(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [error, success]);

  // Limpiar intervalo al desmontar
  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    };
  }, []);

  // Procesar cola de capturas
  useEffect(() => {
    const processQueue = async () => {
      if (capturesQueueRef.current.length > 0 && !isProcessingQueue) {
        setIsProcessingQueue(true);
        const captureData = capturesQueueRef.current.shift();
        
        try {
          await uploadCapture(captureData.blob, captureData.label);
        } catch (error) {
          console.error('Error procesando captura:', error);
        } finally {
          setIsProcessingQueue(false);
        }
      }
    };

    processQueue();
  }, [capturesQueueRef.current.length, isProcessingQueue]);

  // Inicializar MediaPipe Hands y cámara
  useEffect(() => {
    const initializeMediaPipe = async () => {
      try {
        const videoElement = videoRef.current;
        const canvasElement = canvasRef.current;
        const captureCanvasElement = captureCanvasRef.current;

        if (!videoElement || !canvasElement || !captureCanvasElement) {
          console.error('Elementos de video/canvas no encontrados');
          setError('Error: Elementos de cámara no disponibles');
          return;
        }

        const canvasCtx = canvasElement.getContext('2d');
        if (!canvasCtx) {
          console.error('No se pudo obtener el contexto del canvas');
          setError('Error: Contexto de canvas no disponible');
          return;
        }

        const hands = new mpHands.Hands({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });
        
        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.7,
          minTrackingConfidence: 0.7
        });

        hands.onResults((results) => {
          if (!canvasElement || !canvasCtx) return;

          canvasCtx.save();
          canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
          
          if (results.image) {
            canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
          }

          const handsDetected = results.multiHandLandmarks && results.multiHandLandmarks.length;
          setHandsDetected(handsDetected);
          setIsDetectingHand(handsDetected > 0);
          
          if (handsDetected > 0) {
            setStatus(`${handsDetected} ${handsDetected === 1 ? 'mano' : 'manos'} detectada${handsDetected === 1 ? '' : 's'}`);
            
            for (const landmarks of results.multiHandLandmarks) {
              drawConnectors(canvasCtx, landmarks, mpHands.HAND_CONNECTIONS, 
                { color: '#2563EB', lineWidth: 3 });
              drawLandmarks(canvasCtx, landmarks, 
                { color: '#DC2626', radius: 4 });
            }
            
            // Mostrar contador de grabación si está activa
            if (isRecording) {
              canvasCtx.font = 'bold 20px Inter, sans-serif';
              canvasCtx.fillStyle = '#DC2626';
              canvasCtx.textAlign = 'center';
              canvasCtx.fillText(`🔴 GRABANDO: ${capturesCount} capturas`, canvasElement.width / 2, 40);
            }
            
            canvasCtx.font = '16px Inter, sans-serif';
            canvasCtx.fillStyle = '#1F2937';
            canvasCtx.textAlign = 'left';
            canvasCtx.fillText(`Manos detectadas: ${handsDetected}`, 15, isRecording ? 70 : 30);
            
            if (results.multiHandedness) {
              results.multiHandedness.forEach((handedness, index) => {
                const label = handedness.label;
                const score = handedness.score;
                canvasCtx.fillText(`${label} (${(score * 100).toFixed(1)}%)`, 15, (isRecording ? 95 : 55) + (index * 25));
              });
            }
          } else {
            setStatus("No se detectan manos");
            canvasCtx.font = '18px Inter, sans-serif';
            canvasCtx.fillStyle = '#6B7280';
            canvasCtx.textAlign = 'center';
            canvasCtx.fillText('Mueve tus manos frente a la cámara', canvasElement.width / 2, canvasElement.height / 2);
          }
          
          canvasCtx.restore();
        });

        handsRef.current = hands;

        const camera = new Camera(videoElement, {
          onFrame: async () => {
            if (videoElement && handsRef.current) {
              await handsRef.current.send({ image: videoElement });
            }
          },
          width: 800,
          height: 600
        });
        
        await camera.start();
        
        setTimeout(() => {
          if (canvasElement) {
            canvasElement.width = 800;
            canvasElement.height = 600;
          }
          if (captureCanvasElement) {
            captureCanvasElement.width = 800;
            captureCanvasElement.height = 600;
          }
        }, 100);

        setIsMediaPipeInitialized(true);
        
        return () => {
          camera.stop();
        };
      } catch (err) {
        console.error('Error initializing MediaPipe:', err);
        setError('Error al inicializar la cámara: ' + err.message);
      }
    };

    if (videoRef.current && canvasRef.current && captureCanvasRef.current) {
      initializeMediaPipe();
    } else {
      setTimeout(() => {
        if (videoRef.current && canvasRef.current && captureCanvasRef.current) {
          initializeMediaPipe();
        }
      }, 100);
    }

    fetchSamplesInfo();
  }, []);

  // Función para capturar frame
  const captureFrame = () => {
    try {
      const cap = captureCanvasRef.current;
      if (!cap) return null;

      const ctx = cap.getContext('2d');
      if (!ctx) return null;

      ctx.clearRect(0, 0, cap.width, cap.height);
      ctx.drawImage(videoRef.current, 0, 0, cap.width, cap.height);
      
      return new Promise((resolve) => {
        cap.toBlob(resolve, 'image/jpeg', 0.9);
      });
    } catch (error) {
      console.error('Error capturando frame:', error);
      return null;
    }
  };

  // Función para subir captura
  const uploadCapture = async (blob, captureLabel) => {
    try {
      const fd = new FormData();
      fd.append('label', captureLabel);
      fd.append('file', blob, `frame_${Date.now()}.jpg`);
      fd.append('hands_detected', handsDetected.toString());
      fd.append('category', currentCategory);

      await axios.post('http://127.0.0.1:8000/api/upload_sample', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      return true;
    } catch (error) {
      console.error('Error subiendo captura:', error);
      throw error;
    }
  };

  // Iniciar grabación
  const startRecording = async () => {
    if (!isDetectingHand) {
      setError('No se detectan manos. Por favor, coloca tus manos frente a la cámara.');
      return;
    }

    setIsRecording(true);
    setCapturesCount(0);
    capturesQueueRef.current = [];
    setRecordingLabel(label);

    // Configurar intervalo de captura
    recordingIntervalRef.current = setInterval(async () => {
      if (isDetectingHand) {
        const blob = await captureFrame();
        if (blob) {
          capturesQueueRef.current.push({
            blob: blob,
            label: recordingLabel,
            timestamp: Date.now()
          });
          setCapturesCount(prev => prev + 1);
        }
      }
    }, recordingInterval);

    setSuccess(`Grabación iniciada para: ${recordingLabel}`);
  };

  // Detener grabación
  const stopRecording = () => {
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    
    setIsRecording(false);
    setSuccess(`Grabación finalizada. Total de capturas: ${capturesCount}`);
    
    // Actualizar información de muestras después de un breve delay
    setTimeout(() => {
      fetchSamplesInfo();
    }, 2000);
  };

  // Capturar muestra individual (mantenido por compatibilidad)
  const captureSample = async () => {
    if (!isDetectingHand) {
      setError('No se detectan manos. Por favor, coloca tus manos frente a la cámara.');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const blob = await captureFrame();
      if (!blob) {
        throw new Error('No se pudo generar la imagen');
      }

      await uploadCapture(blob, label);
      setSuccess(`Muestra capturada exitosamente para: ${label}`);
      fetchSamplesInfo();
      
      const cameraFrame = document.querySelector('.camera-preview-large');
      if (cameraFrame) {
        cameraFrame.classList.add('capture-success');
        setTimeout(() => cameraFrame.classList.remove('capture-success'), 500);
      }
    } catch (err) {
      const errorMsg = err.response?.data?.detail || err.message;
      setError('Error al capturar muestra: ' + errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  // Obtener información de muestras
  const fetchSamplesInfo = async () => {
    try {
      const res = await axios.get('http://127.0.0.1:8000/api/samples');
      setSamplesInfo(res.data);
    } catch (err) {
      console.error('Error fetching samples info:', err);
    }
  };

  // Limpiar muestras
  const clearSamples = async () => {
    if (!window.confirm('¿Estás seguro de que quieres eliminar todas las muestras?')) {
      return;
    }
    
    try {
      await axios.delete('http://127.0.0.1:8000/api/clear_samples');
      setSamplesInfo({});
      setSuccess('Todas las muestras han sido eliminadas');
    } catch (err) {
      const errorMsg = err.response?.data?.detail || err.message;
      setError('Error al limpiar muestras: ' + errorMsg);
    }
  };

  // Entrenar modelo
  const trainModel = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const fd = new FormData();
      fd.append('name', modelName);
      
      const res = await axios.post('http://127.0.0.1:8000/api/train', fd);
      
      setSuccess(`Modelo "${modelName}" entrenado exitosamente`);
      if (onModelsUpdate) onModelsUpdate();
      fetchModels();
    } catch (err) {
      const errorMsg = err.response?.data?.detail || err.message;
      setError('Error en entrenamiento: ' + errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  // Eliminar modelo
  const deleteModel = async (modelName) => {
    if (!window.confirm(`¿Estás seguro de que quieres eliminar el modelo "${modelName}"?`)) {
      return;
    }

    try {
      // Necesitarías agregar este endpoint en tu backend
      await axios.delete(`http://127.0.0.1:8000/api/model/${modelName}`);
      setSuccess(`Modelo "${modelName}" eliminado exitosamente`);
      fetchModels();
    } catch (err) {
      const errorMsg = err.response?.data?.detail || err.message;
      setError('Error al eliminar modelo: ' + errorMsg);
    }
  };

  // Obtener modelos
  const fetchModels = useCallback(async () => {
    try {
      const res = await axios.get('http://127.0.0.1:8000/api/models');
      setModels(res.data.models || []);
    } catch (err) {
      console.error('Error fetching models:', err);
      setError('Error al cargar modelos: ' + err.message);
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Predecir con un modelo
  const predict = async (model) => {
    if (!isDetectingHand) {
      setError('No se detectan manos. Por favor, coloca tus manos frente a la cámara.');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const blob = await captureFrame();
      if (!blob) {
        throw new Error('No se pudo generar la imagen');
      }

      const fd = new FormData();
      fd.append('file', blob, 'frame.jpg');
      fd.append('model', model);
      fd.append('hands_detected', handsDetected.toString());

      const res = await axios.post('http://127.0.0.1:8000/api/predict', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      setPrediction(res.data.prediction);
      setConfidence(res.data.confidence);
      setAllPredictions(res.data.all_predictions);
      setSuccess(`Predicción realizada: ${res.data.prediction}`);
      setActiveTab('prediction');
    } catch (err) {
      const errorMsg = err.response?.data?.detail || err.message;
      setError('Error en predicción: ' + errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const updateHandDetectionSettings = (maxHands, complexity, detectionConfidence, trackingConfidence) => {
    if (handsRef.current) {
      handsRef.current.setOptions({
        maxNumHands: maxHands,
        modelComplexity: complexity,
        minDetectionConfidence: detectionConfidence,
        minTrackingConfidence: trackingConfidence
      });
    }
  };

  return (
    <div className="dashboard">
      {/* Sidebar */}
      <aside className={`sidebar ${isSidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <div className="logo-section">
            <img src="/innova.png" alt="Innova Tec" className="logo" />
            <div className="brand-text">
              <h1>Innova Tec</h1>
              <span>Vision&Señas-IA</span>
            </div>
          </div>
          <button className="sidebar-toggle" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
            {isSidebarOpen ? '◀' : '▶'}
          </button>
        </div>

        <nav className="sidebar-nav">
          <button className={`nav-item ${activeTab === 'capture' ? 'active' : ''}`} onClick={() => setActiveTab('capture')}>
            <span className="nav-icon">📷</span>
            {isSidebarOpen && <span className="nav-text">Captura</span>}
          </button>
          <button className={`nav-item ${activeTab === 'training' ? 'active' : ''}`} onClick={() => setActiveTab('training')}>
            <span className="nav-icon">🤖</span>
            {isSidebarOpen && <span className="nav-text">Entrenamiento</span>}
          </button>
          <button className={`nav-item ${activeTab === 'prediction' ? 'active' : ''}`} onClick={() => setActiveTab('prediction')}>
            <span className="nav-icon">🔍</span>
            {isSidebarOpen && <span className="nav-text">Predicción</span>}
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="status-info">
            <div className={`status-indicator ${isDetectingHand ? 'active' : ''}`}>
              <div className="status-dot"></div>
              {isSidebarOpen && (
                <span className="status-text">
                  {isDetectingHand ? `${handsDetected} mano(s) detectada(s)` : 'Esperando...'}
                </span>
              )}
            </div>
            {isRecording && isSidebarOpen && (
              <div className="recording-status">
                <div className="recording-dot"></div>
                <span className="recording-text">Grabando: {capturesCount}</span>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header className="content-header">
          <div className="header-title">
            <h2>
              {activeTab === 'capture' && 'Captura de Datos'}
              {activeTab === 'training' && 'Entrenamiento de Modelos'}
              {activeTab === 'prediction' && 'Reconocimiento en Tiempo Real'}
            </h2>
            <p>
              {activeTab === 'capture' && 'Captura muestras para entrenar el sistema'}
              {activeTab === 'training' && 'Configura y entrena modelos de reconocimiento'}
              {activeTab === 'prediction' && 'Realiza predicciones con modelos entrenados'}
            </p>
          </div>
          
          <div className="header-actions">
            <div className="time-display">{new Date().toLocaleTimeString()}</div>
          </div>
        </header>

        {/* Messages */}
        <div className="messages-container">
          {error && (
            <div className="message error">
              <span>⚠️ {error}</span>
              <button onClick={() => setError(null)}>×</button>
            </div>
          )}
          
          {success && (
            <div className="message success">
              <span>✅ {success}</span>
              <button onClick={() => setSuccess(null)}>×</button>
            </div>
          )}
        </div>

        {/* Content Area */}
        <div className="content-area">
          {/* Sección principal con cámara grande */}
          <div className="main-section">
            <div className="camera-container">
              <div className="camera-header">
                <h3>Vista de la Cámara</h3>
                <div className="camera-controls">
                  <button className="control-btn" onClick={() => updateHandDetectionSettings(2, 1, 0.5, 0.5)} title="Modo dos manos">
                    👐 Standard
                  </button>
                  <button className="control-btn" onClick={() => updateHandDetectionSettings(1, 1, 0.7, 0.7)} title="Modo una mano">
                    👆 Preciso
                  </button>
                </div>
              </div>
              
              <div className="camera-preview-large">
                <video ref={videoRef} style={{ display: 'none' }} playsInline></video>
                <canvas ref={canvasRef} className="camera-feed-large" width="800" height="600" />
                <canvas ref={captureCanvasRef} style={{ display: 'none' }} width="800" height="600" />
                {isLoading && (
                  <div className="camera-overlay">
                    <div className="spinner"></div>
                    <span>Procesando...</span>
                  </div>
                )}
                {isRecording && (
                  <div className="recording-overlay">
                    <div className="recording-indicator"></div>
                    <span>GRABANDO - {capturesCount} capturas</span>
                  </div>
                )}
              </div>
              
              <div className="camera-info">
                <div className="info-grid">
                  <div className="info-item">
                    <span className="info-label">Resolución:</span>
                    <span className="info-value">800×600 px</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Estado:</span>
                    <span className={`info-value ${isDetectingHand ? 'active' : 'inactive'}`}>
                      {isDetectingHand ? '● Activo' : '○ Inactivo'}
                    </span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Manos detectadas:</span>
                    <span className="info-value">{handsDetected}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">Modo:</span>
                    <span className="info-value">{isRecording ? '🔴 Grabación' : 'MediaPipe Hands'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Panel de controles a la derecha */}
          <div className="controls-panel">
            {/* Capture Tab */}
            {activeTab === 'capture' && (
              <div className="tab-content active">
                <div className="control-card">
                  <div className="card-section">
                    <h4>Selección de Categoría</h4>
                    <div className="category-selector">
                      {Object.entries(categories).map(([key, category]) => (
                        <button
                          key={key}
                          className={`category-btn ${currentCategory === key ? 'active' : ''}`}
                          onClick={() => {
                            setCurrentCategory(key);
                            setLabel(category.symbols[0]);
                            setRecordingLabel(category.symbols[0]);
                          }}
                          style={{ borderColor: currentCategory === key ? category.color : 'transparent' }}
                        >
                          <span className="category-icon">{category.icon}</span>
                          <span className="category-name">{category.name}</span>
                          <span className="category-count">{category.symbols.length}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="card-section">
                    <h4>Símbolo a Capturar</h4>
                    <div className="symbol-selector">
                      <div className="current-symbol-display">
                        <span className="symbol">{label}</span>
                        <span className="symbol-label">Símbolo actual</span>
                      </div>
                      <div className="symbol-grid">
                        {categories[currentCategory].symbols.map(symbol => (
                          <button
                            key={symbol}
                            className={`symbol-btn ${label === symbol ? 'active' : ''}`}
                            onClick={() => {
                              setLabel(symbol);
                              setRecordingLabel(symbol);
                            }}
                          >
                            {symbol}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Controles de Grabación */}
                  <div className="card-section">
                    <h4>Grabación Automática</h4>
                    <div className="recording-controls">
                      <div className="interval-selector">
                        <label>Intervalo entre capturas:</label>
                        <select 
                          value={recordingInterval} 
                          onChange={(e) => setRecordingInterval(Number(e.target.value))}
                          disabled={isRecording}
                        >
                          <option value={500}>0.5 segundos</option>
                          <option value={1000}>1 segundo</option>
                          <option value={2000}>2 segundos</option>
                          <option value={3000}>3 segundos</option>
                        </select>
                      </div>
                      
                      {!isRecording ? (
                        <button 
                          className="primary-btn record-btn"
                          onClick={startRecording}
                          disabled={!isDetectingHand}
                        >
                          <span>🔴</span>
                          Iniciar Grabación
                        </button>
                      ) : (
                        <button 
                          className="secondary-btn stop-btn"
                          onClick={stopRecording}
                        >
                          <span>⏹️</span>
                          Detener Grabación ({capturesCount})
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Captura individual (mantenido) */}
                  <button 
                    className="secondary-btn capture-single-btn"
                    onClick={captureSample}
                    disabled={isLoading || !isDetectingHand || isRecording}
                  >
                    <span>📸</span>
                    Captura Individual
                  </button>

                  <div className="card-section">
                    <div className="stats-header">
                      <h4>Estadísticas del Dataset</h4>
                      <div className="total-count">{samplesInfo.total_samples || 0} muestras</div>
                    </div>
                    
                    {samplesInfo.samples_per_class && (
                      <div className="samples-distribution">
                        {Object.entries(samplesInfo.samples_per_class).slice(0, 6).map(([symbol, count]) => (
                          <div key={symbol} className="distribution-item">
                            <span className="symbol-label">{symbol}</span>
                            <div className="progress-bar">
                              <div className="progress-fill" style={{ width: `${(count / (samplesInfo.total_samples || 1)) * 100}%` }}></div>
                            </div>
                            <span className="sample-count">{count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <button 
                    className="danger-btn clear-btn"
                    onClick={clearSamples}
                    disabled={isLoading || !samplesInfo.total_samples}
                  >
                    🗑️ Limpiar Dataset
                  </button>
                </div>
              </div>
            )}

            {/* Training Tab */}
            {activeTab === 'training' && (
              <div className="tab-content active">
                <div className="control-card">
                  <div className="card-section">
                    <h4>Configuración del Modelo</h4>
                    <div className="model-config">
                      <label>Nombre del modelo:</label>
                      <div className="input-group">
                        <input 
                          type="text"
                          value={modelName}
                          onChange={(e) => setModelName(e.target.value)}
                          placeholder="nombre_del_modelo"
                          disabled={isLoading}
                        />
                        <span className="input-suffix">.model</span>
                      </div>
                    </div>
                  </div>

                  <button 
                    className="primary-btn train-btn"
                    onClick={trainModel}
                    disabled={isLoading || !samplesInfo.total_samples}
                  >
                    {isLoading ? (
                      <>
                        <div className="btn-spinner"></div>
                        Entrenando...
                      </>
                    ) : (
                      <>
                        <span>🚀</span>
                        Iniciar Entrenamiento
                      </>
                    )}
                  </button>

                  <div className="card-section">
                    <div className="models-header">
                      <h4>Modelos Entrenados</h4>
                      <button className="refresh-btn" onClick={fetchModels} disabled={isLoading}>
                        🔄 Actualizar
                      </button>
                    </div>
                    
                    <div className="models-list">
                      {models.length > 0 ? (
                        models.map(model => (
                          <div key={model.name} className="model-card">
                            <div className="model-info">
                              <h5>{model.name}</h5>
                              <div className="model-stats">
                                <span className="accuracy">Precisión: {(model.accuracy * 100).toFixed(1)}%</span>
                                <span className="samples">{model.n_samples} muestras</span>
                              </div>
                              <div className="model-classes">
                                {model.classes && model.classes.slice(0, 3).map(cls => (
                                  <span key={cls} className="class-tag">{cls}</span>
                                ))}
                                {model.classes && model.classes.length > 3 && (
                                  <span className="class-more">+{model.classes.length - 3} más</span>
                                )}
                              </div>
                            </div>
                            <div className="model-actions">
                              <button className="test-btn" onClick={() => predict(model.name)} disabled={isLoading}>
                                Probar
                              </button>
                              <button className="delete-btn" onClick={() => deleteModel(model.name)} disabled={isLoading}>
                                🗑️
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="empty-models">
                          <span>🤖</span>
                          <p>No hay modelos disponibles</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Prediction Tab */}
            {activeTab === 'prediction' && (
              <div className="tab-content active">
                <div className="control-card">
                  {prediction ? (
                    <>
                      <div className="prediction-result">
                        <div className="prediction-header">
                          <h4>Resultado del Reconocimiento</h4>
                          <span className="confidence-badge">{(confidence * 100).toFixed(1)}% de confianza</span>
                        </div>
                        
                        <div className="prediction-display">
                          <div className="predicted-symbol">{prediction}</div>
                          <div className="confidence-meter">
                            <div className="meter-fill" style={{ width: `${confidence * 100}%` }}></div>
                          </div>
                        </div>

                        <div className="alternative-predictions">
                          <h5>Otras posibilidades:</h5>
                          {allPredictions.slice(0, 5).map(([symbol, prob], index) => (
                            <div key={index} className="alt-prediction">
                              <span className="alt-symbol">{symbol}</span>
                              <div className="alt-prob">
                                <div className="alt-prob-bar" style={{ width: `${prob * 100}%` }}></div>
                                <span className="alt-percent">{(prob * 100).toFixed(1)}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <button className="primary-btn" onClick={() => setActiveTab('training')}>
                        🔄 Realizar otra prueba
                      </button>
                    </>
                  ) : (
                    <div className="prediction-placeholder">
                      <div className="placeholder-icon">👋</div>
                      <h4>Listo para reconocer</h4>
                      <p>Selecciona un modelo y realiza una prueba de reconocimiento</p>
                      <button className="primary-btn" onClick={() => setActiveTab('training')}>
                        🤖 Ir a modelos
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
