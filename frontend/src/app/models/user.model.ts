// src/app/models/user.model.ts
import { RoleModel } from "./role.model";

export interface UserModel {
    id: string;                    // _id from MongoDB, used in frontend
    username: string;              // usually email or login
    password?: string | null;      // null for LDAP users
    name: string;                  // full name

    roleIds: string[];             // role ObjectId strings
    roles?: RoleModel[];           // populated roles (optional)

    createdAt?: string;
    updatedAt?: string;
}
