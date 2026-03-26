import { Component } from '@angular/core';
import { RUNTIME_CONFIG } from 'src/app/runtime-config';

declare global {
  interface Window {
    __env?: any;
  }
}

@Component({
  selector: 'app-footer',
  templateUrl: './footer.component.html',
  styleUrls: ['./footer.component.scss']
})
export class FooterComponent {
  // set the currenr year
  year: number = new Date().getFullYear();
  appTitle = RUNTIME_CONFIG.APP_TITLE;
  companyName = RUNTIME_CONFIG.COMPANY_NAME;

  constructor() { }

  ngOnInit(): void {
  }
}
