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
	  const timelineRef = useRef<HTMLDivElement>(null);
	  const containerRef = useRef<HTMLDivElement>(null);
	  const titleBarRef = useRef<HTMLDivElement>(null);
	  const fullscreenContainerRef = useRef<HTMLDivElement>(null);
	  const videoWrapperRef = useRef<HTMLDivElement>(null);
	  const hideControlsTimer = useRef<number | null>(null);
  const isPreviewingRef = useRef(false);
  const previewRestoreRef = useRef<{ src: string | null; localTime: number; globalTime: number } | null>(null);
  const activeClipIdRef = useRef(activeClipId);
  
	  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [areControlsVisible, setAreControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Audio State
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  
	  // Container Dimensions for Adaptive Sizing
	  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });
	  const [titleBarHeight, setTitleBarHeight] = useState(0);
	  const [fullscreenViewport, setFullscreenViewport] = useState({ width: 0, height: 0 });
	  const isPlayingRef = useRef(false);

	  useEffect(() => { activeClipIdRef.current = activeClipId; }, [activeClipId]);
	  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

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

  const scheduleHideControls = useCallback((delayMs = 5000) => {
    clearHideControlsTimer();
    if (!isPlaying || isScrubbing) return;
    hideControlsTimer.current = window.setTimeout(() => {
      setAreControlsVisible(false);
    }, delayMs);
  }, [clearHideControlsTimer, isPlaying, isScrubbing]);

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
      try { vid.currentTime = time; } catch {}
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
    if (!isPlaying) {
      clearHideControlsTimer();
      setAreControlsVisible(true);
      return;
    }
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

  const endPreview = useCallback(() => {
    if (!isPreviewingRef.current) return;
    isPreviewingRef.current = false;
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
    const targetClip = sequence.find(c => seekTime >= c.sequenceStart && seekTime < c.sequenceEnd) || sequence[sequence.length - 1];
    if (!targetClip) return;

    const unclampedLocalTime = targetClip.start + (seekTime - targetClip.sequenceStart);
    const localTime = Math.max(targetClip.start, Math.min(unclampedLocalTime, targetClip.end));

    if (!isPreviewingRef.current) {
      isPreviewingRef.current = true;
      previewRestoreRef.current = {
        src: vid.getAttribute('src'),
        localTime: vid.currentTime,
        globalTime: globalTimeDisplay,
      };
    }

    setGlobalTimeDisplay(seekTime);
    setVideoSrcAndTime(targetClip.url, localTime);
  }, [hasClips, isPlaying, sequence, globalTimeDisplay, setVideoSrcAndTime]);

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
    getIsPlaying: () => isPlayingRef.current,
  }), [commitSeekToGlobalTime, previewAtGlobalTime, endPreview, play, pause]);
  
  const seekRef = useRef(seekToGlobalTime);
  useEffect(() => { seekRef.current = seekToGlobalTime; });

  const handleTimelineMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    clearHideControlsTimer();
    setAreControlsVisible(true);
    setIsScrubbing(true);

    const calcTime = (clientX: number) => {
        if (!timelineRef.current) return 0;
        const rect = timelineRef.current.getBoundingClientRect();
        const x = clientX - rect.left;
        const pct = Math.max(0, Math.min(1, x / rect.width));
        return pct * totalDurationRef.current;
    };

    // Initial click seek
    seekRef.current(calcTime(e.clientX));

    const onMouseMove = (ev: MouseEvent) => {
        const t = calcTime(ev.clientX);
        seekRef.current(t);
    };

    const onMouseUp = () => {
        setIsScrubbing(false);
        scheduleHideControls();
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

  const toggleMute = () => {
    if (isMuted || volume === 0) {
      setIsMuted(false);
      if (volume === 0) setVolume(1);
    } else {
      setIsMuted(true);
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
						                } ${isFullscreen ? 'rounded-none' : 'rounded-2xl'} ${hasClips ? 'bg-black' : 'bg-transparent'}`}
						                ref={videoWrapperRef}
						                data-spacebar-play="true"
						                tabIndex={0}
						                style={isFullscreen ? fullscreenFrameStyle : wrapperStyle}
					              onPointerMove={() => {
					                setAreControlsVisible(true);
					                scheduleHideControls();
				              }}
	              onPointerEnter={() => {
	                setAreControlsVisible(true);
	                scheduleHideControls();
	              }}
	              onPointerDown={() => {
	                setAreControlsVisible(true);
	                scheduleHideControls();
	              }}
		              onPointerLeave={() => {
		                clearHideControlsTimer();
		                if (isPlaying) setAreControlsVisible(false);
		              }}
			            >
			              {!hasClips && (
				                <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/35 via-black/15 to-transparent pointer-events-none" />
			              )}
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
	                  <div 
	                    onClick={onAddVideo}
	                    className="w-full h-full flex items-center justify-center"
	                  >
			                    <div className="w-full max-w-md aspect-video border-2 border-dashed border-[#9BA8AB]/55 rounded-2xl flex items-center justify-center cursor-pointer hover:border-brand-500/35 hover:bg-white/35 transition-all group bg-white/35 backdrop-blur-xl">
			                      <div className="w-16 h-16 rounded-full bg-white/70 flex items-center justify-center group-hover:scale-110 group-hover:bg-white/85 transition-all shadow-sm border border-[#9BA8AB]/45">
			                        <Plus size={24} className="text-brand-500 transition-colors" />
			                      </div>
			                    </div>
	                  </div>
                )}

		              {/* Bottom Controls (YouTube-like overlay; auto-hide on inactivity) */}
			              {hasClips && (
		                <div className="absolute bottom-0 left-0 right-0 h-1/3 pointer-events-none z-30">
					                  <div
						                    className={`pointer-events-auto h-full px-4 pb-3 bg-gradient-to-t from-black/80 via-black/30 to-transparent transition-opacity duration-200 flex flex-col justify-end ${
						                      areControlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
						                    }`}
						                  >
	                  {/* Scrubber */}
		                  <div
		                    ref={timelineRef}
		                    className="h-1.5 w-full bg-[#CCD0CF]/20 cursor-pointer relative group rounded-full"
		                    onMouseDown={handleTimelineMouseDown}
		                  >
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
                  <div className="mt-2 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
	                      <button
	                        onClick={togglePlay}
	                        className="w-9 h-9 flex items-center justify-center rounded-full text-[#CCD0CF] hover:bg-[#CCD0CF]/10 transition-colors"
	                      >
                        {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                      </button>

                      <div className="flex items-center gap-3 group/vol">
	                        <button
	                          onClick={toggleMute}
	                          className="text-[#CCD0CF] hover:text-[#CCD0CF] transition-colors"
	                        >
                          {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                        </button>
	                        <div className="w-24 h-1 bg-[#CCD0CF]/20 rounded-full relative overflow-hidden cursor-pointer group-hover/vol:bg-[#CCD0CF]/25">
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

		                      <div className="font-mono text-xs text-[#CCD0CF] tracking-wide select-none bg-black/35 px-2 py-1 rounded border border-white/15">
		                        <span className="text-[#CCD0CF]">{formatDurationDisplay(globalTimeDisplay)}</span>
		                      </div>
	                    </div>

			                    <div className="flex items-center gap-2 shrink-0">
				                      <div className="text-[10px] font-bold text-[#CCD0CF] bg-black/35 border border-white/15 px-2 py-1 rounded select-none">
				                        {projectFps} FPS
				                      </div>
				                      <button
				                        onClick={toggleFullscreen}
				                        className="w-9 h-9 flex items-center justify-center rounded-full text-[#CCD0CF] hover:text-[#CCD0CF] hover:bg-[#CCD0CF]/10 transition-colors"
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
			                <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/25 backdrop-blur-[1px]">
			                  <button 
			                    onClick={togglePlay}
		                    className="w-16 h-16 bg-black/30 backdrop-blur-md rounded-full flex items-center justify-center text-[#CCD0CF] border border-white/15 hover:bg-black/40 hover:scale-110 transition-all duration-300 group shadow-2xl"
		                  >
	                    <Play size={32} fill="currentColor" className="ml-1 opacity-90 group-hover:opacity-100" />
	                  </button>
	                </div>
		              )}
			          </div>
			        </div>
			      </div>
		        )}
		      </div>
	    </div>
	  );
});

Player.displayName = 'Player';
