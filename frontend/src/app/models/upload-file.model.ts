export interface UploadFileModel {
  file: File;
  status: 'pending' | 'uploading' | 'done' | 'error';
  progress: number;
  responseData?: any;
  objectUrl?: string; // used for audio preview
}

export interface FileModel {
  id: string; /** duplicate of id for legacy code; keep as string */
  fileId: string;
  filename: string;
  filepath: string;
  uploadTime: number;
  mimetype?: string;
}
