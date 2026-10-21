import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '../components/AppHeader';
import { AppText } from '../components/AppText';
import { ChoiceChips } from '../components/FormControls';
import { GlassCard } from '../components/GlassCard';
import { HintLines, HintsCard } from '../components/HintsCard';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { useApp } from '../context/AppContext';
import { errorMessageKey } from '../domain/errors';
import { NO_FILTER, filterExercises, hasActiveFilter, type LibraryFilter } from '../domain/exerciseLibrary';
import type { Exercise } from '../domain/models';
import { EQUIPMENT, EXERCISE_CATEGORY, MUSCLE } from '../domain/schemas/enums';
import { useExerciseLibrary, useExerciseName } from '../hooks/useExerciseLibrary';
import { useRecommendations } from '../hooks/useRecommendations';
import { announce } from '../services/accessibility';
import { colors, radius } from '../theme';

export default function ExerciseLibraryScreen() {
  const { t } = useTranslation();
  const { isRTL } = useApp();
  const { state, reload, retryDatabase } = useExerciseLibrary();
  const nameOf = useExerciseName();
  const recs = useRecommendations();
  const [filter, setFilter] = useState<LibraryFilter>(NO_FILTER);
  const [showFilters, setShowFilters] = useState(false);

  const shown = useMemo(() => (state.status === 'ready' ? filterExercises(state.exercises, filter, nameOf) : []), [state, filter, nameOf]);
  const patch = (p: Partial<LibraryFilter>) => setFilter((f) => ({ ...f, ...p }));
  const active = hasActiveFilter(filter);

  // Status changes are spoken once through the screen reader; the same text is on screen.
  const previous = useRef<string | null>(null);
  const unavailableText = state.status === 'unavailable' ? `${t(errorMessageKey(state.error))} ${t('library.unavailable')}` : '';
  const failedText = state.status === 'failed' ? `${t('library.readFailed')} ${t(errorMessageKey(state.error))}` : '';
  useEffect(() => {
    const before = previous.current;
    if (before === state.status) return;
    previous.current = state.status;
    if (state.status === 'loading') announce(t('library.loading'));
    else if (state.status === 'unavailable') announce(unavailableText);
    else if (state.status === 'failed') announce(failedText);
    else if (before === 'loading') announce(t('library.loaded'));
  }, [state.status, unavailableText, failedText, t]);

  return (
    <Screen withNav={false} avoidKeyboard>
      <AppHeader title={t('library.title')} right={state.status === 'ready' ? { icon: 'add', label: t('library.add'), onPress: () => router.push('/exercises/form') } : undefined} />
      <AppText size={13} color={colors.onGradientMuted}>{t('library.subtitle')}</AppText>

      {state.status === 'loading' ? (
        <GlassCard strong style={styles.card}>
          <View style={styles.row}>
            <ActivityIndicator color={colors.dark} />
            <AppText size={13} color={colors.ink}>{t('library.loading')}</AppText>
          </View>
        </GlassCard>
      ) : null}

      {state.status === 'unavailable' || state.status === 'failed' ? (
        <GlassCard strong style={styles.card}>
          <View style={styles.row}>
            <Icon name="information-circle-outline" size={18} color={colors.danger} />
            <AppText size={13} color={colors.ink} style={styles.flex}>{state.status === 'unavailable' ? unavailableText : failedText}</AppText>
          </View>
          <Pressable accessibilityRole="button" onPress={state.status === 'unavailable' ? retryDatabase : () => void reload()} style={[styles.btn, styles.btnGhost]}>
            <AppText size={14} weight="medium" color={colors.dark} align="center">{t('library.reload')}</AppText>
          </Pressable>
        </GlassCard>
      ) : null}

      {state.status === 'ready' ? (
        <>
          <TextInput
            accessibilityLabel={t('library.searchLabel')}
            placeholder={t('library.searchPlaceholder')}
            placeholderTextColor={colors.muted}
            value={filter.query}
            onChangeText={(query) => patch({ query })}
            style={[styles.search, { textAlign: isRTL ? 'right' : 'left', writingDirection: isRTL ? 'rtl' : 'ltr' }]}
            returnKeyType="search"
          />
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showFilters }}
              onPress={() => setShowFilters((v) => !v)}
              style={[styles.btn, styles.btnGhost, styles.small]}
            >
              <AppText size={13} weight="medium" color={colors.dark} align="center">{t('library.filters')}</AppText>
            </Pressable>
            {active ? (
              <Pressable accessibilityRole="button" onPress={() => setFilter(NO_FILTER)} style={[styles.btn, styles.btnGhost, styles.small]}>
                <AppText size={13} weight="medium" color={colors.dark} align="center">{t('library.clearFilters')}</AppText>
              </Pressable>
            ) : null}
          </View>
          {showFilters ? (
            <GlassCard strong style={styles.card}>
              <ChoiceChips label={t('library.muscle')} options={MUSCLE} value={filter.muscle} onChange={(muscle) => patch({ muscle })} renderLabel={(m) => t(`library.muscles.${m}`)} noneLabel={t('library.all')} />
              <ChoiceChips label={t('library.equipment')} options={EQUIPMENT} value={filter.equipment} onChange={(equipment) => patch({ equipment })} renderLabel={(q) => t(`library.equipmentNames.${q}`)} noneLabel={t('library.all')} />
              <ChoiceChips label={t('library.category')} options={EXERCISE_CATEGORY} value={filter.category} onChange={(category) => patch({ category })} renderLabel={(c) => t(`library.categories.${c}`)} noneLabel={t('library.all')} />
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: filter.includeHidden }}
                onPress={() => patch({ includeHidden: !filter.includeHidden })}
                style={[styles.chip, filter.includeHidden && styles.chipActive]}
              >
                <AppText size={12} weight={filter.includeHidden ? 'semibold' : 'regular'} color={filter.includeHidden ? colors.white : colors.ink}>{t('library.showArchived')}</AppText>
              </Pressable>
            </GlassCard>
          ) : null}

          <HintsCard lines={recs.limits} />
          <AppText size={12} color={colors.onGradientMuted}>{t('library.count', { count: shown.length })}</AppText>

          {state.exercises.length === 0 ? (
            <GlassCard strong style={styles.card}>
              <AppText size={14} weight="medium" color={colors.ink}>{t('library.empty')}</AppText>
              <AppText size={12} color={colors.muted}>{t('library.emptyHint')}</AppText>
            </GlassCard>
          ) : shown.length === 0 ? (
            <GlassCard strong style={styles.card}>
              <AppText size={13} color={colors.ink}>{t('library.noResults')}</AppText>
            </GlassCard>
          ) : (
            <View style={styles.list}>
              {shown.map((e) => (
                <ExerciseRow key={e.id} exercise={e} name={nameOf(e)} hints={recs.notesOf(recs.assess(e))} />
              ))}
            </View>
          )}
        </>
      ) : null}
    </Screen>
  );
}

function ExerciseRow({ exercise, name, hints }: { exercise: Exercise; name: string; hints: string[] }) {
  const { t } = useTranslation();
  const detail = `${t(`library.muscles.${exercise.primaryMuscle}`)} · ${t(`library.equipmentNames.${exercise.equipment}`)}`;
  const flags = [exercise.source === 'user' ? t('library.custom') : null, exercise.isArchived ? t('library.hidden') : null].filter(Boolean) as string[];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[name, detail, ...flags, ...hints].join(', ')}
      onPress={() => router.push({ pathname: '/exercises/[id]', params: { id: String(exercise.id) } })}
      style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}
    >
      <View style={styles.flex}>
        <AppText size={15} weight="medium" color={colors.ink} numberOfLines={2}>{name}</AppText>
        <AppText size={12} color={colors.muted}>{detail}</AppText>
        <HintLines lines={hints} />
      </View>
      {flags.map((f) => (
        <View key={f} style={styles.badge}>
          <AppText size={10} weight="medium" color={colors.dark}>{f}</AppText>
        </View>
      ))}
      <Icon name="chevron-forward" size={18} color={colors.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  card: { padding: 14, gap: 12 },
  list: { gap: 8 },
  listRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.62)' },
  pressed: { backgroundColor: 'rgba(255,255,255,0.8)' },
  search: { minHeight: 48, borderRadius: radius.pill, paddingHorizontal: 18, backgroundColor: 'rgba(255,255,255,0.9)', color: colors.ink, fontSize: 15 },
  btn: { minHeight: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  btnGhost: { backgroundColor: 'rgba(255,255,255,0.8)' },
  small: { minHeight: 44, paddingHorizontal: 16 },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.8)', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  chipActive: { backgroundColor: colors.dark },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
});
