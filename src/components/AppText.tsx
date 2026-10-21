import React from 'react';
import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';
import { useApp } from '../context/AppContext';
import { colors } from '../theme';

type Weight = 'light' | 'regular' | 'medium' | 'semibold' | 'bold';

const POPPINS: Record<Weight, string> = {
  light: 'Poppins_300Light',
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
};
const CAIRO: Record<Weight, string> = {
  light: 'Cairo_300Light',
  regular: 'Cairo_400Regular',
  medium: 'Cairo_500Medium',
  semibold: 'Cairo_600SemiBold',
  bold: 'Cairo_700Bold',
};

interface Props extends TextProps {
  size?: number;
  weight?: Weight;
  color?: string;
  align?: TextStyle['textAlign'];
}

/** Text that picks Poppins (English) or Cairo (Arabic) and aligns to the reading direction. */
export function AppText({ size = 14, weight = 'regular', color = colors.ink, align, style, ...rest }: Props) {
  const { isRTL } = useApp();
  const family = (isRTL ? CAIRO : POPPINS)[weight];
  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily: family,
          fontSize: size,
          color,
          textAlign: align ?? (isRTL ? 'right' : 'left'),
          writingDirection: isRTL ? 'rtl' : 'ltr',
        },
        // Cairo has taller metrics than Poppins; give it breathing room so glyphs aren't clipped
        isRTL && styles.arabic,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({ arabic: { paddingTop: 1 } });
