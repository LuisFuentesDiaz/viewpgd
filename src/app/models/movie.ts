export interface Movie {
  id: string;
  title: string;
  originalName: string;
  year: number;
  poster?: string;
  quality: string;
  videoUrl: string;
  downloadUrl?: string;
  downloadUrls?: string[];
  uploadDate?: string;
  fileSize?: string;
}
