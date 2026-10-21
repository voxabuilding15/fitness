import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from './AppText';
import { Avatar } from './Avatar';
import { GlassCard } from './GlassCard';
import { useApp } from '../context/AppContext';
import { colors, radius } from '../theme';
import type { Profile, ProfileDraft, ProfileErrors } from '../types/profile';

interface Props {
  profile: Profile;
  editing: boolean;
  draft: ProfileDraft;
  errors: ProfileErrors;
  onChange: (patch: Partial<ProfileDraft>) => void;
}

function Field({
  label, value, onChangeText, error, keyboardType, unit, align,
}: {
  label: string; value: string; onChangeText: (v: string) => void; error?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad'; unit?: string; align?: 'center' | 'auto';
}) {
  const { isRTL } = useApp();
  return (
    <View style={styles.fieldWrap}>
      <AppText size={11} color={colors.muted}>{label}{unit ? ` (${unit})` : ''}</AppText>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        style={[
          styles.input,
          error ? styles.inputError : null,
          { textAlign: align === 'center' ? 'center' : isRTL ? 'right' : 'left', writingDirection: isRTL ? 'rtl' : 'ltr' },
        ]}
        placeholderTextColor={colors.muted}
      />
      {error ? <AppText size={11} color={colors.danger}>{error}</AppText> : null}
    </View>
  );
}

/** Avatar + name/location and the Age / Height / Weight tiles; switches to inputs while editing. */
export function ProfileSummaryCard({ profile, editing, draft, errors, onChange }: Props) {
  const { t } = useTranslation();
  const err = (k: keyof ProfileDraft) => (errors[k] ? t(errors[k]!) : undefined);

  const stats = [
    { key: 'age' as const, label: t('profile.age'), value: String(profile.age), unit: t('common.years') },
    { key: 'height' as const, label: t('profile.height'), value: String(profile.heightCm), unit: t('common.cm') },
    { key: 'weight' as const, label: t('profile.weight'), value: String(profile.weightKg), unit: t('common.kg') },
  ];

  return (
    <GlassCard style={styles.card} strong>
      <View style={styles.top}>
        <Avatar name={editing ? draft.name || profile.name : profile.name} size={64} />
        <View style={styles.names}>
          {editing ? (
            <>
              <Field label={t('profile.name')} value={draft.name} onChangeText={(v) => onChange({ name: v })} error={err('name')} />
              <Field label={t('profile.location')} value={draft.location} onChangeText={(v) => onChange({ location: v })} error={err('location')} />
            </>
          ) : (
            <>
              <AppText size={19} weight="medium" color={colors.ink} numberOfLines={1}>{profile.name}</AppText>
              <AppText size={13} color={colors.muted} numberOfLines={2}>{profile.location}</AppText>
            </>
          )}
        </View>
      </View>
      <View style={styles.stats}>
        {stats.map((s) => (
          <View key={s.key} style={styles.stat}>
            {editing ? (
              <Field
                label={s.label}
                unit={s.unit}
                value={draft[s.key]}
                onChangeText={(v) => onChange({ [s.key]: v })}
                keyboardType={s.key === 'weight' ? 'decimal-pad' : 'numeric'}
                error={err(s.key)}
                align="center"
              />
            ) : (
              <>
                <AppText size={12} color={colors.muted} align="center">{s.label}</AppText>
                <AppText size={20} weight="semibold" color={colors.ink} align="center">
                  {s.value} <AppText size={11} color={colors.ink}>{s.unit}</AppText>
                </AppText>
              </>
            )}
          </View>
        ))}
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 14 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  names: { flex: 1, gap: 6 },
  stats: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  stat: {
    flex: 1, minHeight: 68, borderRadius: radius.md, padding: 8,
    backgroundColor: 'rgba(255,255,255,0.5)', borderWidth: 1, borderColor: colors.glassBorder,
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  fieldWrap: { gap: 3, width: '100%' },
  input: {
    height: 40, borderRadius: 12, paddingHorizontal: 10, backgroundColor: colors.white,
    borderWidth: 1, borderColor: 'rgba(11,59,58,0.25)', color: colors.ink, fontSize: 14,
  },
  inputError: { borderColor: colors.danger },
});
