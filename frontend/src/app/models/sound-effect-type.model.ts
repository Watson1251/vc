export interface SoundEffectTypeModel {
    id: string;               // _id from MongoDB
    soundEffectType: string;  // unique type name
    createdAt?: string;
    updatedAt?: string;
}