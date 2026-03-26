import { Component, OnDestroy, OnInit } from '@angular/core';
import { PageEvent } from '@angular/material/paginator';
import { Subscription } from 'rxjs';

import { TargetModel } from '../../models/target.model';
import { SnackbarService } from '../../services/snackbar.service';
import { PermissionService } from '../../services/permissions.service';
import { TargetsService } from 'src/app/services/targets.services';
import { SocketService, TargetStatusEvent } from 'src/app/services/socket.service';

// ⬇️ NEW: import your custom dialog + its types
import { MatDialog } from '@angular/material/dialog';
import {
  TargetsDialogComponent,
  TargetsDialogData,
  TargetsDialogResult
} from './targets-dialog/targets-dialog.component';
import { HelpDialogService } from '../help-dialog/help-dialog.service';

@Component({
  selector: 'app-targets',
  templateUrl: './targets.component.html',
  styleUrls: ['./targets.component.scss'],
})
export class TargetsComponent implements OnInit, OnDestroy {
  // Data
  targets: TargetModel[] = [];
  filteredTargets: TargetModel[] = [];
  pagedTargets: TargetModel[] = [];

  // UI state
  globalSearch = '';
  pageSize = 5;
  pageIndex = 0;

  private sub?: Subscription;
  selected: TargetModel | null = null;

  private readonly STEP = 3;


  // Per-row visible counts
  private shownCountsRef = new Map<string, number>();   // targetId -> count for reference
  private shownCountsTrain = new Map<string, number>(); // targetId -> count for training

  private sockSub?: Subscription;

  constructor(
    private targetsSvc: TargetsService,
    private snackbar: SnackbarService,
    private perms: PermissionService,
    // ⬇️ NEW
    private dialog: MatDialog,
    private sockets: SocketService,
    private help: HelpDialogService,
  ) { }

  onInfoClick(sectionKey: string): void {
    this.help.open(sectionKey);
  }

  // ------- Permissions -------
  get canRead() { return this.perms.hasKey('TARGETS_READ'); }
  get canCreate() { return this.perms.hasKey('TARGETS_CREATE'); }
  get canUpdate() { return this.perms.hasKey('TARGETS_UPDATE'); }
  get canDelete() { return this.perms.hasKey('TARGETS_DELETE'); }

  // --- Preview logic ---
  previewFileId: string | null = null;

  statusLabel(s?: string): string {
    switch (s) {
      case 'SCHEDULED': return 'مُجدوَل للتدريب';
      case 'STARTED_TRAINING': return 'جاري التدريب';
      case 'DONE': return 'تم التدريب';
      case 'FAILED': return 'فشل التدريب'; // ⬅️ NEW
      case 'NOT_SCHEDULED':
      default: return 'غير مُجدوَل للتدريب';
    }
  }

  statusClass(s?: string): string {
    // Bootstrap-like badge classes (adapt to your design system if needed)
    switch (s) {
      case 'SCHEDULED': return 'bg-info';
      case 'STARTED_TRAINING': return 'bg-warning text-dark';
      case 'DONE': return 'bg-success';
      case 'FAILED': return 'bg-danger'; // ⬅️ NEW
      case 'NOT_SCHEDULED':
      default: return 'bg-secondary';
    }
  }


  onChipClick(f: any): void {
    const id = (f && (f.id || f._id)) || null;
    if (id) this.previewFileId = id;
  }

  // ---- Status helpers for action button ----
  // ---- Status helpers for action button ----
  canTrain(t: TargetModel): boolean {
    // Allow training when not scheduled OR failed (acts as retry)
    return t.status === 'NOT_SCHEDULED' || t.status === 'FAILED'; // ⬅️ UPDATED
  }
  canCancel(t: TargetModel): boolean {
    return t.status === 'SCHEDULED' || t.status === 'STARTED_TRAINING';
  }
  canRetrain(t: TargetModel): boolean {
    return t.status === 'DONE';
  }

  trainBtnTitle(t: TargetModel): string {
    if (t.status === 'FAILED') return 'إعادة المحاولة'; // ⬅️ NEW (retry wording)
    if (this.canTrain(t)) return 'تدريب';
    if (this.canCancel(t)) return 'إلغاء الجدولة';
    if (this.canRetrain(t)) return 'إعادة التدريب';
    return 'غير متاح';
  }

  onTrain(t: TargetModel): void {
    this.targetsSvc.trainTarget(t.id).subscribe({
      next: (res) => {
        if (res.status === 200) {
          this.snackbar.openSnackBar('تمت جدولة التدريب', 'success');
          this.targetsSvc.getTargets(); // refresh list
        }
      }
    });
  }

  onRetrain(t: TargetModel): void {
    // Retrain == schedule again (backend resets to SCHEDULED + isTrained=false)
    this.targetsSvc.trainTarget(t.id).subscribe({
      next: (res) => {
        if (res.status === 200) {
          this.snackbar.openSnackBar('تمت إعادة جدولة التدريب', 'success');
          this.targetsSvc.getTargets();
        }
      }
    });
  }

  onCancelSchedule(t: TargetModel): void {
    this.targetsSvc.cancelTargetSchedule(t.id).subscribe({
      next: (res: any) => {
        const msg = res?.removed
          ? 'تم إلغاء الجدولة وإزالة الطلب من قائمة الانتظار'
          : 'تم إلغاء الجدولة (لا يوجد طلب مطابق في قائمة الانتظار)';
        this.snackbar.openSnackBar(msg, 'success');
        this.targetsSvc.getTargets();
      },
      error: () => {
        this.snackbar.openSnackBar('فشل إلغاء الجدولة', 'failure');
      }
    });
  }

  // Visible slice
  // targets.component.ts
  visibleFiles(t: TargetModel, kind: 'ref' | 'train'): any[] {
    const list = (kind === 'ref' ? (t.referenceAudio || []) : (t.trainingAudio || [])) as any[];
    if (kind === 'ref') return list.slice(0, 1);          // ⬅️ force single
    const n = this.currentCount(t, kind, list.length);
    return list.slice(0, n);
  }


  // Remaining count
  remainingCount(t: TargetModel, kind: 'ref' | 'train'): number {
    const list = kind === 'ref' ? (t.referenceAudio || []) : (t.trainingAudio || []);
    const n = this.currentCount(t, kind, list.length);
    return Math.max(0, list.length - n);
  }

  // Is fully expanded beyond the base STEP?
  isExpanded(t: TargetModel, kind: 'ref' | 'train'): boolean {
    const list = kind === 'ref' ? (t.referenceAudio || []) : (t.trainingAudio || []);
    return this.currentCount(t, kind, list.length) > this.STEP;
  }

  // Toggle: expand by STEP until fully shown; once fully shown, collapse to STEP
  onMoreClick(t: TargetModel, kind: 'ref' | 'train'): void {
    const list = kind === 'ref' ? (t.referenceAudio || []) : (t.trainingAudio || []);
    const map = kind === 'ref' ? this.shownCountsRef : this.shownCountsTrain;

    const current = this.currentCount(t, kind, list.length);

    if (current < list.length) {
      // expand (but not past the end)
      const next = Math.min(current + this.STEP, list.length);
      map.set(t.id, next);
    } else {
      // already fully expanded ⇒ collapse
      map.set(t.id, this.STEP);
    }
  }

  // Current count (clamped)
  private currentCount(t: TargetModel, kind: 'ref' | 'train', total: number): number {
    const map = kind === 'ref' ? this.shownCountsRef : this.shownCountsTrain;
    const saved = map.get(t.id) ?? this.STEP; // default 3
    return Math.min(Math.max(saved, this.STEP), total || 0);
  }

  // Utility helpers
  firstN<T>(arr: T[] | null | undefined, n = 3): T[] {
    const a = Array.isArray(arr) ? arr : [];
    return a.slice(0, Math.max(0, Math.min(n, a.length)));
  }

  remainderCount<T>(arr: T[] | null | undefined, n = 3): number {
    const a = Array.isArray(arr) ? arr : [];
    return Math.max(0, a.length - n);
  }

  ngOnInit(): void {
    if (this.canRead) {
      this.targetsSvc.getTargets();
      this.sub = this.targetsSvc.getTargetsUpdateListener().subscribe(list => {
        this.targets = Array.isArray(list) ? list : (list || []);
        this.applyFilter();

        // (Re)subscribe to visible targets’ rooms
        for (const t of this.targets) {
          if (t?.id) this.sockets.subscribeTarget(t.id);
        }
      });

      // Listen to live status
      this.sockSub = this.sockets.onTargetStatus().subscribe((evt) => this.applyTargetEvent(evt));
    }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.sockSub?.unsubscribe();

    // optional: leave rooms
    for (const t of this.targets) if (t?.id) this.sockets.unsubscribeTarget(t.id);
  }

  private applyTargetEvent(evt: TargetStatusEvent) {
    if (!evt?.id) return;
    const idx = this.targets.findIndex(x => x.id === evt.id);
    if (idx < 0) return;

    // Update row
    const t = { ...this.targets[idx] };
    t.status = evt.status as any;
    if (typeof evt.modelPath === 'string') t.modelPath = evt.modelPath;
    if (typeof evt.configPath === 'string') t.configPath = evt.configPath;

    this.targets[idx] = t;
    this.applyFilter(); // re-page

    // UX: toast on terminal states
    if (evt.status === 'DONE') {
      this.snackbar.openSnackBar('✅ تم اكتمال التدريب بنجاح', 'success');
    } else if (evt.status === 'FAILED') {
      const reason = evt.msg ? `: ${evt.msg}` : '';
      this.snackbar.openSnackBar(`❌ فشل التدريب${reason}`, 'failure');
    }
  }

  // ------- Selection -------
  onRowSelect(t: TargetModel): void {
    this.selected = (this.selected?.id === t.id) ? null : t;
  }
  isSelected(t: TargetModel): boolean {
    return !!this.selected && this.selected.id === t.id;
  }

  // ------- Search & paging -------
  applyFilter(): void {
    const q = (this.globalSearch || '').trim().toLowerCase();

    this.filteredTargets = q
      ? (this.targets || []).filter(t =>
        (t.name || '').toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q))
      : (this.targets || []).slice();

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
    this.pagedTargets = this.filteredTargets.slice(start, end);
  }

  // ------- Audio helpers (show 1st file only) -------
  firstRef(t: TargetModel): any | null {
    return (t?.referenceAudio && t.referenceAudio.length) ? t.referenceAudio[0] : null;
  }
  firstRefFileId(t: TargetModel): string | null {
    if (!t) return null;
    if (t.referenceAudio?.length) return t.referenceAudio[0].id || null;
    if (t.referenceAudioIds?.length) return t.referenceAudioIds[0] || null;
    return null;
  }
  firstTrainFileId(t: TargetModel): string | null {
    if (!t) return null;
    if (t.trainingAudio?.length) return t.trainingAudio[0].id || null;
    if (t.trainingAudioIds?.length) return t.trainingAudioIds[0] || null;
    return null;
  }

  // =========================
  // ===== CRUD via dialog ===
  // =========================

  onAddTarget(): void {
    if (!this.canCreate) return;

    const dlgRef = this.dialog.open<TargetsDialogComponent, TargetsDialogData, TargetsDialogResult>(
      TargetsDialogComponent,
      {
        width: '720px',
        maxWidth: '95vw',
        autoFocus: true,
        disableClose: false,
        panelClass: 'card-dialog-panel',
        data: { mode: 'create' }
      }
    );

    dlgRef.afterClosed().subscribe(result => {
      if (!result?.confirmed || result.mode !== 'create') return;

      this.targetsSvc.createTarget({
        name: result.name!,
        description: result.description || undefined,
        referenceAudioIds: result.referenceAudio || [],
        trainingAudioIds: result.trainingAudio || [],
      }).subscribe({
        next: (res) => {
          if (res.status === 201 || res.status === 200) {
            this.snackbar.openSnackBar('تم إنشاء الهدف بنجاح', 'success');
            this.targetsSvc.getTargets();
          }
        }
      });
    });
  }

  onEditTarget(t: TargetModel): void {
    if (!this.canUpdate) return;

    const initial: TargetsDialogData['initial'] = {
      id: t.id,
      name: t.name,
      description: t.description || '',

      // ✅ If populated arrays exist, pass lightweight objects with filename
      referenceAudio: Array.isArray(t.referenceAudio) && t.referenceAudio.length
        ? [{
          id: (t.referenceAudio[0] as any).id || (t.referenceAudio[0] as any)._id,
          filename: (t.referenceAudio[0] as any).filename || (t.referenceAudio[0] as any).name || ''
        }]
        : (t.referenceAudioIds && t.referenceAudioIds.length ? [t.referenceAudioIds[0]] : []),

      trainingAudio: Array.isArray(t.trainingAudio) && t.trainingAudio.length
        ? t.trainingAudio.map(f => ({
          id: (f as any).id || (f as any)._id,
          filename: (f as any).filename || (f as any).name || ''
        }))
        : (t.trainingAudioIds ? [...t.trainingAudioIds] : []),
    };

    const dlgRef = this.dialog.open<TargetsDialogComponent, TargetsDialogData, TargetsDialogResult>(
      TargetsDialogComponent,
      {
        width: '720px',
        maxWidth: '95vw',
        autoFocus: true,
        disableClose: false,
        panelClass: 'card-dialog-panel',
        data: { mode: 'edit', initial }
      }
    );

    dlgRef.afterClosed().subscribe(result => {
      if (!result?.confirmed || result.mode !== 'edit') return;

      this.targetsSvc.updateTarget(t.id, {
        name: result.name!,
        description: result.description || '',
        referenceAudioIds: result.referenceAudio ?? undefined,
        trainingAudioIds: result.trainingAudio ?? undefined,
      }).subscribe({
        next: (res) => {
          if (res.status === 200) {
            this.snackbar.openSnackBar('تم تحديث الهدف بنجاح', 'success');
            this.targetsSvc.getTargets();
          }
        }
      });
    });
  }

  onDeleteTarget(t: TargetModel): void {
    if (!this.canDelete) return;

    const dlgRef = this.dialog.open<TargetsDialogComponent, TargetsDialogData, TargetsDialogResult>(
      TargetsDialogComponent,
      {
        width: '480px',
        maxWidth: '95vw',
        autoFocus: true,
        disableClose: false,
        panelClass: 'card-dialog-panel',
        data: {
          mode: 'delete',
          initial: { id: t.id, name: t.name }
        }
      }
    );

    dlgRef.afterClosed().subscribe(result => {
      if (!result?.confirmed || result.mode !== 'delete') return;

      this.targetsSvc.deleteTarget(t.id).subscribe({
        next: (res) => {
          if (res.status === 200) {
            this.snackbar.openSnackBar('تم حذف الهدف بنجاح', 'success');
            this.targetsSvc.getTargets();
          }
        }
      });
    });
  }


  // ------- Refresh -------
  refresh(): void {
    this.targetsSvc.getTargets();
    this.snackbar.openSnackBar('تم تحديث قائمة الأهداف', 'success');
  }
}
