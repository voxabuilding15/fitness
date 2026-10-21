import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppHeader, goBack } from '../components/AppHeader';
import { AppText } from '../components/AppText';
import { ChoiceChips, TextField } from '../components/FormControls';
import { GlassCard } from '../components/GlassCard';
import { HintLines, HintsCard } from '../components/HintsCard';
import { Screen } from '../components/Screen';
import { useApp } from '../context/AppContext';
import { useDatabase } from '../context/DatabaseContext';
import { errorMessageKey } from '../domain/errors';
import { NO_FILTER, filterExercises, hasActiveFilter, type LibraryFilter } from '../domain/exerciseLibrary';
import { EQUIPMENT, MUSCLE } from '../domain/schemas/enums';
import type { Exercise } from '../domain/models';
import {
  MAX_TEMPLATE_EXERCISES, addExercise, countOf, draftFromTemplate, emptyTemplateDraft, isDirty, itemIssueKey, moveItem, moveItemTo, orderedIssueKeys, planTemplateSave,
  removeItem, updateItem, type DraftItem, type ItemField, type TemplateDraft, type TemplateIssues,
} from '../domain/templateBuilder';
import { useExerciseName } from '../hooks/useExerciseLibrary';
import { useRecommendations } from '../hooks/useRecommendations';
import { useTemplates } from '../hooks/useTemplates';
import { announce } from '../services/accessibility';
import { colors, radius } from '../theme';

/** Create a workout, or edit one (`?id=`). Nothing is written until Save, and Save needs a successful read of what exists. */
export default function TemplateFormScreen() {
  const { t } = useTranslation();
  const { isRTL } = useApp();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editId = id === undefined ? null : /^\d+$/.test(String(id)) ? Number(id) : NaN;
  const { state: db } = useDatabase();
  const { state, retry, retryDatabase } = useTemplates();
  const nameOf = useExerciseName();
  const recs = useRecommendations();
  const [edited, setEdited] = useState<TemplateDraft | null>(null);
  // after the first Save attempt, problems are re-checked on every change, so they disappear as soon as they are fixed
  const [submitted, setSubmitted] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [filter, setFilter] = useState<LibraryFilter>(NO_FILTER);
  const [showFilters, setShowFilters] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const existing = state.status === 'ready' && editId !== null ? state.templates.find((x) => x.id === editId) ?? null : null;
  const initial = useMemo<TemplateDraft>(() => (existing ? draftFromTemplate(existing) : emptyTemplateDraft()), [existing]);
  const draft = edited ?? initial;

  const missing = editId !== null && (Number.isNaN(editId) || (state.status === 'ready' && !existing));
  const status = missing ? 'missing' : state.status;
  const title = t(editId === null ? 'templates.newTitle' : 'templates.editTitle');

  if (status !== 'ready' || state.status !== 'ready') {
    const text = status === 'missing' ? t('templates.notFound') : status === 'unavailable' ? t('templates.unavailable') : status === 'failed' && state.status === 'failed' ? `${t('templates.readFailed')} ${t(errorMessageKey(state.error))}` : t('templates.loading');
    return (
      <Screen withNav={false}>
        <AppHeader title={title} />
        <GlassCard strong style={styles.card}>
          <View style={styles.row}>
            {status === 'loading' ? <ActivityIndicator color={colors.dark} /> : null}
            <AppText size={13} color={colors.ink}>{text}</AppText>
          </View>
          {status === 'unavailable' || status === 'failed' ? (
            <Pressable accessibilityRole="button" onPress={status === 'unavailable' ? retryDatabase : retry} style={[styles.btn, styles.btnGhost]}>
              <AppText size={14} weight="medium" color={colors.dark} align="center">{t('templates.reload')}</AppText>
            </Pressable>
          ) : null}
        </GlassCard>
      </Screen>
    );
  }

  const byId = new Map(state.exercises.map((e) => [e.id, e]));
  const nameFor = (item: DraftItem) => {
    const ex = byId.get(item.exerciseId);
    return ex ? nameOf(ex) : '';
  };
  const change = (next: TemplateDraft) => {
    setEdited(next);
    setSaveError(null);
  };

  const dirty = isDirty(draft, initial);
  // the problems with the draft as it is NOW (only after a Save attempt, so a fresh form isn't covered in errors)
  const check = submitted ? planTemplateSave(draft, state.templates, existing?.id) : null;
  const issues: TemplateIssues = check && !check.ok && check.error.kind === 'validation' ? check.error.issues : {};
  const fieldLabel: Record<ItemField, string> = { sets: t('templates.sets'), restSec: t('templates.rest'), repsMin: t('templates.repsMin'), repsMax: t('templates.repsMax'), durationSec: t('templates.duration') };
  const problems = orderedIssueKeys(draft, issues).map((k) => {
    if (k === 'name') return { key: k, where: t('templates.name'), what: t(issues[k]) };
    if (k === 'notes') return { key: k, where: t('templates.notes'), what: t(issues[k]) };
    if (k === 'exercises') return { key: k, where: t('templates.exercises'), what: t(issues[k]) };
    const [rowKey, field] = k.split('.');
    const row = draft.items.find((i) => i.key === Number(rowKey));
    return { key: k, where: `${row ? nameFor(row) : ''}, ${fieldLabel[field as ItemField]}`, what: t(issues[k]) };
  });

  // exercises that touch a caution area come last, and for a beginner the easy-to-start ones first; otherwise the order is unchanged
  const pickable = filterExercises(state.exercises, filter, nameOf)
    .map((e) => ({ e, a: recs.assess(e) }))
    .sort((x, y) => recs.compareForPicker(x.a, y.a));
  const add = (ex: Exercise) => {
    if (draft.items.length >= MAX_TEMPLATE_EXERCISES) return announce(t('templates.pickerLimit'));
    change(addExercise(draft, ex));
    announce(t('templates.added', { name: nameOf(ex) }));
  };
  const remove = (item: DraftItem) => {
    change(removeItem(draft, item.key));
    announce(t('templates.removed', { name: nameFor(item) }));
  };
  const moveEnd = (item: DraftItem, where: 'top' | 'bottom') => {
    const next = moveItemTo(draft, item.key, where);
    if (next === draft) return;
    change(next);
    announce(t('templates.moved', { name: nameFor(item), position: next.items.findIndex((i) => i.key === item.key) + 1, total: next.items.length }));
  };
  const move = (item: DraftItem, delta: -1 | 1) => {
    const next = moveItem(draft, item.key, delta);
    if (next === draft) return;
    change(next);
    announce(t('templates.moved', { name: nameFor(item), position: next.items.findIndex((i) => i.key === item.key) + 1, total: next.items.length }));
  };

  const save = async () => {
    const repos = db.status === 'ready' ? db.repos : null;
    if (!repos || saving) return;
    setSubmitted(true);
    const plan = planTemplateSave(draft, state.templates, existing?.id);
    if (!plan.ok) {
      const found = plan.error.kind === 'validation' ? plan.error.issues : {};
      const where = orderedIssueKeys(draft, found).map((k) => {
        if (k === 'name') return t('templates.fieldName');
        if (k === 'exercises') return t('templates.fieldExercises');
        const row = draft.items.find((i) => i.key === Number(k.split('.')[0]));
        return row ? nameFor(row) : k;
      });
      announce(where.length ? t('templates.needsAttention', { fields: [...new Set(where)].join(', ') }) : t(errorMessageKey(plan.error)));
      return;
    }
    setSaving(true);
    const r = existing ? await repos.templates.update(existing.id, plan.value) : await repos.templates.create(plan.value);
    setSaving(false);
    if (r.ok) {
      announce(t(existing ? 'templates.saved' : 'templates.created'));
      goBack();
    } else {
      const text = t(errorMessageKey(r.error));
      setSaveError(text);
      announce(text);
    }
  };

  const number = (item: DraftItem, field: ItemField, label: string) => (
    <View style={styles.half} key={field}>
      <TextField
        label={label}
        a11yLabel={`${label}, ${nameFor(item)}`}
        value={item[field]}
        onChange={(v) => change(updateItem(draft, item.key, { [field]: v }))}
        error={issues[itemIssueKey(item.key, field)]}
        keyboardType="number-pad"
        maxLength={5}
      />
    </View>
  );

  return (
    <Screen withNav={false} avoidKeyboard>
      <AppHeader title={title} />
      {problems.length > 0 ? (
        <GlassCard strong style={styles.card}>
          <View role="group" accessibilityLabel={t('templates.fixTitle')} style={styles.rowCard}>
            <AppText size={14} weight="semibold" color={colors.danger} accessibilityRole="header">{t('templates.fixTitle')}</AppText>
            {problems.map((p) => <AppText key={p.key} size={12} color={colors.ink}>{`${p.where}: ${p.what}`}</AppText>)}
          </View>
        </GlassCard>
      ) : null}
      <GlassCard strong style={styles.card}>
        <TextField label={t('templates.name')} value={draft.name} onChange={(v) => change({ ...draft, name: v })} error={issues.name} maxLength={80} />
        <TextField label={t('templates.notes')} value={draft.notes} onChange={(v) => change({ ...draft, notes: v })} error={issues.notes} multiline />
      </GlassCard>

      <AppText size={16} weight="semibold" color={colors.onGradient} accessibilityRole="header">{t('templates.exercises')}</AppText>
      {draft.items.length === 0 ? (
        <GlassCard strong style={styles.card}>
          <AppText size={13} color={issues.exercises ? colors.danger : colors.ink}>{issues.exercises ? t(issues.exercises) : t('templates.noExercises')}</AppText>
        </GlassCard>
      ) : null}
      {draft.items.map((item, index) => {
        const ex = byId.get(item.exerciseId);
        const name = nameFor(item);
        return (
          <GlassCard strong style={styles.card} key={item.key}>
            <View role="group" accessibilityLabel={t('templates.rowLabel', { position: index + 1, total: draft.items.length, name })} style={styles.rowCard}>
              <View style={styles.row}>
                <AppText size={15} weight="semibold" color={colors.ink} style={styles.flex}>{`${index + 1}. ${name}`}</AppText>
                {ex?.isArchived ? <AppText size={10} color={colors.muted}>{t('templates.hiddenExercise')}</AppText> : null}
              </View>
              {ex ? <HintLines lines={recs.notesOf(recs.assess(ex), false)} /> : null}
              <View style={styles.row}>
                <Pressable accessibilityRole="button" accessibilityLabel={`${t('templates.moveUp')}: ${name}`} accessibilityState={{ disabled: index === 0 }} disabled={index === 0} onPress={() => move(item, -1)} style={[styles.small, index === 0 && styles.dim]}>
                  <AppText size={16} color={colors.dark} align="center">↑</AppText>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`${t('templates.moveDown')}: ${name}`} accessibilityState={{ disabled: index === draft.items.length - 1 }} disabled={index === draft.items.length - 1} onPress={() => move(item, 1)} style={[styles.small, index === draft.items.length - 1 && styles.dim]}>
                  <AppText size={16} color={colors.dark} align="center">↓</AppText>
                </Pressable>
                {draft.items.length > 4 ? (
                  <>
                    <Pressable accessibilityRole="button" accessibilityLabel={`${t('templates.moveTop')}: ${name}`} accessibilityState={{ disabled: index === 0 }} disabled={index === 0} onPress={() => moveEnd(item, 'top')} style={[styles.small, index === 0 && styles.dim]}>
                      <AppText size={12} color={colors.dark} align="center">⤒</AppText>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={`${t('templates.moveBottom')}: ${name}`} accessibilityState={{ disabled: index === draft.items.length - 1 }} disabled={index === draft.items.length - 1} onPress={() => moveEnd(item, 'bottom')} style={[styles.small, index === draft.items.length - 1 && styles.dim]}>
                      <AppText size={12} color={colors.dark} align="center">⤓</AppText>
                    </Pressable>
                  </>
                ) : null}
                <Pressable accessibilityRole="button" accessibilityLabel={`${t('templates.remove')}: ${name}`} onPress={() => remove(item)} style={[styles.small, styles.removeBtn]}>
                  <AppText size={13} weight="medium" color={colors.danger} align="center">{t('templates.remove')}</AppText>
                </Pressable>
              </View>
              <View style={styles.row}>
                {number(item, 'sets', t('templates.sets'))}
                {number(item, 'restSec', t('templates.rest'))}
              </View>
              <View style={styles.row}>
                {item.kind === 'reps' ? (
                  <>
                    {number(item, 'repsMin', t('templates.repsMin'))}
                    {number(item, 'repsMax', t('templates.repsMax'))}
                  </>
                ) : number(item, 'durationSec', t('templates.duration'))}
              </View>
            </View>
          </GlassCard>
        );
      })}

      {picking ? (
        <GlassCard strong style={styles.card}>
          <TextInput
            accessibilityLabel={t('templates.pickerSearch')}
            placeholder={t('templates.pickerSearch')}
            placeholderTextColor={colors.muted}
            value={filter.query}
            onChangeText={(v) => setFilter((f) => ({ ...f, query: v }))}
            style={[styles.search, { textAlign: isRTL ? 'right' : 'left', writingDirection: isRTL ? 'rtl' : 'ltr' }]}
          />
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showFilters }} onPress={() => setShowFilters((v) => !v)} style={[styles.btn, styles.btnGhost]}>
            <AppText size={13} weight="medium" color={colors.dark} align="center">{t('library.filters')}</AppText>
          </Pressable>
          {showFilters ? (
            <View style={styles.rowCard}>
              <ChoiceChips label={t('library.muscle')} options={MUSCLE} value={filter.muscle} onChange={(v) => setFilter((f) => ({ ...f, muscle: v }))} renderLabel={(v) => t(`library.muscles.${v}`)} noneLabel={t('library.all')} />
              <ChoiceChips label={t('library.equipment')} options={EQUIPMENT} value={filter.equipment} onChange={(v) => setFilter((f) => ({ ...f, equipment: v }))} renderLabel={(v) => t(`library.equipmentNames.${v}`)} noneLabel={t('library.all')} />
              {hasActiveFilter(filter) ? (
                <Pressable accessibilityRole="button" onPress={() => setFilter(NO_FILTER)} style={[styles.btn, styles.btnGhost]}>
                  <AppText size={13} weight="medium" color={colors.dark} align="center">{t('library.clearFilters')}</AppText>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <AppText size={12} color={colors.muted}>{t('templates.pickerCount', { count: pickable.length })}</AppText>
          {pickable.length === 0 ? <AppText size={13} color={colors.ink}>{t('templates.pickerEmpty')}</AppText> : null}
          <HintsCard lines={recs.limits} />
          {pickable.slice(0, 100).map(({ e: ex, a }) => {
            const already = countOf(draft, ex.id);
            const lines = [...recs.notesOf(a), ...(already ? [t('templates.alreadyAdded', { count: already })] : [])];
            return (
              <Pressable key={ex.id} accessibilityRole="button" accessibilityLabel={[`${t('templates.add')}: ${nameOf(ex)}`, ...lines].join(', ')} onPress={() => add(ex)} style={styles.pickRow}>
                <AppText size={14} color={colors.ink}>{nameOf(ex)}</AppText>
                <AppText size={11} color={colors.muted}>{`${t(`library.muscles.${ex.primaryMuscle}`)} · ${t(`library.equipmentNames.${ex.equipment}`)}`}</AppText>
                <HintLines lines={lines} />
              </Pressable>
            );
          })}
          <Pressable accessibilityRole="button" onPress={() => { setPicking(false); setFilter(NO_FILTER); setShowFilters(false); }} style={[styles.btn, styles.btnGhost]}>
            <AppText size={14} weight="medium" color={colors.dark} align="center">{t('templates.pickerDone')}</AppText>
          </Pressable>
        </GlassCard>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => setPicking(true)} style={[styles.btn, styles.btnGhost]}>
          <AppText size={14} weight="medium" color={colors.dark} align="center">{t('templates.add')}</AppText>
        </Pressable>
      )}

      {saveError ? <AppText size={12} color={colors.white}>{saveError}</AppText> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving, busy: saving }} disabled={saving} onPress={() => void save()} style={[styles.btn, styles.btnPrimary, saving && styles.dim]}>
        <AppText size={14} weight="medium" color={colors.white} align="center">{t(saving ? 'templates.saving' : 'templates.save')}</AppText>
      </Pressable>
      {confirmCancel ? (
        <GlassCard strong style={styles.card}>
          <View role="group" accessibilityLabel={t('templates.discardTitle')} style={styles.rowCard}>
            <AppText size={14} weight="semibold" color={colors.ink} accessibilityRole="header">{t('templates.discardTitle')}</AppText>
            <AppText size={12} color={colors.muted}>{t('templates.discardBody')}</AppText>
            <Pressable accessibilityRole="button" onPress={goBack} style={[styles.btn, styles.btnDanger]}>
              <AppText size={14} weight="medium" color={colors.white} align="center">{t('templates.discardYes')}</AppText>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setConfirmCancel(false)} style={[styles.btn, styles.btnGhost]}>
              <AppText size={14} weight="medium" color={colors.dark} align="center">{t('templates.keepEditing')}</AppText>
            </Pressable>
          </View>
        </GlassCard>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => { if (dirty && !saving) { setConfirmCancel(true); announce(t('templates.discardTitle')); } else goBack(); }} style={[styles.btn, styles.btnGhost]}>
          <AppText size={14} weight="medium" color={colors.dark} align="center">{t('templates.cancel')}</AppText>
        </Pressable>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowCard: { gap: 10 },
  half: { flex: 1, minWidth: 130 },
  card: { padding: 16, gap: 12 },
  search: { minHeight: 44, borderRadius: radius.sm, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.85)', color: colors.ink, fontSize: 15 },
  pickRow: { minHeight: 48, justifyContent: 'center', paddingVertical: 6, gap: 2 },
  small: { minHeight: 44, minWidth: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.8)' },
  removeBtn: { marginStart: 'auto' },
  btn: { minHeight: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  btnPrimary: { backgroundColor: colors.dark },
  btnGhost: { backgroundColor: 'rgba(255,255,255,0.8)' },
  dim: { opacity: 0.5 },
  btnDanger: { backgroundColor: colors.danger },
});
