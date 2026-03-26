import { StepperSelectionEvent } from '@angular/cdk/stepper';
import { Component, Inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatStepper } from '@angular/material/stepper';
import { Subscription } from 'rxjs';
import { FileuploadService } from 'src/app/services/fileupload.service';
import { SnackbarService } from 'src/app/services/snackbar.service';

export type DialogMode = 'create' | 'edit' | 'delete';

export interface TargetsDialogData {
  mode: DialogMode;
  initial?: {
    id?: string;
    name?: string;
    description?: string;
    referenceAudio?: any[];
    trainingAudio?: any[];
  };
}

export interface TargetsDialogResult {
  confirmed: boolean;
  mode: DialogMode;
  name?: string;
  description?: string;
  referenceAudio?: string[];
  trainingAudio?: string[];
}

@Component({
  selector: 'app-targets-dialog',
  templateUrl: './targets-dialog.component.html',
  styleUrls: ['./targets-dialog.component.scss'],
})
export class TargetsDialogComponent implements OnInit, OnDestroy {
  formGroup!: FormGroup;
  infoGroup!: FormGroup;
  trainGroup!: FormGroup;

  mode: DialogMode = 'create';
  referenceFiles: any[] = [];
  trainFiles: any[] = [];
  private orphanFileIds: string[] = [];
  private closeSub?: Subscription;

  // Which file is currently previewed (per list)
  previewRefIndex: number | null = null;
  previewTrainIndex: number | null = null;

  @ViewChild('stepper') stepper?: MatStepper;

  stepIndex = 0;

  onStepChange(ev: StepperSelectionEvent): void {
    this.stepIndex = ev.selectedIndex;
  }

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<TargetsDialogComponent, TargetsDialogResult>,
    @Inject(MAT_DIALOG_DATA) public data: TargetsDialogData,
    private fileSvc: FileuploadService,
    private snackbar: SnackbarService
  ) { }

  /** Title for header */
  get headerTitle(): string {
    switch (this.mode) {
      case 'edit': return 'تعديل هدف';
      case 'delete': return 'حذف هدف';
      default: return 'إضافة هدف جديد';
    }
  }

  goPrev(): void {
    this.stepper?.previous();
  }

  goNext(): void {
    this.stepper?.next();
  }

  isNextDisabled(): boolean {
    return (
      (this.stepIndex === 0 && (!this.infoGroup.valid || this.referenceFiles.length !== 1)) || // ⬅️ exactly one
      (this.stepIndex === 1 && this.trainFiles.length === 0)
    );
  }

  ngOnInit(): void {
    this.mode = this.data?.mode ?? 'create';
    const d = this.data.initial || {};

    this.infoGroup = this.fb.group({
      name: [d.name || '', [Validators.required, Validators.minLength(3)]],
      description: [d.description || ''],
    });

    this.trainGroup = this.fb.group({ dummy: [''] });
    this.formGroup = this.fb.group({ info: this.infoGroup, train: this.trainGroup });

    // ⬅️ Clamp to single (first) reference file if any
    const refInit = Array.isArray(d.referenceAudio) ? d.referenceAudio : [];
    this.referenceFiles = refInit.length ? [refInit[0]] : [];

    const trInit = Array.isArray(d.trainingAudio) ? d.trainingAudio : [];
    this.trainFiles = trInit;

    // Resolve names (will safely no-op for empty/single)
    this.resolveFilenamesIfNeeded(this.referenceFiles, 'referenceFiles');
    this.resolveFilenamesIfNeeded(this.trainFiles, 'trainFiles');

    this.closeSub = this.dialogRef.beforeClosed().subscribe(result => {
      const confirmed = !!result?.confirmed;
      if (!confirmed && this.orphanFileIds.length) {
        for (const id of this.orphanFileIds) this.fileSvc.deleteFile(id).subscribe();
      }
    });
  }

  ngOnDestroy(): void {
    this.closeSub?.unsubscribe();
  }

  private resolveFilenamesIfNeeded(list: any[], targetKey: 'referenceFiles' | 'trainFiles') {
    const ids = (list || []).filter(x => typeof x === 'string') as string[];
    if (ids.length === 0) return;

    // Replace strings with { id } placeholders first, so template is stable
    const normalized = (list || []).map(x => (typeof x === 'string' ? { id: x } : x));
    (this as any)[targetKey] = normalized;

    // Try batch if your service has it; otherwise fall back to per-id
    if (typeof this.fileSvc.getManyMeta === 'function') {
      this.fileSvc.getManyMeta(ids).subscribe((metas: any[]) => {
        (this as any)[targetKey] = normalized.map((item: any) => {
          const meta = metas?.find(m => (m.id || m._id) === (item.id || item._id));
          return meta ? { ...item, filename: meta.filename || meta.name } : item;
        });
      });
    } else if (typeof this.fileSvc.getFileMeta === 'function') {
      ids.forEach(id => {
        this.fileSvc.getFileMeta(id).subscribe((meta: any) => {
          const arr = (this as any)[targetKey] as any[];
          const i = arr.findIndex(x => (x.id || x._id) === id);
          if (i >= 0) arr[i] = { ...arr[i], filename: meta?.filename || meta?.name || arr[i].filename };
        });
      });
    }
  }

  // --- Upload handlers ----------------------------------------------------
  onRefFilesUploaded(files: any[]): void {
    if (!files || files.length === 0) return;
    const newFile = files[0];
    const newId = newFile._id || newFile.id;

    // If there was an existing uploaded (orphan) file, clean it
    if (this.referenceFiles.length === 1) {
      const old = this.referenceFiles[0];
      const oldId = this.getId(old);
      // Only delete if it was uploaded during this dialog session
      if (oldId && this.orphanFileIds.includes(oldId)) {
        this.fileSvc.deleteFile(oldId).subscribe();
        this.orphanFileIds = this.orphanFileIds.filter(x => x !== oldId);
      }
    }

    // Set single file
    this.referenceFiles = [newFile];

    // Track the new upload as orphan (in case user cancels)
    if (newId) this.orphanFileIds.push(newId);

    // Optional: auto-open preview (no index complexity anymore)
    this.previewRefIndex = 0;
  }

  onTrainFilesUploaded(files: any[]): void {
    files.forEach(f => {
      const id = f._id || f.id;
      this.trainFiles.push(f);
      this.orphanFileIds.push(id);
    });
  }

  /** Resolve an id from possible file object/string */
  getId(f: any): string | null {
    if (!f) return null;
    if (typeof f === 'string') return f;
    return f._id || f.id || null;
  }

  /** Toggle preview for a reference file by index */
  /** Toggle reference preview; when i === null, close preview and show dropzone back */
  toggleRefPreview(i: number | null): void {
    if (i === null) {
      this.previewRefIndex = null;
      return;
    }
    // If clicking the same index, toggle off
    this.previewRefIndex = (this.previewRefIndex === i) ? null : i;
  }

  /** Toggle training preview; same semantics as above */
  toggleTrainPreview(i: number | null): void {
    if (i === null) {
      this.previewTrainIndex = null;
      return;
    }
    this.previewTrainIndex = (this.previewTrainIndex === i) ? null : i;
  }

  // Return first N items safely
  firstN<T>(arr: T[] | null | undefined, n = 3): T[] {
    const a = Array.isArray(arr) ? arr : [];
    return a.slice(0, Math.max(0, Math.min(n, a.length)));
  }

  // Return how many items remain after first N
  remainderCount<T>(arr: T[] | null | undefined, n = 3): number {
    const a = Array.isArray(arr) ? arr : [];
    return Math.max(0, a.length - n);
  }

  // --- File Deletion ------------------------------------------------------
  onDeleteRefFile(f: any, idx: number): void {
    const id = this.getId(f);
    if (!id) return;

    this.fileSvc.deleteFile(id).subscribe({
      next: () => {
        this.referenceFiles.splice(idx, 1);
        this.orphanFileIds = this.orphanFileIds.filter(x => x !== id);

        // adjust preview index if needed
        if (this.previewRefIndex !== null) {
          if (this.previewRefIndex === idx) this.previewRefIndex = null;
          else if (this.previewRefIndex > idx) this.previewRefIndex -= 1;
        }

        this.snackbar.openSnackBar('تم حذف الملف المرجعي', 'success');
      },
      error: () => this.snackbar.openSnackBar('فشل حذف الملف', 'failure')
    });
  }

  onDeleteTrainFile(f: any, idx: number): void {
    const id = this.getId(f);
    if (!id) return;

    this.fileSvc.deleteFile(id).subscribe({
      next: () => {
        this.trainFiles.splice(idx, 1);
        this.orphanFileIds = this.orphanFileIds.filter(x => x !== id);

        // adjust preview index if needed
        if (this.previewTrainIndex !== null) {
          if (this.previewTrainIndex === idx) this.previewTrainIndex = null;
          else if (this.previewTrainIndex > idx) this.previewTrainIndex -= 1;
        }

        this.snackbar.openSnackBar('تم حذف ملف التدريب', 'success');
      },
      error: () => this.snackbar.openSnackBar('فشل حذف الملف', 'failure')
    });
  }

  // --- Confirm / Cancel ---------------------------------------------------
  onConfirm(): void {
    if (this.mode === 'delete') {
      this.dialogRef.close({ confirmed: true, mode: 'delete' });
      return;
    }

    if (!this.infoGroup.valid || this.referenceFiles.length !== 1) return;

    const result: TargetsDialogResult = {
      confirmed: true,
      mode: this.mode,
      name: this.infoGroup.value.name.trim(),
      description: this.infoGroup.value.description.trim(),
      referenceAudio: [this.getId(this.referenceFiles[0])!],   // ⬅️ single
      trainingAudio: this.trainFiles.map(f => this.getId(f)!).filter(Boolean),
    };

    this.dialogRef.close(result);
  }

  onCancel(): void {
    this.dialogRef.close({ confirmed: false, mode: this.mode });
  }
}
