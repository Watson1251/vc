// paginator.component.ts
import { Component, EventEmitter, Input, Output, SimpleChanges, ViewChild } from '@angular/core';
import { MatPaginator, PageEvent } from '@angular/material/paginator';
import { MatTableDataSource } from '@angular/material/table';
import { Helper } from '../helpers';

@Component({
  selector: 'app-paginator',
  templateUrl: './paginator.component.html',
  styleUrls: ['./paginator.component.scss'],
})
export class PaginatorComponent {
  @Input() dataSource: MatTableDataSource<any> | undefined;

  // 🔻 make these controlled by parent
  @Input() length = 0;
  @Input() pageSize = 5;
  @Input() pageIndex = 0;
  @Input() pageSizeOptions = [5, 10, 25, 50, 100];
  @Input() hidePageSize = false;
  @Input() showPageSizeOptions = true;
  @Input() showFirstLastButtons = true;
  @Input() disabled = false;

  @Output() pageChange = new EventEmitter<PageEvent>();

  Helper = Helper;

  @ViewChild(MatPaginator, { static: true }) paginator!: MatPaginator;
  @ViewChild(MatPaginator, { static: false }) set setPaginator(content: MatPaginator | undefined) {
    if (content) {
      setTimeout(() => {
        this.paginator = content;

        // Arabic labels
        this.paginator._intl.itemsPerPageLabel = 'العناصر:';
        this.paginator._intl.firstPageLabel = 'الصفحة الأولى';
        this.paginator._intl.previousPageLabel = 'الصفحة السابقة';
        this.paginator._intl.nextPageLabel = 'الصفحة التالية';
        this.paginator._intl.lastPageLabel = 'الصفحة الأخيرة';
        this.paginator._intl.getRangeLabel = (page, pageSize, length) => {
          const start = page * pageSize + 1;
          const endLength = Math.min((page + 1) * pageSize, length);
          return `${start} إلى ${endLength} من ${length}`;
        };

        // Hook to dataSource
        if (this.dataSource) this.dataSource.paginator = this.paginator;

        // Initial sync with inputs
        this.applyInputsToPaginator();
      });
    }
  }

  pageEvent?: PageEvent;

  handlePageEvent(e: PageEvent) {
    this.pageEvent = e;
    this.length = e.length;
    this.pageSize = e.pageSize;
    this.pageIndex = e.pageIndex;
    this.pageChange.emit(e);
  }

  ngOnInit() {
    if (this.dataSource) {
      // If parent provided length, use it; otherwise derive from dataSource
      if (!this.length) this.length = this.dataSource.data.length;
      this.dataSource.paginator = this.paginator;
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    // When parent resets pageIndex/size/length, mirror into MatPaginator
    if (changes['dataSource'] && this.dataSource && this.paginator) {
      if (!this.length) this.length = this.dataSource.data.length;
      this.dataSource.paginator = this.paginator;
    }
    if (
      changes['pageIndex'] ||
      changes['pageSize'] ||
      changes['length'] ||
      changes['showFirstLastButtons'] ||
      changes['hidePageSize']
    ) {
      this.applyInputsToPaginator();
    }
  }

  // Public helper if parent ever wants to force first page programmatically
  firstPage() {
    if (this.paginator) {
      this.paginator.firstPage();
      this.pageIndex = 0;
    }
  }

  private applyInputsToPaginator() {
    if (!this.paginator) return;
    this.paginator.length = this.length;
    this.paginator.pageSize = this.pageSize;
    // Set pageIndex then, if zero, also call firstPage to ensure UI updates
    this.paginator.pageIndex = this.pageIndex;
    if (this.pageIndex === 0) this.paginator.firstPage();
  }
}
