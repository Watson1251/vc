export interface RoleModel {
    id: string;                 // _id from MongoDB
    name: string;               // e.g., "admin", "viewer"
    adGroups: string[];         // optional AD sync
    isAdmin: boolean;           // admin marker
    permissionHashes: string[]; // ONLY SHA256 hashes
    createdAt?: string;
    updatedAt?: string;
}