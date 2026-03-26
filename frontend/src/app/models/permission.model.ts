export interface PermissionModel {
    key: string;    // e.g. "USERS_READ"
    label: string;  // e.g. "Read Users"
    value: string;  // e.g. "users:read"
    hash: string;   // sha256(key)
}
