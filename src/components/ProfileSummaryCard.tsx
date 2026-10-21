import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from './AppText';
import { Avatar } from './Avatar';
import { GlassCard } from './GlassCard';
import { useApp } from '../context/AppContext';
import type { SavedHint } from '../domain/goalsDraft';
import type { DatedValue, ProfileForm, ProfileFormField, ProfileIssues, ProfileView } from '../domain/profileDraft';
import { colors, radius } from '../theme';

interface Props {
  view: ProfileView;
  editing: boolean;
  form: ProfileForm;
  errors: ProfileIssues;
  /** Stored age / weight that were left out of the form because they are old or undated. */
  hints: { age: SavedHint | null; weight: SavedHint | null };
  onChange: (patch: Partial<ProfileForm>) => void;
}

function Field({
  label, value, onChangeText, error, keyboardType, unit, align, hint,
}: {
  label: string; value: string; onChangeText: (v: string) => void; error?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad'; unit?: string; align?: 'center' | 'auto'; hint?: string;
}) {
  const { isRTL } = useApp();
  return (
    <View style={styles.fieldWrap}>
      <AppText size={11} color={colors.muted}>{label}{unit ? ` (${unit})` : ''}</AppText>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
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

const DASH = '—';

/** Avatar + name/location and the Age / Height / Weight tiles; switches to inputs while editing. Shows only what is stored: a missing value is a dash, never a made-up one. */
export function ProfileSummaryCard({ view, editing, form, errors, hints, onChange }: Props) {
  const { t } = useTranslation();
  const err = (k: ProfileFormField) => (errors[k] ? t(errors[k]!) : undefined);
  const hintText = (field: 'age' | 'weight', h: SavedHint | null) => (h ? t(`goals.hints.${field}.${h.reason}`, { value: h.value, date: h.on ?? '' }) : undefined);
  /** One line under a tile when the value is not known to be current. */
  const noteFor = (field: 'age' | 'weight', v: DatedValue | null) =>
    v && v.staleness !== 'fresh' ? t(`profile.notes.${field}.${v.staleness}`, { date: v.on ?? '' }) : null;

  const stats = [
    { key: 'age' as const, label: t('profile.age'), value: view.age ? String(view.age.value) : DASH, unit: t('common.years'), note: noteFor('age', view.age) },
    { key: 'height' as const, label: t('profile.height'), value: view.heightCm !== null ? String(view.heightCm) : DASH, unit: t('common.cm'), note: null },
    { key: 'weight' as const, label: t('profile.weight'), value: view.weight ? String(view.weight.value) : DASH, unit: t('common.kg'), note: noteFor('weight', view.weight) },
  ];
  const shownName = editing ? form.name : view.name ?? '';

  return (
    <GlassCard style={styles.card} strong>
      <View style={styles.top}>
        <Avatar name={shownName} size={64} />
        <View style={styles.names}>
          {editing ? (
            <>
              <Field label={t('profile.name')} value={form.name} onChangeText={(v) => onChange({ name: v })} error={err('name')} />
              <Field label={t('profile.location')} value={form.location} onChangeText={(v) => onChange({ location: v })} error={err('location')} />
            </>
          ) : view.hasProfile ? (
            <>
              <AppText size={19} weight="medium" color={colors.ink} numberOfLines={1}>{view.name}</AppText>
              {view.location ? <AppText size={13} color={colors.muted} numberOfLines={2}>{view.location}</AppText> : null}
            </>
          ) : (
            <>
              <AppText size={17} weight="medium" color={colors.ink}>{t('profile.empty')}</AppText>
              <AppText size={12} color={colors.muted}>{t('profile.emptyHint')}</AppText>
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
                value={form[s.key]}
                onChangeText={(v) => onChange({ [s.key]: v })}
                keyboardType={s.key === 'age' ? 'numeric' : 'decimal-pad'}
                error={err(s.key)}
                hint={s.key === 'age' ? hintText('age', hints.age) : s.key === 'weight' ? hintText('weight', hints.weight) : undefined}
                align="center"
              />
            ) : (
              <>
                <AppText size={12} color={colors.muted} align="center">{s.label}</AppText>
                <AppText size={20} weight="semibold" color={colors.ink} align="center">
                  {s.value} {s.value !== DASH ? <AppText size={11} color={colors.ink}>{s.unit}</AppText> : null}
                </AppText>
              </>
            )}
          </View>
        ))}
      </View>
      {editing ? (
        <>
          {hints.age ? <AppText size={11} color={colors.ink}>{hintText('age', hints.age)}</AppText> : null}
          {hints.weight ? <AppText size={11} color={colors.ink}>{hintText('weight', hints.weight)}</AppText> : null}
        </>
      ) : (
        stats.filter((s) => s.note).map((s) => (
          <AppText key={s.key} size={11} color={colors.ink}>{`${s.label}: ${s.note}`}</AppText>
        ))
      )}
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
    minHeight: 44, borderRadius: 12, paddingHorizontal: 10, backgroundColor: colors.white,
    borderWidth: 1, borderColor: 'rgba(11,59,58,0.25)', color: colors.ink, fontSize: 14,
  },
  inputError: { borderColor: colors.danger },
});
