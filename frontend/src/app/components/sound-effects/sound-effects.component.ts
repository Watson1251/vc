import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { PageEvent } from '@angular/material/paginator';
import { Subscription } from 'rxjs';

import { SoundEffectTypeModel } from '../../models/sound-effect-type.model';
import { SoundEffectModel } from '../../models/sound-effect.model';
import { SoundEffectTypesService } from '../../services/sound-effect-types.service';
import { SoundEffectsService } from '../../services/sound-effects.service';
import { SnackbarService } from '../../services/snackbar.service';
import { PermissionService } from '../../services/permissions.service';
import { MatDialog } from '@angular/material/dialog';
import { SoundEffectDialogData, SoundEffectDialogResult, SoundEffectsDialogComponent } from './sound-effects-dialog/sound-effects-dialog.component';
import { CategoryDialogData, CategoryDialogComponent, CategoryDialogResult } from './category-dialog/category-dialog.component';
import { HelpDialogService } from '../help-dialog/help-dialog.service';

@Component({
  selector: 'app-sound-effects',
  templateUrl: './sound-effects.component.html',
  styleUrls: ['./sound-effects.component.scss']
})
export class SoundEffectsComponent implements OnInit, OnDestroy {
  /** UI copy */
  titleLabel = 'اختر مؤثرًا صوتيًا من القائمة!';

  // sound-effects.component.ts (class fields)
  /** Types + active tab/index */
  types: SoundEffectTypeModel[] = [];
  activeTypeId: string | null = null;
  activeItem: number | null = null;

  /** Sound effects (active type view + global stash) */
  effects: SoundEffectModel[] = [];
  filteredEffects: SoundEffectModel[] = [];
  pagedEffects: SoundEffectModel[] = [];
  allEffects: SoundEffectModel[] = [];

  /** Search + pagination */
  searchTerm = '';
  pageSize = 5;
  pageIndex = 0;
  cropPreviews = true; // or false by default

  private typesIndex = new Map<string, string>();

  /** Subscriptions */
  private typesSub?: Subscription;
  private effectsSub?: Subscription;

  /** Lazy counts for badges (if you need later) */
  private countByType = new Map<string, number>();

  selectedEffect: SoundEffectModel | null = null;

  constructor(
    private typesSvc: SoundEffectTypesService,
    private effectsSvc: SoundEffectsService,
    private snackbar: SnackbarService,
    private perms: PermissionService,
    private dialog: MatDialog,
    private help: HelpDialogService,
  ) { }

  onInfoClick(sectionKey: string): void {
    this.help.open(sectionKey);
  }

  // ------- Permissions -------
  get canReadEffects() { return this.perms.hasKey('SOUND_EFFECTS_READ'); }
  get canCreateEffects() { return this.perms.hasKey('SOUND_EFFECTS_CREATE'); }
  get canUpdateEffects() { return this.perms.hasKey('SOUND_EFFECTS_UPDATE'); }
  get canDeleteEffects() { return this.perms.hasKey('SOUND_EFFECTS_DELETE'); }

  get canCreateType() { return this.perms.hasKey('SOUND_EFFECT_TYPES_CREATE'); }
  get canUpdateType() { return this.perms.hasKey('SOUND_EFFECT_TYPES_UPDATE'); }
  get canDeleteType() { return this.perms.hasKey('SOUND_EFFECT_TYPES_DELETE'); }

  // ------- Lifecycle -------
  ngOnInit(): void {
    // fetch types and keep them fresh
    this.typesSvc.getTypes();
    this.typesSub = this.typesSvc.getTypesUpdateListener().subscribe(list => {
      this.types = list || [];
      this.rebuildTypesIndex();

      if (this.types.length === 0) {
        this.activeTypeId = null;
        this.activeItem = null;
        this.resetEffectsState();
        return;
      }

      // If nothing selected yet, default to first type.
      if (this.activeTypeId === null || !this.types.find(t => t.id === this.activeTypeId)) {
        this.activeTypeId = this.types[0].id;
      }

      const idx = this.types.findIndex(t => t.id === this.activeTypeId);
      this.activeItem = idx >= 0 ? idx : 0;

      // load all effects (listener rebuilds active view)
      if (this.activeTypeId) this.loadEffects(this.activeTypeId);
    });

    this.effectsSvc.getEffects();
    this.effectsSub = this.effectsSvc.getEffectsUpdateListener().subscribe(list => {
      this.allEffects = Array.isArray(list) ? list : (list || []);

      this.rebuildActiveView();
    });
  }

  ngOnDestroy(): void {
    this.typesSub?.unsubscribe();
    this.effectsSub?.unsubscribe();
  }

  private rebuildTypesIndex(): void {
    this.typesIndex.clear();
    for (const t of this.types) {
      const anyT: any = t as any;
      if (anyT?._id) this.typesIndex.set(String(anyT._id), t.soundEffectType);
      if (t.id) this.typesIndex.set(String(t.id), t.soundEffectType);
    }
  }

  // ------- Tabs wiring -------
  onTabIndexChange(i: number): void {
    this.activeItem = i;
    const t = this.types[i];
    this.activeTypeId = t?.id ?? null;

    this.pageIndex = 0;
    this.searchTerm = '';
    this.rebuildActiveView();
  }

  private activate(typeId: string): void {
    this.activeTypeId = typeId;
    this.pageIndex = 0;
    this.searchTerm = '';
    this.loadEffects(typeId);
  }

  get selectedMatIndex(): number {
    const idx = this.types.findIndex(t => t.id === this.activeTypeId);
    return idx >= 0 ? idx : 0;
  }

  // ------- Loading effects (active type only via stash) -------
  private loadEffects(_typeId: string): void {
    if (!this.canReadEffects) { this.resetEffectsState(); return; }

    this.effectsSub?.unsubscribe();
    this.effectsSub = this.effectsSvc.getEffectsUpdateListener().subscribe(list => {
      this.allEffects = Array.isArray(list) ? list : (list || []);
      this.rebuildActiveView();
    });

    // fetch ALL effects from backend (service should expose unfiltered endpoint)
    this.effectsSvc.getEffects();
  }

  private rebuildActiveView(): void {
    if (this.activeTypeId) {
      this.effects = (this.allEffects || []).filter(e => e.soundEffectTypeId === this.activeTypeId);
    } else {
      // (shouldn’t happen) fallback
      this.effects = [];
    }

    // Recompute counts
    this.countByType.clear();
    for (const e of this.allEffects || []) {
      const k = e.soundEffectTypeId;
      this.countByType.set(k, (this.countByType.get(k) ?? 0) + 1);
    }

    this.applyFilter();
  }

  private resetEffectsState(): void {
    this.effects = [];
    this.filteredEffects = [];
    this.pagedEffects = [];
    this.pageIndex = 0;
    this.selectedEffect = null;
  }

  // sound-effects.component.ts
  get hasSelectedEffect(): boolean {
    return !!this.selectedEffect;
  }

  // ------- Filters & Paging -------
  applyFilter(): void {
    const q = this.searchTerm.trim().toLowerCase();
    this.filteredEffects = q
      ? this.effects.filter(e => (e.name || '').toLowerCase().includes(q))
      : this.effects.slice();

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
    this.pagedEffects = this.filteredEffects.slice(start, end);
  }

  // Safely resolve the file id (supports populated file object or raw id)
  getFileId(se: SoundEffectModel): string | null {
    return this.resolveFileIdFromEffect(se);
  }

  // Helper to safely pull fileId + filename off a row
  private resolveFileMeta(se: SoundEffectModel): { fileId?: string | null; fileName?: string | null; file?: any } {
    const fileObj: any = (se as any).file ?? null;
    const fileId = fileObj?.id || fileObj?._id || (se as any).fileId || null;
    const fileName = fileObj?.filename || null;
    return { fileId, fileName, file: fileObj };
  }

  initialRegionFor(se: SoundEffectModel):
    | { start?: number; end?: number }
    | undefined {
    const s = (se as any)?.start;
    const e = (se as any)?.end;

    const isNum = (v: any) => typeof v === 'number' && Number.isFinite(v);
    if (isNum(s) && isNum(e) && e > s) {
      return { start: s, end: e };
    }
    // no valid region on this row
    return undefined;
  }

  // CREATE
  onAddEffect(): void {
    if (!this.canCreateEffects || !this.hasActiveType) return;

    const dlgRef = this.dialog.open<
      SoundEffectsDialogComponent,
      SoundEffectDialogData,
      SoundEffectDialogResult
    >(SoundEffectsDialogComponent, {
      width: '640px',
      maxWidth: '95vw',
      autoFocus: true,
      disableClose: false,
      panelClass: 'card-dialog-panel',
      data: {
        mode: 'create',
        types: this.types,
        selectedTypeId: this.activeTypeId || null,
      },
    });

    dlgRef.afterClosed().subscribe(result => {
      if (!result?.confirmed || result.mode !== 'create') return;

      this.effectsSvc.createEffect({
        name: result.name!,
        soundEffectTypeId: result.soundEffectTypeId!,
        fileId: result.fileId!,
        start: typeof result.start === 'number' ? result.start : (result.start === null ? null : undefined),
        end: typeof result.end === 'number' ? result.end : (result.end === null ? null : undefined),
      }).subscribe({
        next: () => {
          this.snackbar.openSnackBar('تم إنشاء المؤثر بنجاح', 'success');
          this.effectsSvc.getEffects();
        }
      });
    });
  }

  // Safely resolve a file id from a SoundEffectModel (supports populated or raw)
  private resolveFileIdFromEffect(se: SoundEffectModel): string | null {
    const f: any = (se as any).file || null;
    return (f?._id || f?.id || (se as any).fileId || null) ?? null;
  }

  // EDIT
  onEditEffect(se: SoundEffectModel): void {
    if (!this.canUpdateEffects) return;

    const existingFileId = this.resolveFileIdFromEffect(se);

    const dlgRef = this.dialog.open<
      SoundEffectsDialogComponent,
      SoundEffectDialogData,
      SoundEffectDialogResult
    >(SoundEffectsDialogComponent, {
      width: '640px',
      maxWidth: '95vw',
      autoFocus: true,
      disableClose: false,
      panelClass: 'card-dialog-panel',
      data: {
        mode: 'edit',
        types: this.types,
        selectedTypeId: se.soundEffectTypeId,
        initial: {
          id: se.id,
          name: se.name,
          soundEffectTypeId: se.soundEffectTypeId,
          fileId: existingFileId, // may be null; dialog will show dropzone if missing
          // ⬇️ seed
          start: typeof se.start === 'number' ? se.start : null,
          end: typeof se.end === 'number' ? se.end : null,
        }
      },
    });

    dlgRef.afterClosed().subscribe(result => {
      if (!result?.confirmed || result.mode !== 'edit') return;

      this.effectsSvc.updateEffect(se.id, {
        name: result.name!,
        soundEffectTypeId: result.soundEffectTypeId!,
        fileId: result.fileId!, // either original (verified) or newly uploaded
        start: typeof result.start === 'number' ? result.start : (result.start === null ? null : undefined),
        end: typeof result.end === 'number' ? result.end : (result.end === null ? null : undefined),

      }).subscribe({
        next: () => {
          this.snackbar.openSnackBar('تم تحديث المؤثر بنجاح', 'success');
          this.effectsSvc.getEffects();
        }
      });
    });
  }

  // DELETE
  onDeleteEffect(se: SoundEffectModel): void {
    if (!this.canDeleteEffects) return;

    const meta = this.resolveFileMeta(se);

    const dlgRef = this.dialog.open<
      SoundEffectsDialogComponent,
      SoundEffectDialogData,
      SoundEffectDialogResult
    >(SoundEffectsDialogComponent, {
      width: '520px',
      maxWidth: '95vw',
      autoFocus: true,
      disableClose: false,
      panelClass: 'card-dialog-panel',
      data: {
        mode: 'delete',
        types: this.types, // harmless
        initial: {
          id: se.id,
          name: se.name,
          soundEffectTypeId: se.soundEffectTypeId,
          fileId: meta.fileId ?? null,
          file: meta.file ?? null, // ⬅️ pass file object if present (may include filename)
        },
      },
    });

    dlgRef.afterClosed().subscribe(result => {
      if (!result?.confirmed || result.mode !== 'delete') return;

      this.effectsSvc.deleteEffect(se.id).subscribe({
        next: () => {
          this.snackbar.openSnackBar('تم حذف المؤثر بنجاح', 'success');
          this.effectsSvc.getEffects();
        }
      });
    });
  }


  // ------- Selection -------
  onRowSelectEffect(se: SoundEffectModel): void {
    this.selectedEffect = (this.selectedEffect?.id === se.id) ? null : se;
  }

  isEffectSelected(se: SoundEffectModel): boolean {
    return !!this.selectedEffect && this.selectedEffect.id === se.id;
  }

  // helper: collect existing names (current user only, since backend is user-scoped)
  private getExistingTypeNames(): string[] {
    return (this.types || []).map(t => t.soundEffectType || '').filter(Boolean);
  }

  // --- shared helper ---
  private openCategoryDialog(data: CategoryDialogData) {
    return this.dialog.open<CategoryDialogComponent, CategoryDialogData, CategoryDialogResult>(
      CategoryDialogComponent,
      {
        width: '560px',
        maxWidth: '95vw',
        autoFocus: true,
        disableClose: false,
        panelClass: 'card-dialog-panel',
        data
      }
    ).afterClosed();
  }

  // ------- Type controls (replaced prompts) -------
  // CREATE
  onAddType(): void {
    if (!this.canCreateType) return;
    this.openCategoryDialog({
      mode: 'create',
      existingNames: this.getExistingTypeNames(),
    }).subscribe(res => {
      if (!res?.confirmed || !res.name) return;
      this.typesSvc.createType({ soundEffectType: res.name }).subscribe({
        next: () => {
          this.snackbar.openSnackBar('تم إنشاء الفئة بنجاح', 'success');
          this.typesSvc.getTypes();
        }
      });
    });
  }

  // EDIT
  onTypeEdit(type: SoundEffectTypeModel): void {
    if (!this.canUpdateType) return;

    const idx = this.types.findIndex(x => x.id === type.id);
    if (idx >= 0) { this.activeItem = idx; this.activeTypeId = type.id; }

    const existing = this.getExistingTypeNames();
    this.openCategoryDialog({
      mode: 'edit',
      name: type.soundEffectType,
      existingNames: existing,
    }).subscribe(res => {
      if (!res?.confirmed || !res.name || res.name === type.soundEffectType) return;

      this.typesSvc.updateType(type.id, { soundEffectType: res.name }).subscribe({
        next: () => {
          this.snackbar.openSnackBar('تم تحديث الفئة بنجاح', 'success');
          this.typesSvc.getTypes();
        }
      });
    });
  }

  onDeleteType(): void {
    if (!this.canDeleteType || !this.activeTypeId) return;
    const active = this.types.find(t => t.id === this.activeTypeId);
    if (!active) return;

    this.openCategoryDialog({ mode: 'delete', name: active.soundEffectType }).subscribe(res => {
      if (!res?.confirmed) return;

      const id = this.activeTypeId!;
      this.typesSvc.deleteType(id).subscribe({
        next: () => {
          this.snackbar.openSnackBar('تم حذف الفئة بنجاح', 'success');
          this.typesSvc.getTypes();
          if (this.activeTypeId === id) {
            this.activeTypeId = null;
            this.activeItem = null;
            this.resetEffectsState();
          }
        }
      });
    });
  }

  // ------- Utilities -------
  get hasActiveType(): boolean {
    return this.activeItem !== null && this.activeItem !== undefined
      && this.types.length > 0
      && this.activeItem >= 0
      && this.activeItem < this.types.length;
  }

  getActiveType(): SoundEffectTypeModel | null {
    return this.hasActiveType ? this.types[this.activeItem!] : null;
  }

  getEffectCount(typeId: string): number {
    return this.countByType.get(typeId) ?? 0;
  }

  private refreshTypesAndEffects(message?: string): void {
    this.typesSvc.getTypes();
    this.effectsSvc.getEffects();
    if (message) this.snackbar.openSnackBar(message, 'success');
  }

  refresh(): void {
    this.typesSvc.getTypes();
    this.effectsSvc.getEffects();
    this.snackbar.openSnackBar('تم تحديث مكتبات المؤثرات الصوتية', 'success');
  }
}
