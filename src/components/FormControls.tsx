import React from 'react';
import { Pressable, StyleSheet, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from './AppText';
import { useApp } from '../context/AppContext';
import { playSound } from '../services/soundService';
import { colors, radius } from '../theme';

/** A labelled text input. An error is shown under it AND exposed as the input's accessibility hint. */
export function TextField({
  label, value, onChange, error, keyboardType, maxLength, a11yLabel, multiline,
}: {
  label: string; value: string; onChange: (v: string) => void; error?: string; keyboardType?: KeyboardTypeOptions; maxLength?: number;
  /** Spoken name when several fields share the same visible label (for example one "Sets" per exercise row). */
  a11yLabel?: string; multiline?: boolean;
}) {
  const { t } = useTranslation();
  const { isRTL } = useApp();
  return (
    <View style={styles.field}>
      <AppText size={12} color={colors.muted}>{label}</AppText>
      <TextInput
        accessibilityLabel={a11yLabel ?? label}
        accessibilityHint={error ? t(error) : undefined}
        multiline={multiline}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        maxLength={maxLength}
        style={[styles.input, error ? styles.inputError : null, { textAlign: isRTL ? 'right' : 'left', writingDirection: isRTL ? 'rtl' : 'ltr' }]}
        placeholderTextColor={colors.muted}
      />
      {error ? <AppText size={11} color={colors.danger}>{t(error)}</AppText> : null}
    </View>
  );
}

/**
 * Pick one option (a radio group). With `noneLabel` an extra first chip clears the choice (used for "All" filters);
 * without it nothing is preselected and `value` stays null until the person chooses.
 */
export function ChoiceChips<T extends string | number>({
  label, options, value, onChange, renderLabel, error, noneLabel,
}: {
  label: string; options: readonly T[]; value: T | null; onChange: (v: T | null) => void; renderLabel: (v: T) => string; error?: string; noneLabel?: string;
}) {
  const { t } = useTranslation();
  const chip = (key: string, text: string, active: boolean, pick: () => void) => (
    <Pressable
      key={key}
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      onPress={() => {
        playSound('tap');
        pick();
      }}
      style={[styles.chip, active && styles.chipActive]}
    >
      <AppText size={12} weight={active ? 'semibold' : 'regular'} color={active ? colors.white : colors.ink}>{text}</AppText>
    </Pressable>
  );
  return (
    <View style={styles.field}>
      <AppText size={12} color={colors.muted}>{label}</AppText>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {noneLabel ? chip('__none', noneLabel, value === null, () => onChange(null)) : null}
        {options.map((o) => chip(String(o), renderLabel(o), value === o, () => onChange(o)))}
      </View>
      {error ? <AppText size={11} color={colors.danger}>{t(error)}</AppText> : null}
    </View>
  );
}

/** Pick any number of options (a group of checkboxes). */
export function MultiChips<T extends string>({
  label, options, values, onToggle, renderLabel, note,
}: { label: string; options: readonly T[]; values: readonly T[]; onToggle: (v: T) => void; renderLabel: (v: T) => string; note?: string }) {
  return (
    <View style={styles.field}>
      <AppText size={12} color={colors.muted}>{label}</AppText>
      <View style={styles.chips} role="group" accessibilityLabel={label}>
        {options.map((o) => {
          const active = values.includes(o);
          return (
            <Pressable
              key={o}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: active }}
              onPress={() => {
                playSound('tap');
                onToggle(o);
              }}
              style={[styles.chip, active && styles.chipActive]}
            >
              <AppText size={12} weight={active ? 'semibold' : 'regular'} color={active ? colors.white : colors.ink}>{renderLabel(o)}</AppText>
            </Pressable>
          );
        })}
      </View>
      {note ? <AppText size={11} color={colors.muted}>{note}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  input: { minHeight: 44, borderRadius: radius.sm, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.85)', color: colors.ink, fontSize: 15 },
  inputError: { borderWidth: 1, borderColor: colors.danger },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, minWidth: 44, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.8)', alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: colors.dark },
});
