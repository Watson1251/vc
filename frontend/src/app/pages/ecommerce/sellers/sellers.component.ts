import { Component, ViewChild } from '@angular/core';

// Get Data
import { DecimalPipe } from '@angular/common';
import { Observable } from 'rxjs';
import { UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms';
import { ModalDirective } from 'ngx-bootstrap/modal';
import { DropzoneConfigInterface } from 'ngx-dropzone-wrapper';
import { addSellerdata, deleteSellerdataData, fetchsellerdata, updateSellerdataData } from 'src/app/store/Seller/seller.action';
import { selectData } from 'src/app/store/Seller/seller.selector';
import { Store } from '@ngrx/store';

@Component({
  selector: 'app-sellers',
  templateUrl: './sellers.component.html',
  styleUrls: ['./sellers.component.scss'],
  providers: [DecimalPipe]
})

// Seller Component
export class SellersComponent {

  // bread crumb items
  breadCrumbItems!: Array<{}>;
  sellerData: any;
  sellers: any;
  sellersList: any
  endItem: any
  sellerForm!: UntypedFormGroup;
  submitted: boolean = false;
  files: File[] = [];

  @ViewChild('addSellerModal', { static: false }) addSellerModal?: ModalDirective;
  @ViewChild('removeItemModal', { static: false }) removeItemModal?: ModalDirective;
  deleteId: any;

  constructor(private formBuilder: UntypedFormBuilder, public store: Store) {
    // this.sellerList = service.countries$;
    // this.total = service.total$;
  }

  ngOnInit(): void {
    /**
     * BreadCrumb
     */
    this.breadCrumbItems = [
      { label: 'Ecommerce', active: true },
      { label: 'Sellers', active: true }
    ];

    /**
* Form Validation
*/
    this.sellerForm = this.formBuilder.group({
      id: [''],
      name: ['', [Validators.required]],
      seller: ['', [Validators.required]],
      email: ['', [Validators.required]],
      phone: ['', [Validators.required]],
      img: [''],
    });

    // Fetch Data
    setTimeout(() => {
      this.store.dispatch(fetchsellerdata());
      this.store.select(selectData).subscribe((data) => {
        this.sellers = data;
        this.sellersList = data;
        this.sellers = this.sellersList.slice(0, 10);
      })
      document.getElementById('elmLoader')?.classList.add('d-none')
    }, 1200)
  }

  public dropzoneConfig: DropzoneConfigInterface = {
    clickable: true,
    addRemoveLinks: true,
    previewsContainer: false,
  };

  uploadedFiles: any[] = [];

  // File Upload
  imageURL: any;
  onUploadSuccess(event: any) {
    setTimeout(() => {
      this.uploadedFiles.push(event[0]);
      this.sellerForm.controls['img'].setValue(event[0].dataURL);
    }, 0);
  }

  // File Remove
  removeFile(event: any) {
    this.uploadedFiles.splice(this.uploadedFiles.indexOf(event), 1);
  }

  // Edit Seller
  editSeller(id: any) {
    this.addSellerModal?.show()
    var modaltitle = document.querySelector('.modal-title') as HTMLAreaElement
    modaltitle.innerHTML = 'Edit seller details'
    var modalbtn = document.getElementById('add-btn') as HTMLAreaElement
    modalbtn.innerHTML = 'Update'

    this.uploadedFiles.push({ 'dataURL': this.sellerData[id].img, 'name': this.sellerData[id].img_alt, 'size': 1024, });

    this.sellerForm.patchValue(this.sellers[id]);
  }

  // Add Seller
  saveSeller() {
    if (this.sellerForm.valid) {
      if (this.sellerForm.get('id')?.value) {
        const updatedData = this.sellerForm.value;
        this.store.dispatch(updateSellerdataData({ updatedData }));
      }
      else {
        this.sellerForm.controls['id'].setValue(this.sellers.length + 1)
        const newData = this.sellerForm.value
        this.store.dispatch(addSellerdata({ newData }))

      }
      setTimeout(() => {
        this.sellerForm.reset();
      }, 1000);
      this.addSellerModal?.hide()
    }
  }


  // Delete Seller
  removeSeller(id: any) {
    this.deleteId = id;
    this.removeItemModal?.show()
  }

  // delete
  deleteSeller() {
    this.store.dispatch(deleteSellerdataData({ id: this.deleteId }));
    this.removeItemModal?.hide()
  }

  pageChanged(event: any): void {
    const startItem = (event.page - 1) * event.itemsPerPage;
    this.endItem = event.page * event.itemsPerPage;
    this.sellers = this.sellersList.slice(startItem, this.endItem);
  }

}
