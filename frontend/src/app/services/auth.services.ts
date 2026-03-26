import { Injectable } from "@angular/core";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { BehaviorSubject, catchError, finalize, Observable, of, shareReplay, Subject, switchMap, tap, throwError } from "rxjs";

import { environment } from "../../environments/environment";
import { Router } from "@angular/router";
import { SnackbarService } from "./snackbar.service";
import { PermissionService } from "./permissions.service";
import { SocketService } from "./socket.service";
import * as forge from 'node-forge';

const BACKEND_URL = environment.apiUrl + '/auth/';

type MeResponse = {
  user: any;
  isAdmin: boolean;
  permissionHashes: string[];
};

type Profile = MeResponse;

@Injectable({ providedIn: "root" })
export class AuthService {
  private isAuthenticated = false;
  private token: string = "";
  private tokenTimer: any;

  private name: string = "";

  private authStatusListener = new Subject<boolean>();

  private profileLoading = new BehaviorSubject<boolean>(false);
  isProfileLoading$ = this.profileLoading.asObservable();

  private profileCache?: Profile;
  private inFlight$?: Observable<Profile>;

  // expose a readonly stream of last profile (emit null before the first load if you want)
  private profileSubject = new BehaviorSubject<Profile | null>(null);
  profile$ = this.profileSubject.asObservable();

  constructor(
    private http: HttpClient,
    private router: Router,
    private snackbarService: SnackbarService,
    private permissionService: PermissionService,
    private sockets: SocketService
  ) { }

  getAuthStatusListener() {
    return this.authStatusListener.asObservable();
  }


  encryptPassword(password: string): string {
    const publicKey = forge.pki.publicKeyFromPem(environment.rsaPublicKey);
    const encrypted = publicKey.encrypt(password, 'RSA-OAEP', {
      md: forge.md.sha256.create(),
      mgf1: {
        md: forge.md.sha1.create()
      }
    });
    return forge.util.encode64(encrypted);
  }

  // ---- load + set permissions + cache ----
  private loadProfile(): Observable<Profile> {
    this.profileLoading.next(true);
    return this.http.get<MeResponse>(BACKEND_URL + "me").pipe(
      tap(res => {
        // push perms into your *security* PermissionService
        this.permissionService.setFromProfile(res.permissionHashes, res.isAdmin);
        // cache
        this.profileCache = res;
        this.profileSubject.next(res);
      }),
      finalize(() => this.profileLoading.next(false))
    );
  }

  /** Call this anywhere to make sure profile is available without duplicating requests */
  ensureProfile$(): Observable<Profile> {
    if (this.profileCache) return of(this.profileCache);
    if (this.inFlight$) return this.inFlight$;
    this.inFlight$ = this.loadProfile().pipe(
      finalize(() => { this.inFlight$ = undefined; }),
      shareReplay(1)
    );
    return this.inFlight$;
  }

  formatUsername(name: string) {
    if (!name.trim()) return '';

    var result = name.split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLocaleLowerCase())
      .join(' ');

    const tokens = result.split(' ');
    if (tokens.length > 3) {
      result = [tokens[0], ...tokens.slice(-2)].join(' ');
    }

    return result;
  }

  // ---- login() changes: use ensureProfile$ then navigate ----
  login(username: string, password: string) {
    const authData = { username: username, encrypted: this.encryptPassword(password) };
    this.http.post<{ token: string; expiresIn: number; name: string }>(
      BACKEND_URL + "login",
      authData
    ).pipe(
      tap((response) => {
        const token = response.token;
        this.token = token;
        if (!token) return;

        this.name = this.formatUsername(response.name);
        this.isAuthenticated = true;
        this.authStatusListener.next(true);

        const expiresInDuration = response.expiresIn;
        this.setAuthTimer(expiresInDuration);
        const expirationDate = new Date(Date.now() + expiresInDuration * 1000);
        this.saveAuthData(token, expirationDate, this.name);

        this.sockets.connect(this.token);
      }),
      switchMap(() =>
        // ensure profile (and permissions) are loaded before routing
        this.ensureProfile$().pipe(
          catchError(() => of(null as any)) // don't block navigation on error
        )
      )
    ).subscribe({
      next: () => this.router.navigate(["/"]),
      error: () => {
        this.authStatusListener.next(false);
        this.snackbarService.openSnackBar('خطأ في اسم المستخدم أو كلمة المرور', 'failure');
      }
    });
  }

  // ---- autoAuthUser(): also ensure profile ----
  autoAuthUser() {
    const authInformation = this.getAuthData();
    if (!authInformation) return;

    const expiresIn = authInformation.expirationDate.getTime() - Date.now();
    if (expiresIn > 0) {
      this.token = authInformation.token;
      this.sockets.connect(this.token);
      this.isAuthenticated = true;
      this.name = authInformation.name ?? '';
      this.setAuthTimer(expiresIn / 1000);
      this.authStatusListener.next(true);

      this.ensureProfile$().subscribe({
        error: () => this.logout()
      });
    }
  }

  logout() {
    this.token = '';
    this.isAuthenticated = false;
    this.authStatusListener.next(false);
    this.name = '';
    this.profileCache = undefined;
    this.profileSubject.next(null);
    clearTimeout(this.tokenTimer);
    this.clearAuthData();
    this.sockets.disconnect();

    // clear client-side perms
    this.permissionService.clear();

    this.router.navigate(["/login"]);
  }

  private getAuthData() {
    const token = localStorage.getItem("token");
    const expirationDate = localStorage.getItem("expiration");
    const name = localStorage.getItem("name");
    if (!token || !expirationDate) {
      return;
    }
    return {
      token: token,
      expirationDate: new Date(expirationDate),
      name: name
    };
  }

  private saveAuthData(token: string, expirationDate: Date, name: string) {
    localStorage.setItem("token", token);
    localStorage.setItem("expiration", expirationDate.toISOString());
    localStorage.setItem("name", name);
  }

  private clearAuthData() {
    localStorage.removeItem("token");
    localStorage.removeItem("expiration");
    localStorage.removeItem("name");
  }

  private setAuthTimer(duration: number) {
    // console.log("Setting timer: " + duration);
    this.tokenTimer = setTimeout(() => {
      this.logout();
    }, duration * 1000);
  }

  getToken() {
    return this.token;
  }

  getIsAuth() {
    return this.isAuthenticated;
  }

  getUsername() {
    return this.name;
  }

  handleError(error: HttpErrorResponse) {
    let message = '';

    // Client-side error occurred
    if (error.error instanceof ErrorEvent) {
      message = error.error.message
        ? error.error.message
        : 'حدث خطأ في العميل.';
    } else {
      // Server-side error occurred
      message = error.error?.message
        ? error.error.message
        : 'حدث خطأ في المزود.';
    }

    this.snackbarService.openSnackBar(message, 'failure');
    return throwError(() => message);
  }

}
