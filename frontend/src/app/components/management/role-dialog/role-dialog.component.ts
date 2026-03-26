import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { FormBuilder, Validators, FormControl, AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { RoleModel } from '../../../models/role.model';
import { PermissionModel } from '../../../models/permission.model';
import { SnackbarService } from 'src/app/services/snackbar.service';

type RoleDialogData = {
  mode: 'create' | 'edit';
  role: RoleModel;
  allPermissions: PermissionModel[];
  takenRoleNames: string[]; // ⬅️ add
};

type GroupKey = string;
type Group = { key: GroupKey; title: string; items: PermissionModel[] };

@Component({
  selector: 'app-role-dialog',
  templateUrl: './role-dialog.component.html',
  styleUrls: ['./role-dialog.component.scss']
})
export class RoleDialogComponent {
  title = 'دور جديد';
  allPermissions: PermissionModel[] = [];
  selected = new Set<string>();

  // optional quick search within permissions
  permSearch = new FormControl<string>('', { nonNullable: true });

  // grouped (filtered) list
  groups: Group[] = [];

  // === master indexes built from ALL permissions (not filtered) ===
  private byHash = new Map<string, PermissionModel>();
  private groupIndex = new Map<GroupKey, PermissionModel[]>();     // groupKey -> all perms in that group
  private groupReadHash = new Map<GroupKey, string | null>();      // groupKey -> *_READ hash if present
  private byKey = new Map<string, PermissionModel>();              // NEW: key -> perm

  private rolesReadHash: string | null = null;                      // NEW


  /** Hard-enforced read perms for all roles */
  private enforcedReadKeys = ['DEVICES_READ', 'LIBRARIES_READ', 'TWEETS_READ', 'ACTIONS_READ'] as const;
  private enforcedReadHashes = new Set<string>();

  // --- helper to disable chips in template ---
  isEnforcedRead(p?: PermissionModel): boolean {
    if (!p) return false;
    return this.enforcedReadHashes.has(p.hash);
  }

  private anyUsersSelected(): boolean {                              // NEW
    const users = this.groupIndex.get('USERS') || [];
    return users.some(p => this.selected.has(p.hash));
  }

  private ensureRolesReadIfUsers(): void {                           // NEW
    if (this.anyUsersSelected() && this.rolesReadHash) {
      this.selected.add(this.rolesReadHash);
    }
  }

  private librariesReadHash: string | null = null;
  private tweetsReadHash: string | null = null;

  private anySelectedInGroupKey(gk: GroupKey): boolean {
    const items = this.groupIndex.get(gk) || [];
    return items.some(i => this.selected.has(i.hash));
  }

  private ensureLibrariesReadIfTweets(): void {
    if (this.anySelectedInGroupKey('TWEETS') && this.librariesReadHash) {
      this.selected.add(this.librariesReadHash);
    }
  }

  // Arabic titles for known groups
  private groupTitles: Record<string, string> = {
    USERS: 'المستخدمون',
    ROLES: 'الأدوار',
    DEVICES: 'الأجهزة',
    FILES: 'الملفات',
    LIBRARIES: 'فئات مكتبات التغريدات',
    TWEETS: 'مكتبات التغريدات',
    ACTIONS: 'إجراءات الإغراق',
    OTHER: 'أخرى',
  };

  // preferred semantic order of groups
  private preferredGroupOrder: GroupKey[] = [
    'ROLES',
    'USERS',
    'DEVICES',
    'LIBRARIES',
    'TWEETS',
    'ACTIONS',
    'FILES',
    'OTHER',
  ];

  form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(64)]],
  });

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: RoleDialogData,
    private ref: MatDialogRef<RoleDialogComponent>,
    private fb: FormBuilder,
    private snackbar: SnackbarService
  ) {
    this.title = data.mode === 'edit' ? 'تعديل الدور' : 'دور جديد';
    this.allPermissions = (data.allPermissions ?? []).slice();

    // init selection
    if (data.role) {
      this.form.patchValue({ name: data.role.name });
      (data.role.permissionHashes || []).forEach(h => this.selected.add(h));
    }

    // attach uniqueness validator using the passed list
    const nameCtrl = this.form.controls.name;
    nameCtrl.addValidators(this.uniqueRoleNameValidator(this.data.takenRoleNames || []));
    nameCtrl.updateValueAndValidity({ emitEvent: false });

    // if edit mode, prefill name
    if (data.role?.name) {
      this.form.patchValue({ name: data.role.name });
    }

    // build master indexes once
    this.buildMasterIndex();
    // ensure enforced reads are always ON
    this.enforcedReadHashes.forEach(h => this.selected.add(h));

    // initial build + react to search
    this.rebuildGroups();
    this.permSearch.valueChanges.subscribe(() => this.rebuildGroups());

    this.ensureRolesReadIfUsers();
  }

  private orderOf(key: GroupKey): number {
    const idx = this.preferredGroupOrder.indexOf(key);
    return idx === -1 ? 999 : idx; // unknown groups go last
  }

  private rebuildGroups(): void {
    const q = (this.permSearch.value || '').trim().toLowerCase();
    const filtered = q
      ? this.allPermissions.filter(p =>
        (p.label || '').toLowerCase().includes(q) ||
        (p.key || '').toLowerCase().includes(q))
      : this.allPermissions;

    const map = new Map<GroupKey, PermissionModel[]>();
    for (const p of filtered) {
      const gk = this.getGroupKey(p);
      (map.get(gk) ?? map.set(gk, []).get(gk)!).push(p);
    }

    this.groups = Array.from(map.entries())
      .sort(([a], [b]) => this.orderOf(a) - this.orderOf(b))   // use preferred order
      .map(([key, items]) => ({
        key,
        title: this.getGroupTitle(key),
        items: items.sort((a, b) =>
          (a.label || a.key).localeCompare(b.label || b.key, 'ar'))
      }));
  }

  private uniqueRoleNameValidator(usedNames: string[]): ValidatorFn {
    const used = new Set((usedNames || []).map(s => (s || '').trim().toLowerCase()));
    return (control: AbstractControl): ValidationErrors | null => {
      const val = (control.value || '').trim().toLowerCase();
      if (!val) return null;
      return used.has(val) ? { roleNameTaken: true } : null;
    };
  }

  private buildMasterIndex(): void {
    this.byHash.clear(); this.byKey.clear();                         // NEW
    this.groupIndex.clear(); this.groupReadHash.clear();
    this.rolesReadHash = null;                                       // NEW
    this.librariesReadHash = null;       // ⬅️ NEW
    this.tweetsReadHash = null;          // ⬅️ NEW

    for (const p of this.allPermissions) {
      this.byHash.set(p.hash, p);
      if (p.key) this.byKey.set(p.key, p);                           // NEW
      const gk = this.getGroupKey(p);
      (this.groupIndex.get(gk) ?? this.groupIndex.set(gk, []).get(gk)!).push(p);
    }

    for (const [gk, items] of this.groupIndex.entries()) {
      const read = items.find(i => this.isReadKey(i.key));
      this.groupReadHash.set(gk, read ? read.hash : null);
    }

    // capture ROLES_READ once
    this.rolesReadHash = this.byKey.get('ROLES_READ')?.hash || null; // NEW
    this.librariesReadHash = this.byKey.get('LIBRARIES_READ')?.hash || null; // ⬅️
    this.tweetsReadHash = this.byKey.get('TWEETS_READ')?.hash || null; // ⬅️

    // ⬅️ NEW: build enforced set (only if present in the catalog)
    this.enforcedReadHashes.clear();
    for (const k of this.enforcedReadKeys) {
      const h = this.byKey.get(k)?.hash;
      if (h) this.enforcedReadHashes.add(h);
    }
  }


  // optional: small notice if a user somehow tries to deselect via keyboard etc.
  private notifyEnforcedBlocked() {
    this.snackbar.openSnackBar('هذه الصلاحية مفروضة لجميع الأدوار ولا يمكن إلغاء تحديدها.', 'failure');
  }

  private isReadKey(key: string | undefined): boolean {
    return !!key && key.endsWith('_READ');
  }

  private groupKeyByHash(hash: string): GroupKey | null {
    const p = this.byHash.get(hash);
    return p ? this.getGroupKey(p) : null;
  }

  private otherSelectedInGroup(gk: GroupKey, excludeHash?: string): boolean {
    const items = this.groupIndex.get(gk) || [];
    return items.some(i => i.hash !== excludeHash && this.selected.has(i.hash));
  }

  // ---------- grouping ----------
  private getGroupKey(p: PermissionModel): GroupKey {
    const key = (p.key || '').trim();
    if (key) return key.split('_', 1)[0] || 'OTHER';
    const v = (p.value || '').split(':', 1)[0];
    return v || 'OTHER';
  }
  private getGroupTitle(k: GroupKey) { return this.groupTitles[k] || k; }

  private notifyBlocked(kind: 'group-read' | 'roles-read-dep' | 'libraries-read-dep') {
    const msg =
      kind === 'group-read'
        ? 'لا يمكن إلغاء تحديد صلاحية العرض بينما توجد صلاحيات أخرى محددة ضمن نفس المجموعة.'
        : 'لا يمكن إلغاء تحديد "عرض الأدوار" لأن صلاحيات المستخدمين تتطلبها.';
    this.snackbar.openSnackBar(msg, 'failure');
  }

  // ---------- selection ----------
  toggle(hash: string) {
    if (this.isDisabled()) return;

    // block attempts on enforced reads
    if (this.enforcedReadHashes.has(hash)) {
      this.notifyEnforcedBlocked();
      return;
    }

    const perm = this.byHash.get(hash);
    if (!perm) return;

    const gk = this.getGroupKey(perm);
    const readHash = this.groupReadHash.get(gk) || null;
    const isRead = this.isReadKey(perm.key);

    if (this.selected.has(hash)) {
      // DESELECT
      if (isRead && this.otherSelectedInGroup(gk, hash)) {
        this.notifyBlocked('group-read');
        return;
      }
      if (perm.key === 'ROLES_READ' && this.anyUsersSelected()) {
        this.notifyBlocked('roles-read-dep');
        return;
      }
      if (perm.key === 'LIBRARIES_READ' && this.anySelectedInGroupKey('TWEETS')) {
        this.notifyBlocked('libraries-read-dep');
        return;
      }
      this.selected.delete(hash);
    } else {
      // SELECT
      this.selected.add(hash);
      if (!isRead && readHash) this.selected.add(readHash);
      if (gk === 'USERS') this.ensureRolesReadIfUsers();
      if (gk === 'TWEETS') this.ensureLibrariesReadIfTweets();
    }
  }

  isSelected(hash: string) { return this.selected.has(hash); }
  isDisabled() { return this.data.role?.isAdmin === true; }

  // group helpers
  groupCount(g: Group) { return g.items.length; }
  groupSelectedCount(g: Group) { return g.items.filter(i => this.selected.has(i.hash)).length; }
  groupAllSelected(g: Group) { return g.items.every(i => this.selected.has(i.hash)); }
  groupAnySelected(g: Group) { return g.items.some(i => this.selected.has(i.hash)); }



  toggleGroup(g: Group) {
    if (this.isDisabled()) return;

    const all = this.groupAllSelected(g);

    if (all) {
      // Deselect group — keep enforced reads ON
      g.items.forEach(i => {
        if (!this.enforcedReadHashes.has(i.hash)) {
          this.selected.delete(i.hash);
        }
      });
    } else {
      // Select all — normal behavior + keep group READ
      g.items.forEach(i => this.selected.add(i.hash));
      const read = g.items.find(i => this.isReadKey(i.key));
      if (read) this.selected.add(read.hash);

      if (g.key === 'USERS') this.ensureRolesReadIfUsers();
      if (g.key === 'TWEETS') this.ensureLibrariesReadIfTweets();
    }
  }


  // ---------- dialog ----------
  onCancel() { this.ref.close(); }

  onSave() {
    if (this.form.invalid) return;

    const name = (this.form.value.name || '').trim(); // ensure trimmed
    const updated: RoleModel = {
      ...(this.data.role || {}),
      name,
      adGroups: this.data.role?.adGroups ?? [],
      isAdmin: this.data.role?.isAdmin ?? false,
      permissionHashes: Array.from(this.selected),
    };

    this.ref.close(updated);
  }

  // trackBy
  trackGroup = (_: number, g: Group) => g.key;
  trackPerm = (_: number, p: PermissionModel) => p.hash;
}
