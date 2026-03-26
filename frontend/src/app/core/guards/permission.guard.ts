// src/app/security/permission.guard.ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../../services/auth.services';
import { PermissionService } from '../../services/permissions.service';
import { SnackbarService } from '../../services/snackbar.service';
import { map, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

export function requirePerms(required: string[], mode: 'any' | 'all' = 'all'): CanActivateFn {
    return () => {
        const auth = inject(AuthService);
        const perms = inject(PermissionService);
        const router = inject(Router);
        const snackbar = inject(SnackbarService);

        return auth.ensureProfile$().pipe(
            map(() => {
                const ok = mode === 'any'
                    ? perms.hasAny(required)
                    : perms.hasAll(required);

                if (ok) return true;

                snackbar.openSnackBar('ليس لديك صلاحية للوصول إلى هذه الصفحة', 'failure');
                return router.parseUrl('/'); // redirect to home
            }),
            catchError(() => {
                snackbar.openSnackBar('يجب تسجيل الدخول أولاً', 'failure');
                return of(router.parseUrl('/login'));
            })
        );
    };
}
