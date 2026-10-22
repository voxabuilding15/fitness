import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from './AppText';
import { TextField } from './FormControls';
import { GlassCard } from './GlassCard';
import { HintLines } from './HintsCard';
import type { SessionSet } from '../domain/models';
import type { TrackingType } from '../domain/schemas/enums';
import { listedSets } from '../domain/lastPerformance';
import { fieldsFor, type SetDraft, type SetField, type SetIssues } from '../domain/setEntry';
import { colors, radius } from '../theme';

type T = (key: string, o?: Record<string, string | number>) => string;
const num = (n: number) => String(Math.round(n * 1000) / 1000);

/** One logged set in words, e.g. "82.5 kg × 8". */
export function setSummary(t: T, tracking: TrackingType, s: SessionSet): string {
  const secs = s.durationSec ?? 0;
  if (tracking === 'weight_reps') return t('liveSession.sumWeightReps', { weight: num(s.weightKg ?? 0), reps: s.reps ?? 0 });
  if (tracking === 'reps_only') return t('liveSession.sumReps', { reps: s.reps ?? 0 });
  if (tracking === 'duration') return t('liveSession.sumDuration', { seconds: secs });
  return t('liveSession.sumDistance', { km: num((s.distanceM ?? 0) / 1000), minutes: num(secs / 60) });
}

const FIELD_LABEL: Record<SetField, string> = {
  weight: 'liveSession.weightKg', reps: 'liveSession.reps', durationSec: 'liveSession.durationSec', distanceKm: 'liveSession.distanceKm', durationMin: 'liveSession.durationMin',
};
export const fieldLabelKey = (f: SetField) => FIELD_LABEL[f];

interface Props {
  position: number;
  name: string;
  tracking: TrackingType;
  /** The targets recorded when the session started, in words; null when none were recorded. */
  planned: string | null;
  /** Short hints from the Profile settings (caution areas), shown under the name. */
  hints?: string[];
  sets: SessionSet[];
  /** What was logged for this exercise in the most recent completed workout; absent when it was never done (or while the workout has ended). */
  last?: { date: string; sets: SessionSet[]; canUse: boolean; onUse: () => void };
  /** null = this card is read-only (the workout has ended). */
  entry: null | {
    draft: SetDraft; issues: SetIssues; saving: boolean; onChange: (field: SetField, value: string) => void; onLog: () => void;
    confirmRemoveId: number | null; onAskRemove: (id: number | null) => void; onRemove: (id: number) => void;
    restSec: number | null; onStartRest: () => void;
  };
}

export function SessionExerciseCard({ position, name, tracking, planned, hints = [], sets, last, entry }: Props) {
  const { t } = useTranslation();
  const logged = sets.filter((s) => s.isCompleted);
  return (
    <GlassCard strong style={styles.card}>
      <View role="group" accessibilityLabel={`${position}. ${name}`} style={styles.body}>
        <AppText size={16} weight="semibold" color={colors.ink} accessibilityRole="header">{`${position}. ${name}`}</AppText>
        {planned ? <AppText size={12} color={colors.muted}>{t('liveSession.planned', { summary: planned })}</AppText> : null}
        <HintLines lines={hints} />
        {last && last.sets.length > 0 ? (
          <View role="group" accessibilityLabel={t('liveSession.lastTime', { date: last.date })} style={styles.last}>
            <AppText size={12} weight="medium" color={colors.ink}>{t('liveSession.lastTime', { date: last.date })}</AppText>
            {(() => {
              const { shown, more } = listedSets(last.sets);
              return (
                <AppText size={12} color={colors.muted}>
                  {shown.map((s) => setSummary(t, tracking, s)).join(' · ')}{more > 0 ? ` · ${t('liveSession.lastMore', { count: more })}` : ''}
                </AppText>
              );
            })()}
            {last.canUse ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`${t('liveSession.lastUse')}: ${name}`} onPress={last.onUse} style={[styles.small, styles.useLast]}>
                <AppText size={12} weight="medium" color={colors.dark}>{t('liveSession.lastUse')}</AppText>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {logged.length === 0 ? <AppText size={12} color={colors.muted}>{t('liveSession.noSets')}</AppText> : null}
        {logged.map((s) => (
          <View key={s.id} style={styles.setRow}>
            <AppText size={14} color={colors.ink} style={styles.flex}>{`${t('liveSession.setNumber', { n: s.setNumber })}: ${setSummary(t, tracking, s)}`}</AppText>
            {entry && entry.confirmRemoveId !== s.id ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`${t('liveSession.removeSet')}: ${name}, ${t('liveSession.setNumber', { n: s.setNumber })}`} onPress={() => entry.onAskRemove(s.id)} style={styles.small}>
                <AppText size={12} weight="medium" color={colors.danger}>{t('liveSession.removeSet')}</AppText>
              </Pressable>
            ) : null}
            {entry && entry.confirmRemoveId === s.id ? (
              <View style={styles.confirm}>
                <AppText size={12} color={colors.ink}>{t('liveSession.removeSetConfirm', { n: s.setNumber })}</AppText>
                <Pressable accessibilityRole="button" disabled={entry.saving} onPress={() => entry.onRemove(s.id)} style={[styles.small, styles.danger]}>
                  <AppText size={12} weight="medium" color={colors.white}>{t('liveSession.removeSetYes')}</AppText>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => entry.onAskRemove(null)} style={styles.small}>
                  <AppText size={12} weight="medium" color={colors.dark}>{t('liveSession.keepGoing')}</AppText>
                </Pressable>
              </View>
            ) : null}
          </View>
        ))}

        {entry ? (
          <>
            <View style={styles.fields}>
              {fieldsFor(tracking).map((f) => (
                <View key={f} style={styles.field}>
                  <TextField
                    label={t(FIELD_LABEL[f])}
                    a11yLabel={`${t(FIELD_LABEL[f])}, ${name}`}
                    value={entry.draft[f]}
                    onChange={(v) => entry.onChange(f, v)}
                    error={entry.issues[f]}
                    keyboardType={f === 'reps' || f === 'durationSec' ? 'number-pad' : 'decimal-pad'}
                    maxLength={8}
                  />
                </View>
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t('liveSession.logSet')}: ${name}, ${t('liveSession.setNumber', { n: logged.length + 1 })}`}
              accessibilityState={{ disabled: entry.saving, busy: entry.saving }}
              disabled={entry.saving}
              onPress={entry.onLog}
              style={[styles.btn, styles.primary, entry.saving && styles.dim]}
            >
              <AppText size={14} weight="medium" color={colors.white} align="center">{t(entry.saving ? 'liveSession.savingSet' : 'liveSession.logSet')}</AppText>
            </Pressable>
            {entry.restSec ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`${t('liveSession.restStart', { seconds: entry.restSec })}, ${name}`} onPress={entry.onStartRest} style={[styles.btn, styles.ghost]}>
                <AppText size={14} weight="medium" color={colors.dark} align="center">{t('liveSession.restStart', { seconds: entry.restSec })}</AppText>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { padding: 16 },
  body: { gap: 10 },
  last: { gap: 4, alignItems: 'flex-start' },
  useLast: { alignSelf: 'flex-start', borderWidth: 1, borderColor: 'rgba(0,0,0,0.12)' },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  confirm: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  fields: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  field: { flex: 1, minWidth: 130 },
  small: { minHeight: 44, minWidth: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.8)' },
  danger: { backgroundColor: colors.danger },
  btn: { minHeight: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  primary: { backgroundColor: colors.dark },
  ghost: { backgroundColor: 'rgba(255,255,255,0.8)' },
  dim: { opacity: 0.5 },
});
