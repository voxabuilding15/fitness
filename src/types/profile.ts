export interface Profile {
  name: string;
  location: string;
  age: number;
  heightCm: number;
  weightKg: number;
}

export interface ProfileDraft {
  name: string;
  location: string;
  age: string;
  height: string;
  weight: string;
}

export type ProfileErrorKey =
  | 'validation.nameRequired'
  | 'validation.nameTooLong'
  | 'validation.locationTooLong'
  | 'validation.ageRange'
  | 'validation.heightRange'
  | 'validation.weightRange';

export type ProfileErrors = Partial<Record<keyof ProfileDraft, ProfileErrorKey>>;
