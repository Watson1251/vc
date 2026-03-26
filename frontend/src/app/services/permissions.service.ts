// src/app/security/permission.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { PERMISSION_HASHES, PermissionKey } from './../security/permission-hashes';

@Injectable({ providedIn: 'root' })
export class PermissionService {
    private set = new Set<string>();
    private admin = false;

    private _changes = new BehaviorSubject<void>(undefined);
    readonly changes$ = this._changes.asObservable();

    setFromProfile(permissionHashes: string[], isAdmin: boolean) {
        this.set = new Set(permissionHashes || []);
        this.admin = !!isAdmin;
        this._changes.next();                      // 👈 notify
    }

    clear() { this.set.clear(); this.admin = false; this._changes.next(); }

    has(hash: string) { return this.admin || this.set.has(hash); }
    hasAll(hashes: string[]) { return this.admin || hashes.every(h => this.set.has(h)); }
    hasAny(hashes: string[]) { return this.admin || hashes.some(h => this.set.has(h)); }
    get isAdmin() { return this.admin; }

    hasKey(key: PermissionKey) {
        const hash = PERMISSION_HASHES[key];
        return !!hash && this.has(hash);
    }
}
