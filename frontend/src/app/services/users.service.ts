// src/app/services/users.service.ts
import { Injectable } from "@angular/core";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { Observable, Subject, throwError } from "rxjs";
import { catchError } from "rxjs/operators";

import { environment } from "../../environments/environment";
import { SnackbarService } from "./snackbar.service";
import { UserModel } from "../models/user.model";
import { RoleModel } from "../models/role.model";

const BACKEND_URL = environment.apiUrl + "/users/";

// Narrow type for what backend may return for devices/roles
type IdLike = string;
type MaybePopulatedRole = RoleModel | IdLike;

@Injectable({ providedIn: "root" })
export class UsersService {

    private users: UserModel[] = [];
    private usersUpdated = new Subject<UserModel[]>();

    constructor(
        private http: HttpClient,
        private snackbarService: SnackbarService
    ) { }

    /** Central mapping – tolerant to populated or plain ObjectIds */
    private mapUser(u: any): UserModel {
        const rolesArr: MaybePopulatedRole[] = Array.isArray(u?.roles) ? u.roles : [];
        const roleIds = Array.isArray(u?.roleIds) ? u.roleIds : rolesArr.map((r: any) => (typeof r === "string" ? r : r?._id)).filter(Boolean);
        const roles: RoleModel[] | undefined = rolesArr.length && typeof rolesArr[0] !== "string" ? rolesArr as RoleModel[] : undefined;

        return {
            id: u._id,
            username: u.username,
            name: u.name,
            roleIds,
            roles,
            createdAt: u.createdAt,
            updatedAt: u.updatedAt
        };
    }

    getUsers(): void {
        this.http.get<{ users: any[] }>(BACKEND_URL, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)))
            .subscribe(response => {
                if (response.status === 200 || response.status === 201) {
                    const fetchedUsers = response.body?.users || [];
                    this.users = fetchedUsers.map(u => this.mapUser(u));
                    this.usersUpdated.next(this.users);
                }
            });
    }

    getUser(id: string): Observable<any> {
        return this.http.get<any>(BACKEND_URL + id, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    /**
     * Create/update expect `devices` to be an array of ObjectId strings on the wire.
     * On the component side, pass `deviceIds` and we'll transform to `devices`.
     */
    createUser(data: Partial<UserModel>): Observable<any> {
        const payload = this.toWirePayload(data);
        return this.http.post<any>(BACKEND_URL, payload, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    updateUser(id: string, data: Partial<UserModel>): Observable<any> {
        const payload = this.toWirePayload(data);
        return this.http.put<any>(BACKEND_URL + id, payload, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    deleteUser(id: string): Observable<any> {
        return this.http.delete<any>(BACKEND_URL + id, { observe: 'response' })
            .pipe(catchError(this.handleError.bind(this)));
    }

    getUsersUpdateListener() {
        return this.usersUpdated.asObservable();
    }

    /** Convert our front model to backend wire shape */
    private toWirePayload(data: Partial<UserModel>) {
        const {
            id, // never send
            roles, roleIds,
            ...rest
        } = data;

        const out: any = { ...rest };

        if (Array.isArray(roleIds)) out.roleIds = roleIds;

        return out;
    }

    private handleError(error: HttpErrorResponse) {
        let message = '';
        if (error.error instanceof ErrorEvent) {
            message = error.error.message || 'حدث خطأ في العميل.';
        } else {
            message = error.error?.message || 'حدث خطأ في المزود.';
        }
        this.snackbarService.openSnackBar(message, 'failure');
        return throwError(() => message);
    }
}
