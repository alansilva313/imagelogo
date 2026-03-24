import { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Upload,
  Download,
  Plus,
  Trash2,
  LayoutGrid,
  Layers,
  ChevronRight,
  ChevronLeft,
  Heart,
  Clock,
  AlertTriangle,
  ImageIcon,
  Zap,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import JSZip from 'jszip';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from './supabaseClient';
import './App.css';
import './PositionGrid.css';
import './Gallery.css';

/* ── Types ────────────────────────────────────────────────── */
interface ImageFile {
  file: File;
  preview: string;
  name: string;
  isVertical: boolean;
}

interface SavedImage {
  id: string;
  url_publica: string;
  nome: string;
  created_at: string;
}

type LogoPosition = 'TL' | 'TC' | 'TR' | 'ML' | 'MC' | 'MR' | 'BL' | 'BC' | 'BR';

interface LogoConfig {
  position: LogoPosition;
  padding: number;
  scale: number;
  opacity: number;
}

/* ── IndexedDB Helpers ────────────────────────────────────── */
const DB_NAME = 'LogoImageDB';
const DB_VERSION = 1;

function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('editorState')) {
        db.createObjectStore('editorState');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function saveToDB(key: string, data: any) {
  initDB().then(db => {
    const tx = db.transaction('editorState', 'readwrite');
    tx.objectStore('editorState').put(data, key);
  }).catch(err => console.error('DB Save error', err));
}

function loadFromDB(key: string): Promise<any> {
    return initDB().then(db => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('editorState', 'readonly');
        const req = tx.objectStore('editorState').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    });
}

/* ── Helpers ──────────────────────────────────────────────── */
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
  });
}

/* ── App ──────────────────────────────────────────────────── */
export default function App() {
  const [view, setView] = useState<'dashboard' | 'editor' | 'history'>('dashboard');
  const [images, setImages] = useState<ImageFile[]>([]);
  const [logo, setLogo] = useState<ImageFile | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [activeOrientation, setActiveOrientation] = useState<'H' | 'V'>('H');
  const [savedImages, setSavedImages] = useState<SavedImage[]>([]); // últimos 7 dias
  const [allImages, setAllImages] = useState<SavedImage[]>([]);     // histórico completo
  const [liked, setLiked] = useState<Set<string>>(new Set());

  // Função interna de logger (agora apenas pro console)
  const addLog = (msg: string, type: 'info' | 'error' | 'success' | 'warn' = 'info') => {
    if (type === 'error') console.error(`[LogoImage]`, msg);
    else if (type === 'warn') console.warn(`[LogoImage]`, msg);
    else console.info(`[LogoImage]`, msg);
  };

  const [configH, setConfigH] = useState<LogoConfig>({ position: 'BR', padding: 5, scale: 15, opacity: 100 });
  const [configV, setConfigV] = useState<LogoConfig>({ position: 'BR', padding: 5, scale: 20, opacity: 100 });

  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exportDone, setExportDone] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  /* Load State from DB */
  const hasLoadedFromDB = useRef(false);

  useEffect(() => {
    const loadState = async () => {
      try {
        const savedConfigH = await loadFromDB('configH');
        const savedConfigV = await loadFromDB('configV');
        const savedOrientation = await loadFromDB('activeOrientation');
        const savedLogo = await loadFromDB('logo');
        const savedImages = await loadFromDB('images');

        if (savedConfigH) setConfigH(savedConfigH);
        if (savedConfigV) setConfigV(savedConfigV);
        if (savedOrientation) setActiveOrientation(savedOrientation);

        if (savedLogo instanceof File) {
          const img = new Image();
          img.src = URL.createObjectURL(savedLogo);
          img.onload = () => {
            setLogo({ file: savedLogo, preview: img.src, name: savedLogo.name, isVertical: img.height > img.width });
          };
        }

        if (Array.isArray(savedImages) && savedImages.length > 0) {
          const loadedImages: ImageFile[] = [];
          for (const file of savedImages) {
             if (file instanceof File) {
               const img = new Image();
               img.src = URL.createObjectURL(file);
               await new Promise(r => { img.onload = r; });
               loadedImages.push({ file, preview: img.src, name: file.name, isVertical: img.height > img.width });
             }
          }
          if (loadedImages.length > 0) {
            setImages(loadedImages);
          }
        }
      } catch (err) {
        console.error("Failed to load state from DB:", err);
      } finally {
        hasLoadedFromDB.current = true;
      }
    };
    loadState();
  }, []);

  /* Save State to DB */
  useEffect(() => {
    if (!hasLoadedFromDB.current) return;
    saveToDB('configH', configH);
    saveToDB('configV', configV);
    saveToDB('activeOrientation', activeOrientation);
  }, [configH, configV, activeOrientation]);

  useEffect(() => {
    if (!hasLoadedFromDB.current) return;
    saveToDB('images', images.map(img => img.file));
  }, [images]);

  useEffect(() => {
    if (!hasLoadedFromDB.current) return;
    if (logo) saveToDB('logo', logo.file);
    else saveToDB('logo', null);
  }, [logo]);

  /* fetch galeria — últimos 7 dias */
  const fetchGallery = useCallback(async () => {
    if (!supabase) { 
      addLog('Cliente Supabase não inicializado. Verifique o .env', 'error');
      return; 
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    addLog('Buscando histórico na tabela "logos"...', 'info');

    // Galeria: últimos 7 dias
    const { data: recent, error: recentErr } = await supabase
      .from('logos')
      .select('*')
      .gt('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false });

    if (recentErr) {
      addLog(`Falha ao buscar galeria: ${recentErr.message}`, 'error');
    } else {
      setSavedImages((recent ?? []) as SavedImage[]);
    }

    // Histórico: todos os registros
    const { data: all, error: allErr } = await supabase
      .from('logos')
      .select('*')
      .order('created_at', { ascending: false });

    if (allErr) {
      addLog(`Falha ao buscar histórico: ${allErr.message}`, 'error');
    } else {
      addLog(`${all?.length ?? 0} registros encontrados no histórico.`, 'success');
      setAllImages((all ?? []) as SavedImage[]);
    }
  }, []);

  useEffect(() => { fetchGallery(); }, [fetchGallery]);

  /* dropzones */
  const onDropImages = useCallback((acceptedFiles: File[]) => {
    acceptedFiles.forEach(file => {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        const isVertical = img.height > img.width;
        setImages(prev => [...prev, { file, preview: img.src, name: file.name, isVertical }]);
        if (view === 'dashboard') setView('editor');
      };
    });
  }, [view]);

  const { getRootProps: getImageRootProps, getInputProps: getImageInputProps, isDragActive: isImageDrag } = useDropzone({
    onDrop: onDropImages,
    accept: { 'image/*': [] }
  });

  const onDropLogo = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles[0]) {
      const file = acceptedFiles[0];
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        setLogo({ file, preview: img.src, name: file.name, isVertical: img.height > img.width });
      };
    }
  }, []);

  const { getRootProps: getLogoRootProps, getInputProps: getLogoInputProps } = useDropzone({
    onDrop: onDropLogo,
    accept: { 'image/*': [] },
    multiple: false
  });

  /* logo transform */
  const getLogoTransform = (imgW: number, imgH: number, logoW: number, logoH: number, config: LogoConfig) => {
    const pad = Math.min(imgW, imgH) * (config.padding / 100);
    let x = 0, y = 0;
    if (config.position.includes('L')) x = pad;
    else if (config.position.includes('C')) x = (imgW / 2) - (logoW / 2);
    else if (config.position.includes('R')) x = imgW - logoW - pad;
    if (config.position.includes('T')) y = pad;
    else if (config.position.includes('M')) y = (imgH / 2) - (logoH / 2);
    else if (config.position.includes('B')) y = imgH - logoH - pad;
    return { x, y };
  };

  /* preview */
  const renderPreview = useCallback(() => {
    if (!canvasRef.current || images.length === 0 || view !== 'editor') return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const currentImg = images[activeImageIndex];
    if (!currentImg) return;
    const img = new Image();
    img.src = currentImg.preview;
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      if (logo) {
        const logoImg = new Image();
        logoImg.src = logo.preview;
        logoImg.onload = () => {
          const config = currentImg.isVertical ? configV : configH;
          const logoAspect = logoImg.width / logoImg.height;
          const logoWidth = img.width * (config.scale / 100);
          const logoHeight = logoWidth / logoAspect;
          const { x, y } = getLogoTransform(img.width, img.height, logoWidth, logoHeight, config);
          ctx.globalAlpha = config.opacity / 100;
          ctx.drawImage(logoImg, x, y, logoWidth, logoHeight);
          ctx.globalAlpha = 1.0;
        };
      }
    };
  }, [images, logo, activeImageIndex, configH, configV, view]);

  useEffect(() => { renderPreview(); }, [renderPreview]);

  /* export */
  const handleExport = async (uploadToCloud: boolean) => {
    if (images.length === 0 || !logo) return;
    setIsProcessing(true);
    setExportDone(false);
    setProgress(0);

    const zip = new JSZip();
    const exportCanvas = document.createElement('canvas');
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return;

    const logoImg = new Image();
    logoImg.src = logo.preview;
    await new Promise(r => (logoImg.onload = r));

    for (let i = 0; i < images.length; i++) {
      const current = images[i];
      const img = new Image();
      img.src = current.preview;
      await new Promise(r => (img.onload = r));

      exportCanvas.width = img.width;
      exportCanvas.height = img.height;
      ctx.clearRect(0, 0, img.width, img.height);
      ctx.drawImage(img, 0, 0);

      const config = current.isVertical ? configV : configH;
      const logoAspect = logoImg.width / logoImg.height;
      const logoWidth = img.width * (config.scale / 100);
      const logoHeight = logoWidth / logoAspect;
      const { x, y } = getLogoTransform(img.width, img.height, logoWidth, logoHeight, config);

      ctx.globalAlpha = config.opacity / 100;
      ctx.drawImage(logoImg, x, y, logoWidth, logoHeight);
      ctx.globalAlpha = 1.0;

      const blob = await new Promise<Blob | null>(resolve =>
        exportCanvas.toBlob(resolve, 'image/png', 1.0)
      );

      if (blob) {
        const fileName = `processed_${Date.now()}_${current.name}`;
        zip.file(current.name, blob);

        // Upload/Save history only if requested
        if (uploadToCloud) {
          if (supabase) {
            addLog(`📤 Iniciando upload no storage "processed": ${fileName}`, 'info');

            // 1. Upload para o Storage
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('processed')
            .upload(fileName, blob, { contentType: 'image/png', upsert: false });

          if (uploadError) {
            addLog(`❌ Erro no upload (storage): ${uploadError.message}`, 'error');
            console.error('[Supabase] Falha Upload:', uploadError);
          } else {
            addLog(`✅ Arquivo salvo no storage: ${uploadData.path}`, 'success');

            // 2. Gera URL pública
            const { data: urlData } = supabase.storage
              .from('processed')
              .getPublicUrl(fileName);
            const publicUrl = urlData.publicUrl;

            // 3. Insert na tabela logos
            addLog(`📥 Salvando registro na tabela "logos"...`, 'info');
            const { data: insertData, error: insertError } = await supabase
              .from('logos')
              .insert({ nome: current.name, url_publica: publicUrl })
              .select();

            if (insertError) {
              addLog(`❌ Erro ao inserir na tabela: ${insertError.message}`, 'error');
              console.error('[Supabase] Falha Insert:', insertError);
            } else {
              addLog(`✅ Histórico registrado com sucesso! (ID: ${insertData?.[0]?.id})`, 'success');
            }
          }
        } else {
          // Log if saving requested but supabase null
          addLog('⚠️ Supabase não configurado. Download ZIP feito localmente.', 'warn');
        }
        }
      }
      setProgress(Math.round(((i + 1) / images.length) * 100));
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = 'logoimage_export.zip';
    link.click();

    setExportDone(true);
    setTimeout(() => {
      setIsProcessing(false);
      setExportDone(false);
      fetchGallery();
      setView('dashboard');
    }, 1800);
  };

  /* controls */
  const handleDownloadCurrent = async () => {
    if (images.length === 0 || !logo || !canvasRef.current) return;
    
    // Configura o canvas de exportação para a imagem atual com qualidade nativa
    const current = images[activeImageIndex];
    const exportCanvas = document.createElement('canvas');
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return;

    const logoImg = new Image();
    logoImg.src = logo.preview;
    await new Promise(r => (logoImg.onload = r));

    const img = new Image();
    img.src = current.preview;
    await new Promise(r => (img.onload = r));

    exportCanvas.width = img.width;
    exportCanvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    const config = current.isVertical ? configV : configH;
    const logoAspect = logoImg.width / logoImg.height;
    const logoWidth = img.width * (config.scale / 100);
    const logoHeight = logoWidth / logoAspect;
    const { x, y } = getLogoTransform(img.width, img.height, logoWidth, logoHeight, config);

    ctx.globalAlpha = config.opacity / 100;
    ctx.drawImage(logoImg, x, y, logoWidth, logoHeight);
    ctx.globalAlpha = 1.0;

    exportCanvas.toBlob(async (blob) => {
      if (!blob) return;
      const fileName = `logoimage_${current.name}`;
      const file = new File([blob], fileName, { type: 'image/png' });
      
      // API de Compartilhamento Nativa do Celular (Salvar na Galeria iOS/Android)
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: 'Imagem com Watermark',
          });
        } catch (e) {
          console.log('Compartilhamento cancelado ou falhou', e);
        }
      } else {
        // Fallback para download clássico
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
      }
    }, 'image/png', 1.0);
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
    if (activeImageIndex >= images.length - 1 && images.length > 1) setActiveImageIndex(0);
  };

  const nextImage = () => { if (activeImageIndex < images.length - 1) setActiveImageIndex(activeImageIndex + 1); };
  const prevImage = () => { if (activeImageIndex > 0) setActiveImageIndex(activeImageIndex - 1); };

  const currentConfig = activeOrientation === 'H' ? configH : configV;
  const setConfig = activeOrientation === 'H' ? setConfigH : setConfigV;
  const positions: LogoPosition[] = ['TL', 'TC', 'TR', 'ML', 'MC', 'MR', 'BL', 'BC', 'BR'];

  const toggleLike = (id: string) => {
    setLiked(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  /* Touch gestures for swipe (Mobile) */
  const touchStartX = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchStartX.current - touchEndX;

    if (diff > 50) {
      nextImage(); // swipe left -> next
    } else if (diff < -50) {
      prevImage(); // swipe right -> prev
    }
    touchStartX.current = null;
  };

  /* ── Render ─────────────────────────────────────────────── */
  return (
    <div className="app-container">

      {/* ── SIDEBAR ───────────────────────────────────────── */}
      <aside className="sidebar-panel">
        {/* Brand */}
        <div className="brand">
          <div className="brand-icon">
            <Sparkles size={16} color="#fff" />
          </div>
          Logo<span className="brand-dot">Image</span>
        </div>

        {/* Nav */}
        <nav className="nav-section">
          <span className="nav-label">Plataforma</span>
          <ul className="nav-list">
            <li
              id="nav-gallery"
              className={`nav-item ${view === 'dashboard' ? 'active' : ''}`}
              onClick={() => setView('dashboard')}
            >
              <LayoutGrid className="nav-icon" />
              <span className="nav-item-label">Galeria</span>
            </li>
            <li
              id="nav-editor"
              className={`nav-item ${view === 'editor' ? 'active' : ''}`}
              onClick={() => setView('editor')}
            >
              <Layers className="nav-icon" />
              <span className="nav-item-label">Editor em Lote</span>
            </li>
          </ul>
        </nav>

        <div className="sidebar-divider" />

        <nav className="nav-section">
          <span className="nav-label">Arquivo</span>
          <ul className="nav-list">
            <li
              id="nav-history"
              className={`nav-item ${view === 'history' ? 'active' : ''}`}
              onClick={() => setView('history')}
            >
              <Clock className="nav-icon" />
              <span className="nav-item-label">Histórico</span>
            </li>
          </ul>
        </nav>

        {/* User */}
        <div className="user-card">
          <div className="user-avatar">L</div>
          <div>
            <div className="user-name">LogoImage Pro</div>
            <span className="user-plan">Premium</span>
          </div>
        </div>
      </aside>

      {/* ── MAIN ──────────────────────────────────────────── */}
      <main className="main-wrapper">

        {/* Top header */}
        <header className="top-nav">
          <div>
            <h1 className="page-title">
              {view === 'dashboard' && 'Galeria de Imagens'}
              {view === 'editor' && 'Editor em Lote'}
              {view === 'history' && 'Histórico de Edições'}
            </h1>
            <p className="page-subtitle">
              {view === 'dashboard' && `${savedImages.length} arquivo${savedImages.length !== 1 ? 's' : ''} processado${savedImages.length !== 1 ? 's' : ''} nos últimos 7 dias`}
              {view === 'editor' && 'Adicione imagens e configure o watermark'}
              {view === 'history' && `${allImages.length} processamento${allImages.length !== 1 ? 's' : ''} no total`}
            </p>
          </div>

          <div className="top-nav-right">
            {view === 'editor' && images.length > 0 && (
              <span className="section-count">{images.length} imagem{images.length !== 1 ? 's' : ''}</span>
            )}
            <div className="view-toggle">
              <button
                id="toggle-gallery"
                className={`toggle-btn ${view === 'dashboard' ? 'active' : ''}`}
                onClick={() => setView('dashboard')}
              >
                Galeria
              </button>
              <button
                id="toggle-editor"
                className={`toggle-btn ${view === 'editor' ? 'active' : ''}`}
                onClick={() => setView('editor')}
              >
                Editor
              </button>
              <button
                id="toggle-history"
                className={`toggle-btn ${view === 'history' ? 'active' : ''}`}
                onClick={() => setView('history')}
              >
                Histórico
              </button>
            </div>
          </div>
        </header>

        {/* ── Page Body ─────────────────────────────────── */}
        <AnimatePresence mode="wait">
          {view === 'history' ? (

            /* ── HISTÓRICO ───────────────────────────────── */
            <motion.div
              key="history"
              className="page-content"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
            >
              {/* Stats */}
              <div className="stats-row" style={{ marginBottom: 28 }}>
                <div className="stat-card">
                  <div className="stat-icon"><ImageIcon size={18} /></div>
                  <div className="stat-value">{allImages.length}</div>
                  <div className="stat-label">Total processado</div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon"><CheckCircle2 size={18} /></div>
                  <div className="stat-value">{savedImages.length}</div>
                  <div className="stat-label">Últimos 7 dias</div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon"><Zap size={18} /></div>
                  <div className="stat-value">
                    {allImages.length > 0
                      ? new Date(allImages[allImages.length - 1].created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
                      : '—'}
                  </div>
                  <div className="stat-label">Primeiro registro</div>
                </div>
              </div>

              {allImages.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon"><Clock size={28} /></div>
                  <p className="empty-title">Nenhum histórico ainda</p>
                  <p className="empty-body">Exporte imagens no Editor em Lote para registrar o histórico aqui.</p>
                  <button className="btn-primary" style={{ marginTop: 4 }} onClick={() => setView('editor')}>
                    <Layers size={16} /> Abrir Editor
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {allImages.map((img, i) => (
                    <motion.div
                      key={img.id}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03, duration: 0.3 }}
                      className="history-row"
                    >
                      {/* Thumb */}
                      <div style={{ width: 52, height: 52, borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: '#06080f' }}>
                        <img src={img.url_publica} alt={img.nome} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {img.nome}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Clock size={11} />
                          {new Date(img.created_at).toLocaleString('pt-BR', {
                            day: '2-digit', month: 'short', year: 'numeric',
                            hour: '2-digit', minute: '2-digit'
                          })}
                        </div>
                      </div>

                      {/* Badge */}
                      <span className="history-row-badge">
                        PNG
                      </span>

                      {/* Download */}
                      <a
                        href={img.url_publica}
                        download={img.nome}
                        style={{ color: 'var(--text-muted)', display: 'flex', transition: 'color 0.18s', flexShrink: 0 }}
                        title="Baixar"
                        className="download-link"
                      >
                        <Download size={16} />
                      </a>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>

          ) : view === 'dashboard' ? (

            /* ── DASHBOARD ──────────────────────────────── */
            <motion.div
              key="dashboard"
              className="page-content"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
            >
              {/* Stats row */}
              <div className="stats-row">
                <div className="stat-card">
                  <div className="stat-icon"><ImageIcon size={18} /></div>
                  <div className="stat-value">{savedImages.length}</div>
                  <div className="stat-label">Imagens salvas</div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon"><CheckCircle2 size={18} /></div>
                  <div className="stat-value">{images.length}</div>
                  <div className="stat-label">Na fila do editor</div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon"><Zap size={18} /></div>
                  <div className="stat-value">7d</div>
                  <div className="stat-label">Janela de retenção</div>
                </div>
              </div>

              {/* Section header */}
              <div className="section-header">
                <h2 className="section-title">Processamentos Recentes</h2>
                {savedImages.length > 0 && (
                  <span className="section-count">{savedImages.length} imagens</span>
                )}
              </div>

              {/* Grid */}
              <div className="dashboard-grid">
                {savedImages.length === 0 ? (
                  <div className="empty-state col-span-full">
                    <div className="empty-icon">
                      <ImageIcon size={28} />
                    </div>
                    <p className="empty-title">Nenhum arquivo recente</p>
                    <p className="empty-body">
                      Inicie um processamento no Editor em Lote para ver suas imagens com watermark aqui.
                    </p>
                    <button
                      id="cta-start-processing"
                      {...getImageRootProps()}
                      className="btn-primary"
                      style={{ marginTop: 4 }}
                    >
                      <input {...getImageInputProps()} />
                      <Upload size={16} />
                      Iniciar Processamento
                    </button>
                  </div>
                ) : (
                  savedImages.map((img, i) => (
                    <motion.div
                      key={img.id}
                      className="image-card group"
                      layoutId={img.id}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05, duration: 0.35 }}
                    >
                      <img src={img.url_publica} className="card-img" alt={img.nome} loading="lazy" />

                      {/* Format tag */}
                      <div className="card-tag">PNG</div>

                      {/* Action buttons — visible on hover */}
                      <div className="card-actions">
                        <button
                          className={`card-action-btn ${liked.has(img.id) ? 'active' : ''}`}
                          onClick={() => toggleLike(img.id)}
                          title="Favoritar"
                          style={liked.has(img.id) ? { background: 'rgba(239,68,68,0.8)', borderColor: 'transparent', color: '#fff' } : {}}
                        >
                          <Heart size={14} />
                        </button>
                        <a
                          href={img.url_publica}
                          download={img.nome}
                          className="card-action-btn"
                          title="Baixar"
                        >
                          <Download size={14} />
                        </a>
                      </div>

                      {/* Overlay on hover */}
                      <div className="card-overlay">
                        <div className="card-title">{img.nome.replace(/\.[^.]+$/, '')}</div>
                        <div className="card-meta">
                          <div className="card-meta-row" style={{ gap: 5, color: '#64748b', fontSize: 12 }}>
                            <Clock size={11} />
                            {formatDate(img.created_at)}
                          </div>
                          <a
                            href={img.url_publica}
                            download={img.nome}
                            className="download-link"
                            title="Download"
                          >
                            <Download size={15} />
                          </a>
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>

              {/* Notice */}
              <div className="notice-banner">
                <AlertTriangle size={16} />
                Arquivos são excluídos automaticamente após 7 dias para otimização de espaço.
              </div>
            </motion.div>

          ) : (

            /* ── EDITOR ─────────────────────────────────── */
            <motion.div
              key="editor"
              className="page-content"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
            >
              {/* Upload strip */}
              <div className="file-manager">
                {/* Images dropzone */}
                <div
                  id="drop-images"
                  {...getImageRootProps()}
                  className={`mini-drop ${images.length > 0 ? 'has-file' : ''} ${isImageDrag ? 'has-file' : ''}`}
                >
                  <input {...getImageInputProps()} />
                  <div className="mini-drop-icon">
                    <Upload size={18} />
                  </div>
                  <div>
                    <div className="mini-drop-label">
                      {images.length > 0 ? `${images.length} foto${images.length !== 1 ? 's' : ''} carregada${images.length !== 1 ? 's' : ''}` : 'Upload de Fotos'}
                    </div>
                    <div className="mini-drop-sub">
                      {images.length > 0 ? 'Clique ou arraste para adicionar mais' : 'Arraste ou clique para selecionar'}
                    </div>
                  </div>
                </div>

                {/* Logo dropzone */}
                <div
                  id="drop-logo"
                  {...getLogoRootProps()}
                  className={`mini-drop ${logo ? 'has-file' : ''}`}
                  style={{ maxWidth: 280 }}
                >
                  <input {...getLogoInputProps()} />
                  {logo ? (
                    <>
                      <img src={logo.preview} className="logo-thumb" alt="Logo" />
                      <div>
                        <div className="mini-drop-label">Logo Ativa</div>
                        <div className="mini-drop-sub" style={{ color: 'var(--primary)', fontWeight: 600 }}>
                          {logo.name}
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="mini-drop-icon">
                        <Plus size={18} />
                      </div>
                      <div>
                        <div className="mini-drop-label">Watermark (Logo)</div>
                        <div className="mini-drop-sub">PNG com transparência recomendado</div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Editor layout */}
              <div className="editor-layout">

                {/* Canvas */}
                <div 
                  className="editor-canvas-container"
                  onTouchStart={handleTouchStart}
                  onTouchEnd={handleTouchEnd}
                >
                  {/* Nav arrows */}
                  {images.length > 1 && (
                    <>
                      <button
                        id="canvas-prev"
                        className="canvas-arrow left"
                        onClick={prevImage}
                        disabled={activeImageIndex === 0}
                        style={{ opacity: activeImageIndex === 0 ? 0 : undefined }}
                      >
                        <ChevronLeft size={22} />
                      </button>
                      <button
                        id="canvas-next"
                        className="canvas-arrow right"
                        onClick={nextImage}
                        disabled={activeImageIndex === images.length - 1}
                        style={{ opacity: activeImageIndex === images.length - 1 ? 0 : undefined }}
                      >
                        <ChevronRight size={22} />
                      </button>
                      <div className="canvas-counter">
                        {activeImageIndex + 1} / {images.length}
                      </div>
                    </>
                  )}

                  {/* Baixar Imagem Atual */}
                  {images.length > 0 && logo && (
                    <button
                      id="canvas-download"
                      className="canvas-download"
                      onClick={handleDownloadCurrent}
                      title="Salvar esta imagem (Galeria/Local)"
                    >
                      <Download size={15} />
                    </button>
                  )}

                  {/* Remove button */}
                  {images.length > 0 && (
                    <button
                      id="canvas-remove"
                      className="canvas-remove"
                      onClick={() => removeImage(activeImageIndex)}
                      title="Remover imagem"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}

                  {/* Canvas */}
                  <canvas ref={canvasRef} style={{ display: images.length === 0 ? 'none' : 'block' }} />

                  {/* Empty state */}
                  {images.length === 0 && (
                    <div className="canvas-empty">
                      <div className="canvas-empty-icon">
                        <ImageIcon size={28} />
                      </div>
                      <p style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, opacity: 0.4 }}>
                        Aguardando imagens
                      </p>
                      <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', textAlign: 'center', maxWidth: 260 }}>
                        Arraste imagens para o campo acima para começar
                      </p>
                    </div>
                  )}

                  {/* Processing overlay */}
                  <AnimatePresence>
                    {isProcessing && (
                      <motion.div
                        className="processing-overlay"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      >
                        {exportDone ? (
                          <>
                            <motion.div
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                            >
                              <CheckCircle2 size={48} color="var(--primary)" />
                            </motion.div>
                            <p style={{ color: '#fff', fontWeight: 700, fontSize: '1rem' }}>
                              Exportação concluída!
                            </p>
                            <p className="processing-label">Redirecionando para a galeria…</p>
                          </>
                        ) : (
                          <>
                            <div
                              style={{
                                width: 48,
                                height: 48,
                                border: '3px solid var(--border)',
                                borderTopColor: 'var(--primary)',
                                borderRadius: '50%',
                                animation: 'spin 0.9s linear infinite',
                              }}
                            />
                            <div className="progress-track" style={{ width: '100%', maxWidth: 320 }}>
                              <div className="progress-fill" style={{ width: `${progress}%` }} />
                            </div>
                            <p className="processing-label">
                              Processando e sincronizando — {progress}%
                            </p>
                          </>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Panel */}
                <aside className="editor-panel">
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h3 style={{ fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: '0.9375rem', letterSpacing: '-0.01em' }}>
                      Configurações
                    </h3>
                    {images.length > 0 && (
                      <span className="orientation-badge">
                        {images[activeImageIndex]?.isVertical ? 'VERTICAL' : 'HORIZONTAL'}
                      </span>
                    )}
                  </div>

                  {/* Orientation */}
                  <div>
                    <div className="panel-section-title">Modo de Orientação</div>
                    <div className="editor-orientation-switch">
                      <button
                        id="orientation-h"
                        className={`switch-btn ${activeOrientation === 'H' ? 'active' : ''}`}
                        onClick={() => setActiveOrientation('H')}
                      >
                        Horizontal
                      </button>
                      <button
                        id="orientation-v"
                        className={`switch-btn ${activeOrientation === 'V' ? 'active' : ''}`}
                        onClick={() => setActiveOrientation('V')}
                      >
                        Vertical
                      </button>
                    </div>
                  </div>

                  {/* Position grid */}
                  <div>
                    <div className="panel-section-title">Posição do Logo</div>
                    <div className="position-grid">
                      {positions.map(pos => (
                        <button
                          key={pos}
                          id={`pos-${pos}`}
                          className={`pos-btn ${currentConfig.position === pos ? 'active' : ''}`}
                          onClick={() => setConfig({ ...currentConfig, position: pos })}
                          title={pos}
                        >
                          <div className="pos-dot" />
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Controls */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                    {[
                      { key: 'padding', label: 'Margem', min: 0, max: 25 },
                      { key: 'scale',   label: 'Tamanho', min: 5, max: 80 },
                      { key: 'opacity', label: 'Opacidade', min: 0, max: 100 },
                    ].map(({ key, label, min, max }) => (
                      <div key={key} className="control-item">
                        <div className="control-header">
                          <span className="control-label">{label}</span>
                          <span className="control-value">
                            {currentConfig[key as keyof LogoConfig]}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={min}
                          max={max}
                          value={currentConfig[key as keyof LogoConfig] as number}
                          onChange={e => setConfig({ ...currentConfig, [key]: Number(e.target.value) })}
                        />
                      </div>
                    ))}
                  </div>

                  {/* Export Actions */}
                  <div className="export-section" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                    <button
                      id="btn-export-cloud"
                      onClick={() => handleExport(true)}
                      disabled={isProcessing || !logo || images.length === 0}
                      className="btn-primary"
                      style={{ padding: '14px 24px', fontSize: '0.8125rem', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                      title="Exportar ZIP e registrar no Histórico do Supabase"
                    >
                      <Zap size={16} />
                      Processar e Salvar nuvem
                    </button>

                    <button
                      id="btn-export-local"
                      onClick={() => handleExport(false)}
                      disabled={isProcessing || !logo || images.length === 0}
                      className="btn-secondary"
                      style={{ 
                        padding: '12px 24px', fontSize: '0.8125rem', width: '100%', 
                        background: 'transparent', border: '1px solid var(--border-accent)',
                        color: 'var(--text-primary)', borderRadius: 'var(--radius-md)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer'
                      }}
                      title="Apenas exportar o ZIP para o computador, sem salvar registro."
                    >
                      <Download size={16} />
                      Baixar ZIP sem salvar histórico
                    </button>
                    
                    {(!logo || images.length === 0) && (
                      <p style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                        {!logo && images.length === 0
                          ? 'Adicione imagens e um logo para processar'
                          : !logo
                          ? 'Aguardando logo (PNG com transparência)'
                          : 'Aguardando imagens para processar'}
                      </p>
                    )}
                  </div>

                </aside>
              </div>

              {/* Thumbnail strip */}
              {images.length > 1 && (
                <div className="thumb-strip" style={{ marginTop: 20 }}>
                  {images.map((img, i) => (
                    <div
                      key={i}
                      id={`thumb-${i}`}
                      className={`thumb-item ${i === activeImageIndex ? 'active' : ''}`}
                      onClick={() => setActiveImageIndex(i)}
                    >
                      <img src={img.preview} alt={img.name} />
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Spinner keyframes */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

