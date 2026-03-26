import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Subject, Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { SoundEffectModel } from '../models/sound-effect.model';
import { SnackbarService } from './snackbar.service';

const BACKEND_URL = environment.apiUrl + '/sound-effects/';
const toEpoch = (v: any) => (v ? new Date(v).getTime() : 0);

@Injectable({ providedIn: 'root' })
export class SoundEffectsService {
    private effects: SoundEffectModel[] = [];
    private effectsUpdated = new Subject<SoundEffectModel[]>();

    constructor(
        private http: HttpClient,
        private snackbar: SnackbarService
    ) { }

    /**
     * Load all sound effects (optional filters via params) and emit
     * options:
     *  - soundEffectTypeId?: string
     *  - name?: string (substring match)
     */
    getEffects(options?: { soundEffectTypeId?: string; name?: string }): void {
        let params = new HttpParams();
        if (options?.soundEffectTypeId) params = params.set('soundEffectTypeId', options.soundEffectTypeId);
        if (options?.name) params = params.set('name', options.name);

        this.http.get<{ soundEffects: any[] }>(BACKEND_URL, { params, observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)))
            .subscribe(res => {
                if (res.status === 200 || res.status === 201) {
                    const raw = res.body?.soundEffects || [];

                    this.effects = raw.map((e: any): SoundEffectModel => {
                        const file = (e.fileId && e.fileId._id)
                            ? {
                                id: e.fileId._id as string,
                                fileId: e.fileId._id as string,  // ✅ add this
                                filename: e.fileId.filename as string,
                                filepath: e.fileId.filepath as string,
                                uploadTime: typeof e.fileId.uploadTime === 'number'
                                    ? e.fileId.uploadTime
                                    : (e.fileId.createdAt ? Number(new Date(e.fileId.createdAt)) : 0),
                                mimetype: e.fileId.mimetype as (string | undefined),
                            }
                            : undefined;

                        const fileId: string =
                            (e.fileId && e.fileId._id) ? e.fileId._id as string :
                                (typeof e.fileId === 'string' ? e.fileId : '');

                        const type = (e.soundEffectTypeId && e.soundEffectTypeId._id)
                            ? {
                                id: e.soundEffectTypeId._id as string,
                                soundEffectType: e.soundEffectTypeId.soundEffectType as string,
                            }
                            : undefined;

                        const soundEffectTypeId: string =
                            (e.soundEffectTypeId && e.soundEffectTypeId._id) ? e.soundEffectTypeId._id as string :
                                (typeof e.soundEffectTypeId === 'string' ? e.soundEffectTypeId : '');

                        return {
                            id: e._id as string,
                            name: e.name as string,
                            fileId,                         // ✅ always a string
                            file,                           // ✅ if populated, includes fileId
                            soundEffectTypeId: soundEffectTypeId,
                            soundEffectType: type,
                            start: typeof e.start === 'number' ? e.start : (e.start == null ? null : undefined),
                            end: typeof e.end === 'number' ? e.end : (e.end == null ? null : undefined),
                            createdAt: e.createdAt as (string | undefined),
                            updatedAt: e.updatedAt as (string | undefined),
                        };
                    }).sort((a, b) => toEpoch(b.createdAt) - toEpoch(a.createdAt));

                    this.effectsUpdated.next(this.effects);
                }
            });
    }


    /** Stream of effects */
    getEffectsUpdateListener(): Observable<SoundEffectModel[]> {
        return this.effectsUpdated.asObservable();
    }

    /** Get a single effect */
    getEffect(id: string): Observable<any> {
        return this.http.get<any>(BACKEND_URL + id, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    /** Create */
    createEffect(
        data: Pick<SoundEffectModel, 'name' | 'soundEffectTypeId'> & { fileId: string; start?: number | null; end?: number | null }
    ): Observable<any> {
        const payload: any = {
            name: data.name,
            soundEffectTypeId: data.soundEffectTypeId,
            fileId: data.fileId,
        };
        if (typeof data.start !== 'undefined') payload.start = data.start;
        if (typeof data.end !== 'undefined') payload.end = data.end;

        return this.http.post<any>(BACKEND_URL, payload, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    /** Update */
    updateEffect(
        id: string,
        data: Partial<Pick<SoundEffectModel, 'name' | 'soundEffectTypeId' | 'start' | 'end'>> & { fileId?: string | null }
    ): Observable<any> {
        const payload: any = {};
        if (typeof data.name !== 'undefined') payload.name = data.name;
        if (typeof data.soundEffectTypeId !== 'undefined') payload.soundEffectTypeId = data.soundEffectTypeId;
        if (typeof data.fileId !== 'undefined') payload.fileId = data.fileId;

        if (typeof data.start !== 'undefined') payload.start = data.start; // number or null
        if (typeof data.end !== 'undefined') payload.end = data.end;   // number or null

        return this.http.put<any>(BACKEND_URL + id, payload, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    /** Delete */
    deleteEffect(id: string): Observable<any> {
        return this.http.delete<any>(BACKEND_URL + id, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    // ----- Client-side helpers (optional) -----
    filterLocalByType(typeId: string): SoundEffectModel[] {
        return this.effects.filter(e => e.soundEffectTypeId === typeId);
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
