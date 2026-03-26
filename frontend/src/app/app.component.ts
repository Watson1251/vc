import { Component } from '@angular/core';
import { Subscription } from 'rxjs';
import { AuthService } from './services/auth.services';
import { RUNTIME_CONFIG } from './runtime-config';
import { Title } from '@angular/platform-browser';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  title = RUNTIME_CONFIG.APP_TITLE;
  company = RUNTIME_CONFIG.COMPANY_NAME;

  // e.g., app.component.ts or a core initializer service 
  constructor(
    public auth: AuthService,
    private t: Title
  ) {
    this.t.setTitle(this.title);
  }

  ngOnInit(): void {
    this.auth.autoAuthUser();
  }

  ngOnDestroy(): void {
  }
}
