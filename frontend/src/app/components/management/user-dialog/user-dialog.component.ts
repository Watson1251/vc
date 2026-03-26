import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import {
  AbstractControl,
  FormBuilder,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { UserModel } from '../../../models/user.model';
import { RoleModel } from '../../../models/role.model';

type UserDialogData = {
  mode: 'create' | 'edit';
  user: Partial<UserModel>;
  allRoles: RoleModel[];
  takenUsernames?: string[];
};

/** Optional minLength validator: passes if empty; enforces length if non-empty */
function optionalMinLength(len: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const v = (control.value ?? '') as string;
    if (!v) return null; // allow empty (edit mode)
    return v.length < len
      ? { minLenOptional: { requiredLength: len, actualLength: v.length } }
      : null;
  };
}

/** Unique username validator (case-insensitive). Allows current username when editing. */
function uniqueUsernameValidator(
  taken: string[] = [],
  currentUsername?: string
): ValidatorFn {
  const takenSet = new Set(taken.map((s) => (s ?? '').trim().toLowerCase()));
  const current = (currentUsername ?? '').trim().toLowerCase();
  return (control: AbstractControl): ValidationErrors | null => {
    const raw = (control.value ?? '') as string;
    const candidate = raw.trim().toLowerCase();
    if (!candidate) return null; // other validators (required) handle empties
    if (candidate === current) return null; // unchanged in edit mode
    return takenSet.has(candidate) ? { usernameTaken: true } : null;
  };
}

@Component({
  selector: 'app-user-dialog',
  templateUrl: './user-dialog.component.html',
  styleUrls: ['./user-dialog.component.scss'],
})
export class UserDialogComponent {
  title = 'مستخدم جديد';
  mode: 'create' | 'edit';

  // Roles
  allRoles: RoleModel[] = [];
  visibleRoles: RoleModel[] = [];
  rolesLocked = false; // lock role editing when user already has admin role in edit mode
  isCreateNoAssignableRoles = false;
  selectedRoleIds = new Set<string>();

  // Devices
  allDevices: Array<{ id: string; name?: string; serial?: string }> = [];
  filteredDevices: Array<{ id: string; name?: string; serial?: string }> = [];
  selectedDeviceIds = new Set<string>();
  devicesSearch = '';
  devicesLocked = false; // when admin is selected/owned → all devices forced on & cannot toggle

  showPassword = false;

  form = this.fb.group({
    username: ['', []], // validators set in ctor
    name: ['', [Validators.required, Validators.maxLength(128)]],
    password: [''], // validators set per mode
  });

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: UserDialogData,
    private ref: MatDialogRef<UserDialogComponent>,
    private fb: FormBuilder
  ) {
    this.mode = data.mode;
    this.title = data.mode === 'edit' ? 'تعديل المستخدم' : 'مستخدم جديد';
    this.allRoles = data.allRoles ?? [];

    // Initialize form values + pre-selected roles
    const startingUsername = data.user?.username ?? '';
    const startingName = data.user?.name ?? '';
    this.form.patchValue({ username: startingUsername, name: startingName });
    (data.user?.roleIds || []).forEach((id) => this.selectedRoleIds.add(id));

    // Username validators
    const taken = data.takenUsernames ?? [];
    this.ctrl('username').setValidators([
      Validators.required,
      Validators.maxLength(64),
      uniqueUsernameValidator(taken, startingUsername),
    ]);
    this.ctrl('username').updateValueAndValidity({ emitEvent: false });

    // Detect if edited user already has an admin role
    const userHasAdminRole = (data.user?.roleIds || []).some(
      (id) => this.allRoles.find((r) => r.id === id)?.isAdmin === true
    );

    // Role visibility/locking
    if (this.mode === 'edit' && userHasAdminRole) {
      // Show all roles but lock editing
      this.rolesLocked = true;
      this.visibleRoles = this.allRoles.slice();
    } else {
      // Hide admin roles from selection
      this.visibleRoles = this.allRoles.filter((r) => !r.isAdmin);
    }

    // If creating and there are no assignable (non-admin) roles
    this.isCreateNoAssignableRoles =
      this.mode === 'create' && this.visibleRoles.length === 0;

    // Password validators
    if (this.mode === 'create') {
      this.ctrl('password').setValidators([Validators.required, optionalMinLength(8)]);
    } else {
      this.ctrl('password').setValidators([optionalMinLength(8)]);
    }
    this.ctrl('password').updateValueAndValidity({ emitEvent: false });

    // If user already has admin role → lock devices & select all
    if (userHasAdminRole) {
      this.lockDevicesToAll();
    }

    this.applyDevicesFilter();
  }

  // --------- Helpers ----------
  ctrl(name: string) {
    return this.form.get(name)!;
  }

  // --------- Roles Selection ----------
  toggleRole(id: string) {
    if (this.rolesLocked || this.isCreateNoAssignableRoles) return;

    if (this.selectedRoleIds.has(id)) this.selectedRoleIds.delete(id);
    else this.selectedRoleIds.add(id);

    // If an admin role becomes selected now, lock devices to all.
    const adminNowSelected = Array.from(this.selectedRoleIds).some(
      (rid) => this.allRoles.find((r) => r.id === rid)?.isAdmin
    );
    if (adminNowSelected) {
      this.lockDevicesToAll();
    } else if (!this.rolesLocked) {
      // If admin no longer selected and roles aren’t locked, allow manual device selection
      this.devicesLocked = false;
    }
  }

  isRoleSelected(id: string) {
    return this.selectedRoleIds.has(id);
  }

  // --------- Devices Selection ----------
  toggleDevice(id: string) {
    if (this.devicesLocked) return; // locked for admin → ignore clicks
    if (this.selectedDeviceIds.has(id)) this.selectedDeviceIds.delete(id);
    else this.selectedDeviceIds.add(id);
  }

  isDeviceSelected(id: string) {
    return this.selectedDeviceIds.has(id);
  }

  applyDevicesFilter() {
    const q = (this.devicesSearch || '').trim().toLowerCase();
    if (!q) {
      this.filteredDevices = this.allDevices.slice();
      return;
    }
    this.filteredDevices = this.allDevices.filter((d) => {
      const name = (d.name || '').toLowerCase();
      const serial = (d.serial || '').toLowerCase();
      return name.includes(q) || serial.includes(q);
    });
  }

  private lockDevicesToAll() {
    this.devicesLocked = true;
    this.selectedDeviceIds = new Set(this.allDevices.map((d) => d.id));
  }

  // --------- Actions ----------
  onCancel() {
    this.ref.close();
  }

  onSave() {
    // Validate
    if (this.form.invalid) return;
    if (!this.rolesLocked && (this.isCreateNoAssignableRoles || this.selectedRoleIds.size === 0)) return;

    const rawPass = (this.form.value.password ?? '').toString().trim();

    const payload: Partial<UserModel> = {
      ...(this.data.user || {}),
      username: this.form.value.username!.trim(),
      name: this.form.value.name!.trim(),
      roleIds: Array.from(this.selectedRoleIds),
      ...(this.mode === 'create'
        ? { password: rawPass }
        : rawPass
          ? { password: rawPass }
          : {}),
    };

    this.ref.close(payload);
  }
}
