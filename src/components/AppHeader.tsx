import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { IconButton } from './IconButton';
import { AppText } from './AppText';
import { colors } from '../theme';

type IconName = React.ComponentProps<typeof IconButton>['icon'];

interface Props {
  title: string;
  right?: { icon: IconName; label: string; onPress: () => void };
}

export function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** Back button · centered title · optional action — used by Statistics, Profile and detail screens. */
export function AppHeader({ title, right }: Props) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <IconButton icon="arrow-back" label={t('common.back')} onPress={goBack} />
      <AppText size={18} weight="medium" color={colors.onGradient} align="center" style={styles.title} numberOfLines={1}>
        {title}
      </AppText>
      {right ? <IconButton icon={right.icon} label={right.label} onPress={right.onPress} /> : <View style={styles.spacer} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flex: 1, paddingHorizontal: 8 },
  spacer: { width: 44 },
});
