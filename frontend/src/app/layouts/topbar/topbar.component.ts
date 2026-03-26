import { Component, EventEmitter, OnInit, Output, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { ModalDirective } from 'ngx-bootstrap/modal';
import { AuthService } from 'src/app/services/auth.services';
import { Subscription } from 'rxjs';
import { HasPermDirective } from 'src/app/has-perm.directive';

@Component({
  selector: 'app-topbar',
  templateUrl: './topbar.component.html',
  styleUrls: ['./topbar.component.scss'],
})
export class TopbarComponent implements OnInit {

  country: any;
  selectedItem!: any;

  flagvalue: any;
  valueset: any;
  countryName: any;
  cookieValue: any;
  userData: any;
  cartData: any;

  element: any;
  mode: string | undefined;

  total: any;
  subtotal: any = 0;
  totalsum: any;
  taxRate: any = 0.125;
  shippingRate: any = '65.00';
  discountRate: any = 0.15;
  discount: any;
  tax: any;

  notificationList: any;

  currentRoute: string = "";

  @Output() mobileMenuButtonClicked = new EventEmitter();
  username: string = '';

  @ViewChild('removeNotificationModal', { static: false }) removeNotificationModal?: ModalDirective;
  @ViewChild('removeCartModal', { static: false }) removeCartModal?: ModalDirective;
  deleteid: any;
  totalNotify: number = 0;
  newNotify: number = 0;
  readNotify: number = 0;

  constructor(
    public authService: AuthService,
    private router: Router
  ) { }

  toggleMobileMenu(event: any) {
    document.querySelector('.hamburger-icon')?.classList.toggle('open')
    event.preventDefault();
    this.mobileMenuButtonClicked.emit();
  }

  windowScroll() {
    if (document.body.scrollTop > 100 || document.documentElement.scrollTop > 100) {
      // (document.getElementById('back-to-top') as HTMLElement).style.display = "block";
      document.getElementById('page-topbar')?.classList.add('topbar-shadow')
    } else {
      // (document.getElementById('back-to-top') as HTMLElement).style.display = "none";
      document.getElementById('page-topbar')?.classList.remove('topbar-shadow')
    }
  }

  // Increment Decrement Quantity
  qty: number = 0;
  increment(qty: any, i: any, id: any) {
    this.subtotal = 0;
    if (id == '0' && qty > 1) {
      qty--;
      this.cartData[i].qty = qty
      this.cartData[i].total = (this.cartData[i].qty * this.cartData[i].price).toFixed(2)
    }
    if (id == '1') {
      qty++;
      this.cartData[i].qty = qty
      this.cartData[i].total = (this.cartData[i].qty * this.cartData[i].price).toFixed(2)
    }

    this.cartData.map((x: any) => {
      this.subtotal += parseFloat(x['total'])
    })

    this.subtotal = this.subtotal.toFixed(2)
    this.discount = (this.subtotal * this.discountRate).toFixed(2)
    this.tax = (this.subtotal * this.taxRate).toFixed(2);
    this.totalsum = (parseFloat(this.subtotal) + parseFloat(this.tax) + parseFloat(this.shippingRate) - parseFloat(this.discount)).toFixed(2)
  }

  ngOnInit(): void {
    this.currentRoute = this.router.url;
    this.username = this.authService.getUsername();
  }

  navigateTo(route: string) {
    this.router.navigateByUrl(route);
    this.currentRoute = route;
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }
}
