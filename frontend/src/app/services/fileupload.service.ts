import { Injectable } from '@angular/core';
import {
  HttpClient,
  HttpErrorResponse,
  HttpEvent,
  HttpEventType,
  HttpHeaders,
  HttpParams,
  HttpResponse,
} from '@angular/common/http';
import { forkJoin, Observable, of, Subject, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { SnackbarService } from './snackbar.service';
import { environment } from '../../environments/environment';
import { FileModel, UploadFileModel } from '../models/upload-file.model';

const BACKEND_URL = environment.apiUrl + '/file-upload/';

export interface UploadProgressResult {
  progress: number;
  result?: any;
}

@Injectable({
  providedIn: 'root',
})
export class FileuploadService {
  constructor(
    private http: HttpClient,
    private snackbarService: SnackbarService
  ) { }

  private files: FileModel[] = [];
  private filesUpdated = new Subject<any>();

  private normalizeMeta(file: any): FileModel {
    const id = file?._id || file?.id;
    return {
      id,
      fileId: id, // ✅ ensure presence
      filename: file?.filename || file?.name || '',
      filepath: file?.filepath || '',
      uploadTime: file?.uploadTime
        ? Number(new Date(file.uploadTime))
        : (file?.createdAt ? Number(new Date(file.createdAt)) : Date.now()),
      mimetype: file?.mimetype,
    };
  }

  /** Fetch single file metadata by id */
  getFileMeta(fileId: string): Observable<FileModel> {
    return this.http.get<{ file: any }>(`${BACKEND_URL}${fileId}/meta`).pipe(
      map(({ file }) => this.normalizeMeta(file)),
      catchError((error: HttpErrorResponse) => this.handleError(error))
    );
  }

  /** Resolve many file ids to metas (no backend batch required) */
  getManyMeta(ids: string[]): Observable<FileModel[]> {
    if (!ids || ids.length === 0) return of([]);
    return forkJoin(ids.map(id => this.getFileMeta(id)));
  }


  retrieveFile(fileId: string, isEnhanced = false): Observable<Blob> {
    let params = new HttpParams();
    if (isEnhanced) {
      params = params.set('enhanced', 'true');
    }

    return this.http.get(`${BACKEND_URL}${fileId}`, {
      params,
      responseType: 'blob',
    });
  }

  getFileUrl(fileId: string, isEnhanced: boolean = false): string {
    const url = `${BACKEND_URL}${fileId}`;
    return isEnhanced ? `${url}?enhanced=true` : url;
  }

  /** Back-compat alias (was named getFile) */
  getFile(fileId: string): Observable<FileModel> {
    return this.getFileMeta(fileId);
  }

  getFiles() {
    this.http
      .get<{ message: string; files: any }>(BACKEND_URL, {
        observe: 'response',
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          return this.handleError(error);
        })
      )
      .subscribe((response: any) => {
        if (response.status == 200 || response.status == 201) {
          if (response.body == null) {
            return;
          }

          var fetchedFiles = response.body.files;
          var tempFiles: FileModel[] = [];

          fetchedFiles.forEach((item: any) => {
            const file: FileModel = {
              id: item._id,
              fileId: item._id,              // ✅
              filename: item.filename,
              filepath: item.filepath,
              uploadTime: Number(item.uploadTime),
              mimetype: item.mimetype,       // optional
            };
            tempFiles.push(file);
          });

          this.files = tempFiles;
          this.filesUpdated.next(this.files);
        }
      });
  }

  deleteFile(fileId: string) {
    return this.http
      .delete<any>(`${BACKEND_URL}${fileId}`, { observe: 'response' })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          return this.handleError(error);
        })
      );
  }

  getAllFiles(): Observable<any[]> {
    return this.http.get<{ files: any[] }>(BACKEND_URL).pipe(
      map((response) => response.files),
      catchError((error: HttpErrorResponse) => this.handleError(error))
    );
  }

  upload(file: File): Observable<UploadProgressResult> {
    const formData: FormData = new FormData();
    formData.append('file', file, file.name);

    return this.http
      .post<any>(BACKEND_URL + '', formData, {
        observe: 'events',
        reportProgress: true,
      })
      .pipe(
        map((event) => this.getEventMessage(event)),
        catchError((error: HttpErrorResponse) => this.handleError(error))
      );
  }

  private getEventMessage(event: HttpEvent<any>): UploadProgressResult {
    console.log('HTTP Event:', event);
    const result: UploadProgressResult = { progress: 0 };

    switch (event.type) {
      case HttpEventType.UploadProgress:
        result.progress = event.total ? Math.round((100 * event.loaded) / event.total) : 0;
        break;

      case HttpEventType.Response:
        result.progress = 100;
        if (event instanceof HttpResponse) {
          const raw = event.body?.file || event.body?.files?.[0];
          result.result = raw
            ? { id: raw._id || raw.id, fileId: raw._id || raw.id, filename: raw.filename || raw.name || '' }
            : undefined;
        }
        break;
    }

    return result;
  }

  handleError(error: HttpErrorResponse) {
    let message = '';

    // Client-side error occurred
    if (error.error instanceof ErrorEvent) {
      message = error.error.message
        ? error.error.message
        : 'حدث خطأ في العميل.';
    } else {
      // Server-side error occurred
      message = error.error?.message
        ? error.error.message
        : 'حدث خطأ في المزود.';
    }

    this.snackbarService.openSnackBar(message, 'failure');
    return throwError(() => message);
  }
}
