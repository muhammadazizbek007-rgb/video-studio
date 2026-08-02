export type VideoGenerationStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type VideoGenerationMode = 'text_to_video' | 'image_to_video' | 'reference_to_video';

export type VideoAspectRatio = '16:9' | '9:16' | '1:1';

export type VideoDuration = 4 | 5 | 6 | 7 | 8;

export type VideoStylePreset =
  | 'Cinematic'
  | 'UGC'
  | 'App Promo'
  | 'Product Demo'
  | 'Character Story'
  | 'Social Ad';

export type CameraMotion = 'Static' | 'Zoom in' | 'Dolly in' | 'Handheld' | 'Orbit' | 'Pan';

export type VideoElementCategory = 'general' | 'character' | 'location' | 'prop';
