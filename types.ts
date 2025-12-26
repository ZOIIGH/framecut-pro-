export interface Clip {
  id: string;
  file: File;
  url: string;
  name: string;
  originalDuration: number; // in seconds
  start: number; // in seconds
  end: number; // in seconds
  fps: number;
  isSelected: boolean;
}

export interface TimeCode {
  seconds: number;
  frames: number;
}
