// sound-effects-dialog.component.ts
import { Component, Inject, OnInit, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { SoundEffectTypeModel } from 'src/app/models/sound-effect-type.model';
import { FileuploadService } from 'src/app/services/fileupload.service';
import { SnackbarService } from 'src/app/services/snackbar.service';
import { WavesurferComponent } from '../../wavesurfer/wavesurfer.component';

type DialogMode = 'create' | 'edit' | 'delete';

export interface SoundEffectDialogData {
  mode: DialogMode;
  types: SoundEffectTypeModel[];
  selectedTypeId?: string | null;
  initial?: {
    id: string;
    name: string;
    soundEffectTypeId: string;
    fileId?: string | null;
    /** ⬇️ optional pre-populated file object (if you have it) */
    file?: { _id?: string; id?: string; filename?: string } | null;

    // ⬇️ seed region
    start?: number | null;
    end?: number | null;
  };
}

export interface SoundEffectDialogResult {
  confirmed: boolean;
  mode: DialogMode;
  id?: string;               // effect id (edit/delete)
  name?: string;
  soundEffectTypeId?: string;
  fileId?: string;           // new uploaded file id (if changed)

  // ⬇️ return region (if any)
  start?: number | null;
  end?: number | null;

  deleteConfirmed?: boolean; // delete mode flag
}

@Component({
  selector: 'app-sound-effects-dialog',
  templateUrl: './sound-effects-dialog.component.html',
  styleUrls: ['./sound-effects-dialog.component.scss']
})
export class SoundEffectsDialogComponent implements OnInit {

  private initialSnapshot!: {
    name: string;
    soundEffectTypeId: string | null;
    fileId: string | null;
    start: number | null;
    end: number | null;
  };

  // current region state
  cropStart: number | null = null;
  cropEnd: number | null = null;

  form!: FormGroup;

  // inputs/state
  mode: DialogMode = 'create';
  types: SoundEffectTypeModel[] = [];
  originalFileId: string | null = null;   // existing file (edit mode)
  uploadedFileId: string | null = null;   // newly uploaded file (create/edit)
  regionExists = false;

  // ADD these fields on the component class
  deleteFileName: string | null = null;
  isDeleteMetaLoading = false;

  @ViewChild(WavesurferComponent) wave?: WavesurferComponent;

  get headerTitle(): string {
    return this.mode === 'delete'
      ? 'حذف مؤثر صوتي'
      : this.mode === 'edit'
        ? 'تعديل مؤثر صوتي'
        : 'إضافة مؤثر صوتي';
  }

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<SoundEffectsDialogComponent, SoundEffectDialogResult>,
    @Inject(MAT_DIALOG_DATA) public data: SoundEffectDialogData,
    private fileuploadService: FileuploadService,
    private snackbarService: SnackbarService
  ) { }

  ngOnInit(): void {
    // init mode + data
    this.mode = this.data?.mode ?? 'create';
    this.types = this.data?.types ?? [];
    this.originalFileId = this.data?.initial?.fileId ?? null;

    // build form only for create/edit
    this.form = this.fb.group({
      soundEffectTypeId: [
        this.data?.initial?.soundEffectTypeId ??
        this.data?.selectedTypeId ??
        this.types[0]?.id ??
        null,
        [Validators.required]
      ],
      name: [
        this.data?.initial?.name ?? '',
        [Validators.required, Validators.minLength(3), this.noWhitespace]
      ],
    });

    const initName = (this.data?.initial?.name ?? '').trim();
    const initType = this.data?.initial?.soundEffectTypeId ?? this.data?.selectedTypeId ?? this.types[0]?.id ?? null;
    const initFile = this.data?.initial?.fileId ?? null;

    this.cropStart = (this.data?.initial?.start ?? null) as number | null;
    this.cropEnd = (this.data?.initial?.end ?? null) as number | null;

    // snapshot includes start/end (good)
    this.initialSnapshot = {
      name: initName,
      soundEffectTypeId: initType,
      fileId: initFile,
      start: this.cropStart,
      end: this.cropEnd,
    };

    // If editing and there is a stored file id, verify it exists.
    if (this.mode === 'edit' && this.originalFileId) {
      this.fileuploadService.getFile(this.originalFileId).subscribe({
        next: () => {
          // ok, keep preview
        },
        error: () => {
          // file is gone -> reveal dropzone
          this.originalFileId = null;
          this.snackbarService.openSnackBar(
            'الملف المرتبط غير متاح. الرجاء رفع ملف جديد.',
            'failure'
          );
        }
      });
    }

    // Only enforce in edit mode
    if (this.mode === 'edit') {
      this.dialogRef.disableClose = !this.hasAnyFile; // block close if no file
    }

    // auto-delete newly uploaded orphan when dialog closes without saving (create/edit only)
    if (this.mode !== 'delete') {
      this.dialogRef.beforeClosed().subscribe((result) => {
        const confirmed = !!result?.confirmed;
        if (!confirmed && this.uploadedFileId) {
          this.fileuploadService.deleteFile(this.uploadedFileId).subscribe();
        }
      });
    }

    if (this.mode === 'delete') {
      const fileObj = this.data?.initial?.file ?? null;
      const fid = this.data?.initial?.fileId ?? fileObj?.id ?? fileObj?._id ?? null;

      if (fileObj?.filename) {
        // already have it
        this.deleteFileName = fileObj.filename;
      } else if (fid) {
        // fetch metadata to show filename
        this.isDeleteMetaLoading = true;
        this.fileuploadService.getFile(fid).subscribe({
          next: (meta) => {
            this.deleteFileName = meta?.filename || null;
            this.isDeleteMetaLoading = false;
          },
          error: () => {
            this.deleteFileName = null;
            this.isDeleteMetaLoading = false;
          }
        });
      }
    }
  }

  // sound-effects-dialog.component.ts (class)
  get isDirty(): boolean {
    // Only matters for edit mode; for create we’ll allow save when valid + file.
    if (this.mode !== 'edit') return true;

    const currentName = String(this.form.get('name')?.value ?? '').trim();
    const currentType = this.form.get('soundEffectTypeId')?.value ?? null;
    const currentFileId = this.uploadedFileId ?? this.originalFileId ?? null;

    return (
      currentName !== (this.initialSnapshot.name ?? '') ||
      currentType !== (this.initialSnapshot.soundEffectTypeId ?? null) ||
      currentFileId !== (this.initialSnapshot.fileId ?? null) ||
      this.cropStart !== (this.initialSnapshot.start ?? null) ||
      this.cropEnd !== (this.initialSnapshot.end ?? null)
    );
  }


  // file uploaded from dropzone
  onFilesUploaded = (payload: any[]) => {
    console.log('Files uploaded:', payload);
    const first = Array.isArray(payload) ? payload[0] : payload;
    const fid = first?._id || first?.id || null;

    this.uploadedFileId = fid;

    // Re-enable dismissing if we're editing and now we have a file
    if (this.mode === 'edit' && this.hasAnyFile) {
      this.dialogRef.disableClose = false;
    }
  };

  // inside SoundEffectsDialogComponent
  get hasAnyFile(): boolean {
    return !!this.uploadedFileId || !!this.originalFileId;
  }

  // edit region
  onRegionState(exists: boolean) {
    this.regionExists = exists;
  }

  // inside SoundEffectsDialogComponent
  onRegionChange(ev: { start?: number; end?: number } | undefined): void {
    this.cropStart = (typeof ev?.start === 'number') ? ev.start : null;
    this.cropEnd = (typeof ev?.end === 'number') ? ev.end : null;
  }

  onEditRegion(): void {
    if (this.regionExists) return;
    this.regionExists = true;
    this.wave?.addRegionFullTrimmed('اقتصاص المؤثر الصوتي');
  }

  // delete current file (preview header trash)
  onDeleteFile(): void {
    const id = this.uploadedFileId ?? this.originalFileId;
    if (!id) return;

    this.fileuploadService.deleteFile(id).subscribe({
      next: () => {
        this.snackbarService.openSnackBar('تم حذف الملف بنجاح', 'success');
        // clear both, show dropzone
        this.uploadedFileId = null;
        this.originalFileId = null;

        // In EDIT mode, block dismiss until user uploads a new one
        if (this.mode === 'edit') {
          this.dialogRef.disableClose = true;
        }
      },
      error: () => this.snackbarService.openSnackBar('فشل حذف الملف', 'failure')
    });
  }

  // validation helpers
  // sound-effects-dialog.component.ts
  get canSave(): boolean {
    if (this.mode === 'delete') return true;

    const hasFile = !!(this.uploadedFileId || this.originalFileId);
    if (!this.form.valid || !hasFile) return false;

    // Create: allow save once valid + file attached
    if (this.mode === 'create') return true;

    // Edit: require an actual change
    return this.isDirty;
  }

  private noWhitespace = (control: any) =>
    ((control.value ?? '').toString().trim().length > 0 ? null : { whitespace: true });

  // actions
  onCancel(): void {
    // In EDIT mode, do not allow cancel if there is no file
    if (this.mode === 'edit' && !this.hasAnyFile) {
      this.snackbarService.openSnackBar('الرجاء إرفاق ملف قبل الإغلاق.', 'failure');
      return;
    }

    // your existing optional cleanup for temporary uploads (create mode etc.)
    if (this.uploadedFileId && this.mode !== 'edit') {
      this.fileuploadService.deleteFile(this.uploadedFileId).subscribe();
    }

    this.dialogRef.close({ confirmed: false, mode: this.mode });
  }

  onConfirm(): void {
    if (this.mode === 'delete') {
      // delete mode: return minimal payload
      this.dialogRef.close({ confirmed: true, mode: 'delete', id: this.data?.initial?.id, deleteConfirmed: true });
      return;
    }

    if (!this.canSave) {
      this.form.markAllAsTouched();
      return;
    }

    const { name, soundEffectTypeId } = this.form.value;
    this.dialogRef.close({
      confirmed: true,
      mode: this.mode,
      id: this.data?.initial?.id,
      name: String(name).trim(),
      soundEffectTypeId,
      fileId: this.uploadedFileId || this.originalFileId || undefined,

      start: this.cropStart,
      end: this.cropEnd,
    });
  }
}
