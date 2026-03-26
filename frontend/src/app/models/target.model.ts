import { FileModel } from './upload-file.model';

export type TargetStatus = 'NOT_SCHEDULED' | 'SCHEDULED' | 'STARTED_TRAINING' | 'DONE' | 'FAILED'; // ⬅️ NEW

export interface TargetModel {
    id: string;
    name: string;
    description?: string;

    // Always plain ObjectId strings (even if backend populates)
    referenceAudioIds: string[];
    trainingAudioIds: string[];

    // Present only when backend populates arrays
    referenceAudio?: FileModel[];
    trainingAudio?: FileModel[];

    // NEW: backend is status-only now + model path
    status: TargetStatus;
    modelPath?: string; // default "", if not provided
    configPath?: string; // default "", if not provided

    owner?: string;     // backend returns username now
    createdAt?: string;
    updatedAt?: string;
}
