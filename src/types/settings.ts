export type Language = 'en' | 'ar';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';
export type CautionArea = 'neck' | 'shoulders' | 'lowerBack' | 'knees' | 'wrists' | 'ankles';

export interface ReminderSettings {
  enabled: boolean;
  hour: number;
  minute: number;
  /** JS weekday numbers, 0 = Sunday … 6 = Saturday */
  days: number[];
}

export interface AppSettings {
  language: Language;
  soundEnabled: boolean;
  experience: ExperienceLevel;
  cautionAreas: CautionArea[];
  reminders: ReminderSettings;
}
