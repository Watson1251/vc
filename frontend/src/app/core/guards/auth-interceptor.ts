// src/app/interceptors/auth.interceptor.ts
import {
  HttpInterceptor,
  HttpRequest,
  HttpHandler,
  HttpEvent
} from "@angular/common/http";
import { Injectable } from "@angular/core";
import { AuthService } from "src/app/services/auth.services";
import { Observable } from "rxjs";

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(private authService: AuthService) { }

  intercept(req: HttpRequest<any>, next: HttpHandler) {
    const authToken = this.authService.getToken(); // 👈 THIS calls refreshTokenIfNeeded()
    const authRequest = authToken
      ? req.clone({ headers: req.headers.set("Authorization", "Bearer " + authToken) })
      : req;
    return next.handle(authRequest);
  }
}
