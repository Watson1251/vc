import { FileModel } from './upload-file.model';
import { TargetModel } from './target.model';
import { SoundEffectModel } from './sound-effect.model';

export type CloneStatus =
    | 'NOT_SCHEDULED'
    | 'SCHEDULED'
    | 'RUNNING'
    | 'DONE'
    | 'FAILED'
    | 'CANCELLED';

export interface CloneActionModel {
    id: string;

    scenario?: string;

    // content & reference
    contentAudioId: string;
    contentAudio?: FileModel;

    referenceAudioId: string;
    referenceAudio?: FileModel;

    // target (lightweight)
    targetId: string;
    target?: Pick<TargetModel, 'id' | 'name' | 'description' | 'status' | 'modelPath' | 'configPath'>;

    // resolved from target on backend
    modelPath?: string;
    configPath?: string;

    // sound effect
    soundEffectId?: string;
    soundEffect?: SoundEffectModel;

    diffusion: number;
    length: number;
    inference_rate: number;

    // ✅ NEW: status lifecycle (mirrors backend)
    status?: CloneStatus;

    // ✅ cloned result: can be a FileUpload id (string) or populated FileModel
    outputPath?: string | FileModel;
    errorMsg?: string;

    owner?: string;
    createdAt?: string;
    updatedAt?: string;
}
