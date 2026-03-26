import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ManagementComponent } from './management/management.component';
import { requirePerms } from '../core/guards/permission.guard';
import { PERMISSION_HASHES } from '../security/permission-hashes';
import { SoundEffectsComponent } from './sound-effects/sound-effects.component';
import { HomeComponent } from './home/home.component';
import { TargetsComponent } from './targets/targets.component';

const home: string = '';

const routes: Routes = [
  {
    path: home, component: HomeComponent
  },
  {
    path: 'management', component: ManagementComponent,
    canActivate: [requirePerms(
      [PERMISSION_HASHES.ROLES_READ, PERMISSION_HASHES.USERS_READ],
      'any'
    )],
  },
  {
    path: 'sound-effects', component: SoundEffectsComponent,
    // canActivate: [requirePerms([PERMISSION_HASHES.LIBRARIES_READ])], // 'all' by default
  },
  {
    path: 'targets', component: TargetsComponent,
    // canActivate: [requirePerms([PERMISSION_HASHES.DEVICES_READ])], // 'all' by default
  },
  { path: '**', redirectTo: home, pathMatch: 'full' },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ComponentsRoutingModule { }
