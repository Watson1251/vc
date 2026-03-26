import { Component, ViewChild, Output, EventEmitter, Renderer2 } from '@angular/core';
import { EventService } from '../../core/services/event.service';
import { Router } from '@angular/router';
import { NgxSpinnerService } from 'ngx-spinner';
import { Store } from '@ngrx/store';
import { RootReducerState } from 'src/app/store';
import { getLayout, getLayoutTheme, getLayoutWidth, getLayoutmode, getPosition, getPreloader, getSidebarcolor, getSidebarsize, getTopbar, getsidebarimage, getsidebarview } from 'src/app/store/layouts/layout-selector';
import { changeMode, changeTheme, changelayoutTheme, changeposition, changepreLoader, changesidebarImage, changesidebarView, changesidebarcolor, changesize, changetopbar, changewidthLayout } from 'src/app/store/layouts/layout-action';
import { LayoutState, initialState } from 'src/app/store/layouts/layout-reducers';

@Component({
  selector: 'app-rightsidebar',
  templateUrl: './rightsidebar.component.html',
  styleUrls: ['./rightsidebar.component.scss']
})
export class RightsidebarComponent {

  hideCustomizer: boolean = true;

  rightsidebar: any;
  size: string | undefined;
  sidebarView: string | undefined;
  attribute: any;
  sidebarImage: any;
  sidebarVisibility: any;
  preLoader: any;
  grd: any;
  sidebar: any
  layout!: string;;
  layoutTheme: any;
  layoutmode: any;
  layoutposition: any;
  sidebarsize: any;
  sidebarViews: any;
  topbar: any;
  sidebarcolor: any;
  sidebarimage: any;
  preloader: any
  layoutWidth: any;
  initialAppState!: LayoutState;

  @Output() settingsButtonClicked = new EventEmitter();

  constructor(private eventService: EventService, private router: Router, private spinner: NgxSpinnerService, public store: Store<RootReducerState>, public renderer: Renderer2) { }

  ngOnInit(): void {
    this.initialAppState = initialState;
    this.store.select('layout').subscribe((data: any) => {
      this.layout = data.LAYOUT;
      this.layoutTheme = data.LAYOUT_THEME;
      this.layoutWidth = data.LAYOUT_WIDTH;
      this.layoutmode = data.LAYOUT_MODE;
      this.layoutposition = data.LAYOUT_POSITION;
      this.topbar = data.TOPBAR;
      this.sidebarsize = data.SIDEBAR_SIZE;
      this.sidebarViews = data.SIDEBAR_VIEW;
      this.sidebarcolor = data.SIDEBAR_COLOR;
      this.sidebarimage = data.SIDEBAR_IMAGE;
      this.preloader = data.DATA_PRELOADER;
    });

    // Set the initial layout
    // this.changeLayout('horizontal');
    this.changeLayout('vertical');
    this.changeTheme('material');
  }

  //  Filter Offcanvas Set
  openEnd() {
    document.querySelector('.righsidebar')?.classList.add('show')
    document.querySelector('.backdrop2')?.classList.add('show')
  }

  closeoffcanvas() {
    document.querySelector('.righsidebar')?.classList.remove('show')
    document.querySelector('.backdrop2')?.classList.remove('show')
  }
  /**
   * Change the layout onclick
   * @param layout Change the layout
   */
  changeLayout(layout: string) {
    this.layout = layout;
    this.store.dispatch(changelayoutTheme({ layout }));
    this.eventService.broadcast('changeLayout', layout);
    this.store.select(getLayout).subscribe((layout) => {
      document.documentElement.setAttribute('data-layout', layout);
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 1500);
    })
  }

  // change theme
  changeTheme(theme: string) {
    this.spinner.show();
    this.layoutTheme = theme;
    // store
    this.store.dispatch(changeTheme({ theme }));
    this.store.select(getLayoutTheme).subscribe((theme) => {
      this.renderer.setAttribute(document.documentElement, 'data-theme', theme);
    })
    setTimeout(() => {
      this.spinner.hide();
    }, 1000);
    if (theme == 'minimal') {
      this.renderer.setAttribute(document.documentElement, 'data-sidebar', 'light');
    } else {
      this.renderer.setAttribute(document.documentElement, 'data-sidebar', 'dark');
    }
  }

  // Sidebar Size Change
  changeSidebar(sidebarView: string) {
    this.sidebarViews = sidebarView;
    this.store.dispatch(changesidebarView({ sidebarView }));
    this.store.select(getsidebarview).subscribe((sidebarView) => {
      this.renderer.setAttribute(document.documentElement, 'data-layout-style', sidebarView);
    })
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 0);
  }

  // Sidebar Size Change
  changeSidebarSize(size: string) {
    this.size = size;
    // store
    this.store.dispatch(changesize({ size }));
    this.store.select(getSidebarsize).subscribe((size) => {
      this.renderer.setAttribute(document.documentElement, 'data-sidebar-size', size);
    })
  }

  // Add Active Class
  addActive(grdSidebar: any) {
    this.grd = grdSidebar;
    document.documentElement.setAttribute('data-sidebar', grdSidebar)
    document.getElementById('collapseBgGradient')?.classList.toggle('show');
    document.getElementById('collapseBgGradient1')?.classList.add('active');
  }

  // Remove Active Class
  removeActive() {
    this.grd = '';
    document.getElementById('collapseBgGradient1')?.classList.remove('active');
    document.getElementById('collapseBgGradient')?.classList.remove('show');
  }

  // When the user clicks on the button, scroll to the top of the document
  topFunction() {
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
  }

  // Mode Change
  changeMode(mode: string) {
    this.layoutmode = mode;
    this.store.dispatch(changeMode({ mode }));
    this.store.select(getLayoutmode).subscribe((mode) => {
      this.renderer.setAttribute(document.documentElement, 'data-bs-theme', mode);
    })
    if (mode === 'light') {
      this.renderer.setAttribute(document.documentElement, 'data-topbar', 'light');
    } else {
      this.renderer.setAttribute(document.documentElement, 'data-topbar', mode);
    }
  }

  // Sidebar Color Change
  changeSidebarColor(sidebar: string) {
    this.sidebarcolor = sidebar;
    this.store.dispatch(changesidebarcolor({ sidebar }));
    this.store.select(getSidebarcolor).subscribe((sidebar) => {
      this.renderer.setAttribute(document.documentElement, 'data-sidebar', sidebar);
    })
  }


  // Visibility Change
  changeVisibility(visibility: string) {
    this.sidebarVisibility = visibility;
    document.documentElement.setAttribute('data-sidebar-visibility', visibility)
  }


  // Width Change
  changeWidth(width: string, size: string) {
    this.layoutWidth = width;
    this.store.dispatch(changewidthLayout({ width }));
    this.store.select(getLayoutWidth).subscribe((width) => {
      this.renderer.setAttribute(document.documentElement, 'data-layout-width', width);
    })
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      document.documentElement.setAttribute('data-sidebar-size', size);
    }, 0);
  }
  // Position Change
  changePosition(position: string) {
    this.layoutposition = position;
    // document.documentElement.setAttribute('data-layout-position', position);
    this.store.dispatch(changeposition({ position }));
    this.store.select(getPosition).subscribe((position) => {
      this.renderer.setAttribute(document.documentElement, 'data-layout-position', position);
    })
  }

  // Topbar Change
  changeTopColor(topbar: string) {
    this.topbar = topbar;
    this.store.dispatch(changetopbar({ topbar }));
    this.store.select(getTopbar).subscribe((topbar) => {
      this.renderer.setAttribute(document.documentElement, 'data-topbar', topbar);
    })

  }

  // Sidebar Image Change
  changeSidebarImage(sidebarImage: string) {
    this.sidebarimage = sidebarImage;
    this.store.dispatch(changesidebarImage({ sidebarImage }));
    this.store.select(getsidebarimage).subscribe((sidebarImage) => {
      this.renderer.setAttribute(document.documentElement, 'data-sidebar-image', sidebarImage);
    })
  }

  // PreLoader Image Change
  changeLoader(preLoader: string) {
    this.preLoader = preLoader;
    this.store.dispatch(changepreLoader({ preLoader }));
    this.store.select(getPreloader).subscribe((preLoader) => {
      this.renderer.setAttribute(document.documentElement, 'data-preloader', preLoader);
    })
    var preloader = document.getElementById("preloader");
    if (preloader) {
      setTimeout(() => {
        this.renderer.setStyle(preloader, 'opacity', '0')
        this.renderer.setStyle(preloader, 'visibility', 'hidden')
      }, 1000);
    }
  }
}
