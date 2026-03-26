// src/app/models/sound-effect.model.ts
import { SoundEffectTypeModel } from './sound-effect-type.model';
import { FileModel } from './upload-file.model';

export interface SoundEffectModel {
    id: string;
    name: string;

    // Always a plain ObjectId string
    fileId: string;

    // Present only when backend populates fileId
    file?: FileModel;

    soundEffectTypeId: string;
    soundEffectType?: Pick<SoundEffectTypeModel, 'id' | 'soundEffectType'>;

    // ⬇️ optional crop points (seconds)
    start?: number | null;
    end?: number | null;

    createdAt?: string;
    updatedAt?: string;
}
