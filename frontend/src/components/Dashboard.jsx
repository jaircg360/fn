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
  const [label, setLabel] = useState('A');
  const [samplesInfo, setSamplesInfo] = useState({});
  const [modelName, setModelName] = useState('vowels_v1');
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

  const API_URL = process.env.REACT_APP_API_URL;

  useEffect(() => {
    fetchSamplesInfo();
    fetchModels();
  }, []);

  const fetchSamplesInfo = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/samples`);
      setSamplesInfo(res.data);
    } catch (err) {
      console.error("Error al obtener muestras:", err);
    }
  };

  const fetchModels = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/models`);
      setModels(res.data.models || []);
      if (onModelsUpdate) {
        onModelsUpdate(res.data.models || []);
      }
    } catch (err) {
      console.error("Error al obtener modelos:", err);
    }
  };

  const captureSample = async () => {
    if (!captureCanvasRef.current) return;
    const canvas = captureCanvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(async (blob) => {
      const fd = new FormData();
      fd.append('file', blob, 'sample.png');
      fd.append('label', label);
      try {
        const res = await axios.post(`${API_URL}/api/upload_sample`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        setSuccess("Muestra capturada exitosamente.");
        fetchSamplesInfo();
      } catch (err) {
        setError("Error al capturar muestra.");
      }
    }, 'image/png');
  };

  const clearSamples = async () => {
    try {
      await axios.delete(`${API_URL}/api/clear_samples`);
      setSamplesInfo({});
      setSuccess("Muestras eliminadas.");
    } catch (err) {
      setError("Error al eliminar muestras.");
    }
  };

  const trainModel = async () => {
    setIsLoading(true);
    try {
      const res = await axios.post(`${API_URL}/api/train`, { model_name: modelName });
      setSuccess(`Modelo ${res.data.model_name} entrenado exitosamente.`);
      fetchModels();
    } catch (err) {
      setError("Error al entrenar modelo.");
    } finally {
      setIsLoading(false);
    }
  };

  const startPrediction = useCallback(() => {
    if (!videoRef.current) return;

    const hands = new mpHands.Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });
    hands.setOptions({
      maxNumHands: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7
    });

    hands.onResults(async (results) => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        setIsDetectingHand(true);
        setStatus("Mano detectada");

        for (const landmarks of results.multiHandLandmarks) {
          drawConnectors(ctx, landmarks, mpHands.HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
          drawLandmarks(ctx, landmarks, { color: '#FF0000', lineWidth: 1 });
        }

        try {
          const canvasPred = captureCanvasRef.current;
          const ctxPred = canvasPred.getContext('2d');
          ctxPred.drawImage(results.image, 0, 0, canvasPred.width, canvasPred.height);
          canvasPred.toBlob(async (blob) => {
            const fd = new FormData();
            fd.append('file', blob, 'frame.png');
            fd.append('model_name', modelName);
            const res = await axios.post(`${API_URL}/api/predict`, fd, {
              headers: { 'Content-Type': 'multipart/form-data' }
            });
            setPrediction(res.data.prediction);
            setConfidence(res.data.confidence);
            setAllPredictions(res.data.all_predictions || []);
          }, 'image/png');
        } catch (err) {
          console.error("Error al predecir:", err);
        }

      } else {
        setIsDetectingHand(false);
        setStatus("Esperando detección...");
      }
      ctx.restore();
    });

    const camera = new Camera(videoRef.current, {
      onFrame: async () => {
        await hands.send({ image: videoRef.current });
      },
      width: 640,
      height: 480
    });
    camera.start();
  }, [modelName, API_URL]);

  useEffect(() => {
    if (activeTab === 'predict') {
      startPrediction();
    }
  }, [activeTab, startPrediction]);

  return (
    <div className="dashboard">
      <div className="tabs">
        <button onClick={() => setActiveTab('capture')}>Captura</button>
        <button onClick={() => setActiveTab('train')}>Entrenar</button>
        <button onClick={() => setActiveTab('predict')}>Predecir</button>
      </div>

      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}

      {activeTab === 'capture' && (
        <div className="capture-section">
          <video ref={videoRef} autoPlay playsInline></video>
          <canvas ref={captureCanvasRef} width="224" height="224" style={{ display: 'none' }} />
          <div>
            <label>Etiqueta:</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} />
            <button onClick={captureSample}>Capturar</button>
            <button onClick={clearSamples}>Eliminar muestras</button>
          </div>
          <div>
            <h3>Muestras por etiqueta:</h3>
            <pre>{JSON.stringify(samplesInfo, null, 2)}</pre>
          </div>
        </div>
      )}

      {activeTab === 'train' && (
        <div className="train-section">
          <input value={modelName} onChange={(e) => setModelName(e.target.value)} />
          <button onClick={trainModel} disabled={isLoading}>
            {isLoading ? "Entrenando..." : "Entrenar modelo"}
          </button>
          <div>
            <h3>Modelos disponibles:</h3>
            <ul>
              {models.map((m, idx) => (
                <li key={idx}>{m}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {activeTab === 'predict' && (
        <div className="predict-section">
          <video ref={videoRef} autoPlay playsInline style={{ display: 'none' }}></video>
          <canvas ref={canvasRef} width="640" height="480"></canvas>
          <div className="status">{status}</div>
          {prediction && (
            <div>
              <h3>Predicción: {prediction}</h3>
              <p>Confianza: {(confidence * 100).toFixed(2)}%</p>
              <h4>Todas las predicciones:</h4>
              <pre>{JSON.stringify(allPredictions, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

  return (
    <div className="dashboard-container">
      {/* Header */}
      <header className="dashboard-header">
        <h1>👋 Sistema de Reconocimiento de Señas</h1>
        <p className="header-subtitle">Interfaz para captura, entrenamiento y predicción de lenguaje de señas</p>
      </header>

      <div className="dashboard-content">
        {/* Panel de cámara a la izquierda */}
        <div className="camera-section">
          <div className="camera-container">
            <div className="camera-frame">
              <video ref={videoRef} style={{ display: 'none' }}></video>
              <canvas 
                ref={canvasRef} 
                className="camera-feed"
              />
              {isLoading && (
                <div className="camera-overlay">
                  <div className="spinner-border text-light" role="status">
                    <span className="visually-hidden">Cargando...</span>
                  </div>
                </div>
              )}
              <div className="hand-status">
                {isDetectingHand ? (
                  <span className="hand-detected">{status}</span>
                ) : (
                  <span className="hand-not-detected">{status}</span>
                )}
              </div>
            </div>
            <canvas ref={captureCanvasRef} style={{ display: 'none' }} />
          </div>
        </div>
        
        {/* Panel de controles a la derecha */}
        <div className="controls-section">
          <div className="controls-container">
            {/* Navegación por pestañas */}
            <ul className="nav nav-tabs mb-3">
              <li className="nav-item">
                <button 
                  className={`nav-link ${activeTab === 'capture' ? 'active' : ''}`}
                  onClick={() => setActiveTab('capture')}
                >
                  <i className="fas fa-camera me-2"></i>Captura
                </button>
              </li>
              <li className="nav-item">
                <button 
                  className={`nav-link ${activeTab === 'training' ? 'active' : ''}`}
                  onClick={() => setActiveTab('training')}
                >
                  <i className="fas fa-brain me-2"></i>Entrenamiento
                </button>
              </li>
              <li className="nav-item">
                <button 
                  className={`nav-link ${activeTab === 'prediction' ? 'active' : ''}`}
                  onClick={() => setActiveTab('prediction')}
                >
                  <i className="fas fa-search me-2"></i>Predicción
                </button>
              </li>
            </ul>

            {/* Mensajes de estado */}
            {error && (
              <div className="alert alert-danger alert-dismissible fade show" role="alert">
                <i className="fas fa-exclamation-circle me-2"></i>
                {error}
                <button type="button" className="btn-close" onClick={() => setError(null)}></button>
              </div>
            )}
            
            {success && (
              <div className="alert alert-success alert-dismissible fade show" role="alert">
                <i className="fas fa-check-circle me-2"></i>
                {success}
                <button type="button" className="btn-close" onClick={() => setSuccess(null)}></button>
              </div>
            )}

            {/* Contenido de pestañas */}
            <div className="tab-content">
              {/* Pestaña de Captura */}
              {activeTab === 'capture' && (
                <div className="tab-pane fade show active">
                  <div className="control-card">
                    <h5><i className="fas fa-hand-point-up me-2"></i>Capturar Muestra</h5>
                    
                    <div className="mb-3">
                      <label className="form-label">Selecciona la letra</label>
                      <div className="vowel-buttons">
                        {['A', 'E', 'I', 'O', 'U'].map(vowel => (
                          <button
                            key={vowel}
                            className={`vowel-btn ${label === vowel ? 'active' : ''}`}
                            onClick={() => setLabel(vowel)}
                          >
                            {vowel}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button 
                      className="btn btn-primary w-100 capture-btn" 
                      onClick={captureSample}
                      disabled={isLoading || !isDetectingHand}
                    >
                      {isLoading ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                          Capturando...
                        </>
                      ) : (
                        <>
                          <i className="fas fa-camera me-2"></i>
                          Capturar muestra
                        </>
                      )}
                    </button>
                    
                    <div className="samples-info">
                      <h6>Muestras recogidas</h6>
                      <div className="total-samples">
                        <span className="number">{samplesInfo.total_samples || 0}</span>
                        <span className="label">muestras totales</span>
                      </div>
                      
                      {samplesInfo.samples_per_class && (
                        <div className="samples-by-class">
                          {Object.entries(samplesInfo.samples_per_class).map(([label, count]) => (
                            <div key={label} className="sample-class">
                              <span className="class-label">{label}</span>
                              <div className="progress">
                                <div 
                                  className="progress-bar" 
                                  style={{ 
                                    width: `${(count / samplesInfo.total_samples) * 100}%`,
                                    backgroundColor: `hsl(${label.charCodeAt(0) * 10}, 70%, 50%)`
                                  }}
                                ></div>
                              </div>
                              <span className="class-count">{count}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    
                    <button 
                      className="btn btn-outline-danger btn-sm w-100 mt-2" 
                      onClick={clearSamples}
                      disabled={isLoading || !samplesInfo.total_samples}
                    >
                      <i className="fas fa-trash me-2"></i>
                      Limpiar todas las muestras
                    </button>
                  </div>
                </div>
              )}

              {/* Pestaña de Entrenamiento */}
              {activeTab === 'training' && (
                <div className="tab-pane fade show active">
                  <div className="control-card">
                    <h5><i className="fas fa-brain me-2"></i>Entrenar Modelo</h5>
                    
                    <div className="mb-3">
                      <label className="form-label">Nombre del modelo</label>
                      <input 
                        className="form-control dark-input" 
                        value={modelName} 
                        onChange={e => setModelName(e.target.value)}
                        disabled={isLoading}
                        placeholder="Ej: mi_modelo_v1"
                      />
                    </div>
                    
                    <button 
                      className="btn btn-success w-100 train-btn" 
                      onClick={trainModel}
                      disabled={isLoading || !samplesInfo.total_samples}
                      title={!samplesInfo.total_samples ? "Primero captura algunas muestras" : ""}
                    >
                      {isLoading ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                          Entrenando...
                        </>
                      ) : (
                        <>
                          <i className="fas fa-robot me-2"></i>
                          Entrenar y Guardar Modelo
                        </>
                      )}
                    </button>
                    
                    <div className="models-list mt-3">
                      <h6>Modelos disponibles</h6>
                      <button 
                        className="btn btn-outline-info btn-sm w-100 mb-2" 
                        onClick={fetchModels}
                        disabled={isLoading}
                      >
                        <i className="fas fa-sync-alt me-2"></i>
                        Actualizar lista
                      </button>
                      
                      <div className="model-cards">
                        {models.length > 0 ? (
                          models.map(m => (
                            <div key={m.name} className="model-card">
                              <div className="model-info">
                                <div className="model-name">{m.name}</div>
                                <div className="model-stats">
                                  <span className="accuracy">{(m.accuracy * 100).toFixed(1)}%</span>
                                  <span className="samples">{m.n_samples} muestras</span>
                                </div>
                              </div>
                              <button 
                                className="btn btn-sm btn-outline-primary"
                                onClick={() => predict(m.name)}
                                disabled={isLoading}
                              >
                                Probar
                              </button>
                            </div>
                          ))
                        ) : (
                          <div className="empty-models">
                            <i className="fas fa-exclamation-circle"></i>
                            <p>No hay modelos disponibles</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Pestaña de Predicción */}
              {activeTab === 'prediction' && (
                <div className="tab-pane fade show active">
                  <div className="control-card">
                    <h5><i className="fas fa-search me-2"></i>Resultado de Predicción</h5>
                    
                    {prediction ? (
                      <>
                        <div className="prediction-result">
                          <div className="main-prediction">
                            <div className="predicted-letter">{prediction}</div>
                            <div className="confidence">
                              <div className="confidence-value">{(confidence * 100).toFixed(1)}%</div>
                              <div className="confidence-label">de confianza</div>
                            </div>
                          </div>
                          
                          <div className="other-predictions">
                            <h6>Otras posibles letras:</h6>
                            {allPredictions.slice(1, 4).map(([letter, prob], index) => (
                              <div key={index} className="alternative-prediction">
                                <span className="alt-letter">{letter}</span>
                                <div className="alt-probability">
                                  <div 
                                    className="alt-probability-bar"
                                    style={{ width: `${prob * 100}%` }}
                                  ></div>
                                  <span className="alt-percentage">{(prob * 100).toFixed(1)}%</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        
                        <button 
                          className="btn btn-info w-100 mt-3"
                          onClick={() => setActiveTab('training')}
                        >
                          <i className="fas fa-brain me-2"></i>
                          Probar otro modelo
                        </button>
                      </>
                    ) : (
                      <div className="no-prediction">
                        <i className="fas fa-hand-point-right"></i>
                        <p>Realiza una predicción primero</p>
                        <button 
                          className="btn btn-primary mt-2"
                          onClick={() => setActiveTab('training')}
                        >
                          Ir a modelos
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="dashboard-footer">
        <p>Sistema de Reconocimiento de Señas - {new Date().getFullYear()}</p>
      </footer>

    </div>
  );
}
