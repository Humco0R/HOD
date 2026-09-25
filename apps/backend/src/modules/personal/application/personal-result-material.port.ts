import type { PersonalActionResultMaterial } from './personal-action-result-session.port';

export interface PersonalResultMaterialPort {
  save(input: {
    actionId: string;
    userId: string;
    kind: 'PHOTO' | 'FILE';
    attachment: Record<string, unknown>;
  }): Promise<PersonalActionResultMaterial>;
  remove(input: { actionId: string; userId: string; materialId: string }): Promise<void>;
}
