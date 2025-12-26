import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Clip } from '../types';
import { formatDurationDisplay } from '../utils';
import { 
	  GripVertical, 
	  Trash2, 
	  RotateCcw, 
	  Scissors, 
	  Film
	} from './Icons';

interface ClipItemProps {
  clip: Clip;
  sequenceStart: number;
  sequenceEnd: number;
  index: number;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdateClip: (id: string, updates: Partial<Clip>) => void;
  currentPlaybackTime?: number;
  onDragStart: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
  onDragEnter: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
  onDragEnd: (e: React.DragEvent<HTMLDivElement>) => void;
  dropIndicator?: 'top' | 'bottom' | null;
  hoverPreviewEnabled?: boolean;
  onHoverPreview?: (globalTime: number) => void;
  onHoverPreviewEnd?: () => void;
  onSeekGlobalTime?: (globalTime: number) => void;
}

export const ClipItem: React.FC<ClipItemProps> = React.memo(({ 
  clip, 
  sequenceStart,
  sequenceEnd,
  index,
  onSelect, 
  onDelete, 
  onUpdateClip,
  currentPlaybackTime,
  onDragStart,
  onDragEnter,
  onDragEnd,
  dropIndicator,
  hoverPreviewEnabled = false,
  onHoverPreview,
  onHoverPreviewEnd,
  onSeekGlobalTime
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [trimFrames, setTrimFrames] = useState(18);

  const isInteractingRef = useRef(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(clip.start);
  const endRef = useRef(clip.end);
  const durationRef = useRef(clip.originalDuration);
  const rafRef = useRef<number | null>(null);
  const pendingUpdateRef = useRef<Partial<Clip> | null>(null);

  useEffect(() => { startRef.current = clip.start; }, [clip.start]);
  useEffect(() => { endRef.current = clip.end; }, [clip.end]);
  useEffect(() => { durationRef.current = clip.originalDuration; }, [clip.originalDuration]);

  const fps = useMemo(() => {
    return Number.isFinite(clip.fps) && clip.fps > 0 ? clip.fps : 60;
  }, [clip.fps]);
  const minDuration = useMemo(() => Math.max(0.1, 1 / fps), [fps]);
  
  const handleTrimEnd = (e: React.MouseEvent) => {
    e.stopPropagation();
    const frames = Math.max(1, Math.round(trimFrames || 0));
    const trimAmount = frames / fps;
    const newEnd = Math.max(clip.start + minDuration, clip.end - trimAmount);
    onUpdateClip(clip.id, { end: newEnd });
  };

  const handleReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdateClip(clip.id, { start: 0, end: clip.originalDuration });
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    if (isInteractingRef.current) {
      e.preventDefault();
      return;
    }
    setIsDragging(true);
    onDragStart(e, index);
  };

  const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
    setIsDragging(false);
    onDragEnd(e);
  };

  const currentDuration = clip.end - clip.start;
  const isPlaying = currentPlaybackTime !== undefined;

  // Calculate percentage for playhead position
  const playheadPosition = isPlaying && clip.originalDuration > 0
    ? (currentPlaybackTime / clip.originalDuration) * 100
    : 0;

  const startPct = clip.originalDuration > 0 ? (clip.start / clip.originalDuration) * 100 : 0;
  const endPct = clip.originalDuration > 0 ? (clip.end / clip.originalDuration) * 100 : 0;

  const scheduleUpdate = (updates: Partial<Clip>) => {
    pendingUpdateRef.current = updates;
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      const pending = pendingUpdateRef.current;
      pendingUpdateRef.current = null;
      rafRef.current = null;
      if (pending) onUpdateClip(clip.id, pending);
    });
  };

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

  const getTimeFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const pct = rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0;
    return pct * (durationRef.current || 0);
  };

  const toGlobalTimeFromLocal = (localTime: number) => {
    const clampedLocal = clamp(localTime, clip.start, clip.end);
    return sequenceStart + (clampedLocal - clip.start);
  };

  const handleTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!hoverPreviewEnabled || !onHoverPreview) return;
    if (isInteractingRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, select, textarea, a, [role="slider"]')) return;
    const localTime = getTimeFromClientX(e.clientX);
    onHoverPreview(toGlobalTimeFromLocal(localTime));
  };

  const handleTrackPointerLeave = () => {
    if (!hoverPreviewEnabled || !onHoverPreviewEnd) return;
    if (isInteractingRef.current) return;
    onHoverPreviewEnd();
  };

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeekGlobalTime) return;
    if (isInteractingRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, select, textarea, a, [role="slider"]')) return;
    const localTime = getTimeFromClientX(e.clientX);
    onSeekGlobalTime(toGlobalTimeFromLocal(localTime));
  };

  const beginTrim = (edge: 'start' | 'end') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isInteractingRef.current = true;

    const onMove = (ev: PointerEvent) => {
      const t = getTimeFromClientX(ev.clientX);
      const curStart = startRef.current;
      const curEnd = endRef.current;
      const dur = durationRef.current || 0;
      if (dur <= 0) return;

      if (edge === 'start') {
        const nextStart = clamp(t, 0, curEnd - minDuration);
        scheduleUpdate({ start: nextStart });
      } else {
        const nextEnd = clamp(t, curStart + minDuration, dur);
        scheduleUpdate({ end: nextEnd });
      }
    };

    const onUp = () => {
      isInteractingRef.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  return (
	    <div 
	      draggable
	      tabIndex={0}
	      data-spacebar-play="true"
	      onDragStart={handleDragStart}
	      onDragEnter={(e) => onDragEnter(e, index)}
	      onDragEnd={handleDragEnd}
      onDragOver={(e) => e.preventDefault()}
	      className={`
	        relative group rounded-xl p-3 mb-3 border transition-all cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/20
	        ${isDragging ? 'opacity-60 scale-[0.99] border-dashed border-[#9BA8AB]/55 bg-white/40' : ''}
	        ${clip.isSelected 
	          ? 'bg-white/75 border-brand-500/25 backdrop-blur-xl shadow-[0_0_0_1px_rgba(37,55,69,0.12),0_18px_40px_rgba(37,55,69,0.10)]' 
	          : 'bg-white/60 backdrop-blur-xl border-[#9BA8AB]/45 hover:border-brand-500/25 hover:bg-white/75'
	        }
	      `}
      onClick={() => onSelect(clip.id)}
    >
      {/* Drop Indicators */}
      {dropIndicator === 'top' && (
        <div className="absolute top-[-6px] left-0 right-0 h-1 bg-[#9BA8AB] rounded-full shadow-[0_0_10px_rgba(155,168,171,0.35)] z-50 pointer-events-none" />
      )}
      {dropIndicator === 'bottom' && (
        <div className="absolute bottom-[-6px] left-0 right-0 h-1 bg-[#9BA8AB] rounded-full shadow-[0_0_10px_rgba(155,168,171,0.35)] z-50 pointer-events-none" />
      )}

	      {/* Header Row */}
		      <div className="flex items-center justify-between mb-2 text-xs text-[#4A5C6A]">
		        <div className="flex items-center gap-2 overflow-hidden min-w-0">
		          <GripVertical size={14} className="text-[#4A5C6A] cursor-grab active:cursor-grabbing shrink-0" />
		          <span className="font-medium text-[#253745] truncate" title={clip.name}>
		            {clip.name}
		          </span>
		        </div>
			        <div className="flex items-center gap-2 shrink-0">
				          <button 
				            onClick={(e) => { e.stopPropagation(); onDelete(clip.id); }}
				            className="text-[#4A5C6A] hover:text-[#253745] transition-colors p-1"
				            aria-label="Delete clip"
			          >
		            <Trash2 size={14} />
		          </button>
	        </div>
	      </div>

	      {/* Timeline Visuals */}
	      <div className="space-y-1 mb-3">
	        {/* Video Track */}
		        <div
		          ref={trackRef}
		          className="h-6 bg-white/70 rounded border border-[#9BA8AB]/45 relative overflow-hidden flex items-center px-2"
		          onPointerMove={handleTrackPointerMove}
		          onPointerLeave={handleTrackPointerLeave}
		          onClick={handleTrackClick}
		        >
		          <Film size={12} className="text-[#4A5C6A] mr-2 z-10" />
	          {/* Active Region */}
	          <div 
	            className="absolute top-0 bottom-0 bg-brand-500/10 border-l border-r border-brand-500/30"
            style={{
              left: `${(clip.start / clip.originalDuration) * 100}%`,
              width: `${((clip.end - clip.start) / clip.originalDuration) * 100}%`
	            }}
	          />
	          {/* Trim Handles */}
	          {clip.originalDuration > 0 && (
	            <>
	              <div
	                onPointerDown={beginTrim('start')}
	                className="absolute top-0 bottom-0 w-4 -translate-x-1/2 cursor-ew-resize z-30 opacity-0 group-hover:opacity-100 transition-opacity"
	                style={{ left: `${startPct}%` }}
	                aria-label="Trim start"
	                role="slider"
		              >
		                <div className="absolute top-0 bottom-0 left-1.5 w-1 bg-[#9BA8AB]/70 rounded-sm shadow-sm" />
		              </div>
	              <div
	                onPointerDown={beginTrim('end')}
	                className="absolute top-0 bottom-0 w-4 -translate-x-1/2 cursor-ew-resize z-30 opacity-0 group-hover:opacity-100 transition-opacity"
	                style={{ left: `${endPct}%` }}
	                aria-label="Trim end"
	                role="slider"
		              >
		                <div className="absolute top-0 bottom-0 left-1.5 w-1 bg-[#9BA8AB]/70 rounded-sm shadow-sm" />
		              </div>
	            </>
	          )}
	          {/* Playhead Indicator */}
	          {isPlaying && (
	            <div
	              className="absolute top-0 bottom-0 w-0.5 bg-[#ff0000] shadow-[0_0_8px_rgba(255,0,0,0.8)] z-20 transition-[left] duration-75 ease-linear"
	              style={{ left: `${playheadPosition}%` }}
	            />
	          )}
	        </div>
	      </div>

	      {/* Controls Row */}
			      <div className="flex items-center justify-between gap-2">
			        <div className="flex gap-2">
			          {/* Start/End Time Inputs (Simulated display) */}
			          <div className="flex flex-col">
			            <span className="text-[10px] text-[#4A5C6A] uppercase font-bold tracking-wider">Start</span>
			            <div className="text-xs font-mono text-[#253745] bg-white/70 px-1.5 py-1 rounded border border-[#9BA8AB]/45">
			              {formatDurationDisplay(sequenceStart)}
			            </div>
			          </div>
			          <div className="text-[#4A5C6A] self-end mb-2">→</div>
			          <div className="flex flex-col">
			            <span className="text-[10px] text-[#4A5C6A] uppercase font-bold tracking-wider">End</span>
			            <div className="text-xs font-mono text-[#253745] bg-white/70 px-1.5 py-1 rounded border border-[#9BA8AB]/45">
			              {formatDurationDisplay(sequenceEnd)}
			            </div>
			          </div>
			        </div>

			        <div className="flex flex-col items-end">
			           <div className="bg-[#CCD0CF]/80 px-2 py-0.5 rounded text-[10px] text-[#253745] border border-[#9BA8AB]/45 mb-2">
			             Dur: <span className="font-mono text-[#253745]">{formatDurationDisplay(currentDuration)}</span>
			           </div>
			        </div>
			      </div>

	      {/* Action Buttons */}
		      <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#9BA8AB]/45">
		        <button 
		          onClick={handleReset}
		          className="text-xs text-[#4A5C6A] hover:text-[#253745] flex items-center gap-1 transition-colors"
		        >
		          <RotateCcw size={12} /> Reset
		        </button>

	        <div className="flex items-center gap-2">
		          <div className="flex items-center h-8 px-2 rounded-lg border border-[#9BA8AB]/45 bg-white/65">
		            <input
		              type="number"
		              min={1}
		              step={1}
		              value={trimFrames}
		              onChange={(e) => setTrimFrames(Math.max(1, Number(e.target.value) || 1))}
		              onClick={(e) => e.stopPropagation()}
		              data-no-spin="true"
		              className="w-[2.6ch] bg-transparent text-right text-xs font-mono text-[#253745] outline-none"
		              aria-label="Trim frames"
		            />
		            <span className="ml-1 text-[10px] text-[#4A5C6A] font-mono select-none">f</span>
		          </div>
		          <button 
		            onClick={handleTrimEnd}
		            className="bg-brand-500 hover:bg-brand-500/90 text-[#CCD0CF] text-xs font-medium py-1.5 px-3 rounded flex items-center gap-1.5 shadow-sm transition-all active:scale-95 h-8 border border-brand-500/35"
		          >
	            <Scissors size={12} />
	            Trim End
	          </button>
	        </div>
	      </div>
    </div>
  );
});
