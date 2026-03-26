import { Injectable } from "@angular/core";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { forkJoin, Observable, Subject, throwError } from "rxjs";
import { catchError, map } from "rxjs/operators";

import { environment } from "../../environments/environment";
import { SnackbarService } from "./snackbar.service";
import { RoleModel } from "../models/role.model";
import { PermissionCatalogService } from "./permission-catalog.service";

const BACKEND_URL = environment.apiUrl + "/roles/";

@Injectable({ providedIn: "root" })
export class RolesService {

    private roles: RoleModel[] = [];
    private rolesUpdated = new Subject<RoleModel[]>();

    constructor(
        private http: HttpClient,
        private snackbarService: SnackbarService,
        private permissionsSvc: PermissionCatalogService
    ) { }

    /** Load all roles and emit to subscribers */
    getRoles(): void {
        this.http.get<{ roles: any[] }>(BACKEND_URL, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)))
            .subscribe(response => {
                if (response.status === 200 || response.status === 201) {
                    const fetched = response.body?.roles || [];
                    this.roles = fetched.map((r: any): RoleModel => ({
                        id: r._id,
                        name: r.name,
                        adGroups: r.adGroups || [],
                        isAdmin: !!r.isAdmin,
                        permissionHashes: r.permissionHashes || [],
                        createdAt: r.createdAt,
                        updatedAt: r.updatedAt
                    }));
                    this.rolesUpdated.next(this.roles);
                }
            });
    }

    /** Stream of the roles array */
    getRolesUpdateListener() {
        return this.rolesUpdated.asObservable();
    }

    /** Get a single role by id (raw HTTP response) */
    getRole(id: string): Observable<any> {
        return this.http.get<any>(BACKEND_URL + id, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    /** Create a role */
    createRole(data: Partial<RoleModel>): Observable<any> {
        // Backend expects { name, adGroups?, isAdmin?, permissionHashes? }
        const payload: any = {
            name: data.name,
            adGroups: data.adGroups ?? [],
            isAdmin: data.isAdmin ?? false,
            permissionHashes: data.permissionHashes ?? []
        };
        return this.http.post<any>(BACKEND_URL, payload, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    /** Update a role */
    updateRole(id: string, data: Partial<RoleModel>): Observable<any> {
        // Note: If isAdmin is set true, backend will override permissionHashes to ALL.
        const payload: any = {};
        if (typeof data.name !== 'undefined') payload.name = data.name;
        if (typeof data.isAdmin !== 'undefined') payload.isAdmin = data.isAdmin;
        if (typeof data.adGroups !== 'undefined') payload.adGroups = data.adGroups;
        if (typeof data.permissionHashes !== 'undefined') payload.permissionHashes = data.permissionHashes;

        return this.http.put<any>(BACKEND_URL + id, payload, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    /** Delete a role */
    deleteRole(id: string): Observable<any> {
        return this.http.delete<any>(BACKEND_URL + id, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
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
