import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import ffmpegCoreJsUrl from '@ffmpeg/core?url';
import ffmpegCoreWasmUrl from '@ffmpeg/core/wasm?url';
import { Clip } from './types';
import { generateId } from './utils';
import { ClipItem } from './components/ClipItem';
import { Player, type PlayerHandle } from './components/Player';
import { 
  Scissors, 
  Download, 
  Plus, 
  LayoutTemplate,
  Loader2,
  X,
  FileVideo,
  Check,
  ChevronRight,
  Settings,
  Eye,
  EyeOff
} from './components/Icons';

export default function App() {
  const [clips, setClips] = useState<Clip[]>([]);
  // selectedClipId now serves as the "Active Playing Clip" in the sequence
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [currentPlaybackTime, setCurrentPlaybackTime] = useState(0);

  // Player Display Settings
  const [displayAspectRatio, setDisplayAspectRatio] = useState('9:16');
  const [displayFitMode, setDisplayFitMode] = useState<'contain' | 'cover'>('contain');
  const [hoverPreviewEnabled, setHoverPreviewEnabled] = useState(false);
  
  // Export State
  const [exportStep, setExportStep] = useState<'idle' | 'setup' | 'processing'>('idle');
  const [exportStatus, setExportStatus] = useState('');

  type ExportResolution = 'auto' | '720p' | '1080p';
  type ExportFps = 'auto' | 24 | 30 | 60;
  type ExportCodec = 'h264';

  const [exportConfig, setExportConfig] = useState<{
    filename: string;
    format: 'mp4';
    resolution: ExportResolution;
    fps: ExportFps;
    codec: ExportCodec;
	  }>({
	    filename: 'my_sequence',
	    format: 'mp4',
	    resolution: 'auto',
	    fps: 'auto',
	    codec: 'h264',
	  });


  // Drag Visual State
  const [dragState, setDragState] = useState<{ source: number | null; target: number | null }>({ source: null, target: null });

  // Resizable split view (left list / right preview)
  const [sidebarWidth, setSidebarWidth] = useState(420);
  const [isResizingPanels, setIsResizingPanels] = useState(false);
  const sidebarWidthInitializedRef = useRef(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const ffmpegRef = useRef(new FFmpeg());
	  const splitViewRef = useRef<HTMLElement>(null);
  const playerRef = useRef<PlayerHandle | null>(null);
  const ffmpegLogBufferRef = useRef<string[]>([]);
  const ffmpegEventsForRef = useRef<FFmpeg | null>(null);

  // Drag and Drop Refs (Logic)
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // Keep sidebar width sane on resize (e.g., when window becomes narrower)
  useEffect(() => {
    const el = splitViewRef.current;
    if (!el) return;

    const minSidebar = 320;
    const minRight = 420;

    const clamp = () => {
      const rect = el.getBoundingClientRect();
      const maxSidebar = Math.max(minSidebar, rect.width - minRight);
      setSidebarWidth(prev => Math.min(prev, maxSidebar));
    };

    clamp();
    const observer = new ResizeObserver(clamp);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = splitViewRef.current;
    if (!el) return;
    if (sidebarWidthInitializedRef.current) return;
    if (displayAspectRatio !== '9:16') return;

    const rect = el.getBoundingClientRect();
    const minSidebar = 320;
    const minRight = 420;
    const maxSidebar = Math.max(minSidebar, rect.width - minRight);
    const preferred = Math.round(rect.width / 2);
    setSidebarWidth(Math.min(maxSidebar, Math.max(minSidebar, preferred)));
    sidebarWidthInitializedRef.current = true;
  }, [displayAspectRatio]);

  useEffect(() => {
    if (!hoverPreviewEnabled) playerRef.current?.endPreview();
  }, [hoverPreviewEnabled]);

  useEffect(() => {
    const isEditable = (el: Element | null) => {
      if (!el) return false;
      const tag = (el as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return (el as HTMLElement).isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const isSpace = e.code === 'Space' || e.key === ' ';
      const isMuteToggle = e.code === 'KeyM' || e.key?.toLowerCase() === 'm';
      if (!isSpace && !isMuteToggle) return;

      const activeEl = document.activeElement as HTMLElement | null;
      if (isEditable(activeEl)) return;
      if (activeEl?.closest('button, a, [role="button"], [role="slider"]')) return;

      const player = playerRef.current;
      if (!player) return;

      if (isMuteToggle) {
        e.preventDefault();
        player.toggleMute();
        return;
      }

      if (player.getIsPlaying()) {
        e.preventDefault();
        player.pause();
        return;
      }

      const isBackground =
        !activeEl ||
        activeEl === document.body ||
        activeEl === document.documentElement ||
        activeEl.id === 'root';

      const eligible = isBackground || Boolean(activeEl?.closest('[data-spacebar-play="true"]'));
      if (!eligible) return;

      e.preventDefault();
      player.play();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      const newClips: Clip[] = (Array.from(files) as File[]).map((file) => {
        const id = generateId();
        return {
          id,
          file,
          url: URL.createObjectURL(file),
          name: file.name,
          originalDuration: 0, // Will update when loaded
          start: 0,
          end: 0,
          fps: 60,
          isSelected: false,
        };
      });

      // Load metadata
      newClips.forEach(clip => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
          setClips(prev => {
            const updated = prev.map(c => {
              if (c.id === clip.id) {
                return { 
                  ...c, 
                  originalDuration: video.duration, 
                  end: video.duration 
                };
              }
              return c;
            });
            return updated;
          });
          
          // If this is the first clip, select it automatically
          if (!selectedClipId && newClips.length > 0) {
              // We defer this slightly to ensure state is ready
              setTimeout(() => {
                 setSelectedClipId(prev => prev || newClips[0].id);
              }, 0);
          }
        };
        video.src = clip.url;
      });

      setClips(prev => {
        const updated = [...prev, ...newClips];
        if (!selectedClipId && updated.length > 0) {
           setSelectedClipId(updated[0].id);
        }
        return updated;
      });
    }
  };

  const loadFFmpeg = async () => {
    const withTimeout = async <T,>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), ms);
      });

      try {
        return await Promise.race([promise, timeoutPromise]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    };

    const ensureEvents = (ffmpeg: FFmpeg) => {
      if (ffmpegEventsForRef.current === ffmpeg) return;
      ffmpegEventsForRef.current = ffmpeg;
      ffmpegLogBufferRef.current = [];
      ffmpeg.on('log', ({ message }) => {
        const buf = ffmpegLogBufferRef.current;
        buf.push(message);
        if (buf.length > 200) buf.splice(0, buf.length - 200);
      });
    };

    let ffmpeg = ffmpegRef.current;
    if (ffmpeg.loaded) return ffmpeg;

    const doLoad = async () => {
      ensureEvents(ffmpeg);
      setExportStatus('Initializing FFmpeg…');
      await withTimeout(
        ffmpeg.load({
          coreURL: ffmpegCoreJsUrl,
          wasmURL: ffmpegCoreWasmUrl,
        }),
        240_000,
        'FFmpeg initialization timed out'
      );
    };

    try {
      await doLoad();
      return ffmpeg;
    } catch (err) {
      console.warn('FFmpeg load failed; retrying with a fresh instance', err);
      try { ffmpeg.terminate(); } catch {}
      ffmpegRef.current = new FFmpeg();
      ffmpegEventsForRef.current = null;
      ffmpeg = ffmpegRef.current;
      await doLoad();
      return ffmpeg;
    }
  };

  const handleOpenExportSetup = () => {
    if (clips.length === 0) return;
    // Generate a default timestamped name
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "_");
    setExportConfig(prev => ({ 
      ...prev, 
      filename: `sequence_${timestamp}`,
    }));
    setExportStep('setup');
  };

  const executeExport = async () => {
    if (clips.length === 0) return;

    const finalFilename = `${exportConfig.filename}.${exportConfig.format}`;

    // Ask for save location first (so export can run in background afterwards)
    let fileHandle: any | null = null;
    try {
      // @ts-ignore - showSaveFilePicker is not in all TS definitions yet
      if (window.showSaveFilePicker) {
        // @ts-ignore
        fileHandle = await window.showSaveFilePicker({
          suggestedName: finalFilename,
          types: [
            {
              description: 'Video File',
              accept: { [`video/${exportConfig.format}`]: [`.${exportConfig.format}`] },
            },
          ],
        });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return; // user cancelled
      console.warn('File picker failed, falling back to browser download', err);
      fileHandle = null;
    }

    setExportStep('processing');
    setExportStatus('Preparing export…');

    let ffmpegForExport: FFmpeg | null = null;
    let onProgress: ((event: { progress: number }) => void) | null = null;

    try {
      ffmpegForExport = await loadFFmpeg();

      onProgress = ({ progress }: { progress: number }) => {
        if (!Number.isFinite(progress)) return;
        const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
        setExportStatus((current) => {
          if (!current.toLowerCase().includes('render')) return current;
          return current.replace(/\s+\d{1,3}%$/, '') + ` ${pct}%`;
        });
      };
      ffmpegForExport.on('progress', onProgress);
      
      setExportStatus('Loading video files...');
      
      // 1. Write files to FFmpeg virtual filesystem
      const fileNames: string[] = [];
      let concatListContent = '';

      for (const clip of clips) {
        const safeName = `${clip.id}.mp4`;
        fileNames.push(safeName);
        
        // Write file to memory
        await ffmpegForExport.writeFile(safeName, await fetchFile(clip.file));
        
        // Append to concat list with trim points
        concatListContent += `file '${safeName}'\n`;
        concatListContent += `inpoint ${clip.start}\n`;
        concatListContent += `outpoint ${clip.end}\n`;
      }

	      await ffmpegForExport.writeFile('concat_list.txt', concatListContent);
	      const outputName = `output.${exportConfig.format}`;

		      const runH264 = async () => {
		        setExportStatus('Rendering (H.264)…');
		        const dims = getExportDimensions(exportConfig.resolution);
		        const fps = exportConfig.fps === 'auto' ? projectFps : exportConfig.fps;
	        const videoFilter = dims
	          ? (displayFitMode === 'cover'
	            ? `scale=${dims.width}:${dims.height}:force_original_aspect_ratio=increase,crop=${dims.width}:${dims.height},setsar=1`
	            : `scale=${dims.width}:${dims.height}:force_original_aspect_ratio=decrease,pad=${dims.width}:${dims.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`
	          )
	          : null;

	        const args: string[] = [
	          '-f', 'concat',
	          '-safe', '0',
	          '-i', 'concat_list.txt',
	        ];
	        if (videoFilter) args.push('-vf', videoFilter);
	        args.push(
	          '-r', String(fps),
	          '-c:v', 'libx264',
	          '-preset', 'veryfast',
	          '-crf', '23',
	          '-pix_fmt', 'yuv420p',
	          '-c:a', 'aac',
	          '-b:a', '192k',
	          '-movflags', '+faststart',
	          outputName,
	        );
		        await ffmpegForExport.exec(args);
		      };
		      await runH264();

      // 3. Retrieve and Download
      setExportStatus('Saving file...');
      const data = await ffmpegForExport.readFile(outputName);
      const blob = new Blob([data], { type: `video/${exportConfig.format}` });

      if (fileHandle) {
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        // Fallback to classic download (no save picker support)
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = finalFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }

      // Cleanup
      for (const name of fileNames) {
        try { await ffmpegForExport.deleteFile(name); } catch(e) {}
      }
      await ffmpegForExport.deleteFile('concat_list.txt');
      await ffmpegForExport.deleteFile(outputName);
	    } catch (error) {
	      console.error(error);
	      const message = error instanceof Error ? error.message : String(error);
	      const tail = ffmpegLogBufferRef.current.slice(-30).join('\n');
	      alert(`Export failed: ${message}\n\nLast FFmpeg log:\n${tail || '(no logs)'}\n\nCheck console for details.`);
	    } finally {
        if (ffmpegForExport && onProgress) {
          try { ffmpegForExport.off('progress', onProgress); } catch {}
        }
	      setExportStep('idle');
	      setExportStatus('');
	    }
	  };

  const handleDeleteClip = useCallback((id: string) => {
    setClips(prev => {
      const remaining = prev.filter(c => c.id !== id);
      return remaining;
    });
    if (selectedClipId === id) {
      // If we deleted the active clip, select the first one or null
      setClips(prev => {
         if (prev.length > 0) setSelectedClipId(prev[0].id);
         else setSelectedClipId(null);
         return prev;
      });
    }
  }, [selectedClipId]);

  // User manually selects a clip -> Jump player to it
  const handleSelectClip = useCallback((id: string) => {
    setSelectedClipId(id);
  }, []);

  // Player auto-advances -> Update selection
  const handleActiveClipChange = useCallback((id: string) => {
    setSelectedClipId(id);
  }, []);

  const handleUpdateClip = useCallback((id: string, updates: Partial<Clip>) => {
    setClips(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  }, []);

  const handleBatchTrim = () => {
    const trimAmount = 18 / 60; // 0.3 seconds
    setClips(prev => prev.map(c => {
      const newEnd = Math.max(c.start + 0.1, c.end - trimAmount);
      return { ...c, end: newEnd };
    }));
  };

  // --- Drag and Drop Handlers ---
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    dragItem.current = index;
    setDragState({ source: index, target: null });
    // Set drop effect
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    dragOverItem.current = index;
    setDragState(prev => {
      if (prev.target === index) return prev;
      return { ...prev, target: index };
    });
  };

  const handleDragEnd = () => {
    const _dragItem = dragItem.current;
    const _dragOverItem = dragOverItem.current;

    if (_dragItem !== null && _dragOverItem !== null && _dragItem !== _dragOverItem) {
      const _clips = [...clips];
      const draggedItemContent = _clips[_dragItem];
      _clips.splice(_dragItem, 1);
      _clips.splice(_dragOverItem, 0, draggedItemContent);
      setClips(_clips);
    }
    
    dragItem.current = null;
    dragOverItem.current = null;
    setDragState({ source: null, target: null });
  };

  // Update selection status + compute global sequence time for each clip
  const clipsWithSelection = useMemo(() => {
    let accumulatedTime = 0;
    return clips.map(c => {
      const duration = c.end - c.start;
      const sequenceStart = accumulatedTime;
      accumulatedTime += duration;
      return {
        ...c,
        isSelected: c.id === selectedClipId,
        sequenceStart,
        sequenceEnd: accumulatedTime,
      };
    });
  }, [clips, selectedClipId]);

  const projectFps = useMemo(() => {
    let maxFps = 0;
    for (const clip of clips) {
      if (Number.isFinite(clip.fps)) maxFps = Math.max(maxFps, clip.fps);
    }
    return maxFps || 60;
  }, [clips]);

  const toEven = (value: number) => {
    const v = Math.round(value);
    return v % 2 === 0 ? v : v + 1;
  };

  const getExportDimensions = (resolution: ExportResolution) => {
    if (resolution === 'auto') return null;
    const base = resolution === '720p' ? 720 : 1080;

    const [rW, rH] = displayAspectRatio.split(':').map(Number);
    if (!Number.isFinite(rW) || !Number.isFinite(rH) || rW <= 0 || rH <= 0) {
      return { width: base, height: base };
    }

    // Treat "p" as the short-side length (like 1280x720 or 720x1280 depending on ratio)
    let width: number;
    let height: number;
    if (rW <= rH) {
      width = base;
      height = (base * rH) / rW;
    } else {
      height = base;
      width = (base * rW) / rH;
    }

    return { width: toEven(width), height: toEven(height) };
  };

  const dims720p = getExportDimensions('720p');
  const dims1080p = getExportDimensions('1080p');

  const handleResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const containerRect = splitViewRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    setIsResizingPanels(true);

    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const minSidebar = 320;
    const minRight = 420;
    const maxSidebar = Math.max(minSidebar, containerRect.width - minRight);

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: PointerEvent) => {
      const next = startWidth + (ev.clientX - startX);
      setSidebarWidth(Math.min(maxSidebar, Math.max(minSidebar, next)));
    };

    const onUp = () => {
      setIsResizingPanels(false);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [sidebarWidth]);

  return (
    <div className="h-screen w-screen bg-transparent text-[#253745] flex flex-col overflow-hidden font-sans selection:bg-[#9BA8AB]/35 relative">

      {/* Global Title Bar */}
      <header className="shrink-0 border-b border-[#9BA8AB]/45 bg-white/65 backdrop-blur-xl">
        <div className="h-14 px-6 flex items-center justify-between max-w-[1200px] mx-auto">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-brand-500/10 border border-brand-500/25 flex items-center justify-center shrink-0">
              <LayoutTemplate size={18} className="text-brand-500" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-wide truncate">FrameCut Pro</div>
              <div className="text-[11px] text-[#4A5C6A] truncate">
                片段：{clips.length}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
	            {exportStep === 'processing' && (
	              <div
                className="hidden md:flex items-center gap-2 h-9 px-3 rounded-lg bg-white/65 border border-[#9BA8AB]/45 backdrop-blur-xl text-xs text-[#253745] max-w-[420px]"
                aria-live="polite"
              >
                <Loader2 size={14} className="text-[#253745] animate-spin" />
                <span className="truncate">{exportStatus || '導出中…'}</span>
                <span className="text-[#4A5C6A] font-mono truncate">
                  {exportConfig.filename}.{exportConfig.format}
                </span>
              </div>
            )}

            <button
              onClick={handleOpenExportSetup}
              disabled={clips.length === 0 || exportStep === 'processing'}
              className={`h-9 px-3 rounded-lg text-xs font-bold uppercase tracking-wide flex items-center gap-2 border transition-colors ${
	                clips.length === 0
	                  ? 'bg-white/60 text-[#9BA8AB] border-[#9BA8AB]/45 cursor-not-allowed'
	                  : 'bg-brand-500 hover:bg-brand-500/90 text-[#CCD0CF] border-brand-500'
	              }`}
	            >
              <Download size={14} /> 導出
            </button>
          </div>
        </div>
      </header>
      
	      {/* Export Setup Modal */}
			      {exportStep === 'setup' && (
			        <div className="absolute inset-0 z-50 bg-[#9BA8AB]/35 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
			           <div className="bg-white/80 backdrop-blur-xl border border-[#9BA8AB]/45 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
		              
		              {/* Modal Header */}
			              <div className="h-14 border-b border-[#9BA8AB]/45 flex items-center justify-between px-6 bg-white/65">
			                <h3 className="text-sm font-bold text-[#253745] uppercase tracking-wider flex items-center gap-2">
			                   <Download size={16} className="text-brand-500" /> 
			                   Export Settings
			                </h3>
		                <button 
		                  onClick={() => setExportStep('idle')} 
		                  className="text-[#4A5C6A] hover:text-[#253745] transition-colors p-1"
		                >
		                   <X size={18} />
		                </button>
		              </div>

	              {/* Modal Body */}
	              <div className="p-6 space-y-6">
	                 
		                 {/* Format Selection */}
		                 <div className="space-y-2">
		                    <label className="text-xs font-bold text-[#4A5C6A] uppercase tracking-wider block">Export Format</label>
		                    <div className="grid grid-cols-2 gap-3">
			                       <button 
			                         onClick={() => setExportConfig(c => ({...c, format: 'mp4'}))}
			                         className={`flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
			                           exportConfig.format === 'mp4' 
			                             ? 'bg-brand-500/10 border-brand-500/30 text-[#253745]' 
			                             : 'bg-white/70 border-[#9BA8AB]/45 text-[#253745] hover:border-brand-500/25 hover:bg-white/80'
			                         }`}
			                       >
		                          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${exportConfig.format === 'mp4' ? 'bg-brand-500 text-[#CCD0CF]' : 'bg-[#CCD0CF]/80 text-[#4A5C6A] border border-[#9BA8AB]/45'}`}>
		                             <FileVideo size={16} />
		                          </div>
		                          <div>
		                             <div className="text-sm font-bold">MP4</div>
		                             <div className="text-[10px] text-[#4A5C6A]">Compatible & Fast</div>
		                          </div>
		                          {exportConfig.format === 'mp4' && <Check size={16} className="ml-auto text-brand-500" />}
		                       </button>
		                       {/* Placeholder for future formats */}
			                       <div className="opacity-50 pointer-events-none flex items-center gap-3 p-3 rounded-lg border border-[#9BA8AB]/45 bg-white/60">
			                           <div className="w-8 h-8 rounded-full bg-[#CCD0CF]/80 flex items-center justify-center text-[#4A5C6A] border border-[#9BA8AB]/45">
			                              <FileVideo size={16} />
			                           </div>
		                           <div>
		                             <div className="text-sm font-bold text-[#4A5C6A]">GIF</div>
		                             <div className="text-[10px] text-[#4A5C6A]">Coming soon</div>
		                           </div>
		                       </div>
			                    </div>
			                 </div>

		                 {/* Encoding */}
			                 <div className="space-y-2">
				                   <label className="text-xs font-bold text-[#4A5C6A] uppercase tracking-wider block">Encoding</label>
					                   <select
				                     value={exportConfig.codec}
		                     onChange={(e) => {
		                       const codec = e.target.value as ExportCodec;
		                       setExportConfig(c => ({ ...c, codec }));
		                     }}
					                     className="w-full bg-white/70 border border-[#9BA8AB]/45 text-[#253745] text-sm rounded-lg px-4 py-3 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/25 transition-all"
					                   >
		                     <option value="h264">H.264 (re-encode)</option>
		                   </select>
				                   <div className="text-[11px] text-[#4A5C6A]">
				                     將以 H.264 重新編碼輸出。
				                   </div>
			                 </div>

		                 {/* Resolution */}
		                 <div className="space-y-2">
			                   <label className="text-xs font-bold text-[#4A5C6A] uppercase tracking-wider block">Resolution</label>
				                   <select
		                     value={exportConfig.resolution}
		                     onChange={(e) => {
		                       const resolution = e.target.value as ExportResolution;
		                       setExportConfig(c => ({
		                         ...c,
		                         resolution,
		                       }));
		                     }}
				                     className="w-full bg-white/70 border border-[#9BA8AB]/45 text-[#253745] text-sm rounded-lg px-4 py-3 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/25 transition-all"
				                   >
	                     <option value="auto">Auto (keep source)</option>
	                     <option value="720p">720p{dims720p ? ` (${dims720p.width}×${dims720p.height})` : ''}</option>
	                     <option value="1080p">1080p{dims1080p ? ` (${dims1080p.width}×${dims1080p.height})` : ''}</option>
	                   </select>
	                 </div>

		                 {/* FPS */}
		                 <div className="space-y-2">
			                   <label className="text-xs font-bold text-[#4A5C6A] uppercase tracking-wider block">FPS</label>
				                   <select
		                     value={String(exportConfig.fps)}
		                     onChange={(e) => {
		                       const v = e.target.value;
		                       const fps = (v === 'auto' ? 'auto' : (Number(v) as ExportFps));
		                       setExportConfig(c => ({
		                         ...c,
		                         fps,
		                       }));
		                     }}
				                     className="w-full bg-white/70 border border-[#9BA8AB]/45 text-[#253745] text-sm rounded-lg px-4 py-3 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/25 transition-all"
				                   >
	                     <option value="auto">Auto ({projectFps} FPS)</option>
	                     <option value="24">24 FPS</option>
	                     <option value="30">30 FPS</option>
	                     <option value="60">60 FPS</option>
	                   </select>
	                 </div>

		                 {/* Filename Input */}
		                 <div className="space-y-2">
			                    <label className="text-xs font-bold text-[#4A5C6A] uppercase tracking-wider block">Filename</label>
			                    <div className="relative group">
		                       <input 
	                         type="text" 
                         value={exportConfig.filename}
                         onChange={(e) => setExportConfig(c => ({...c, filename: e.target.value}))}
                         onFocus={(e) => e.target.select()}
			                         className="w-full bg-white/70 border border-[#9BA8AB]/45 text-[#253745] text-sm rounded-lg px-4 py-3 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/25 transition-all font-mono placeholder:text-[#9BA8AB]"
			                         placeholder="Enter filename..."
			                       />
		                       <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#4A5C6A] text-xs font-mono select-none">
		                         .{exportConfig.format}
		                       </span>
	                    </div>
	                 </div>

              </div>

		              {/* Modal Footer */}
			              <div className="p-4 bg-white/65 border-t border-[#9BA8AB]/45 flex justify-end gap-3">
		                 <button 
		                   onClick={() => setExportStep('idle')}
		                   className="px-4 py-2 rounded-lg text-xs font-bold text-[#4A5C6A] hover:text-[#253745] hover:bg-[#CCD0CF]/60 transition-colors"
		                 >
		                   Cancel
		                 </button>
		                 <button 
		                   onClick={executeExport}
		                   className="px-5 py-2 bg-brand-500 hover:bg-brand-500/90 text-[#CCD0CF] rounded-lg text-xs font-bold flex items-center gap-2 shadow-sm active:scale-95 transition-all border border-brand-500/35"
		                 >
		                   Export Sequence <ChevronRight size={14} />
		                 </button>
		              </div>

           </div>
        </div>
      )}


      {/* Hidden File Input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileUpload} 
        multiple 
        accept="video/*" 
        className="hidden" 
      />

	      {/* Main Content (Resizable Split View) */}
	      <div className="flex-1 overflow-hidden p-6">
	        <div className="h-full max-w-[1200px] mx-auto">
		          <main
		            ref={splitViewRef}
		            className={`h-full flex overflow-hidden rounded-2xl border border-[#9BA8AB]/45 bg-white/55 backdrop-blur-xl shadow-[0_18px_60px_rgba(37,55,69,0.12)] ${
		              isResizingPanels ? 'cursor-col-resize' : ''
		            }`}
		            style={{ ['--sidebar-width' as any]: `${sidebarWidth}px` } as React.CSSProperties}
		          >
	        
	        {/* Left Sidebar: Clip List */}
		        <aside className="bg-white/30 backdrop-blur-xl flex flex-col h-full overflow-hidden min-w-[320px] w-[var(--sidebar-width)] shrink-0">
          
		          {/* Sidebar Header with Tools */}
				          <div className="pt-4 px-6 pb-2">
				            <div className="w-full rounded-xl border border-[#9BA8AB]/45 bg-white/65 backdrop-blur-xl px-3 py-2 shadow-sm flex items-center justify-between gap-3">
				              <div className="flex items-center gap-2 text-[#253745] min-w-0">
				                <span className="text-[11px] font-bold uppercase tracking-widest">Clips</span>
				                <span className="bg-[#CCD0CF]/80 text-[#253745] text-[10px] px-1.5 py-0.5 rounded-full border border-[#9BA8AB]/45 font-mono shrink-0">
			                  {clips.length}
			                </span>
			              </div>

	              <div className="flex items-center gap-2 shrink-0">
	                <button
	                  onClick={() => setHoverPreviewEnabled(v => !v)}
			                  aria-pressed={hoverPreviewEnabled}
			                  className={`flex items-center gap-1.5 h-8 px-3 text-[10px] font-bold uppercase tracking-wide rounded-lg border transition-all active:scale-95 ${
			                    hoverPreviewEnabled
			                      ? 'bg-brand-500/10 border-brand-500/25 text-brand-500'
			                      : 'bg-white/65 hover:bg-white/75 text-[#253745] border-[#9BA8AB]/45'
			                  }`}
			                  title="Hover to preview frames on the right"
			                >
	                  {hoverPreviewEnabled ? <Eye size={12} /> : <EyeOff size={12} />}
	                  Preview
	                </button>

			                <button 
			                  onClick={handleBatchTrim}
			                  className="flex items-center gap-1.5 h-8 px-3 bg-white/65 hover:bg-white/75 text-[#253745] text-[10px] font-bold uppercase tracking-wide rounded-lg border border-[#9BA8AB]/45 transition-all active:scale-95"
			                >
			                  <Scissors size={12} /> Trim All
			                </button>
	              </div>
	            </div>
		          </div>

		          {/* List Container */}
			          <div className="flex-1 overflow-y-auto px-6 pb-6 custom-scrollbar">
	            {clipsWithSelection.map((clip, index) => {
	              // Determine drop indicator position
	              let dropIndicator: 'top' | 'bottom' | null = null;
	              if (dragState.source !== null && dragState.target === index && dragState.source !== index) {
	                 if (dragState.source < index) dropIndicator = 'bottom';
	                 else dropIndicator = 'top';
	              }

	                return (
	                  <ClipItem 
	                    key={clip.id} 
	                    clip={clip} 
	                    sequenceStart={clip.sequenceStart}
	                    sequenceEnd={clip.sequenceEnd}
	                    index={index}
	                    onSelect={handleSelectClip}
	                    onDelete={handleDeleteClip}
	                    onUpdateClip={handleUpdateClip}
	                  onDragStart={handleDragStart}
	                  onDragEnter={handleDragEnter}
	                  onDragEnd={handleDragEnd}
	                  dropIndicator={dropIndicator}
	                  hoverPreviewEnabled={hoverPreviewEnabled}
	                  onHoverPreview={(t) => playerRef.current?.previewAtGlobalTime(t)}
	                  onHoverPreviewEnd={() => playerRef.current?.endPreview()}
	                  onSeekGlobalTime={(t) => playerRef.current?.commitSeekToGlobalTime(t)}
	                  // Pass playback time ONLY if this is the active clip
	                  currentPlaybackTime={clip.id === selectedClipId ? currentPlaybackTime : undefined}
	                />
	              );
	            })}
	
			            {/* Add Video Button Placeholder */}
			            <div className="w-full h-[196px] border border-[#9BA8AB]/45 bg-white/35 rounded-xl flex items-center justify-center text-[#4A5C6A] mb-3 backdrop-blur-xl">
			              <button
			                type="button"
			                onClick={() => fileInputRef.current?.click()}
			                className="w-10 h-10 rounded-full bg-white/70 border border-[#9BA8AB]/45 flex items-center justify-center hover:scale-110 active:scale-95 transition-transform"
			                aria-label="Add video"
			              >
			                <Plus size={20} className="text-brand-500" />
			              </button>
			            </div>
	          </div>
	        </aside>

        {/* Resize Handle */}
	        <div
	          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panels"
          onPointerDown={handleResizePointerDown}
		          className={`flex w-2 shrink-0 items-stretch cursor-col-resize select-none touch-none ${
		            isResizingPanels ? 'bg-brand-500/15' : 'hover:bg-[#9BA8AB]/30'
		          }`}
		          title="Drag to resize"
		        >
		          <div className={`mx-auto w-px ${isResizingPanels ? 'bg-brand-500/60' : 'bg-[#9BA8AB]/60'}`} />
		        </div>

	        {/* Right Panel: Sequence Player */}
			        <section className="flex-1 min-w-0 h-full overflow-hidden bg-white/20 backdrop-blur-xl">
		          <Player 
	            ref={playerRef}
	            clips={clips} 
	            activeClipId={selectedClipId}
	            onActiveClipChange={handleActiveClipChange}
	            onTimeUpdate={setCurrentPlaybackTime}
	            onAddVideo={() => fileInputRef.current?.click()}
	            aspectRatio={displayAspectRatio}
	            onAspectRatioChange={setDisplayAspectRatio}
	            fitMode={displayFitMode}
	            onFitModeChange={setDisplayFitMode}
	          />
		        </section>

          </main>
        </div>
      </div>
    </div>
  );
}
