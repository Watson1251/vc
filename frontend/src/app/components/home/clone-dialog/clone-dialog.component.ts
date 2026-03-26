import { StepperSelectionEvent } from '@angular/cdk/stepper';
import { Component, Inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatStepper } from '@angular/material/stepper';
import { Subscription } from 'rxjs';

import { SnackbarService } from 'src/app/services/snackbar.service';
import { FileuploadService } from 'src/app/services/fileupload.service';
import { TargetsService } from 'src/app/services/targets.services';
import { SoundEffectTypesService } from 'src/app/services/sound-effect-types.service';
import { SoundEffectsService } from 'src/app/services/sound-effects.service';

import { TargetModel } from 'src/app/models/target.model';
import { SoundEffectTypeModel } from 'src/app/models/sound-effect-type.model';
import { SoundEffectModel } from 'src/app/models/sound-effect.model';

export type CloneDialogMode = 'create' | 'edit';

export interface CloneDialogData {
  mode: CloneDialogMode;
  initial?: {
    targetId?: string;
    scenario?: string;
    contentAudioId?: string;     // for edit mode only
    referenceAudioId?: string;
    soundEffectTypeId?: string | null;
    soundEffectId?: string | null;
    diffusion?: number;
    length?: number;
    inference_rate?: number;
  };
}

export interface CloneDialogResult {
  confirmed: boolean;
  mode: CloneDialogMode;

  targetId: string;
  scenario?: string;

  contentAudioId: string;
  referenceAudioId: string;
  soundEffectId?: string | null;

  diffusion: number;
  length: number;
  inference_rate: number;
}

@Component({
  selector: 'app-clone-dialog',
  templateUrl: './clone-dialog.component.html',
  styleUrls: ['./clone-dialog.component.scss'],
})
export class CloneDialogComponent implements OnInit, OnDestroy {
  mode: CloneDialogMode = 'create';

  // Stepper + forms
  @ViewChild('stepper') stepper?: MatStepper;
  stepIndex = 0;

  formGroup!: FormGroup;
  step1Group!: FormGroup; // target + scenario
  step2Group!: FormGroup; // content audio + reference + (optional) sound effect
  step3Group!: FormGroup; // sliders

  // Data sources
  targets: TargetModel[] = [];
  targetSub?: Subscription;

  // Add this field
  private originalContentId: string | null = null;

  refChoices: { id: string; filename?: string }[] = []; // from selected target
  // Content file (single)
  contentFileId: string | null = null;
  // uploaded file that needs cleanup if dialog canceled
  private orphanContentFileId: string | null = null;

  // Preview state
  previewContent = false;

  selectedPreset: 'fast' | 'balanced' | 'quality' | '' = '';

  // Sound effect types + effects
  seTypes: SoundEffectTypeModel[] = [];
  seTypesSub?: Subscription;

  effects: SoundEffectModel[] = [];
  effectsSub?: Subscription;

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<CloneDialogComponent, CloneDialogResult>,
    @Inject(MAT_DIALOG_DATA) public data: CloneDialogData,
    private fileSvc: FileuploadService,
    private snackbar: SnackbarService,
    private targetsSvc: TargetsService,
    private seTypesSvc: SoundEffectTypesService,
    private seSvc: SoundEffectsService
  ) { }

  get headerTitle(): string {
    return this.mode === 'edit' ? 'تعديل عملية استنساخ' : 'إجراء استنساخ جديد';
  }

  ngOnInit(): void {
    this.mode = this.data?.mode ?? 'create';
    const d = this.data?.initial || {};

    // Handle contentAudio init (edit mode)
    this.contentFileId = d.contentAudioId || null;
    this.originalContentId = this.contentFileId;          // ✅ remember original file
    this.previewContent = !!this.contentFileId;           // ✅ auto show preview on edit

    // Step groups
    this.step1Group = this.fb.group({
      targetId: [d.targetId || '', Validators.required],
      scenario: [d.scenario || ''],
    });

    this.step2Group = this.fb.group({
      contentAudioId: [d.contentAudioId || '', Validators.required],
      referenceAudioId: [d.referenceAudioId || '', Validators.required],
      soundEffectTypeId: [typeof d.soundEffectTypeId === 'string' ? d.soundEffectTypeId : ''],
      soundEffectId: [typeof d.soundEffectId === 'string' ? d.soundEffectId : ''],
    });

    this.step3Group = this.fb.group({
      diffusion: [typeof d.diffusion === 'number' ? d.diffusion : 25.0, [Validators.min(1), Validators.max(60)]],
      length: [typeof d.length === 'number' ? d.length : 1.0, [Validators.min(0.5), Validators.max(2)]],
      inference_rate: [typeof d.inference_rate === 'number' ? d.inference_rate : 0.7, [Validators.min(0), Validators.max(1)]],
    });

    // Keep diffusion as an int within [1, 60]
    this.step3Group.get('diffusion')!.valueChanges.subscribe(v => {
      const num = Math.max(1, Math.min(60, Math.round(Number(v) || 25)));
      if (num !== v) this.step3Group.patchValue({ diffusion: num }, { emitEvent: false });
    });

    this.step3Group.get('length')!.valueChanges.subscribe(v => {
      const num = Math.max(0.5, Math.min(2, Number(v) || 1));
      if (num !== v) this.step3Group.patchValue({ length: num }, { emitEvent: false });
    });

    this.step3Group.get('inference_rate')!.valueChanges.subscribe(v => {
      const num = Math.max(0, Math.min(1, Number(v) || 0.7));
      const rounded = Math.round(num * 100) / 100;
      if (rounded !== v) this.step3Group.patchValue({ inference_rate: rounded }, { emitEvent: false });
    });

    this.formGroup = this.fb.group({
      step1: this.step1Group,
      step2: this.step2Group,
      step3: this.step3Group,
    });

    // Handle contentAudio init (edit mode)
    this.contentFileId = d.contentAudioId || null;

    // Load data sources
    this.targetsSvc.getTargets(); // uses existing caching/pipeline
    this.targetSub = this.targetsSvc.getTargetsUpdateListener().subscribe(ts => {
      this.targets = ts || [];
      // Refresh ref choices if target already selected
      const tid = this.step1Group.value.targetId;
      if (tid) this.loadTargetRefs(tid);
    });

    this.seTypesSvc.getTypes();
    this.seTypesSub = this.seTypesSvc.getTypesUpdateListener().subscribe(list => (this.seTypes = list || []));

    // On type change, reload effects list
    this.step2Group.get('soundEffectTypeId')!.valueChanges.subscribe(typeId => {
      if (typeId) this.seSvc.getEffects({ soundEffectTypeId: typeId });
      else this.seSvc.getEffects(); // show all when cleared
    });
    this.seSvc.getEffects();
    this.effectsSub = this.seSvc.getEffectsUpdateListener().subscribe(list => (this.effects = list || []));

    // When target changes, refresh refs
    this.step1Group.get('targetId')!.valueChanges.subscribe((tid: string) => this.onTargetChanged(tid));

    // 🧹 Cleanup on close if canceled
    this.dialogRef.beforeClosed().subscribe(result => {
      const confirmed = !!result?.confirmed;
      if (!confirmed && this.orphanContentFileId) {
        this.fileSvc.deleteFile(this.orphanContentFileId).subscribe();
      }
    });
  }

  // Presets (already referenced by your badges)
  applyPreset(kind: 'fast' | 'balanced' | 'quality') {
    if (kind === 'fast') {
      this.step3Group.patchValue({ diffusion: 15, length: 0.9, inference_rate: 0.55 });
    } else if (kind === 'quality') {
      this.step3Group.patchValue({ diffusion: 45, length: 1.1, inference_rate: 0.8 });
    } else {
      this.step3Group.patchValue({ diffusion: 25, length: 1.0, inference_rate: 0.7 });
    }
  }
  resetTuning() {
    this.step3Group.patchValue(this.DEFAULTS);
  }

  coerceDiffusionToInt(v: number) {
    // Make sure it stays an int even if something feeds a float
    const clamped = Math.max(1, Math.min(60, Math.round(Number(v) || this.DEFAULTS.diffusion)));
    if (clamped !== this.step3Group.value.diffusion) {
      this.step3Group.patchValue({ diffusion: clamped }, { emitEvent: false });
    }
  }

  // Inputs ↔ controls
  setDiffusionFromInput(v: string) {
    const n = Math.max(1, Math.min(60, Math.round(Number(v) || this.DEFAULTS.diffusion)));
    this.step3Group.patchValue({ diffusion: n }, { emitEvent: false });
  }
  setLengthFromInput(v: string) {
    const n = Math.max(0.5, Math.min(2, Number(v) || this.DEFAULTS.length));
    this.step3Group.patchValue({ length: n }, { emitEvent: false });
  }
  setInferenceRateFromInput(v: string) {
    const n = Math.max(0, Math.min(1, Number(v) || this.DEFAULTS.inference_rate));
    const rounded = Math.round(n * 100) / 100;
    this.step3Group.patchValue({ inference_rate: rounded }, { emitEvent: false });
  }

  ngOnDestroy(): void {
    this.targetSub?.unsubscribe();
    this.seTypesSub?.unsubscribe();
    this.effectsSub?.unsubscribe();
  }

  formatTimestamp(seconds: any): string {
    if (seconds == null || seconds === "" || isNaN(Number(seconds))) return "";
    const total = Math.max(0, Number(seconds));
    const mins = Math.floor(total / 60);
    const secs = Math.floor(total % 60);
    const two = (n: number) => n.toString().padStart(2, "0");
    return `${mins}:${two(secs)}`;
  }

  get selectedSfx(): SoundEffectModel | null {
    const id = this.step2Group?.value?.soundEffectId;
    if (!id) return null;
    return this.effects.find(e => e.id === id) || null;
  }

  get selectedSfxFileId(): string | null {
    const e = this.selectedSfx;
    return (e?.file?.fileId || e?.fileId || null) ?? null;
  }

  get selectedSfxRegion(): { start?: number; end?: number } | undefined {
    const e = this.selectedSfx;
    if (!e) return undefined;
    const s = typeof e.start === "number" ? e.start : undefined;
    const en = typeof e.end === "number" ? e.end : undefined;
    if (s == null || en == null) return undefined;
    if (!Number.isFinite(s) || !Number.isFinite(en) || en <= s) return undefined;
    return { start: s, end: en };
  }

  /** Ensure first reference is selected if none/invalid; respect existing/initial on edit */
  private ensureFirstRefSelected(): void {
    const current = this.step2Group.value.referenceAudioId as string;
    const exists = !!current && this.refChoices.some(r => r.id === current);

    if (!exists && this.refChoices.length > 0) {
      this.step2Group.patchValue({ referenceAudioId: this.refChoices[0].id }, { emitEvent: false });
    }
  }


  // -------- Stepper controls ----------
  onStepChange(e: StepperSelectionEvent) {
    this.stepIndex = e.selectedIndex;
  }
  goPrev(): void { this.stepper?.previous(); }
  goNext(): void { this.stepper?.next(); }

  readonly DEFAULTS = { diffusion: 25, length: 1.0, inference_rate: 0.7 };
  private readonly PRESETS: Record<'fast' | 'balanced' | 'quality', { diffusion: number; length: number; inference_rate: number }> = {
    fast: { diffusion: 10, length: 1.0, inference_rate: 0.6 },
    balanced: { diffusion: 25, length: 1.0, inference_rate: 0.7 },
    quality: { diffusion: 40, length: 1.0, inference_rate: 0.75 },
  };

  isNextDisabled(): boolean {
    if (this.stepIndex === 0) {
      return !this.step1Group.valid || !this.isTargetUsable(this.selectedTarget());
    }
    if (this.stepIndex === 1) {
      return !this.step2Group.valid;
    }
    return false;
  }

  // -------- Targets & refs ----------
  selectedTarget(): TargetModel | undefined {
    const id = this.step1Group.value.targetId;
    return this.targets.find(t => t.id === id);
  }

  isTargetUsable(t?: TargetModel): boolean {
    return !!t && t.status === 'DONE';
  }

  // when target changes: populate references dropdown (populate via getTarget if needed)
  private loadTargetRefs(id: string) {
    const t = this.targets.find(x => x.id === id);
    const makePairs = (arr: any[]) => (arr || []).map((f: any) => ({
      id: f?.id || f?._id || '',
      filename: f?.filename || f?.name || f?.id || ''
    })).filter(x => x.id);

    if (t?.referenceAudio?.length) {
      this.refChoices = makePairs(t.referenceAudio as any[]);
      this.ensureFirstRefSelected();            // ✅ auto-pick first
      return;
    }

    // Fetch single target to ensure populated arrays
    this.targetsSvc.getTarget(id).subscribe(res => {
      const body = res.body || {};
      const arr = Array.isArray(body.referenceAudio) ? body.referenceAudio : [];
      this.refChoices = makePairs(arr);
      this.ensureFirstRefSelected();            // ✅ auto-pick first
    });
  }

  onTargetChanged(tid: string) {
    this.step2Group.patchValue({ referenceAudioId: '' }, { emitEvent: false });
    this.refChoices = [];
    if (tid) this.loadTargetRefs(tid);
  }

  // -------- Content audio upload / preview ----------
  onContentUploaded(files: any[]) {
    if (!Array.isArray(files) || !files.length) return;
    const f = files[0];
    const id = f?._id || f?.id;
    if (!id) return;

    const prevId = this.contentFileId;

    // If replacing an existing file, delete the previous one:
    // - If the previous was uploaded in this dialog session (orphan), delete it.
    // - Else if we are in edit mode and replacing the original content, delete that original too.
    if (prevId && prevId !== id) {
      if (this.orphanContentFileId === prevId) {
        // previous upload during this dialog session
        this.fileSvc.deleteFile(prevId).subscribe();
        this.orphanContentFileId = null;
      } else if (this.mode === 'edit' && this.originalContentId === prevId) {
        // replacing the original file of the action → delete backend file
        this.fileSvc.deleteFile(prevId).subscribe();
        this.originalContentId = null; // it's gone now
      }
    }

    // Mark the new file as an orphan until Confirm
    this.contentFileId = id;
    this.orphanContentFileId = id;
    this.step2Group.patchValue({ contentAudioId: id });
    this.previewContent = true;
  }

  onDeleteContent() {
    const id = this.contentFileId;
    if (!id) return;

    this.fileSvc.deleteFile(id).subscribe({
      next: () => {
        if (this.orphanContentFileId === id) this.orphanContentFileId = null;
        if (this.originalContentId === id) this.originalContentId = null;  // ✅ track that original was removed
        this.contentFileId = null;
        this.previewContent = false;
        this.step2Group.patchValue({ contentAudioId: '' }); // validator will block Confirm until re-upload
        this.snackbar.openSnackBar('تم حذف ملف المحتوى', 'success');
      },
      error: () => this.snackbar.openSnackBar('فشل حذف الملف', 'failure'),
    });
  }

  // -------- Confirm / Cancel ----------
  onConfirm(): void {
    if (!this.step1Group.valid || !this.step2Group.valid || !this.step3Group.valid) return;

    const raw = this.step3Group.value;
    const diffusion = Math.max(1, Math.round(Number(raw.diffusion)));     // ✅ int
    const length = Number(raw.length);                                     // ✅ float
    const inference_rate = Number(Number(raw.inference_rate).toFixed(2));  // ✅ float (0..1)

    const result: CloneDialogResult = {
      confirmed: true,
      mode: this.mode,
      targetId: this.step1Group.value.targetId,
      scenario: (this.step1Group.value.scenario || '').trim() || undefined,
      contentAudioId: this.step2Group.value.contentAudioId,
      referenceAudioId: this.step2Group.value.referenceAudioId,
      soundEffectId: this.step2Group.value.soundEffectId || null,
      diffusion,
      length,
      inference_rate,
    };

    this.orphanContentFileId = null;
    this.dialogRef.close(result);
  }

  onCancel(): void {
    this.dialogRef.close({ confirmed: false, mode: this.mode } as CloneDialogResult);
  }
}
