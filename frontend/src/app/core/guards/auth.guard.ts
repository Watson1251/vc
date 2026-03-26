import {
    CanActivate,
    ActivatedRouteSnapshot,
    RouterStateSnapshot,
    Router
} from "@angular/router";
import { Injectable } from "@angular/core";
import { Observable, of } from "rxjs";
import { delay } from 'rxjs/operators';
import { AuthService } from "src/app/services/auth.services";
import { SnackbarService } from "src/app/services/snackbar.service";


@Injectable()
export class AuthGuard implements CanActivate {
    constructor(
        private authService: AuthService,
        private router: Router,
        private snackbarService: SnackbarService
    ) { }

    canActivate(
        route: ActivatedRouteSnapshot,
        state: RouterStateSnapshot
    ): boolean | Observable<boolean> | Promise<boolean> {

        const isAuth = this.authService.getIsAuth();

        if (!isAuth) {
            // this.authService.logout();
            this.snackbarService.openSnackBar('الرجاء تسجيل الدخول أولا', 'failure');
            this.router.navigate(['/login']);
        }

        return isAuth;
    }
}
