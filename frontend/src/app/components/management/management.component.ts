import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatTableDataSource } from '@angular/material/table';
import { PageEvent } from '@angular/material/paginator';

import { UserModel } from '../../models/user.model';
import { RoleModel } from '../../models/role.model';
import { PermissionModel } from '../../models/permission.model';

import { UsersService } from '../../services/users.service';
import { RolesService } from '../../services/roles.services';
import { PermissionCatalogService } from '../../services/permission-catalog.service';
import { SnackbarService } from 'src/app/services/snackbar.service';

import { RoleDialogComponent } from './role-dialog/role-dialog.component';
import { UserDialogComponent } from './user-dialog/user-dialog.component';
import { AuthService } from 'src/app/services/auth.services';
import { PermissionService } from '../../services/permissions.service';

@Component({
  selector: 'app-management',
  templateUrl: './management.component.html',
  styleUrls: ['./management.component.scss'],
})
export class ManagementComponent implements OnInit, OnDestroy {
  // ---------- DATA ----------
  users: UserModel[] = [];
  roles: RoleModel[] = [];
  permissions: PermissionModel[] = [];

  // roles view state
  filteredRoles: RoleModel[] = [];
  pagedRoles: RoleModel[] = [];
  dataSource = new MatTableDataSource<RoleModel>([]);
  searchTerm = '';
  pageSize = 5;
  pageIndex = 0;

  // users view state
  filteredUsers: UserModel[] = [];
  pagedUsers: UserModel[] = [];
  dataSourceUsers = new MatTableDataSource<UserModel>([]);
  userSearch = '';
  userPageSize = 5;
  userPageIndex = 0;

  // lookups
  permissionByHash = new Map<string, PermissionModel>();
  roleById = new Map<string, RoleModel>();

  // subs
  private usersSub?: Subscription;
  private rolesSub?: Subscription;
  private permissionsSub?: Subscription;
  private devicesSub?: Subscription;                                   // ✅ NEW
  private initSub?: Subscription;

  // allow flags
  canReadUsers = false;
  canReadRoles = false;
  canReadDevices = false;                                              // ✅ NEW

  readonly DEVICE_CHIPS_LIMIT = 9;

  currentUserId?: string;
  currentUsername?: string;

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

  // 1) Add this near your other private fields
  private preferredGroupOrder: string[] = [
    'ROLES',
    'USERS',
    'DEVICES',
    'LIBRARIES',
    'TWEETS',
    'ACTIONS',
    'FILES',
    'OTHER',
  ];

  private orderOf(key: string): number {
    const i = this.preferredGroupOrder.indexOf(key);
    return i === -1 ? 999 : i; // unknown groups go last
  }

  constructor(
    private usersService: UsersService,
    private rolesService: RolesService,
    private auth: AuthService,
    private perms: PermissionService,
    private permissionsService: PermissionCatalogService,
    private dialog: MatDialog,
    private snackbar: SnackbarService
  ) {
    document.addEventListener('click', () => this.openBubbles.clear());
  }

  private hasNonAdminRole(): boolean {
    return Array.isArray(this.roles) && this.roles.some(r => !r.isAdmin);
  }

  ngOnInit(): void {
    // Wait for profile to hydrate permissions
    this.initSub = this.auth.ensureProfile$().subscribe({
      next: (prof) => {
        this.canReadUsers = this.perms.hasKey('USERS_READ');
        this.canReadRoles = this.perms.hasKey('ROLES_READ');

        // snapshot current user
        this.currentUserId = prof?.user?.id || prof?.user?._id || prof?.user?.userId;
        this.currentUsername = prof?.user?.username || prof?.user?.name || prof?.user?.email;

        // ROLES + PERMISSIONS
        if (this.canReadRoles) {
          this.rolesService.getRoles();
          this.rolesSub = this.rolesService.getRolesUpdateListener().subscribe((roles) => {
            this.roles = roles ?? [];
            this.roleById.clear();
            for (const r of this.roles) this.roleById.set(r.id, r);

            this.filteredRoles = this.roles.slice();
            this.dataSource = new MatTableDataSource(this.filteredRoles);
            this.pageIndex = 0;
            this.updatePagedRoles();
          });

          this.permissionsSub = this.permissionsService.load().subscribe((list) => {
            this.permissions = list ?? [];
            this.permissionByHash = this.permissionsService.mapByHash();
          });
        }

        // USERS
        if (this.canReadUsers) {
          this.usersService.getUsers();
          this.usersSub = this.usersService.getUsersUpdateListener().subscribe((users) => {
            this.users = users ?? [];
            this.filteredUsers = this.users.slice();
            this.dataSourceUsers = new MatTableDataSource(this.filteredUsers);
            this.userPageIndex = 0;
            this.updatePagedUsers();
          });
        }
      },
      error: () => { /* ignore */ },
    });

    // keep snapshot updated
    this.auth.profile$.subscribe((p) => {
      if (!p) return;
      this.currentUserId = p.user?.id || p.user?._id || p.user?.userId;
      this.currentUsername = p.user?.username || p.user?.name || p.user?.email;
    });
  }

  // Put inside ManagementComponent class
  // Utility: split an array into rows of `size`
  chunk<T>(arr: T[], size: number): T[][] {
    if (!Array.isArray(arr) || size <= 0) return [];
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  // ---------- ROLES helpers ----------
  private getGroupKeyFromPerm(p: PermissionModel): string {
    const key = (p.key || '').trim();
    if (key) return key.split('_', 1)[0] || 'OTHER';
    const v = (p.value || '').split(':', 1)[0];
    return v || 'OTHER';
  }
  getGroupTitle(k: string) {
    return this.groupTitles[k] || k;
  }

  formatOtherDevices(count: number): string {
    if (count <= 0) return '';
    if (count === 1) return 'جهاز آخر';          // + جهاز آخر
    if (count === 2) return 'جهازين آخرين';      // + جهازين آخرين
    if (count >= 3 && count <= 10) return `${count} أجهزة أخرى`; // + 3 أجهزة أخرى
    return `${count} جهاز آخر`;                   // + 11 جهاز آخر, + 25 جهاز آخر, ...
  }

  // 2) Update the sorter inside roleGroupSummaries(...)
  roleGroupSummaries(role: RoleModel): Array<{ key: string; title: string; items: PermissionModel[] }> {
    const hashes = role.permissionHashes || [];
    if (!hashes.length) return [];

    const map = new Map<string, PermissionModel[]>();
    for (const h of hashes) {
      const p = this.permissionByHash.get(h);
      if (!p) continue;
      const gk = this.getGroupKeyFromPerm(p);
      (map.get(gk) ?? this.addEmpty(map, gk)).push(p);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => this.orderOf(a) - this.orderOf(b)) // ← use preferred order
      .map(([key, items]) => ({
        key,
        title: this.getGroupTitle(key),
        items: items.sort((a, b) =>
          (a.label || a.key || '').localeCompare(b.label || b.key || '', 'ar')
        ),
      }));
  }


  private addEmpty<T>(m: Map<string, T[]>, k: string): T[] {
    m.set(k, [] as T[]);
    return m.get(k)!;
  }

  // trackBys
  trackMiniGroup = (_: number, g: { key: string }) => g.key;
  trackPermMini = (_: number, p: PermissionModel) => p.hash;

  // touch-open bubble state
  private openBubbles = new Set<string>();
  private bk(roleId: string, gk: string) {
    return `${roleId}:${gk}`;
  }
  isBubbleOpen(roleId: string, gk: string) {
    return this.openBubbles.has(this.bk(roleId, gk));
  }
  toggleBubble(roleId: string, gk: string, ev: Event) {
    ev.stopPropagation();
    const k = this.bk(roleId, gk);
    this.openBubbles.has(k) ? this.openBubbles.delete(k) : this.openBubbles.add(k);
  }

  // ---------- ROLES: CRUD ----------
  openCreateRole(): void {
    const ref = this.dialog.open(RoleDialogComponent, {
      width: '820px',
      maxWidth: '95vw',
      panelClass: 'role-dialog-panel',
      direction: 'rtl',
      data: {
        mode: 'create',
        role: { id: '', name: '', adGroups: [], isAdmin: false, permissionHashes: [] },
        allPermissions: this.permissions,
        takenRoleNames: this.roles.map((r) => (r.name || '').trim().toLowerCase()),
      },
    });

    ref.afterClosed().subscribe((result?: RoleModel) => {
      if (!result) return;
      this.rolesService.createRole(result).subscribe({
        next: () => {
          this.rolesService.getRoles();
          this.snackbar.openSnackBar('تم إنشاء الدور بنجاح', 'success');
        },
      });
    });
  }

  onEditRole(role: RoleModel): void {
    const ref = this.dialog.open(RoleDialogComponent, {
      width: '820px',
      maxWidth: '95vw',
      panelClass: 'role-dialog-panel',
      direction: 'rtl',
      data: {
        mode: 'edit',
        role,
        allPermissions: this.permissions,
        takenRoleNames: this.roles
          .filter((r) => r.id !== role.id)
          .map((r) => (r.name || '').trim().toLowerCase()),
      },
    });

    ref.afterClosed().subscribe((result?: RoleModel) => {
      if (!result) return;
      this.rolesService.updateRole(role.id, result).subscribe({
        next: () => {
          this.rolesService.getRoles();
          this.snackbar.openSnackBar(
            'تم تحديث الدور بنجاح — يرجى تحديث الصفحة لرؤية التغييرات',
            'success'
          );
        },
      });
    });
  }

  onDeleteRole(role: RoleModel): void {
    const ok = window.confirm(`هل أنت متأكد من حذف الدور "${role.name}"؟`);
    if (!ok) return;
    this.rolesService.deleteRole(role.id).subscribe({
      next: () => {
        this.rolesService.getRoles();
        this.snackbar.openSnackBar(
          'تم حذف الدور بنجاح — يرجى تحديث الصفحة لرؤية التغييرات',
          'success'
        );
      },
    });
  }

  refreshRoles(): void {
    this.rolesService.getRoles();
    this.snackbar.openSnackBar('تم تحديث قائمة الأدوار', 'success');
  }

  // ---------- ROLES: filter & paging ----------
  applyFilter(): void {
    const term = this.searchTerm.trim().toLowerCase();
    this.filteredRoles = term
      ? this.roles.filter((r) => (r.name || '').toLowerCase().includes(term))
      : this.roles.slice();

    this.dataSource = new MatTableDataSource(this.filteredRoles);
    this.pageIndex = 0;
    this.updatePagedRoles();
  }

  updatePagedRoles(): void {
    const start = this.pageIndex * this.pageSize;
    const end = start + this.pageSize;
    this.pagedRoles = this.filteredRoles.slice(start, end);
  }

  onPageChange(e: PageEvent): void {
    this.pageIndex = this.pageSize !== e.pageSize ? 0 : e.pageIndex;
    this.pageSize = e.pageSize;
    this.updatePagedRoles();
  }

  // ---------- USERS: CRUD (with devices assignment) ----------
  openCreateUser(): void {

    // لا توجد أدوار أصلًا
    if (!this.roles?.length) {
      this.snackbar.openSnackBar(
        'لا يمكنك إنشاء مستخدم قبل إنشاء دور واحد على الأقل.',
        'failure'
      );
      return;
    }

    // جميع الأدوار المتاحة هي isAdmin فقط
    if (!this.hasNonAdminRole()) {
      this.snackbar.openSnackBar(
        'لا يمكنك إنشاء مستخدم لأن كل الأدوار الحالية هي أدوار مدير. الرجاء إنشاء دور غير إداري أولًا.',
        'failure'
      );
      return;
    }

    const ref = this.dialog.open(UserDialogComponent, {
      width: '820px',
      maxWidth: '95vw',
      panelClass: 'user-dialog-panel',
      direction: 'rtl',
      data: {
        mode: 'create',
        user: {} as Partial<UserModel>,
        allRoles: this.roles,
        takenUsernames: this.users.map((u) => u.username),
      },
    });

    ref.afterClosed().subscribe((result?: Partial<UserModel>) => {
      if (!result) return;

      const payload: Partial<UserModel> = {
        username: (result.username || '').trim(),
        name: (result.name || '').trim(),
        roleIds: result.roleIds || [],
        password: result.password!,                                  // required in create
      };

      this.usersService.createUser(payload).subscribe({
        next: () => {
          this.usersService.getUsers();
          this.snackbar.openSnackBar('تم إنشاء المستخدم بنجاح', 'success');
        },
      });
    });
  }

  onEditUser(u: UserModel): void {
    const ref = this.dialog.open(UserDialogComponent, {
      width: '820px',
      maxWidth: '95vw',
      panelClass: 'user-dialog-panel',
      direction: 'rtl',
      data: {
        mode: 'edit',
        user: u,
        allRoles: this.roles,
        takenUsernames: this.users.map((x) => x.username),
      },
    });

    ref.afterClosed().subscribe((result?: Partial<UserModel>) => {
      if (!result) return;

      const payload: Partial<UserModel> = {
        username: (result.username || '').trim(),
        name: (result.name || '').trim(),
        roleIds: result.roleIds || [],
        ...(result.password ? { password: result.password } : {}),
      };

      this.usersService.updateUser(u.id, payload).subscribe({
        next: () => {
          this.usersService.getUsers();
          const extra = this.isCurrentUserBySnapshot(u)
            ? ' — يرجى تسجيل الخروج ثم الدخول لرؤية التغييرات'
            : '';
          this.snackbar.openSnackBar('تم تحديث المستخدم بنجاح' + extra, 'success');
        },
      });
    });
  }

  onDeleteUser(u: UserModel): void {
    const name = u.username || u.name || 'المستخدم';
    const ok = window.confirm(`هل أنت متأكد من حذف "${name}"؟`);
    if (!ok) return;

    this.usersService.deleteUser(u.id).subscribe({
      next: () => {
        this.usersService.getUsers();
        this.snackbar.openSnackBar('تم حذف المستخدم بنجاح', 'success');
      },
    });
  }

  refreshUsers(): void {
    this.usersService.getUsers();
    this.snackbar.openSnackBar('تم تحديث قائمة المستخدمين', 'success');
  }

  // ---------- USERS: filter & paging ----------
  applyUserFilter(): void {
    const term = this.userSearch.trim().toLowerCase();
    this.filteredUsers = term
      ? this.users.filter((u) =>
        ((u as any).username || (u as any).name || '')
          .toString()
          .toLowerCase()
          .includes(term)
      )
      : this.users.slice();

    this.dataSourceUsers = new MatTableDataSource(this.filteredUsers);
    this.userPageIndex = 0;
    this.updatePagedUsers();
  }

  updatePagedUsers(): void {
    const start = this.userPageIndex * this.userPageSize;
    const end = start + this.userPageSize;
    this.pagedUsers = this.filteredUsers.slice(start, end);
  }

  onUserPageChange(e: PageEvent): void {
    this.userPageIndex = this.userPageSize !== e.pageSize ? 0 : e.pageIndex;
    this.userPageSize = e.pageSize;
    this.updatePagedUsers();
  }

  // ---------- helpers ----------
  isUserAdmin(u: UserModel): boolean {
    const ids = u.roleIds || (u.roles?.map((r) => r.id || (r as any)._id)) || [];
    return ids.some((id) => this.roleById.get(id)?.isAdmin === true);
  }

  isCurrentUserBySnapshot(u: UserModel): boolean {
    const uid = (u as any).id || (u as any)._id;
    const uname = ((u as any).username || (u as any).name || '').toString().toLowerCase();
    const curName = (this.currentUsername || '').toString().toLowerCase();
    return (!!this.currentUserId && this.currentUserId === uid) || (!!curName && curName === uname);
  }

  selectRole(_role: RoleModel | null) {
    /* reserved for future */
  }

  getUserRoleNames(u: UserModel): string[] {
    const ids: string[] = (u as any).roleIds || ((u as any).roles?.map((r: any) => r.id || r._id) ?? []);
    if (!ids?.length) return [];
    return ids.map((id) => this.roleById.get(id)?.name).filter(Boolean) as string[];
  }

  // ---------- DESTROY ----------
  ngOnDestroy(): void {
    this.usersSub?.unsubscribe();
    this.rolesSub?.unsubscribe();
    this.permissionsSub?.unsubscribe();
    this.devicesSub?.unsubscribe();
    this.initSub?.unsubscribe();
  }
}
