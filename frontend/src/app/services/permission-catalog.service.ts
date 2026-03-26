// src/app/services/permission-catalog.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { map, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { PermissionModel } from '../models/permission.model';

const BASE = environment.apiUrl + '/permissions';

@Injectable({ providedIn: 'root' })
export class PermissionCatalogService {
    private subject = new BehaviorSubject<PermissionModel[]>([]);
    private cache$?: Observable<PermissionModel[]>;

    constructor(private http: HttpClient) { }

    load(): Observable<PermissionModel[]> {
        if (!this.cache$) {
            this.cache$ = this.http.get<{ permissions: PermissionModel[] }>(`${BASE}`).pipe(
                map(r => r.permissions ?? []),
                tap(list => this.subject.next(list)),
                shareReplay(1),
            );
        }
        return this.cache$;
    }

    refresh(): Observable<PermissionModel[]> {
        this.cache$ = undefined;
        return this.load();
    }

    /** Optional: server-side resolution if you only have hashes */
    resolve(hashes: string[]): Observable<PermissionModel[]> {
        return this.http.post<{ resolved: PermissionModel[] }>(`${BASE}/resolve`, { hashes })
            .pipe(map(r => r.resolved ?? []));
    }

    /** Quick lookups for chips/tooltips */
    mapByHash(): Map<string, PermissionModel> {
        const m = new Map<string, PermissionModel>();
        for (const p of this.subject.value) m.set(p.hash, p);
        return m;
    }
}
