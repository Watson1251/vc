import { Component, OnDestroy, OnInit } from '@angular/core';
import { NgForm } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AuthService } from 'src/app/services/auth.services';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent implements OnInit, OnDestroy {
  year: number = new Date().getFullYear();
  fieldTextType: boolean = false;
  isLoading: boolean = false;
  private authStatusSub?: Subscription;

  constructor(public authService: AuthService) { }

  ngOnInit(): void {
    this.authStatusSub = this.authService.getAuthStatusListener().subscribe(() => {
      this.isLoading = false;
    });
  }

  ngOnDestroy(): void {
    this.authStatusSub?.unsubscribe();
  }

  toggleFieldTextType(): void {
    this.fieldTextType = !this.fieldTextType;
  }

  onLogin(form: NgForm): void {
    if (form.invalid) return;

    this.isLoading = true;
    const { username, password } = form.value;
    this.authService.login(username, password);
  }
}
