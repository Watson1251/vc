import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ComponentsRoutingModule } from './components-routing.module';

import { NgxDropzoneModule } from 'ngx-dropzone';
import { UiModule } from '../pages/ui/ui.module';
import { AngularMaterialModule } from '../angular-material.module';

import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FormModule } from '../pages/forms/forms.module';
import { LoginComponent } from './login/login.component';
import { HomeComponent } from './home/home.component';
import { ManagementComponent } from './management/management.component';
import { PaginatorComponent } from './paginator/paginator.component';
import { RoleDialogComponent } from './management/role-dialog/role-dialog.component';
import { UserDialogComponent } from './management/user-dialog/user-dialog.component';
import { HasPermDirective } from '../has-perm.directive';
import { SoundEffectsComponent } from './sound-effects/sound-effects.component';
import { SoundEffectsDialogComponent } from './sound-effects/sound-effects-dialog/sound-effects-dialog.component';
import { CategoryDialogComponent } from './sound-effects/category-dialog/category-dialog.component';
import { DropfileComponent } from './dropfile/dropfile.component';
import { WavesurferComponent } from './wavesurfer/wavesurfer.component';
import { TargetsComponent } from './targets/targets.component';
import { TargetsDialogComponent } from './targets/targets-dialog/targets-dialog.component';
import { CloneDialogComponent } from './home/clone-dialog/clone-dialog.component';
import { HelpDialogComponent } from './help-dialog/help-dialog.component';
import { HELP_DIALOG_DEFAULTS } from './help-dialog/help-dialog.service';
import { MatDialogConfig } from '@angular/material/dialog';

@NgModule({
  declarations: [
    LoginComponent,
    HomeComponent,
    ManagementComponent,
    PaginatorComponent,
    RoleDialogComponent,
    UserDialogComponent,
    SoundEffectsComponent,
    SoundEffectsDialogComponent,
    CategoryDialogComponent,
    DropfileComponent,
    WavesurferComponent,
    TargetsComponent,
    TargetsDialogComponent,
    CloneDialogComponent,
    HelpDialogComponent,
  ],
  imports: [
    CommonModule,
    ComponentsRoutingModule,
    NgxDropzoneModule,
    UiModule,
    AngularMaterialModule,
    MatTableModule,
    MatCheckboxModule,
    FormsModule,
    FormModule,
    ReactiveFormsModule,
    HasPermDirective
  ],
  providers: [
    {
      provide: HELP_DIALOG_DEFAULTS,
      useValue: {
        width: '80vw',
        maxWidth: '95vw',
        height: '80vh',
        maxHeight: 'none',
        panelClass: 'help-dialog-panel',
        autoFocus: false,
        hasBackdrop: true,
        disableClose: false,
        backdropClass: 'help-backdrop',
      } as MatDialogConfig,
    },
  ],
})
export class ComponentsModule { }
