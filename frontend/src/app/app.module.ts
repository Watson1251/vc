import { LOCALE_ID, NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import {
  HttpClientModule,
  HttpClient,
  HTTP_INTERCEPTORS,
} from '@angular/common/http';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
// auth
import { AngularFireModule } from '@angular/fire/compat';
import { AngularFireAuthModule } from '@angular/fire/compat/auth';
// Page Route
import { AppRoutingModule } from './app-routing.module';
import { LayoutsModule } from './layouts/layouts.module';
import { ToastrModule } from 'ngx-toastr';

// Laguage
import { TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';

// Store
import { StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';
import { StoreDevtoolsModule } from '@ngrx/store-devtools';
// component
import { AppComponent } from './app.component';
import { AuthlayoutComponent } from './authlayout/authlayout.component';
import { environment } from '../environments/environment';
import { AnalyticsEffects } from './store/Analytics/analytics.effects';
import { rootReducer } from './store';
import { fakebackendInterceptor } from './core/helpers/fake-backend';
import { ErrorInterceptor } from './core/helpers/error.interceptor';
import { JwtInterceptor } from './core/helpers/jwt.interceptor';
import { CRMEffects } from './store/CRM/crm.effects';
import { ECoReducer } from './store/Ecommerce/ecommerce.reducer';
import { ECoEffects } from './store/Ecommerce/ecommerce.effects';
import { LearningEffects } from './store/Learning/learning.effects';
import { RealEffects } from './store/RealEstate/realEstate.effects';
import { AppRealestateEffects } from './store/App-realestate/apprealestate.effects';
import { AgentEffects } from './store/Agent/agent.effects';
import { AgenciesEffects } from './store/Agency/agency.effects';
import { TicketEffects } from './store/Tickets/ticket.effects';
import { ChatEffects } from './store/chat/chat.effects';
import { ProductEffects } from './store/Product/product.effect';
import { InvoiceEffects } from './store/Invoices/invoices.effects';
import { AuthenticationEffects } from './store/Authentication/authentication.effects';
import { initFirebaseBackend } from './authUtils';
import { SellerEffects } from './store/Seller/seller.effects';
import { OrdersEffects } from './store/Orders/order.effects';
import { InstructorEffects } from './store/Learning-instructor/instructor.effects';
import { CustomerEffects } from './store/Customer/customer.effects';
import { studentsEffects } from './store/students/student.effcts';
import { CourcesEffects } from './store/Learning-cources/cources.effect';
import { ComponentsModule } from './components/components.module';
import { AngularMaterialModule } from './angular-material.module';
import { SharedModule } from './shared/shared.module';
import { CommonModule, registerLocaleData } from '@angular/common';
import { UiModule } from './pages/ui/ui.module';
import { AuthGuard } from './core/guards/auth.guard';
import { AuthInterceptor } from './core/guards/auth-interceptor';

export function createTranslateLoader(http: HttpClient): any {
  return new TranslateHttpLoader(http, 'assets/i18n/', '.json');
}
if (environment.defaultauth === 'firebase') {
  initFirebaseBackend(environment.firebaseConfig);
} else {
  fakebackendInterceptor;
}


import { MatNativeDateModule, MAT_DATE_FORMATS, MAT_DATE_LOCALE } from '@angular/material/core';

import localeAr from '@angular/common/locales/ar';
registerLocaleData(localeAr);

export const AR_DDMMYYYY_FORMATS = {
  parse: { dateInput: 'dd/MM/yyyy' },
  display: {
    dateInput: 'dd/MM/yyyy',
    monthYearLabel: 'MMM yyyy',
    dateA11yLabel: 'dd/MM/yyyy',
    monthYearA11yLabel: 'MMMM yyyy',
  },
};

@NgModule({
  declarations: [AppComponent, AuthlayoutComponent],
  imports: [
    TranslateModule.forRoot({
      defaultLanguage: 'en',
      loader: {
        provide: TranslateLoader,
        useFactory: createTranslateLoader,
        deps: [HttpClient],
      },
    }),
    StoreModule.forRoot(rootReducer),
    StoreDevtoolsModule.instrument({
      maxAge: 25, // Retains last 25 states
      logOnly: environment.production, // Restrict extension to log-only mode
    }),

    EffectsModule.forRoot([
      AnalyticsEffects,
      CRMEffects,
      ECoEffects,
      LearningEffects,
      RealEffects,
      AppRealestateEffects,
      AgentEffects,
      AgenciesEffects,
      TicketEffects,
      ChatEffects,
      ProductEffects,
      InvoiceEffects,
      AuthenticationEffects,
      SellerEffects,
      OrdersEffects,
      InstructorEffects,
      CustomerEffects,
      studentsEffects,
      CourcesEffects,
      InstructorEffects,
    ]),
    AngularFireModule.initializeApp(environment.firebaseConfig),
    HttpClientModule,
    BrowserModule,
    BrowserAnimationsModule,
    AppRoutingModule,
    LayoutsModule,
    ToastrModule.forRoot(),
    FormsModule,
    ReactiveFormsModule,
    AngularFireAuthModule,
    AngularMaterialModule,
    ComponentsModule,
    SharedModule,
    CommonModule,
    UiModule,

    MatNativeDateModule,
  ],
  providers: [
    AuthGuard,
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
    { provide: LOCALE_ID, useValue: 'ar' },     // Angular pipes in Arabic
    { provide: MAT_DATE_LOCALE, useValue: 'ar' },     // Material calendar in Arabic
    { provide: MAT_DATE_FORMATS, useValue: AR_DDMMYYYY_FORMATS },
  ],
  bootstrap: [AppComponent],
})
export class AppModule { }
