import { NgModule } from '@angular/core';
import { ExtraOptions, RouterModule, Routes } from '@angular/router';

// Component
import { LayoutComponent } from './layouts/layout.component';
import { AuthlayoutComponent } from './authlayout/authlayout.component';
import { AuthGuard } from './core/guards/auth.guard';
import { LoginComponent } from './components/login/login.component';

const home: string = '';

const routes: Routes = [
  { path: 'login', component: LoginComponent, },
  {
    path: '', component: LayoutComponent,
    loadChildren: () => import('./components/components.module')
      .then(m => m.ComponentsModule), canActivate: [AuthGuard]
  },
  { path: '**', redirectTo: home, pathMatch: 'full' },
];

const config: ExtraOptions = {
  useHash: false,
  scrollPositionRestoration: 'top'
};

@NgModule({
  imports: [RouterModule.forRoot(routes, config)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
