import React, { useRef, useEffect, useState, useMemo, useCallback, useImperativeHandle } from 'react';
import { Clip } from '../types';
import { formatDurationDisplay } from '../utils';
import { Play, Pause, Volume2, VolumeX, Settings, ChevronDown, Monitor, Maximize, Maximize2, Minimize2, Plus } from './Icons';

interface PlayerProps {
  clips: Clip[];
  activeClipId: string | null;
  onActiveClipChange: (id: string) => void;
  onTimeUpdate: (time: number) => void;
  onAddVideo?: () => void;
  aspectRatio: string;
  onAspectRatioChange: (value: string) => void;
  fitMode: 'contain' | 'cover';
  onFitModeChange: (value: 'contain' | 'cover') => void;
}

export interface PlayerHandle {
  commitSeekToGlobalTime: (time: number) => void;
  previewAtGlobalTime: (time: number) => void;
  endPreview: () => void;
  play: () => void;
  pause: () => void;
  toggleMute: () => void;
  getIsPlaying: () => boolean;
}

export const Player = React.forwardRef<PlayerHandle, PlayerProps>(({
  clips,
  activeClipId,
  onActiveClipChange,
  onTimeUpdate,
  onAddVideo,
  aspectRatio,
  onAspectRatioChange,
  fitMode,
  onFitModeChange,
		}, ref) => {
			  const videoRef = useRef<HTMLVideoElement>(null);
			  const timelinePreviewVideoRef = useRef<HTMLVideoElement>(null);
			  const timelinePreviewCanvasRef = useRef<HTMLCanvasElement>(null);
			  const timelineRef = useRef<HTMLDivElement>(null);
			  const containerRef = useRef<HTMLDivElement>(null);
			  const titleBarRef = useRef<HTMLDivElement>(null);
			  const fullscreenContainerRef = useRef<HTMLDivElement>(null);
			  const videoWrapperRef = useRef<HTMLDivElement>(null);
			  const hideControlsTimer = useRef<number | null>(null);
	  const isPointerOverPlayerRef = useRef(false);
	  const isTimelineHoveredRef = useRef(false);
	  const isPreviewingRef = useRef(false);
	  const previewRestoreRef = useRef<{ src: string | null; localTime: number; globalTime: number } | null>(null);
	  const activeClipIdRef = useRef(activeClipId);
	  const previewRafRef = useRef<number | null>(null);
	  const previewPendingTimeRef = useRef<number | null>(null);
	  const aspectRatioRef = useRef(aspectRatio);
	  const fitModeRef = useRef(fitMode);

		  const [isPlaying, setIsPlaying] = useState(false);
	  const [isScrubbing, setIsScrubbing] = useState(false);
	  const [areControlsVisible, setAreControlsVisible] = useState(false);
	  const [isFullscreen, setIsFullscreen] = useState(false);
	  const [timelinePreview, setTimelinePreview] = useState<{
	    isVisible: boolean;
	    leftPx: number;
	    time: number;
	    width: number;
	    height: number;
	  }>({ isVisible: false, leftPx: 0, time: 0, width: 160, height: 90 });
	  const timelinePreviewTokenRef = useRef(0);
	  const timelinePreviewRafRef = useRef<number | null>(null);
	  const timelinePreviewPendingRef = useRef<{ time: number; leftPx: number } | null>(null);
	  const timelinePreviewCaptureTimeRef = useRef<number | null>(null);
	  const timelinePreviewWorkerRunningRef = useRef(false);
  
	  // Audio State
	  const [volume, setVolume] = useState(1);
	  const [isMuted, setIsMuted] = useState(false);
	  const [muteNotificationVisible, setMuteNotificationVisible] = useState(false);
	  const muteNotificationTimerRef = useRef<number | null>(null);

	  const toggleMute = useCallback(() => {
	    setIsMuted((prevMuted) => {
	      const shouldUnmute = prevMuted || volume === 0;
	      if (shouldUnmute) {
	        if (volume === 0) setVolume(1);
	        return false;
	      }
	      return true;
	    });

	    // Show notification for 1 second
	    if (muteNotificationTimerRef.current !== null) {
	      window.clearTimeout(muteNotificationTimerRef.current);
	    }
	    setMuteNotificationVisible(true);
	    muteNotificationTimerRef.current = window.setTimeout(() => {
	      setMuteNotificationVisible(false);
	    }, 1000);
	  }, [volume]);
  
	  // Container Dimensions for Adaptive Sizing
	  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });
	  const [titleBarHeight, setTitleBarHeight] = useState(0);
	  const [fullscreenViewport, setFullscreenViewport] = useState({ width: 0, height: 0 });
	  const isPlayingRef = useRef(false);

	  useEffect(() => { activeClipIdRef.current = activeClipId; }, [activeClipId]);
	  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
	  useEffect(() => { aspectRatioRef.current = aspectRatio; }, [aspectRatio]);
	  useEffect(() => { fitModeRef.current = fitMode; }, [fitMode]);

  const ratios = [
    { label: '9:16 Story', value: '9:16' },
    { label: '16:9 Landscape', value: '16:9' },
    { label: '1:1 Square', value: '1:1' },
    { label: '4:5 Social', value: '4:5' },
    { label: '3:4 Portrait', value: '3:4' },
    { label: '21:9 Cinema', value: '21:9' },
  ];

  const clearHideControlsTimer = useCallback(() => {
    if (hideControlsTimer.current !== null) {
      window.clearTimeout(hideControlsTimer.current);
      hideControlsTimer.current = null;
    }
  }, []);

	  const scheduleHideControls = useCallback((delayMs = 2000) => {
	    clearHideControlsTimer();
	    if (isScrubbing) return;
	    hideControlsTimer.current = window.setTimeout(() => {
	      setAreControlsVisible(false);
	    }, delayMs);
	  }, [clearHideControlsTimer, isScrubbing]);

	  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

		  const hideTimelinePreview = useCallback(() => {
		    timelinePreviewPendingRef.current = null;
		    timelinePreviewCaptureTimeRef.current = null;
		    timelinePreviewTokenRef.current += 1;
		    setTimelinePreview(prev => (prev.isVisible ? { ...prev, isVisible: false } : prev));
		  }, []);

	  useEffect(() => {
	    if (!areControlsVisible) hideTimelinePreview();
	  }, [areControlsVisible, hideTimelinePreview]);

		  useEffect(() => {
		    return () => {
		      if (timelinePreviewRafRef.current !== null) {
		        window.cancelAnimationFrame(timelinePreviewRafRef.current);
		        timelinePreviewRafRef.current = null;
		      }
		      if (previewRafRef.current !== null) {
		        window.cancelAnimationFrame(previewRafRef.current);
		        previewRafRef.current = null;
		      }
		      if (muteNotificationTimerRef.current !== null) {
		        window.clearTimeout(muteNotificationTimerRef.current);
		        muteNotificationTimerRef.current = null;
		      }
		    };
		  }, []);

  useEffect(() => {
    const update = () => {
      const doc: any = document;
      setIsFullscreen(Boolean(doc.fullscreenElement || doc.webkitFullscreenElement));
    };
    update();
    document.addEventListener('fullscreenchange', update);
    // @ts-ignore
    document.addEventListener('webkitfullscreenchange', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      // @ts-ignore
      document.removeEventListener('webkitfullscreenchange', update);
    };
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;
    const update = () => setFullscreenViewport({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [isFullscreen]);

  const toggleFullscreen = useCallback(async () => {
    const doc: any = document;
    const current = doc.fullscreenElement || doc.webkitFullscreenElement;

    const request = async (el: any) => {
      if (!el) return;
      if (el.requestFullscreen) return el.requestFullscreen();
      if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
      if (el.webkitEnterFullscreen) return el.webkitEnterFullscreen();
    };

    const exit = async () => {
      if (doc.exitFullscreen) return doc.exitFullscreen();
      if (doc.webkitExitFullscreen) return doc.webkitExitFullscreen();
    };

    try {
      if (current) {
        await exit();
      } else {
        await request(fullscreenContainerRef.current);
        // iOS Safari may only support fullscreen on <video>
        if (!(doc.fullscreenElement || doc.webkitFullscreenElement)) {
          await request(videoRef.current);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const el = titleBarRef.current;
    if (!el) return;

    const update = () => setTitleBarHeight(el.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [activeClipId, clips.length]);

  // --- Resize Observer ---
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        const style = getComputedStyle(containerRef.current);
        const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        setContainerDimensions({
          width: Math.max(0, clientWidth - paddingX),
          height: Math.max(0, clientHeight - paddingY),
        });
      }
    };

    updateDimensions();
    const observer = new ResizeObserver(updateDimensions);
    if (containerRef.current) observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, []);

  // --- Wrapper Size Calculation ---
  const wrapperStyle = useMemo(() => {
    if (containerDimensions.width === 0 || containerDimensions.height === 0) {
        return { width: '100%', height: '100%' };
    }

    const [rW, rH] = aspectRatio.split(':').map(Number);
    const targetRatio = rW / rH;
    const reservedHeight = titleBarHeight > 0 ? titleBarHeight + 8 : 0;
    const availableHeight = Math.max(0, containerDimensions.height - reservedHeight);

    let width, height;

    // Fit by width first, then constrain by height.
    width = containerDimensions.width;
    height = width / targetRatio;
    if (availableHeight > 0 && height > availableHeight) {
      height = availableHeight;
      width = height * targetRatio;
    }

    return { width, height };
  }, [containerDimensions, aspectRatio, titleBarHeight]);

  const fullscreenFrameStyle = useMemo(() => {
    if (!isFullscreen) return wrapperStyle;

    const viewportWidth = fullscreenViewport.width || window.innerWidth;
    const viewportHeight = fullscreenViewport.height || window.innerHeight;

    const [rW, rH] = aspectRatio.split(':').map(Number);
    const targetRatio = rW / rH;

    let width = viewportWidth;
    let height = width / targetRatio;
    if (height > viewportHeight) {
      height = viewportHeight;
      width = height * targetRatio;
    }

    return { width, height };
  }, [aspectRatio, fullscreenViewport, isFullscreen, wrapperStyle]);


  // --- Sequence Calculation ---
  const sequence = useMemo(() => {
    let accumulatedTime = 0;
    return clips.map(clip => {
      const duration = clip.end - clip.start;
      const start = accumulatedTime;
      accumulatedTime += duration;
      return { 
        ...clip, 
        sequenceStart: start, 
        sequenceDuration: duration,
        sequenceEnd: start + duration
      };
    });
  }, [clips]);

	  const totalDuration = sequence.length > 0 
	    ? sequence[sequence.length - 1].sequenceEnd 
	    : 0;
	  
	  const totalDurationRef = useRef(totalDuration);
	  useEffect(() => { totalDurationRef.current = totalDuration; }, [totalDuration]);
	  const sequenceRef = useRef(sequence);
	  useEffect(() => { sequenceRef.current = sequence; }, [sequence]);

  // Derive active clip object
  const activeClipIndex = sequence.findIndex(c => c.id === activeClipId);
  const activeClip = activeClipIndex !== -1 ? sequence[activeClipIndex] : undefined;
  const hasClips = clips.length > 0 && activeClip !== undefined;

  const projectFps = useMemo(() => {
    let maxFps = 0;
    for (const clip of clips) {
      if (Number.isFinite(clip.fps)) maxFps = Math.max(maxFps, clip.fps);
    }
    return maxFps;
  }, [clips]);

  const [globalTimeDisplay, setGlobalTimeDisplay] = useState(0);
  const isScrubbingRef = useRef(isScrubbing);
  const activeClipRef = useRef(activeClip);

  useEffect(() => { isScrubbingRef.current = isScrubbing; }, [isScrubbing]);
  useEffect(() => { activeClipRef.current = activeClip; }, [activeClip]);

  useEffect(() => {
    if (!hasClips) return;
    if (!isPlaying) return;

    let rafId = 0;
    let lastEmit = 0;

    const tick = (now: number) => {
      const vid = videoRef.current;
      const clip = activeClipRef.current;
      if (vid && clip && !isPreviewingRef.current) {
        const local = vid.currentTime;
        const global = clip.sequenceStart + (local - clip.start);

        if (!isScrubbingRef.current) setGlobalTimeDisplay(global);

        if (now - lastEmit >= 33) {
          onTimeUpdate(local);
          lastEmit = now;
        }
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [hasClips, isPlaying, onTimeUpdate]);

  const setVideoSrcAndTime = useCallback((src: string, time: number) => {
    const vid = videoRef.current;
    if (!vid) return;

    const currentSrc = vid.getAttribute('src');
    if (currentSrc !== src) {
      vid.src = src;
    }

    const apply = () => {
      try {
        // Use fastSeek if available for faster preview response
        const anyVid = vid as any;
        if (typeof anyVid.fastSeek === 'function') {
          anyVid.fastSeek(time);
        } else {
          vid.currentTime = time;
        }
      } catch {}
    };

    if (vid.readyState >= 1) {
      apply();
      return;
    }

    const onLoaded = () => {
      apply();
      vid.removeEventListener('loadedmetadata', onLoaded);
    };
    vid.addEventListener('loadedmetadata', onLoaded);
  }, []);

  useEffect(() => {
    if (!hasClips) return;
    if (!isPointerOverPlayerRef.current) {
      clearHideControlsTimer();
      setAreControlsVisible(false);
      return;
    }
    setAreControlsVisible(true);
    scheduleHideControls();
    return clearHideControlsTimer;
  }, [hasClips, isPlaying, scheduleHideControls, clearHideControlsTimer]);

  // --- Sync Active Clip ID from Props ---
  useEffect(() => {
    if (isPreviewingRef.current) return;
    if (activeClip && videoRef.current) {
        const currentSrc = videoRef.current.getAttribute('src');
        if (currentSrc !== activeClip.url) {
            videoRef.current.src = activeClip.url;
            videoRef.current.currentTime = activeClip.start;
            videoRef.current.volume = volume;
            videoRef.current.muted = isMuted;
            if (isPlaying) {
                videoRef.current.play().catch(() => {});
            }
        }
    }
  }, [activeClip, isPlaying, volume, isMuted]);

  // --- Sync Volume State ---
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = isMuted;
    }
  }, [volume, isMuted]);

  // --- Playback Logic ---
  const handleTimeUpdate = () => {
    if (isPreviewingRef.current) return;
    const vid = videoRef.current;
    if (!vid || !activeClip) return;

    const currentLocalTime = vid.currentTime;
    
    // Calculate global time for the slider
    const currentGlobalTime = activeClip.sequenceStart + (currentLocalTime - activeClip.start);
    
    // Only update slider state if we are NOT scrubbing to prevent jitter
    if (!isScrubbing) {
        setGlobalTimeDisplay(currentGlobalTime);
    }
    
    onTimeUpdate(currentLocalTime);

    // Check if we hit the trim end point
    if (currentLocalTime >= activeClip.end && !isScrubbing) {
      const nextIndex = (activeClipIndex + 1) % sequence.length;
      const nextClip = sequence[nextIndex];
      onActiveClipChange(nextClip.id);
      
      vid.src = nextClip.url;
      vid.currentTime = nextClip.start;
      vid.play();
    }
  };

  const seekToGlobalTime = (time: number) => {
    const seekTime = Math.max(0, Math.min(time, totalDurationRef.current));
    setGlobalTimeDisplay(seekTime);

    const targetClip = sequence.find(c => seekTime >= c.sequenceStart && seekTime < c.sequenceEnd) || sequence[sequence.length - 1];

    if (targetClip) {
      const localSeekTime = targetClip.start + (seekTime - targetClip.sequenceStart);
      
      if (targetClip.id !== activeClipId) {
        onActiveClipChange(targetClip.id);
        // Defer seek slightly to ensure src switch happens first
        setTimeout(() => {
           if (videoRef.current) {
               videoRef.current.currentTime = localSeekTime;
               onTimeUpdate(localSeekTime);
           }
        }, 0);
      } else {
        if (videoRef.current) {
            videoRef.current.currentTime = localSeekTime;
            onTimeUpdate(localSeekTime);
        }
      }
    }
  };

  const updateTimelinePreviewFromClientX = useCallback((clientX: number) => {
    if (!hasClips) return;
    if (!areControlsVisible) return;
    const el = timelineRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;

    const x = clamp(clientX - rect.left, 0, rect.width);
    const seekTime = rect.width > 0 ? (x / rect.width) * totalDurationRef.current : 0;

    // Calculate thumbnail dimensions based on current aspect ratio
    const currentAspectRatio = aspectRatioRef.current;
    const [rW, rH] = currentAspectRatio.split(':').map(Number);
    const targetRatio = rW / rH;

    // Increased base sizes for better visibility
    let thumbWidth: number, thumbHeight: number;

    if (targetRatio >= 1) {
      // Landscape or square: use larger base width
      thumbWidth = 200;
      thumbHeight = Math.round(thumbWidth / targetRatio);
    } else {
      // Portrait: use larger base height
      thumbHeight = 160;
      thumbWidth = Math.round(thumbHeight * targetRatio);
    }

    // Ensure even numbers for video encoding compatibility
    thumbWidth = Math.round(thumbWidth / 2) * 2;
    thumbHeight = Math.round(thumbHeight / 2) * 2;

    // Use mouse X position directly for centering
    const leftPx = x;

    timelinePreviewPendingRef.current = { time: seekTime, leftPx };
    timelinePreviewCaptureTimeRef.current = seekTime;

    // Immediately update position without RAF throttling for smoother movement
    setTimelinePreview(prev => ({
      ...prev,
      isVisible: true,
      leftPx,
      time: seekTime,
      width: thumbWidth,
      height: thumbHeight,
    }));

    if (timelinePreviewWorkerRunningRef.current) return;
    timelinePreviewWorkerRunningRef.current = true;
    const workerToken = timelinePreviewTokenRef.current;

    void (async () => {
      try {
        let idleFrames = 0;

        while (workerToken === timelinePreviewTokenRef.current) {
          const requestedTime = timelinePreviewCaptureTimeRef.current;
          if (requestedTime === null) {
            idleFrames += 1;
            if (idleFrames > 30) break; // Increased from 20 to allow more attempts
            await new Promise<void>((resolve) => window.setTimeout(resolve, 4)); // Reduced from 8ms to 4ms
            continue;
          }

          idleFrames = 0;

          const vid = timelinePreviewVideoRef.current;
          const canvas = timelinePreviewCanvasRef.current;
          if (!vid || !canvas) {
            await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
            continue;
          }
          timelinePreviewCaptureTimeRef.current = null;

          // Calculate thumbnail dimensions based on current aspect ratio
          const currentAspectRatio = aspectRatioRef.current;
          const [rW, rH] = currentAspectRatio.split(':').map(Number);
          const targetRatio = rW / rH;

          // Increased base sizes for better visibility (matching updateTimelinePreviewFromClientX)
          let width: number, height: number;

          if (targetRatio >= 1) {
            // Landscape or square: use larger base width
            width = 200;
            height = Math.round(width / targetRatio);
          } else {
            // Portrait: use larger base height
            height = 160;
            width = Math.round(height * targetRatio);
          }

          // Ensure even numbers for video encoding compatibility
          width = Math.round(width / 2) * 2;
          height = Math.round(height / 2) * 2;

          const canvasWidth = width * 2; // Higher resolution for quality
          const canvasHeight = height * 2;

          if (canvas.width !== canvasWidth) canvas.width = canvasWidth;
          if (canvas.height !== canvasHeight) canvas.height = canvasHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;

          const clippedTime = Math.max(0, Math.min(requestedTime, totalDurationRef.current));
          const seq = sequenceRef.current;
          if (!seq.length) continue;

          const targetClip =
            seq.find(c => clippedTime >= c.sequenceStart && clippedTime < c.sequenceEnd) ||
            seq[seq.length - 1];
          if (!targetClip) continue;

          const unclampedLocalTime = targetClip.start + (clippedTime - targetClip.sequenceStart);
          const localTime = Math.max(targetClip.start, Math.min(unclampedLocalTime, targetClip.end));

          const src = targetClip.url;
          const currentSrc = vid.getAttribute('src');
          if (currentSrc !== src) {
            vid.setAttribute('src', src);
            try { vid.load(); } catch {}
          }

          await new Promise<void>((resolve) => {
            if (vid.readyState >= 1) return resolve();
            vid.addEventListener('loadedmetadata', () => resolve(), { once: true });
            vid.addEventListener('error', () => resolve(), { once: true });
          });
          if (workerToken !== timelinePreviewTokenRef.current) break;
          if (vid.readyState < 1) continue;

          await new Promise<void>((resolve) => {
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              resolve();
            };

            const timeoutId = window.setTimeout(finish, 50); // Reduced from 100ms to 50ms
            vid.addEventListener('seeked', () => {
              window.clearTimeout(timeoutId);
              finish();
            }, { once: true });

            try {
              const anyVid = vid as any;
              if (typeof anyVid.fastSeek === 'function') anyVid.fastSeek(localTime);
              else vid.currentTime = localTime;
            } catch {
              window.clearTimeout(timeoutId);
              finish();
            }
          });
          if (workerToken !== timelinePreviewTokenRef.current) break;

          const anyVid = vid as any;
          if (typeof anyVid.requestVideoFrameCallback === 'function') {
            await new Promise<void>((resolve) => {
              let done = false;
              const finish = () => {
                if (done) return;
                done = true;
                resolve();
              };

              const timeoutId = window.setTimeout(finish, 25); // Reduced from 50ms to 25ms
              anyVid.requestVideoFrameCallback(() => {
                window.clearTimeout(timeoutId);
                finish();
              });
            });
            if (workerToken !== timelinePreviewTokenRef.current) break;
          }

          ctx.clearRect(0, 0, canvasWidth, canvasHeight);
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);

          const vw = vid.videoWidth || canvasWidth;
          const vh = vid.videoHeight || canvasHeight;
          const currentFitMode = fitModeRef.current;

          let scale: number, drawW: number, drawH: number, dx: number, dy: number;

          if (currentFitMode === 'cover') {
            // Cover mode: fill entire canvas, may crop video
            scale = Math.max(canvasWidth / vw, canvasHeight / vh);
            drawW = vw * scale;
            drawH = vh * scale;
            dx = (canvasWidth - drawW) / 2;
            dy = (canvasHeight - drawH) / 2;
          } else {
            // Contain mode: fit video inside canvas, may have letterboxing
            scale = Math.min(canvasWidth / vw, canvasHeight / vh);
            drawW = vw * scale;
            drawH = vh * scale;
            dx = (canvasWidth - drawW) / 2;
            dy = (canvasHeight - drawH) / 2;
          }

          try {
            ctx.drawImage(vid, dx, dy, drawW, drawH);
          } catch {
            // ignore drawing failures
          }
        }
      } finally {
        timelinePreviewWorkerRunningRef.current = false;
      }
    })();
  }, [areControlsVisible, clamp, hasClips, sequenceRef]);

  const endPreview = useCallback(() => {
    if (!isPreviewingRef.current) return;
    isPreviewingRef.current = false;

    // Cancel pending RAF if exists
    if (previewRafRef.current !== null) {
      window.cancelAnimationFrame(previewRafRef.current);
      previewRafRef.current = null;
    }
    previewPendingTimeRef.current = null;

    const restore = previewRestoreRef.current;
    previewRestoreRef.current = null;

    if (!restore) return;
    if (!videoRef.current) return;

    // Restore the committed selection/video.
    const committed = sequence.find(c => c.id === activeClipIdRef.current);
    const src = committed?.url ?? restore.src;
    if (src) setVideoSrcAndTime(src, restore.localTime);
    setGlobalTimeDisplay(restore.globalTime);
  }, [sequence, setVideoSrcAndTime]);

  const previewAtGlobalTime = useCallback((time: number) => {
    if (!hasClips) return;
    if (isPlaying) return;
    const vid = videoRef.current;
    if (!vid) return;

    const seekTime = Math.max(0, Math.min(time, totalDurationRef.current));

    // Store pending time for RAF processing
    previewPendingTimeRef.current = seekTime;

    if (!isPreviewingRef.current) {
      isPreviewingRef.current = true;
      previewRestoreRef.current = {
        src: vid.getAttribute('src'),
        localTime: vid.currentTime,
        globalTime: globalTimeDisplay,
      };
    }

    // Update display immediately for instant visual feedback
    setGlobalTimeDisplay(seekTime);

    // Use RAF to throttle actual video seeking
    if (previewRafRef.current === null) {
      previewRafRef.current = window.requestAnimationFrame(() => {
        previewRafRef.current = null;
        const pendingTime = previewPendingTimeRef.current;
        if (pendingTime === null) return;

        const targetClip = sequence.find(c => pendingTime >= c.sequenceStart && pendingTime < c.sequenceEnd) || sequence[sequence.length - 1];
        if (!targetClip) return;

        const unclampedLocalTime = targetClip.start + (pendingTime - targetClip.sequenceStart);
        const localTime = Math.max(targetClip.start, Math.min(unclampedLocalTime, targetClip.end));

        // Use optimized seek method for faster response
        const currentSrc = vid.getAttribute('src');
        if (currentSrc !== targetClip.url) {
          vid.src = targetClip.url;
        }

        const applySeek = () => {
          try {
            const anyVid = vid as any;
            if (typeof anyVid.fastSeek === 'function') {
              anyVid.fastSeek(localTime);
            } else {
              vid.currentTime = localTime;
            }
          } catch {}
        };

        if (vid.readyState >= 1) {
          applySeek();
        } else {
          const onLoaded = () => {
            applySeek();
            vid.removeEventListener('loadedmetadata', onLoaded);
          };
          vid.addEventListener('loadedmetadata', onLoaded);
        }
      });
    }
  }, [hasClips, isPlaying, sequence, globalTimeDisplay]);

  const commitSeekToGlobalTime = useCallback((time: number) => {
    endPreview();
    seekRef.current(time);
  }, [endPreview]);

  const pause = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.pause();
  }, []);

  const play = useCallback(() => {
    const vid = videoRef.current;
    if (!vid || !activeClip) return;

    if (vid.currentTime >= activeClip.end) {
      vid.currentTime = activeClip.start;
    }
    void vid.play();
  }, [activeClip]);

  useImperativeHandle(ref, () => ({
    commitSeekToGlobalTime,
    previewAtGlobalTime,
    endPreview,
    play,
    pause,
    toggleMute,
    getIsPlaying: () => isPlayingRef.current,
  }), [commitSeekToGlobalTime, previewAtGlobalTime, endPreview, play, pause, toggleMute]);
  
  const seekRef = useRef(seekToGlobalTime);
  useEffect(() => { seekRef.current = seekToGlobalTime; });

  const handleTimelineMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    clearHideControlsTimer();
    setAreControlsVisible(true);
    setIsScrubbing(true);
    setTimelinePreview(prev => ({ ...prev, isVisible: true }));

    const calcTime = (clientX: number) => {
        if (!timelineRef.current) return 0;
        const rect = timelineRef.current.getBoundingClientRect();
        const x = clientX - rect.left;
        const pct = Math.max(0, Math.min(1, x / rect.width));
        return pct * totalDurationRef.current;
    };

    // Initial click seek
    seekRef.current(calcTime(e.clientX));
    updateTimelinePreviewFromClientX(e.clientX);

    const onMouseMove = (ev: MouseEvent) => {
        const t = calcTime(ev.clientX);
        seekRef.current(t);
        updateTimelinePreviewFromClientX(ev.clientX);
    };

    const onMouseUp = () => {
        setIsScrubbing(false);
        scheduleHideControls();
        if (!isTimelineHoveredRef.current) hideTimelinePreview();
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const togglePlay = () => {
    const vid = videoRef.current;
    if (!vid || !activeClip) return;

    if (isPlaying) {
      vid.pause();
    } else {
      if (vid.currentTime >= activeClip.end) {
          vid.currentTime = activeClip.start;
      }
      vid.play();
    }
    setIsPlaying(!isPlaying);
  };

  const onPlayPause = () => {
     if(videoRef.current) setIsPlaying(!videoRef.current.paused);
  }

  // --- Volume Logic ---
	  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
	    const newVol = parseFloat(e.target.value);
	    setVolume(newVol);
	    if (newVol > 0 && isMuted) {
	      setIsMuted(false);
	    }
	  };

  const currentRatioLabel = useMemo(() => {
    return ratios.find(r => r.value === aspectRatio)?.label ?? aspectRatio;
  }, [aspectRatio]);

	  return (
	    <div className="w-full h-full flex flex-col overflow-hidden font-sans">
	      <div 
	        className="flex-1 bg-transparent relative overflow-hidden flex items-start justify-center pt-4 px-6 pb-6"
	        ref={containerRef}
			      >
			        {(
		          <div className="flex flex-col items-center gap-2" style={{ width: wrapperStyle.width as any }}>
	            {/* Title Bar (outside video; matches video width; wraps when needed) */}
			            <div
			              ref={titleBarRef}
			              className="w-full rounded-2xl border border-[#9BA8AB]/45 bg-white/65 backdrop-blur-xl px-3 py-2 shadow-sm"
			            >
	              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
	                {/* DISPLAY (clickable, opens native select) */}
		                <div className="relative">
					                  <div className="flex items-center gap-2 bg-white/70 border border-[#9BA8AB]/45 rounded-lg px-3 h-8">
					                    <Settings size={16} className="text-[#4A5C6A]" />
					                    <span className="text-xs font-medium text-[#253745] whitespace-nowrap">{currentRatioLabel}</span>
					                    <ChevronDown size={12} className="text-[#4A5C6A]" />
					                  </div>
		                  <select
		                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
		                    value={aspectRatio}
		                    onChange={(e) => onAspectRatioChange(e.target.value)}
		                  >
	                    {ratios.map(r => (
	                      <option key={r.value} value={r.value}>{r.label}</option>
	                    ))}
	                  </select>
	                </div>

			                {/* Fit / Fill */}
			                <div className="ml-auto flex items-center">
					                  <div className="flex bg-white/65 rounded-lg p-1 border border-[#9BA8AB]/45 h-8">
				                    <button
				                      onClick={() => onFitModeChange('contain')}
				                      className={`flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold rounded-md transition-all ${
				                        fitMode === 'contain'
				                          ? 'bg-brand-500 text-[#CCD0CF] shadow-sm'
				                          : 'text-[#4A5C6A] hover:text-[#253745] hover:bg-[#CCD0CF]/60'
				                      }`}
			                    >
	                      <Maximize size={10} className={fitMode === 'contain' ? 'opacity-100' : 'opacity-50'} />
	                      Fit
	                    </button>
				                    <button
				                      onClick={() => onFitModeChange('cover')}
				                      className={`flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold rounded-md transition-all ${
				                        fitMode === 'cover'
				                          ? 'bg-brand-500 text-[#CCD0CF] shadow-sm'
				                          : 'text-[#4A5C6A] hover:text-[#253745] hover:bg-[#CCD0CF]/60'
				                      }`}
			                    >
	                      <Monitor size={10} className={fitMode === 'cover' ? 'opacity-100' : 'opacity-50'} />
	                      Fill
	                    </button>
	                  </div>
	                </div>
	              </div>
	            </div>

			            {/* Video */}
				            <div
				              ref={fullscreenContainerRef}
					              className={`relative w-full flex items-center justify-center ${isFullscreen ? 'bg-black' : ''}`}
				            >
						              <div
							                className={`relative flex flex-col justify-center overflow-hidden transition-all duration-300 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/20 ${
							                  isFullscreen ? 'border-0 shadow-none' : 'border border-[#9BA8AB]/45'
							                } ${isFullscreen ? 'rounded-none' : 'rounded-2xl'} ${
							                  hasClips
							                    ? (isFullscreen ? 'bg-black' : 'bg-white/10 backdrop-blur-2xl')
							                    : 'bg-transparent'
							                }`}
						                ref={videoWrapperRef}
						                data-spacebar-play="true"
						                tabIndex={0}
						                style={isFullscreen ? fullscreenFrameStyle : wrapperStyle}
					              onPointerMove={() => {
					                isPointerOverPlayerRef.current = true;
					                setAreControlsVisible(true);
					                scheduleHideControls();
				              }}
	              onPointerEnter={() => {
	                isPointerOverPlayerRef.current = true;
	                setAreControlsVisible(true);
	                scheduleHideControls();
	              }}
	              onPointerDown={() => {
	                isPointerOverPlayerRef.current = true;
	                setAreControlsVisible(true);
	                scheduleHideControls();
	              }}
		              onPointerLeave={() => {
		                isPointerOverPlayerRef.current = false;
		                clearHideControlsTimer();
		                if (!isScrubbingRef.current) setAreControlsVisible(false);
		              }}
			            >
                {hasClips ? (
			                <video
			                  ref={videoRef}
			                  className="w-full h-full block"
		                  style={{ objectFit: isFullscreen ? 'contain' : fitMode }}
		                  onTimeUpdate={handleTimeUpdate}
		                  onPlay={onPlayPause}
		                  onPause={onPlayPause}
		                  onClick={togglePlay}
	                  playsInline
	                />
                ) : (
	                  <div className="w-full h-full flex items-center justify-center">
			                    <div className="w-full max-w-md aspect-video border-2 border-transparent rounded-2xl flex items-center justify-center pointer-events-none transition-all group">
			                      <div
			                        onClick={onAddVideo}
			                        className="w-16 h-16 rounded-full bg-white/70 flex items-center justify-center group-hover:scale-110 group-hover:bg-white/85 transition-all shadow-sm border border-[#9BA8AB]/45 cursor-pointer pointer-events-auto"
			                      >
			                        <Plus size={24} className="text-brand-500 transition-colors" />
			                      </div>
			                    </div>
	                  </div>
                )}

					              {/* Mute Notification */}
					              {muteNotificationVisible && (
					                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40 animate-in fade-in duration-200">
					                  <div className="bg-transparent rounded-2xl px-6 py-4 flex items-center gap-3">
					                    {isMuted ? (
					                      <VolumeX size={32} className="text-white" />
					                    ) : (
					                      <Volume2 size={32} className="text-white" />
					                    )}
					                  </div>
					                </div>
					              )}

					              {/* Bottom Controls (YouTube-like overlay; auto-hide on inactivity) */}
				              {hasClips && (
								                <div className="absolute bottom-0 left-0 right-0 h-1/3 pointer-events-none z-30">
									                  <div
										                    className={`pointer-events-none h-full px-4 pb-3 transition-opacity duration-200 flex flex-col justify-end ${
										                      areControlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
										                    }`}
									                  >
			                  {/* Scrubber with Extended Hover Area (YouTube-style) */}
				                  <div
				                    ref={timelineRef}
				                    className={`h-1.5 w-full bg-[#CCD0CF]/20 cursor-pointer relative group rounded-full ${
				                      areControlsVisible ? 'pointer-events-auto' : 'pointer-events-none'
				                    }`}
				                    onMouseDown={handleTimelineMouseDown}
				                  >
				                    {/* Invisible Extended Hover Area Above Timeline (YouTube-style) - Only covers gap, not thumbnail */}
				                    <div
				                      className="absolute bottom-0 left-0 right-0 h-[24px] -translate-y-0 pointer-events-auto"
				                      onPointerEnter={(e) => {
				                        isTimelineHoveredRef.current = true;
				                        updateTimelinePreviewFromClientX(e.clientX);
				                      }}
				                      onPointerMove={(e) => {
				                        isTimelineHoveredRef.current = true;
				                        updateTimelinePreviewFromClientX(e.clientX);
				                      }}
				                      onPointerLeave={() => {
				                        isTimelineHoveredRef.current = false;
				                        if (!isScrubbingRef.current) hideTimelinePreview();
				                      }}
				                    />
					                    {timelinePreview.isVisible && areControlsVisible && (
					                      <div
					                        className="absolute pointer-events-none"
					                        style={{
					                          left: timelinePreview.leftPx,
					                          transform: 'translateX(-50%)',
					                          bottom: '100%',
					                          marginBottom: '14px'
					                        }}
					                      >
					                        <div
					                          className="rounded-lg overflow-hidden border border-white/20 bg-black/70 shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
					                          style={{
					                            width: `${timelinePreview.width}px`,
					                            height: `${timelinePreview.height}px`
					                          }}
					                        >
					                          <canvas
					                            ref={timelinePreviewCanvasRef}
					                            width={timelinePreview.width * 2}
					                            height={timelinePreview.height * 2}
					                            className="w-full h-full block"
					                          />
					                        </div>
					                        <div className="mt-2 flex justify-center">
					                          <div className="px-3 py-1 rounded-full bg-black/55 text-white/90 text-[11px] font-mono [filter:drop-shadow(0_8px_22px_rgba(0,0,0,0.65))]">
					                            {formatDurationDisplay(timelinePreview.time)}
					                          </div>
					                        </div>
					                      </div>
					                    )}
		                    <div
		                      className="absolute top-0 bottom-0 left-0 bg-[#ff0000] rounded-full"
		                      style={{
		                        width: `${(globalTimeDisplay / Math.max(totalDuration, 0.001)) * 100}%`,
	                        transition: isScrubbing || isPlaying ? 'none' : 'width 200ms linear',
	                      }}
	                    />
		                    <div
		                      className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-[#CCD0CF] rounded-full shadow opacity-0 group-hover:opacity-100 pointer-events-none"
		                      style={{
	                        left: `${(globalTimeDisplay / Math.max(totalDuration, 0.001)) * 100}%`,
	                        transform: 'translate(-50%, -50%)',
	                        transition: isScrubbing || isPlaying ? 'none' : 'left 200ms linear, opacity 150ms ease',
	                      }}
	                    />
		                  </div>

			                  {/* Controls Row */}
						                  <div className={`mt-2 flex items-center justify-between gap-4 ${
						                    areControlsVisible ? 'pointer-events-auto' : 'pointer-events-none'
						                  }`}>
					                    <div className="flex items-center gap-4 min-w-0">
				                      <button
				                        onClick={togglePlay}
				                        className="w-9 h-9 flex items-center justify-center rounded-full text-white/90 [filter:drop-shadow(0_8px_22px_rgba(0,0,0,0.6))] hover:text-white active:scale-95 transition-transform"
				                      >
			                        {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
			                      </button>

	                      <div className="flex items-center group/vol">
			                        <button
			                          onClick={toggleMute}
			                          className="w-9 h-9 flex items-center justify-center rounded-full text-white/90 [filter:drop-shadow(0_8px_22px_rgba(0,0,0,0.6))] hover:text-white active:scale-95 transition-transform"
			                        >
			                          {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
		                        </button>
		                        <div className="w-0 ml-0 opacity-0 pointer-events-none group-hover/vol:w-24 group-hover/vol:ml-3 group-hover/vol:opacity-100 group-hover/vol:pointer-events-auto group-focus-within/vol:w-24 group-focus-within/vol:ml-3 group-focus-within/vol:opacity-100 group-focus-within/vol:pointer-events-auto h-1 bg-[#CCD0CF]/20 rounded-full relative overflow-hidden cursor-pointer group-hover/vol:bg-[#CCD0CF]/25 transition-all duration-200">
	                          <input
	                            type="range"
	                            min={0}
	                            max={1}
	                            step={0.01}
                            value={isMuted ? 0 : volume}
                            onChange={handleVolumeChange}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                          />
	                          <div
	                            className="absolute top-0 bottom-0 left-0 bg-[#CCD0CF]/80 rounded-full"
	                            style={{ width: `${(isMuted ? 0 : volume) * 100}%` }}
	                          />
                        </div>
                      </div>

				                      <div className="font-mono text-xs text-white/90 tracking-wide select-none [filter:drop-shadow(0_8px_22px_rgba(0,0,0,0.7))] px-2 py-1 rounded">
				                        <span className="text-white/90">{formatDurationDisplay(globalTimeDisplay)}</span>
				                      </div>
		                    </div>

				                    <div className="flex items-center gap-2 shrink-0">
						                      <div className="text-[10px] font-bold text-white/90 [filter:drop-shadow(0_8px_22px_rgba(0,0,0,0.7))] px-2 py-1 rounded select-none">
						                        {projectFps} FPS
						                      </div>
						                      <button
						                        onClick={toggleFullscreen}
						                        className="w-9 h-9 flex items-center justify-center rounded-full text-white/90 [filter:drop-shadow(0_8px_22px_rgba(0,0,0,0.6))] hover:text-white active:scale-95 transition-transform"
						                        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
						                        title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
						                      >
				                        {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
			                      </button>
			                    </div>
		                </div>
		                  </div>
		                </div>
		              )}
	              
	              {/* Centered Big Play Button (when paused) */}
				              {hasClips && !isPlaying && (
				                <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
					                  <button 
					                    onClick={togglePlay}
				                    className="pointer-events-auto w-16 h-16 rounded-full flex items-center justify-center text-white/90 [filter:drop-shadow(0_18px_50px_rgba(0,0,0,0.6))] hover:text-white hover:scale-110 active:scale-95 transition-transform duration-300 group"
				                  >
			                    <Play size={32} fill="currentColor" className="ml-1 opacity-90 group-hover:opacity-100" />
			                  </button>
		                </div>
			              )}
			              <video ref={timelinePreviewVideoRef} className="hidden" muted playsInline preload="auto" />
					          </div>
				        </div>
				      </div>
			        )}
		      </div>
	    </div>
	  );
});

Player.displayName = 'Player';
