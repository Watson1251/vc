import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Subject, Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { TargetModel, TargetStatus } from '../models/target.model';
import { SnackbarService } from './snackbar.service';

const BACKEND_URL = environment.apiUrl + '/targets/';
const toEpoch = (v: any) => (v ? new Date(v).getTime() : 0);

type RawIdOrDoc =
    | string
    | { _id?: string; id?: string; filename?: string; filepath?: string; mimetype?: string };

const pickId = (x: RawIdOrDoc): string =>
    typeof x === 'string' ? x : (x?._id || (x as any)?.id || '');

const toFile = (x: RawIdOrDoc) =>
    typeof x === 'string'
        ? undefined
        : ({
            id: x?._id || (x as any)?.id || '',
            filename: (x as any)?.filename,
            filepath: (x as any)?.filepath,
            mimetype: (x as any)?.mimetype,
        });

@Injectable({ providedIn: 'root' })
export class TargetsService {
    private targets: TargetModel[] = [];
    private targetsUpdated = new Subject<TargetModel[]>();

    constructor(
        private http: HttpClient,
        private snackbar: SnackbarService
    ) { }

    cancelTargetSchedule(id: string) {
        return this.http.post<{ message: string; removed: boolean; target: any }>(`${BACKEND_URL}${id}/cancel`, {})
            .pipe(catchError(this.handleError.bind(this)));
    }

    /** Train (or retrain) a target: schedules training on the backend */
    trainTarget(id: string): Observable<any> {
        return this.http
            .post<any>(`${BACKEND_URL}${id}/train`, {}, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    /** Load all targets (optional name filter) and emit. */
    getTargets(options?: { name?: string }): void {
        let params = new HttpParams();
        if (options?.name) params = params.set('name', options.name);

        this.http
            .get<{ targets: any[] }>(BACKEND_URL, { params, observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)))
            .subscribe((res) => {
                if (res.status === 200 || res.status === 201) {
                    const raw = res.body?.targets || [];

                    this.targets = raw
                        .map((t: any): TargetModel => {
                            const refArr = Array.isArray(t.referenceAudio) ? t.referenceAudio : [];
                            const trainArr = Array.isArray(t.trainingAudio) ? t.trainingAudio : [];

                            const referenceAudio = refArr.map(toFile).filter(Boolean) as any[];
                            const trainingAudio = trainArr.map(toFile).filter(Boolean) as any[];

                            const referenceAudioIds = refArr.map(pickId).filter(Boolean);
                            const trainingAudioIds = trainArr.map(pickId).filter(Boolean);

                            const statusVal = (t.status as TargetStatus) || 'NOT_SCHEDULED';

                            return {
                                id: t._id as string,
                                name: t.name as string,
                                description: t.description as string | undefined,

                                owner: typeof t.owner === 'string' ? (t.owner as string) : undefined,

                                referenceAudioIds,
                                trainingAudioIds,
                                referenceAudio: referenceAudio.length ? referenceAudio : undefined,
                                trainingAudio: trainingAudio.length ? trainingAudio : undefined,

                                status: statusVal,

                                // NEW
                                modelPath: typeof t.modelPath === 'string' ? t.modelPath : undefined,
                                configPath: typeof t.configPath === 'string' ? t.configPath : undefined,

                                createdAt: t.createdAt as string | undefined,
                                updatedAt: t.updatedAt as string | undefined,
                            };
                        })
                        .sort((a, b) => toEpoch(b.updatedAt || b.createdAt) - toEpoch(a.updatedAt || a.createdAt));

                    this.targetsUpdated.next(this.targets);
                }
            });
    }

    /** Stream of targets */
    getTargetsUpdateListener(): Observable<TargetModel[]> {
        return this.targetsUpdated.asObservable();
    }

    /** Get a single target */
    getTarget(id: string): Observable<any> {
        return this.http
            .get<any>(BACKEND_URL + id, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    /** Create */
    createTarget(data: {
        name: string;
        description?: string;
        referenceAudioIds?: string[];
        trainingAudioIds?: string[];
        status?: TargetStatus;        // optional; backend defaults
        modelPath?: string;
        configPath?: string;
    }): Observable<any> {
        const payload: any = { name: data.name };
        if (typeof data.description !== 'undefined') payload.description = data.description;
        if (Array.isArray(data.referenceAudioIds)) payload.referenceAudio = data.referenceAudioIds;
        if (Array.isArray(data.trainingAudioIds)) payload.trainingAudio = data.trainingAudioIds;
        if (typeof data.status !== 'undefined') payload.status = data.status;
        if (typeof data.modelPath !== 'undefined') payload.modelPath = data.modelPath;
        if (typeof data.configPath !== 'undefined') payload.configPath = data.configPath;

        return this.http.post<any>(BACKEND_URL, payload, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    /** Update (replaces arrays if provided) */
    updateTarget(
        id: string,
        data: Partial<Pick<TargetModel, 'name' | 'description' | 'status' | 'modelPath' | 'configPath'>> & {
            referenceAudioIds?: string[];
            trainingAudioIds?: string[];
        }
    ): Observable<any> {
        const payload: any = {};
        if (typeof data.name !== 'undefined') payload.name = data.name;
        if (typeof data.description !== 'undefined') payload.description = data.description;
        if (typeof data.referenceAudioIds !== 'undefined') payload.referenceAudio = data.referenceAudioIds;
        if (typeof data.trainingAudioIds !== 'undefined') payload.trainingAudio = data.trainingAudioIds;
        if (typeof data.status !== 'undefined') payload.status = data.status;
        if (typeof data.modelPath !== 'undefined') payload.modelPath = data.modelPath;
        if (typeof data.configPath !== 'undefined') payload.configPath = data.configPath;

        return this.http.put<any>(BACKEND_URL + id, payload, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }


    /** Delete */
    deleteTarget(id: string): Observable<any> {
        return this.http
            .delete<any>(BACKEND_URL + id, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    // ---- Local helpers ----
    listLocal(): TargetModel[] {
        return this.targets.slice();
    }
    findLocalById(id: string): TargetModel | undefined {
        return this.targets.find(t => t.id === id);
    }

    // ---- Error handling (Arabic) ----
    private handleError(error: HttpErrorResponse) {
        const msg = error?.error?.message
            ? error.error.message
            : (error.error instanceof ErrorEvent
                ? (error.error.message || 'حدث خطأ في العميل.')
                : 'حدث خطأ في المزود.');
        this.snackbar.openSnackBar(msg, 'failure');
        return throwError(() => msg);
    }
}
