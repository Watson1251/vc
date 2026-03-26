import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Subject, Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { SoundEffectTypeModel } from '../models/sound-effect-type.model';
import { SnackbarService } from './snackbar.service';

const BACKEND_URL = environment.apiUrl + '/sound-effect-types/';

@Injectable({ providedIn: 'root' })
export class SoundEffectTypesService {
    private types: SoundEffectTypeModel[] = [];
    private typesUpdated = new Subject<SoundEffectTypeModel[]>();

    constructor(
        private http: HttpClient,
        private snackbar: SnackbarService
    ) { }

    /** Load all types and emit */
    getTypes(): void {
        this.http.get<{ soundEffectTypes: any[] }>(BACKEND_URL, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)))
            .subscribe(res => {
                if (res.status === 200 || res.status === 201) {
                    const raw = res.body?.soundEffectTypes || [];
                    this.types = raw.map((t: any): SoundEffectTypeModel => ({
                        id: t._id,
                        soundEffectType: t.soundEffectType,
                        createdAt: t.createdAt,
                        updatedAt: t.updatedAt,
                    }));
                    this.typesUpdated.next(this.types);
                }
            });
    }

    /** Stream of types */
    getTypesUpdateListener(): Observable<SoundEffectTypeModel[]> {
        return this.typesUpdated.asObservable();
    }

    /** Get a single type (returns raw HTTP response) */
    getType(id: string): Observable<any> {
        return this.http.get<any>(BACKEND_URL + id, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    /** Create */
    createType(data: Pick<SoundEffectTypeModel, 'soundEffectType'>): Observable<any> {
        const payload = { soundEffectType: data.soundEffectType };
        return this.http.post<any>(BACKEND_URL, payload, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    /** Update */
    updateType(id: string, data: Partial<Pick<SoundEffectTypeModel, 'soundEffectType'>>): Observable<any> {
        const payload: any = {};
        if (typeof data.soundEffectType !== 'undefined') payload.soundEffectType = data.soundEffectType;
        return this.http.put<any>(BACKEND_URL + id, payload, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    /** Delete */
    deleteType(id: string): Observable<any> {
        return this.http.delete<any>(BACKEND_URL + id, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    // ----- error handling (Arabic) -----
    private handleError(error: HttpErrorResponse) {
        const msg =
            error?.error?.message
                ? error.error.message
                : (error.error instanceof ErrorEvent
                    ? (error.error.message || 'حدث خطأ في العميل.')
                    : 'حدث خطأ في المزود.');
        this.snackbar.openSnackBar(msg, 'failure');
        return throwError(() => msg);
    }
}
