import { Component, Inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

export type CategoryDialogMode = 'create' | 'edit' | 'delete';

export interface CategoryDialogData {
  mode: CategoryDialogMode;
  name?: string;           // current name (for edit)
  existingNames?: string[]; // <-- NEW: names belonging to the authenticated user
}

export interface CategoryDialogResult {
  confirmed: boolean;
  name?: string;         // new/edited name (create/edit only)
}

@Component({
  selector: 'app-category-dialog',
  templateUrl: './category-dialog.component.html',
  styleUrls: ['./category-dialog.component.scss']
})
export class CategoryDialogComponent {
  form: FormGroup;
  mode: CategoryDialogMode;
  title = '';
  actionLabel = '';
  message?: string;

  private initialName = ''; // <-- track original name
  private existingSet = new Set<string>(); // normalized names

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<CategoryDialogComponent, CategoryDialogResult>,
    @Inject(MAT_DIALOG_DATA) public data: CategoryDialogData
  ) {
    this.mode = data.mode;

    if (this.mode === 'create') {
      this.title = 'إضافة فئة';
      this.actionLabel = 'إضافة';
    } else if (this.mode === 'edit') {
      this.title = 'تعديل فئة';
      this.actionLabel = 'حفظ';
    } else {
      this.title = 'حذف فئة';
      this.actionLabel = 'حذف';
      this.message = `هل أنت متأكد من حذف الفئة «${data.name ?? ''}»؟`;
    }

    // Build normalized set of existing names (ignore current name in edit via canSubmit)
    const names = Array.isArray(data.existingNames) ? data.existingNames : [];
    this.existingSet = new Set(names.map(n => this.normalize(n)));

    this.initialName = (data.name ?? '').trim();

    this.form = this.fb.group({
      name: [
        data.name ?? '',
        this.mode === 'delete'
          ? []
          : [Validators.required, Validators.minLength(3), this.noWhitespaceValidator, this.duplicateNameValidator]
      ],
    });
  }

  // Arabic-friendly normalizer: trim, lowercase, strip common diacritics/tatweel
  private normalize(v: string): string {
    const diacritics = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g; // tashkeel + tatweel
    return (v ?? '').toString().trim().toLowerCase().replace(diacritics, '');
  }

  private noWhitespaceValidator = (control: any) => {
    const ok = (control.value ?? '').toString().trim().length > 0;
    return ok ? null : { whitespace: true };
  };

  // Disallow duplicates for the same user.
  // Allow unchanged value in EDIT mode (handled in canSubmit).
  private duplicateNameValidator = (control: any) => {
    const raw = (control?.value ?? '').toString();
    const norm = this.normalize(raw);

    // If editing and unchanged (after normalization), don't flag duplicate here;
    // the Save button is separately disabled via `isUnchanged`.
    if (this.mode === 'edit' && norm === this.normalize(this.initialName)) {
      return null;
    }

    return this.existingSet.has(norm) ? { duplicate: true } : null;
  };

  get isUnchanged(): boolean {
    if (this.mode !== 'edit') return false;
    return this.normalize(this.form.get('name')?.value ?? '') === this.normalize(this.initialName);
  }

  get canSubmit(): boolean {
    if (this.mode === 'delete') return true;
    const nameCtrl = this.form.get('name');
    if (!nameCtrl) return false;

    if (this.form.invalid) return false;
    if (nameCtrl.hasError('duplicate')) return false;   // <-- disable on duplicates
    if (this.mode === 'edit' && this.isUnchanged) return false; // <-- disable when unchanged
    return true;
  }

  onCancel(): void { this.dialogRef.close({ confirmed: false }); }

  onConfirm(): void {
    if (!this.canSubmit) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.mode === 'delete') {
      this.dialogRef.close({ confirmed: true });
      return;
    }
    const name = (this.form.value.name as string).trim();
    this.dialogRef.close({ confirmed: true, name });
  }
}
