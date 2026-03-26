import { Component, OnDestroy, OnInit } from '@angular/core';
import { PageEvent } from '@angular/material/paginator';
import { Subscription } from 'rxjs';

import { SnackbarService } from '../../services/snackbar.service';
import { PermissionService } from '../../services/permissions.service';
import { CloneActionModel } from 'src/app/models/clone-action.model';
import { CloneActionsService } from 'src/app/services/clone-actions.services';
import { MatDialog } from '@angular/material/dialog';
import { CloneDialogComponent, CloneDialogResult } from './clone-dialog/clone-dialog.component';
import { SoundEffectsService } from 'src/app/services/sound-effects.service';
import { SocketService } from 'src/app/services/socket.service';
import { FileuploadService } from 'src/app/services/fileupload.service';
import { HelpDialogService } from '../help-dialog/help-dialog.service';

export interface CloneStatusEvent {
  id: string;
  status: 'NOT_SCHEDULED' | 'SCHEDULED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
  msg?: string;
  outputPath?: string;
  ts?: number;
}

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent implements OnInit, OnDestroy {
  // Data
  actions: CloneActionModel[] = [];
  filteredActions: CloneActionModel[] = [];
  pagedActions: CloneActionModel[] = [];

  // UI state
  globalSearch = '';
  pageSize = 5;
  pageIndex = 0;

  private sub?: Subscription;
  private sockSub?: Subscription;                 // 👈 NEW
  selected: CloneActionModel | null = null;

  // Preview player
  previewFileId: string | null = null;
  previewShowRegion = false; // enable when previewing soundEffect

  private sfxFileIdCache = new Map<string, string>();

  // Track what we're previewing
  private previewActionId: string | null = null;
  private previewType: 'content' | 'reference' | 'sound' | null = null;

  constructor(
    private cloneSvc: CloneActionsService,
    private snackbar: SnackbarService,
    private perms: PermissionService,
    private dialog: MatDialog,
    private sfxSvc: SoundEffectsService,
    private sockets: SocketService,
    private filesSvc: FileuploadService,
    private help: HelpDialogService,
  ) { }

  onInfoClick(sectionKey: string): void {
    this.help.open(sectionKey);
  }

  // ------- Permissions (adjust keys to your system) -------
  get canRead() { return this.perms.hasKey('CLONE_ACTIONS_READ') || this.perms.hasKey('TARGETS_READ'); }
  get canCreate() { return this.perms.hasKey('CLONE_ACTIONS_CREATE') || this.perms.hasKey('TARGETS_CREATE'); }
  get canUpdate() { return this.perms.hasKey('CLONE_ACTIONS_UPDATE') || this.perms.hasKey('TARGETS_UPDATE'); }
  get canDelete() { return this.perms.hasKey('CLONE_ACTIONS_DELETE') || this.perms.hasKey('TARGETS_DELETE'); }

  canScheduleClone(a: CloneActionModel): boolean {
    // allow brand-new, failed (retry), done (reclone), and cancelled
    const schedulable = ['NOT_SCHEDULED', 'FAILED', 'DONE', 'CANCELLED', undefined] as any[];
    return (this.canCreate || this.canUpdate) && schedulable.includes(a.status as any);
  }

  canCancelClone(a: CloneActionModel): boolean {
    return (this.canUpdate || this.canDelete) && (a.status === 'SCHEDULED' || a.status === 'RUNNING');
  }

  canRetry(a: CloneActionModel): boolean {
    return a.status === 'DONE' || a.status === 'FAILED';
  }

  ngOnInit(): void {
    if (this.canRead) {
      this.cloneSvc.getAll();
      this.sub = this.cloneSvc.getAllListener().subscribe(list => {
        this.actions = Array.isArray(list) ? list : (list || []);
        // If the selected action vanished, clear preview too
        if (this.previewActionId && !this.actions.some(x => x.id === this.previewActionId)) {
          this.destroyPreview();
        }



        // (Re)subscribe to rooms for current actions
        for (const a of this.actions) {
          if (a?.id) this.sockets.subscribeClone?.(a.id);     // 👈 needs sockets service helper (see note below)
        }


        this.applyFilter();
      });



      // Live clone status
      this.sockSub = this.sockets.onCloneStatus?.().subscribe((evt: CloneStatusEvent) => {
        this.applyCloneEvent(evt);
      });
    }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.sockSub?.unsubscribe();
    for (const a of this.actions) if (a?.id) this.sockets.unsubscribeClone?.(a.id);
  }



  // Update a single row from socket event
  private applyCloneEvent(evt: CloneStatusEvent) {
    if (!evt?.id) return;
    const idx = this.actions.findIndex(x => x.id === evt.id);
    if (idx < 0) return;

    const row = { ...this.actions[idx] };
    row.status = evt.status as any;
    // If your backend includes outputPath, attach it:
    if (typeof (evt as any).outputPath === 'string') {
      (row as any).outputPath = (evt as any).outputPath;
    }

    this.actions[idx] = row;
    this.applyFilter();

    // Toast on terminal states
    if (evt.status === 'DONE') {
      this.snackbar.openSnackBar('✅ تم اكتمال الاستنساخ بنجاح', 'success');
    } else if (evt.status === 'FAILED') {
      const reason = evt.msg ? `: ${evt.msg}` : '';
      this.snackbar.openSnackBar(`❌ فشل الاستنساخ${reason}`, 'error');
    }
  }

  /** Resolve FileUpload id whether populated or plain id string */
  private getOutputFileId(a: CloneActionModel): string | null {
    const op: any = (a as any)?.outputPath;
    if (!op) return null;
    if (typeof op === 'string') return op;
    return op.id || op._id || null;
  }

  onDownload(a: CloneActionModel): void {
    const id = this.getOutputFileId(a);
    if (!id) {
      this.snackbar.openSnackBar('ملف النتيجة غير متوفر', 'failure');
      return;
    }

    // Always download via Blob to avoid opening a tab without token
    this.filesSvc.retrieveFile(id, false).subscribe({
      next: (blob) => {
        const filename = (this.getOutputFilename(a) || 'cloned.wav').replace(/\s+/g, '_');

        const url = window.URL.createObjectURL(blob);
        const aTag = document.createElement('a');
        aTag.href = url;
        aTag.download = filename;
        document.body.appendChild(aTag);
        aTag.click();
        aTag.remove();
        window.URL.revokeObjectURL(url);
      },
      error: () => this.snackbar.openSnackBar('تعذر تنزيل الملف', 'failure'),
    });
  }


  /** Fully destroy the current preview (removes component via *ngIf) */
  private destroyPreview(): void {
    this.previewFileId = null;
    this.previewShowRegion = false;
    this.previewActionId = null;
    this.previewType = null;
  }

  /** Reset + (re)open a preview on next tick so Angular destroys the old instance first */
  private openPreviewNextTick(fileId: string, showRegion: boolean, a?: CloneActionModel, type: 'content' | 'reference' | 'sound' = 'content'): void {
    // 1) destroy current instance (triggers <app-wavesurfer> ngOnDestroy)
    this.destroyPreview();

    // 2) next tick: set new inputs so Angular creates a fresh instance
    setTimeout(() => {
      this.previewFileId = fileId;
      this.previewShowRegion = showRegion;
      this.previewActionId = a?.id ?? null;
      this.previewType = type;
    }, 0);
  }

  openCloneDialog(): void {
    const ref = this.dialog.open<CloneDialogComponent, any, CloneDialogResult>(CloneDialogComponent, {
      width: '820px',
      maxWidth: '95vw',
      panelClass: 'card-dialog-panel',
      data: { mode: 'create' }
    });

    ref.afterClosed().subscribe(result => {
      if (!result?.confirmed) return;
      this.cloneSvc.create({
        scenario: result.scenario,
        contentAudioId: result.contentAudioId,
        targetId: result.targetId,
        referenceAudioId: result.referenceAudioId,
        soundEffectId: result.soundEffectId ?? undefined,
        diffusion: result.diffusion,
        length: result.length,
        inference_rate: result.inference_rate,
      }).subscribe(r => {
        if (r.status === 201 || r.status === 200) {
          this.snackbar.openSnackBar('تم إنشاء إجراء الاستنساخ', 'success');
          // refresh your list
          this.cloneSvc.getAll();
        }
      });
    });
  }

  // ...

  statusLabel(s?: string): string {
    switch (s) {
      case 'SCHEDULED': return 'مُجدوَل للاستنساخ';
      case 'RUNNING': return 'جاري الاستنساخ';
      case 'DONE': return 'تم الاستنساخ';
      case 'FAILED': return 'فشل الاستنساخ';
      case 'CANCELLED': return 'أُلغي';
      case 'NOT_SCHEDULED':
      default: return 'غير مُجدوَل';
    }
  }

  statusClass(s?: string): string {
    switch (s) {
      case 'SCHEDULED': return 'bg-info';
      case 'RUNNING': return 'bg-warning text-dark';
      case 'DONE': return 'bg-success';
      case 'FAILED': return 'bg-danger';
      case 'CANCELLED': return 'bg-secondary';
      case 'NOT_SCHEDULED':
      default: return 'bg-secondary';
    }
  }

  onAddCloneAction(): void {
    if (!this.canCreate) return;
    this.openCloneDialog(); // reuse the create dialog you already wrote
  }

  onEditAction(a: CloneActionModel): void {
    if (!this.canUpdate) return;

    const ref = this.dialog.open<CloneDialogComponent, any, CloneDialogResult>(CloneDialogComponent, {
      width: '820px',
      maxWidth: '95vw',
      panelClass: 'card-dialog-panel',
      data: {
        mode: 'edit',
        initial: {
          targetId: a.targetId,
          scenario: a.scenario || '',
          contentAudioId: a.contentAudioId,
          referenceAudioId: a.referenceAudioId,
          soundEffectTypeId: '',
          soundEffectId: a.soundEffectId || '',
          diffusion: a.diffusion,
          length: a.length,
          inference_rate: a.inference_rate,
        }
      }
    });

    ref.afterClosed().subscribe(result => {
      if (!result?.confirmed) return;

      this.cloneSvc.update(a.id, {
        scenario: result.scenario,
        contentAudioId: result.contentAudioId,
        targetId: result.targetId,
        referenceAudioId: result.referenceAudioId,
        soundEffectId: result.soundEffectId ?? undefined,
        diffusion: result.diffusion,
        length: result.length,
        inference_rate: result.inference_rate,
      }).subscribe({
        next: (r) => {
          if (r.status === 200) {
            this.snackbar.openSnackBar('تم تحديث إجراء الاستنساخ', 'success');

            // 👇 Auto-reschedule after update
            this.cloneSvc.schedule(a.id).subscribe({
              next: (res) => {
                const msg = res?.body?.message || 'تمت جدولة الاستنساخ بعد التعديل';
                this.snackbar.openSnackBar(msg, 'success');

                // Optimistic UI: mark as SCHEDULED immediately
                (a as any).status = 'SCHEDULED';

                // Ensure socket room is active for live updates
                if (a?.id) this.sockets.subscribeClone?.(a.id);

                this.cloneSvc.getAll(); // refresh list
              },
              error: () => {
                this.snackbar.openSnackBar('تَمّ التحديث ولكن فشلت الجدولة التلقائية', 'failure');
                this.cloneSvc.getAll(); // still refresh to reflect the new fields
              }
            });
          }
        },
        error: () => this.snackbar.openSnackBar('فشل تحديث إجراء الاستنساخ', 'failure')
      });
    });
  }


  canReclone(a: CloneActionModel): boolean {
    return a.status === 'DONE';
  }

  onReclone(a: CloneActionModel): void {
    // Just call schedule; backend will set SCHEDULED again
    this.onScheduleClone(a);
  }



  onScheduleClone(a: CloneActionModel): void {
    if (!this.canScheduleClone(a)) return;
    this.cloneSvc.schedule(a.id).subscribe({
      next: (res) => {
        const msg = res?.body?.message || 'تمت جدولة الاستنساخ';
        this.snackbar.openSnackBar(msg, 'success');

        // Optimistic: align with backend which sets SCHEDULED
        (a as any).status = 'SCHEDULED';

        // Ensure we’re in the room for live updates
        if (a?.id) this.sockets.subscribeClone?.(a.id);

        this.cloneSvc.getAll();
      },
      error: () => this.snackbar.openSnackBar('فشل جدولة الاستنساخ', 'failure')
    });
  }

  onCancelClone(a: CloneActionModel): void {
    if (!this.canCancelClone(a)) return;
    this.cloneSvc.cancel(a.id).subscribe({
      next: (res: any) => {
        const removed = !!res?.body?.removed;
        const msg = removed
          ? 'تم إلغاء الجدولة وإزالة الطلب من قائمة الانتظار'
          : 'تم إلغاء الجدولة (قد يكون العمل قيد التنفيذ)';
        this.snackbar.openSnackBar(msg, 'success');

        // Align with backend policy: set NOT_SCHEDULED immediately
        (a as any).status = 'NOT_SCHEDULED';

        this.cloneSvc.getAll();
      },
      error: (err) => {
        const backendMsg = err;
        this.snackbar.openSnackBar(`فشل إلغاء الاستنساخ: ${backendMsg}`, 'failure');
      },
    });
  }

  onDeleteAction(a: CloneActionModel): void {
    if (!this.canDelete) return;

    const ok = confirm(`هل تريد حذف إجراء الاستنساخ المرتبط بالهدف "${a.target?.name || a.targetId}"؟`);
    if (!ok) return;

    this.cloneSvc.delete(a.id).subscribe({
      next: (res: { status: number }) => {
        if (res.status === 200) {
          this.snackbar.openSnackBar('تم حذف الإجراء بنجاح', 'success');

          // 👇 If the currently previewed file belongs to this action, destroy the player
          const idsToCheck = new Set<string>();
          // content/ref chips use fileId==id (as you display in chips)
          if (a.contentAudio?.id) idsToCheck.add(a.contentAudio.id);
          if (a.contentAudioId) idsToCheck.add(a.contentAudioId);
          if (a.referenceAudio?.id) idsToCheck.add(a.referenceAudio.id);
          if (a.referenceAudioId) idsToCheck.add(a.referenceAudioId);

          // sound effect preview uses the *file* id, not the effect id
          const seKey = a.soundEffect?.id || a.soundEffectId || '';
          const seFileId =
            (a.soundEffect?.fileId && typeof a.soundEffect.fileId === 'object' && '_id' in a.soundEffect.fileId)
              ? (a.soundEffect.fileId as any)._id
              : (typeof a.soundEffect?.fileId === 'string' ? a.soundEffect.fileId : (seKey ? this.sfxFileIdCache.get(seKey) : undefined));
          if (seFileId) idsToCheck.add(seFileId);

          if (this.previewFileId && idsToCheck.has(this.previewFileId)) {
            this.destroyPreview();
          }

          this.cloneSvc.getAll(); // refresh list
        }
      }
    });
  }

  // Preview: open wavesurfer for the given fileId
  onChipClick(id: string, isSoundEffect: boolean, a?: CloneActionModel): void {
    if (!id) return;

    if (!isSoundEffect) {
      // content or reference audio: no regions
      this.openPreviewNextTick(id, false, a, 'content');
      return;
    }

    // 🔉 Sound effect: try to resolve its fileId locally first
    const sfx = a?.soundEffect;
    let fileId: string | null = null;

    if (sfx?.fileId && typeof sfx.fileId === 'object' && '_id' in sfx.fileId) {
      fileId = (sfx.fileId as any)._id;
    } else if (typeof sfx?.fileId === 'string') {
      fileId = sfx.fileId;
    }

    if (fileId) {
      this.openPreviewNextTick(fileId, true, a, 'sound');
      return;
    }

    // Otherwise, use cache or fetch once
    const cached = this.sfxFileIdCache.get(id);
    if (cached) {
      this.openPreviewNextTick(cached, true, a, 'sound');
      return;
    }

    this.sfxSvc.getEffect(id).subscribe({
      next: (res) => {
        const effect = res.body;
        const fid = effect?.fileId?._id || effect?.fileId;
        if (fid) {
          this.sfxFileIdCache.set(id, fid);
          this.openPreviewNextTick(fid, true, a, 'sound');
        } else {
          this.snackbar.openSnackBar('ملف التأثير الصوتي غير متوفر', 'failure');
        }
      },
      error: () => this.snackbar.openSnackBar('تعذر تحميل التأثير الصوتي', 'failure'),
    });
  }


  getSoundEffectFilename(a: CloneActionModel): string {
    const se = a?.soundEffect;
    if (!se) return a?.soundEffectId || '—';
    // Prefer real filename; fall back to effect name, then fileId, then the raw soundEffectId
    return se.file?.filename || se.name || se.fileId || a.soundEffectId || '—';
  }

  // ------- Selection -------
  onRowSelect(a: CloneActionModel): void {
    this.selected = (this.selected?.id === a.id) ? null : a;
  }
  isSelected(a: CloneActionModel): boolean {
    return !!this.selected && this.selected.id === a.id;
  }

  // ------- Search & paging -------

  /** ✅ True if we can show the result chip (we tolerate id-only or populated object) */
  hasOutputFile(a: CloneActionModel): boolean {
    // Cases:
    //  - populated { outputPath: { id/_id, filename, ... } }
    //  - id string { outputPath: 'ObjectIdString' } (from socket just after success)
    return !!(
      (a as any)?.outputPath?.id ||
      (a as any)?.outputPath?._id ||
      typeof (a as any)?.outputPath === 'string'
    );
  }

  /** ✅ Get the display name for the result chip */
  getOutputFilename(a: CloneActionModel): string {
    const op: any = (a as any)?.outputPath;
    // Prefer populated filename if available; else Arabic fallback
    return (op && typeof op === 'object' && (op.filename || op.file?.filename)) || 'الصوت_المستنسخ.wav';
  }

  /** ✅ Click handler for the result chip */
  onResultChipClick(a: CloneActionModel): void {
    // Resolve FileUpload id whether populated or id-string
    const op: any = (a as any)?.outputPath;
    const id =
      (op && typeof op === 'object' && (op.id || op._id)) ||
      (typeof op === 'string' ? op : null);
    if (!id) {
      this.snackbar.openSnackBar('ملف النتيجة غير متوفر', 'failure');
      return;
    }
    // Same behavior as other audio chips (no regions)
    this.openPreviewNextTick(id, false, a, 'content');
  }

  applyFilter(): void {
    const q = (this.globalSearch || '').trim().toLowerCase();

    this.filteredActions = q
      ? (this.actions || []).filter(a => {
        const targetName = (a.target?.name || '').toLowerCase();
        const scenario = (a.scenario || '').toLowerCase();

        const ca = ((a.contentAudio?.filename || a.contentAudioId || '') as string).toLowerCase();
        const ra = ((a.referenceAudio?.filename || a.referenceAudioId || '') as string).toLowerCase();

        // 🔊 sound-effect fields
        const seName = (a.soundEffect?.name || '').toLowerCase();
        const seFile = (a.soundEffect?.file?.filename || '').toLowerCase();
        const seType = (a.soundEffect?.soundEffectType?.soundEffectType || '').toLowerCase();
        const seId = (a.soundEffectId || '').toLowerCase();

        // also use the same label you show in the chip
        const seChip = (this.getSoundEffectFilename(a) || '').toLowerCase();

        const opFile = (((a as any)?.outputPath?.filename) || '').toLowerCase();


        return (
          targetName.includes(q) ||
          scenario.includes(q) ||
          ca.includes(q) ||
          ra.includes(q) ||
          seName.includes(q) ||     // ✅ effect name
          seFile.includes(q) ||     // ✅ effect file filename
          seType.includes(q) ||     // ✅ effect type label
          seId.includes(q) ||     // ✅ raw effect id
          seChip.includes(q) ||
          opFile.includes(q)
        );
      })
      : (this.actions || []).slice();

    this.pageIndex = 0;
    this.updatePaged();
  }

  onPageChange(e: PageEvent): void {
    this.pageIndex = this.pageSize !== e.pageSize ? 0 : e.pageIndex;
    this.pageSize = e.pageSize;
    this.updatePaged();
  }

  private updatePaged(): void {
    const start = this.pageIndex * this.pageSize;
    const end = start + this.pageSize;
    this.pagedActions = this.filteredActions.slice(start, end);
  }

  // ------- Refresh -------
  refresh(): void {
    this.cloneSvc.getAll();
    this.snackbar.openSnackBar('تم تحديث قائمة الإجراءات', 'success');
  }
}
