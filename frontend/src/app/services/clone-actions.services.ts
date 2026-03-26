import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Subject, Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { SnackbarService } from './snackbar.service';
import { CloneActionModel } from '../models/clone-action.model';

const BACKEND_URL = environment.apiUrl + '/clone-actions/';
const toEpoch = (v: any) => (v ? new Date(v).getTime() : 0);

type RawFileDoc =
    | string
    | { _id?: string; id?: string; filename?: string; filepath?: string; mimetype?: string; uploadTime?: number | string; createdAt?: string };

/** Normalize a FileUpload-like doc to FileModel (ensures fileId) */
const toFile = (x: RawFileDoc) => {
    if (typeof x === 'string') return undefined;

    const id = x?._id || (x as any)?.id || '';
    const uploadTime =
        typeof (x as any)?.uploadTime === 'number'
            ? (x as any)?.uploadTime
            : (x as any)?.uploadTime
                ? Number(new Date((x as any).uploadTime))
                : ((x as any)?.createdAt ? Number(new Date((x as any).createdAt)) : 0);

    return {
        id,
        fileId: id, // <-- satisfy FileModel requirement
        filename: (x as any)?.filename,
        filepath: (x as any)?.filepath,
        mimetype: (x as any)?.mimetype,
        uploadTime,
    } as const;
};


type RawIdOrDoc = string | { _id?: string; id?: string };

const pickId = (x: RawIdOrDoc): string =>
    typeof x === 'string' ? x : (x?._id || (x as any)?.id || '');


/** Normalize a SoundEffect doc to a lightweight object with file meta */
/** Normalize a SoundEffect doc to a lightweight object with file meta */
const toSoundEffect = (x: RawIdOrDoc) => {
    if (!x) return undefined;

    // If we only have the soundEffect id, we *don't* know the fileId yet.
    // Return empty string for fileId to satisfy typing.
    if (typeof x === 'string') {
        return {
            id: x,
            name: undefined,
            fileId: '',                  // ✅ always a string
            file: undefined,
            soundEffectTypeId: '',
            soundEffectType: undefined,
            start: null,
            end: null,
            createdAt: undefined,
            updatedAt: undefined,
        };
    }

    const raw: any = x;
    const id = raw?._id || raw?.id || '';

    // fileId may be a populated doc or plain id; ensure string
    const resolvedFileId: string =
        (raw?.fileId && raw.fileId._id) ? raw.fileId._id :
            (typeof raw?.fileId === 'string' ? raw.fileId : '');

    const file = (raw?.fileId && raw.fileId._id)
        ? {
            id: raw.fileId._id,
            fileId: raw.fileId._id,     // ✅ required by FileModel
            filename: raw.fileId.filename,
            filepath: raw.fileId.filepath,
            uploadTime: typeof raw.fileId.uploadTime === 'number'
                ? raw.fileId.uploadTime
                : (raw.fileId.createdAt ? Number(new Date(raw.fileId.createdAt)) : 0),
            mimetype: raw.fileId.mimetype,
        }
        : undefined;

    const typeId: string =
        (raw?.soundEffectTypeId && raw.soundEffectTypeId._id) ? raw.soundEffectTypeId._id :
            (typeof raw?.soundEffectTypeId === 'string' ? raw.soundEffectTypeId : '');

    const type = (raw?.soundEffectTypeId && raw.soundEffectTypeId._id)
        ? {
            id: raw.soundEffectTypeId._id,
            soundEffectType: raw.soundEffectTypeId.soundEffectType,
        }
        : undefined;

    return {
        id,
        name: raw?.name,
        fileId: resolvedFileId,         // ✅ always a string
        file,                           // ✅ if populated, includes fileId
        soundEffectTypeId: typeId,
        soundEffectType: type,
        start: typeof raw?.start === 'number' ? raw.start : null,
        end: typeof raw?.end === 'number' ? raw.end : null,
        createdAt: raw?.createdAt,
        updatedAt: raw?.updatedAt,
    };
};


@Injectable({ providedIn: 'root' })
export class CloneActionsService {
    private items: CloneActionModel[] = [];
    private itemsUpdated = new Subject<CloneActionModel[]>();

    constructor(
        private http: HttpClient,
        private snackbar: SnackbarService
    ) { }

    schedule(id: string): Observable<any> {
        return this.http
            .post<any>(BACKEND_URL + id + '/clone', {}, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    /** Cancel (publish cancel token + best-effort dequeue) */
    cancel(id: string): Observable<any> {
        return this.http
            .post<any>(BACKEND_URL + id + '/cancel', {}, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    /** List (optional by target) */
    getAll(options?: { targetId?: string }): void {
        let params = new HttpParams();
        if (options?.targetId) params = params.set('target', options.targetId);

        this.http
            .get<{ cloneActions: any[] }>(BACKEND_URL, { params, observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)))
            .subscribe(res => {
                if (res.status === 200 || res.status === 201) {
                    const raw = res.body?.cloneActions || [];
                    this.items = raw
                        .map((c: any): CloneActionModel => {
                            const contentAudio = toFile(c.contentAudio);
                            const referenceAudio = toFile(c.referenceAudio);
                            const soundEffectObj = toSoundEffect(c.soundEffect);
                            const outputFile = toFile(c.outputPath);   // ✅ if populated
                            const outputId = pickId(c.outputPath);   // ✅ if id-only

                            return {
                                id: c._id as string,
                                scenario: c.scenario || undefined,

                                // ids
                                contentAudioId: pickId(c.contentAudio),
                                referenceAudioId: pickId(c.referenceAudio),
                                targetId: pickId(c.target),
                                soundEffectId: pickId(c.soundEffect),

                                // populated files
                                contentAudio,
                                referenceAudio,

                                outputPath: outputFile ?? outputId ?? undefined,

                                // populated (or partial) sound effect
                                soundEffect: soundEffectObj,

                                // optionally populated target
                                target: c.target
                                    ? {
                                        id: pickId(c.target),
                                        name: c.target?.name,
                                        description: c.target?.description,
                                        status: c.target?.status,
                                        modelPath: c.target?.modelPath,
                                        configPath: c.target?.configPath,
                                    }
                                    : undefined,

                                // captured paths (if backend sends these)
                                modelPath: typeof c.modelPath === 'string' ? c.modelPath : undefined,
                                configPath: typeof c.configPath === 'string' ? c.configPath : undefined,

                                diffusion: typeof c.diffusion === 'number' ? c.diffusion : 25.0,
                                length: typeof c.length === 'number' ? c.length : 1.0,
                                inference_rate: typeof c.inference_rate === 'number' ? c.inference_rate : 0.7,

                                status: (c as any)?.status, // optional, won’t break if missing

                                owner: typeof c.owner === 'string' ? c.owner : undefined,
                                createdAt: c.createdAt,
                                updatedAt: c.updatedAt,
                            };
                        })
                        .sort((a, b) => toEpoch(b.updatedAt || b.createdAt) - toEpoch(a.updatedAt || a.createdAt));

                    this.itemsUpdated.next(this.items);
                }
            });
    }

    getAllListener(): Observable<CloneActionModel[]> {
        return this.itemsUpdated.asObservable();
    }

    getOne(id: string): Observable<any> {
        return this.http
            .get<any>(BACKEND_URL + id, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    /** Create */
    create(data: {
        scenario?: string;
        contentAudioId: string;
        targetId: string;
        referenceAudioId: string;
        soundEffectId?: string;
        diffusion?: number;
        length?: number;
        inference_rate?: number;
    }): Observable<any> {
        const payload: any = {
            scenario: data.scenario ?? '',
            contentAudio: data.contentAudioId,
            target: data.targetId,
            referenceAudio: data.referenceAudioId,
        };
        if (typeof data.soundEffectId !== 'undefined') payload.soundEffect = data.soundEffectId;
        if (typeof data.diffusion !== 'undefined') payload.diffusion = data.diffusion;
        if (typeof data.length !== 'undefined') payload.length = data.length;
        if (typeof data.inference_rate !== 'undefined') payload.inference_rate = data.inference_rate;

        return this.http
            .post<any>(BACKEND_URL, payload, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    /** Update */
    update(
        id: string,
        data: Partial<{
            scenario: string;
            contentAudioId: string;
            targetId: string;
            referenceAudioId: string;
            soundEffectId: string;
            diffusion: number;
            length: number;
            inference_rate: number;
        }>
    ): Observable<any> {
        const payload: any = {};
        if (typeof data.scenario !== 'undefined') payload.scenario = data.scenario;
        if (typeof data.contentAudioId !== 'undefined') payload.contentAudio = data.contentAudioId;
        if (typeof data.targetId !== 'undefined') payload.target = data.targetId;
        if (typeof data.referenceAudioId !== 'undefined') payload.referenceAudio = data.referenceAudioId;
        if (typeof data.soundEffectId !== 'undefined') payload.soundEffect = data.soundEffectId;
        if (typeof data.diffusion !== 'undefined') payload.diffusion = data.diffusion;
        if (typeof data.length !== 'undefined') payload.length = data.length;
        if (typeof data.inference_rate !== 'undefined') payload.inference_rate = data.inference_rate;

        return this.http
            .put<any>(BACKEND_URL + id, payload, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    /** Delete */
    delete(id: string): Observable<any> {
        return this.http
            .delete<any>(BACKEND_URL + id, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    // Local helpers (optional)
    listLocal(): CloneActionModel[] {
        return this.items.slice();
    }
    findLocalById(id: string): CloneActionModel | undefined {
        return this.items.find(x => x.id === id);
    }

    // Error handling
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
