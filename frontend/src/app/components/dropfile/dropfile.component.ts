import { Component, Input, Output, EventEmitter } from '@angular/core';
import { UploadFileModel } from 'src/app/models/upload-file.model';
import { FileuploadService } from 'src/app/services/fileupload.service';
import { SnackbarService } from 'src/app/services/snackbar.service';

@Component({
  selector: 'app-dropfile',
  templateUrl: './dropfile.component.html',
  styleUrls: ['./dropfile.component.scss'],
})
export class DropfileComponent {
  @Input() isTitle: boolean = true;
  @Input() isOverlay: boolean = false;
  @Input() acceptedTypes: string = '';
  @Output() filesUploaded = new EventEmitter<any[]>(); // adjust type if you have a FileModel
  /** ✅ New: limit total files that can be selected/uploaded in this session */
  @Input() maxFiles: number = Infinity;

  uploadQueue: UploadFileModel[] = [];
  isUploading = false;

  constructor(
    private snackbarService: SnackbarService,
    private fileuploadService: FileuploadService,
  ) {
  }

  /** Remaining slots before hitting maxFiles */
  get remainingSlots(): number {
    if (!isFinite(this.maxFiles)) return Number.POSITIVE_INFINITY;
    const used = this.uploadQueue.length;
    return Math.max(0, this.maxFiles - used);
  }

  /** Helper to use in template (optional) */
  isFinite(v: number): boolean {
    return Number.isFinite(v);
  }

  onSelect(event: any) {
    const newFiles: File[] = event.addedFiles;

    if (this.remainingSlots <= 0) {
      this.snackbarService.openSnackBar('لقد وصلت إلى الحد الأعلى للملفات المسموح بها.', 'failure');
      return;
    }

    // Accept audio/video only (your rule)
    const validFiles = newFiles.filter(file =>
      file.type.startsWith('audio/') || file.type.startsWith('video/')
    );
    const invalidFiles = newFiles.filter(file =>
      !file.type.startsWith('audio/') && !file.type.startsWith('video/')
    );

    if (invalidFiles.length > 0) {
      this.snackbarService.openSnackBar(
        `❌ تم رفض بعض الملفات غير المدعومة:\n${invalidFiles.map(f => f.name).join('\n')}`,
        'failure'
      );
    }

    // Remove duplicates vs current queue
    const { uniqueFiles, duplicateNames } = this.filterDuplicates(validFiles);

    // ✅ Enforce max: only take as many as we have room for
    const allowed = uniqueFiles.slice(0, this.remainingSlots);
    const overflow = uniqueFiles.slice(this.remainingSlots);

    if (duplicateNames.length > 0) {
      this.snackbarService.openSnackBar(
        `تم تجاهل الملفات المكررة:\n${duplicateNames.join('\n')}`,
        'failure'
      );
    }

    if (overflow.length > 0) {
      this.snackbarService.openSnackBar(
        `تم تجاوز الحد الأقصى، تم تجاهل:\n${overflow.map(f => f.name).join('\n')}`,
        'failure'
      );
    }

    const models: UploadFileModel[] = allowed.map((file) => ({
      file,
      status: 'pending',
      progress: 0,
      objectUrl: this.isAudioType(file) ? URL.createObjectURL(file) : undefined,
    }));

    this.uploadQueue.push(...models);
    this.startNextUpload();
  }

  private startNextUpload() {
    if (this.isUploading) return;

    const next = this.uploadQueue.find((f) => f.status === 'pending');
    if (!next) {
      // ✅ All files uploaded
      const allDone = this.uploadQueue.every(
        (f) => f.status === 'done' || f.status === 'error'
      );
      if (allDone) {
        // Clear dropzone
        this.uploadQueue = [];
      }
      return;
    }

    this.isUploading = true;
    next.status = 'uploading';

    this.fileuploadService.upload(next.file).subscribe({
      next: (event) => {
        next.progress = event.progress;
        if (event.progress === 100) {
          console.log('Upload complete event:', event);
          next.status = 'done';
          next.responseData = event.result;

          // ✅ Emit to parent immediately
          if (event.result) {
            this.filesUploaded.emit([event.result]); // ✅ emit only if valid
          }

          this.snackbarService.openSnackBar(
            `تم رفع الملف ${next.file.name} بنجاح`,
            'success'
          );

          this.isUploading = false;
          this.startNextUpload();
        }
      },
      error: () => {
        next.status = 'error';
        this.snackbarService.openSnackBar(
          `فشل رفع الملف ${next.file.name}`,
          'failure'
        );
        this.isUploading = false;
        this.startNextUpload();
      },
    });
  }

  onRemove(fileModel: UploadFileModel) {
    if (fileModel.objectUrl) {
      URL.revokeObjectURL(fileModel.objectUrl);
    }
    this.uploadQueue = this.uploadQueue.filter((f) => f !== fileModel);
  }

  private filterDuplicates(filesToAdd: File[]): {
    uniqueFiles: File[];
    duplicateNames: string[];
  } {
    const uniqueFiles: File[] = [];
    const duplicateNames: string[] = [];

    for (const file of filesToAdd) {
      const isDuplicate = this.uploadQueue.some(
        (f) => f.file.name === file.name && f.file.type === file.type
      );

      if (!isDuplicate) {
        uniqueFiles.push(file);
      } else {
        duplicateNames.push(file.name);
      }
    }

    return { uniqueFiles, duplicateNames };
  }

  isImage(f: UploadFileModel): boolean {
    return f.file.type.startsWith('image/');
  }

  isVideo(f: UploadFileModel): boolean {
    return f.file.type.startsWith('video/');
  }

  isAudio(f: UploadFileModel): boolean {
    return f.file.type.startsWith('audio/');
  }

  private isAudioType(file: File): boolean {
    return file.type.startsWith('audio/');
  }
}
