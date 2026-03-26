import { Component, QueryList, ViewChild, ViewChildren } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms';
import { ModalDirective } from 'ngx-bootstrap/modal';
import { Store } from '@ngrx/store';
import { selectData } from 'src/app/store/Orders/order.selector';
import { addOrderData, deleteOrderData, fetchOrderdata, updateOrderData } from 'src/app/store/Orders/order.action';
import { PageChangedEvent } from 'ngx-bootstrap/pagination';

@Component({
  selector: 'app-orders',
  templateUrl: './orders.component.html',
  styleUrls: ['./orders.component.scss'],
  providers: [DecimalPipe]
})
export class OrdersComponent {
  term: any
  // bread crumb items
  breadCrumbItems!: Array<{}>;
  linebasicChart: any;
  orderForm!: UntypedFormGroup;
  submitted: boolean = false;
  masterSelected!: boolean;
  Orderlist: any
  Order: any
  // Table data
  deleteId: any;
  sortValue: any = 'Order Date'
  endItem: any
  @ViewChild('showModal', { static: false }) showModal?: ModalDirective;
  @ViewChild('deleteRecordModal', { static: false }) deleteRecordModal?: ModalDirective;


  constructor(private formBuilder: UntypedFormBuilder, public store: Store) { }

  ngOnInit(): void {
    /**
     * BreadCrumb
     */
    this.breadCrumbItems = [
      { label: 'Ecommerce', active: true },
      { label: 'Orders', active: true }
    ];


    // Chart Color Data Get Function
    this._linebasicChart('["--tb-primary", "--tb-secondary"]');

    // Fetch Data
    setTimeout(() => {
      // store data
      this.store.dispatch(fetchOrderdata());
      this.store.select(selectData).subscribe((data) => {
        this.Order = data;
        this.Orderlist = data;
        this.Order = this.Orderlist.slice(0, 8)
      });
      document.getElementById('elmLoader')?.classList.add('d-none')
    }, 1200)

    /**
 * Form Validation
 */
    this.orderForm = this.formBuilder.group({
      id: [''],
      customer: ['', [Validators.required]],
      product: ['', [Validators.required]],
      order_date: ['', [Validators.required]],
      name: ['', [Validators.required]],
      price: ['', [Validators.required]],
      pay_method: ['', [Validators.required]],
      delivery_status: ['', [Validators.required]],
      shop: this.formBuilder.group({
        img: ['']
      }),
    });
  }

  // Chart Colors Set
  private getChartColorsArray(colors: any) {
    colors = JSON.parse(colors);
    return colors.map(function (value: any) {
      var newValue = value.replace(" ", "");
      if (newValue.indexOf(",") === -1) {
        var color = getComputedStyle(document.documentElement).getPropertyValue(newValue);
        if (color) {
          color = color.replace(" ", "");
          return color;
        }
        else return newValue;;
      } else {
        var val = value.split(',');
        if (val.length == 2) {
          var rgbaColor = getComputedStyle(document.documentElement).getPropertyValue(val[0]);
          rgbaColor = "rgba(" + rgbaColor + "," + val[1] + ")";
          return rgbaColor;
        } else {
          return newValue;
        }
      }
    });
  }

  /**
  * Sale Charts
  */
  private _linebasicChart(colors: any) {
    colors = this.getChartColorsArray(colors);
    this.linebasicChart = {
      series: [{
        name: "New Orders",
        data: [32, 18, 13, 17, 26, 34, 47, 51, 59, 63, 44, 38, 53, 69, 72, 83, 90, 110, 130, 117, 103, 92, 95, 119, 80, 96, 116, 125]
      }, {
        name: "Return Orders",
        data: [3, 6, 2, 4, 7, 9, 15, 10, 19, 22, 27, 21, 34, 23, 29, 32, 41, 34, 29, 37, 70, 55, 49, 36, 30, 52, 38, 33]
      }],
      chart: {
        height: 350,
        type: 'line',
        toolbar: {
          show: false
        }
      },
      legend: {
        show: true,
        position: 'top',
        horizontalAlign: 'right',
      },
      grid: {
        yaxis: {
          lines: {
            show: false
          }
        },
      },
      markers: {
        size: 0,
        hover: {
          sizeOffset: 4
        }
      },
      stroke: {
        curve: 'smooth',
        width: 2
      },
      colors: colors,
      xaxis: {
        type: 'datetime',
        categories: ['02/01/2023 GMT', '02/02/2023 GMT', '02/03/2023 GMT', '02/04/2023 GMT',
          '02/05/2023 GMT', '02/06/2023 GMT', '02/07/2023 GMT', '02/08/2023 GMT', '02/09/2023 GMT', '02/10/2023 GMT', '02/11/2023 GMT', '02/12/2023 GMT', '02/13/2023 GMT',
          '02/14/2023 GMT', '02/15/2023 GMT', '02/16/2023 GMT', '02/17/2023 GMT', '02/18/2023 GMT', '02/19/2023 GMT', '02/20/2023 GMT', '02/21/2023 GMT', '02/22/2023 GMT',
          '02/23/2023 GMT', '02/24/2023 GMT', '02/25/2023 GMT', '02/26/2023 GMT', '02/27/2023 GMT', '02/28/2023 GMT'
        ]
      },
      yaxis: {
        show: false,
      }
    }

    const attributeToMonitor = 'data-theme';

    const observer = new MutationObserver(() => {
      this._linebasicChart('["--tb-primary", "--tb-secondary"]');
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [attributeToMonitor]
    });
  }

  // Add Sorting
  direction: any = 'asc';
  sortKey: any = ''
  onSort(column: any) {
    if (this.direction == 'asc') {
      this.direction = 'desc';
    } else {
      this.direction = 'asc';
    }
    const sortedArray = [...this.Order]; // Create a new array
    sortedArray.sort((a, b) => {
      const res = this.compare(a[column], b[column]);
      return this.direction === 'asc' ? res : -res;
    });
    this.Order = sortedArray;
  }
  compare(v1: string | number, v2: string | number) {
    return v1 < v2 ? -1 : v1 > v2 ? 1 : 0;
  }

  // Edit Order
  editOrder(id: any) {
    this.showModal?.show()
    var modaltitle = document.querySelector('.modal-title') as HTMLAreaElement
    modaltitle.innerHTML = 'Edit Product'
    var modalbtn = document.getElementById('add-btn') as HTMLAreaElement
    modalbtn.innerHTML = 'Update'

    document.querySelectorAll('#companyLogo-img').forEach((element: any) => {
      element.src = this.Order[id].img;
    });
    // var editData = this.Order[id]
    // this.uploadedFiles.push({ 'dataURL': editData.img, 'name': editData.img_alt, 'size': 1024, });
    this.orderForm.patchValue(this.Order[id]);
  }

  // File Upload
  imageURL: string | undefined;
  fileChange(event: any) {
    let fileList: any = event.target as HTMLInputElement;
    let file: File = fileList.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      this.imageURL = reader.result as string;
      document.querySelectorAll('#companyLogo-img').forEach((element: any) => {
        element.src = this.imageURL;
      });
      this.orderForm.controls['img'].setValue(this.imageURL);
    };

    reader.readAsDataURL(file);
  }

  // Add Order
  saveOrder() {
    if (this.orderForm.valid) {
      if (this.orderForm.get('id')?.value) {
        const updatedData = this.orderForm.value;
        this.store.dispatch(updateOrderData({ updatedData }));
      }
      else {
        // this.orderForm.controls['id'].setValue((this.Order.length + 1).toString());
        const newData = this.orderForm.value
        this.store.dispatch(addOrderData({ newData }))
      }
      document.querySelectorAll('#customer-img').forEach((element: any) => {
        element.src = 'assets/images/users/user-dummy-img.jpg';
      });
    }
    this.showModal?.hide()

    setTimeout(() => {
      this.orderForm.reset();
    }, 1000);
    this.submitted = true
  }

  // Delete Order
  removeOrder(id: any) {
    this.deleteId = id;
    console.log(this.deleteId)
    this.deleteRecordModal?.show()
  }

  checkedValGet: any[] = [];
  // The master checkbox will check/ uncheck all items
  checkUncheckAll(ev: any) {
    this.Order = this.Order.map((x: { states: any }) => ({ ...x, states: ev.target.checked }));

    var checkedVal: any[] = [];
    var result;
    for (var i = 0; i < this.Order.length; i++) {
      if (this.Order[i].states == true) {
        result = this.Order[i].id;
        checkedVal.push(result);
      }
    }

    this.checkedValGet = checkedVal;
    checkedVal.length > 0 ? document.getElementById("remove-actions")?.classList.remove('d-none') : document.getElementById("remove-actions")?.classList.add('d-none');
  }

  // Select Checkbox value Get
  onCheckboxChange(e: any) {
    var checkedVal: any[] = [];
    var result
    for (var i = 0; i < this.Order.length; i++) {
      if (this.Order[i].states == true) {
        result = this.Order[i].id;
        checkedVal.push(result);
      }
    }
    this.checkedValGet = checkedVal
    checkedVal.length > 0 ? document.getElementById("remove-actions")?.classList.remove('d-none') : document.getElementById("remove-actions")?.classList.add('d-none');
  }

  // deletedata
  deleteData(id: any) {
    this.deleteRecordModal?.hide();
    if (id) {
      this.store.dispatch(deleteOrderData({ id: this.deleteId.toString() }));
    }
    this.store.dispatch(deleteOrderData({ id: this.checkedValGet.toString() }));
    this.deleteRecordModal?.hide();
    this.masterSelected = false
  }
  // filterdata
  filterdata() {
    if (this.term) {
      this.Order = this.Orderlist.filter((es: any) => es.product.toLowerCase().includes(this.term.toLowerCase()))
    } else {
      this.Order = this.Orderlist
    }
    this.Order = this.Orderlist.slice(0, 10);
    // noResultElement
    this.updateNoResultDisplay();
  }

  // no result 
  updateNoResultDisplay() {
    const noResultElement = document.querySelector('.noresult') as HTMLElement;
    const paginationElement = document.getElementById('pagination-element') as HTMLElement
    if (this.term && this.Order.length === 0) {
      noResultElement.style.display = 'block';
      paginationElement.classList.add('d-none')
    } else {
      noResultElement.style.display = 'none';
      paginationElement.classList.remove('d-none')
    }
  }

  // pagechanged
  pageChanged(event: PageChangedEvent): void {
    const startItem = (event.page - 1) * event.itemsPerPage;
    this.endItem = event.page * event.itemsPerPage;
    this.Order = this.Orderlist.slice(startItem, this.endItem);
  }

}
