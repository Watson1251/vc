// help-dialog.service.ts
import { Injectable, Inject, InjectionToken } from '@angular/core';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { HelpDialogComponent } from './help-dialog.component';

/** Defaults you can override app-wide */
export const HELP_DIALOG_DEFAULTS = new InjectionToken<MatDialogConfig>('HELP_DIALOG_DEFAULTS', {
    factory: () => ({
        width: '80vw',
        maxWidth: '95vw',
        height: '80vh',
        maxHeight: 'none',
        panelClass: 'help-dialog-panel',
        autoFocus: false,
        hasBackdrop: true,
        disableClose: false,
        backdropClass: 'help-backdrop',
    } as MatDialogConfig)
});

@Injectable({ providedIn: 'root' })
export class HelpDialogService {
    constructor(
        private dialog: MatDialog,
        @Inject(HELP_DIALOG_DEFAULTS) private defaults: MatDialogConfig
    ) { }

    /**
     * Open the HelpDialog anywhere.
     * @param key       the section key (e.g. 'roles')
     * @param overrides optional MatDialogConfig to tweak per-call
     */
    open(key: string, overrides?: MatDialogConfig) {
        const config: MatDialogConfig = {
            ...this.defaults,
            ...overrides,
            data: { ...(overrides?.data ?? {}), key }  // ensure 'key' is present
        };
        return this.dialog.open(HelpDialogComponent, config);
    }
}
