/**
 * Formats seconds into SS:FF (Seconds:Frames) where base is 60 frames/sec
 * Example: 0.3s -> 00.18
 */
export const formatTimecode = (totalSeconds: number): string => {
  const seconds = Math.floor(totalSeconds);
  // Get the fractional part and convert to frames (base 60)
  const fractional = totalSeconds - seconds;
  const frames = Math.round(fractional * 60);

  const sStr = seconds.toString().padStart(2, '0');
  const fStr = frames.toString().padStart(2, '0');

  return `${sStr}:${fStr}`;
};

/**
 * Formats seconds into MM:SS.FF (standard display style in UI)
 */
export const formatDurationDisplay = (totalSeconds: number): string => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const fractional = totalSeconds - Math.floor(totalSeconds);
  const frames = Math.round(fractional * 60);

  const mStr = minutes.toString().padStart(2, '0');
  const sStr = seconds.toString().padStart(2, '0');
  const fStr = frames.toString().padStart(2, '0');

  return `${mStr}:${sStr}.${fStr}`;
};

export const generateId = (): string => {
  return Math.random().toString(36).substring(2, 9);
};
