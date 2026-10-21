import { useWindowDimensions } from 'react-native';

/** True on very small phones (≈ iPhone SE / 320 dp wide), where controls switch to compact variants. */
export const useIsNarrow = () => useWindowDimensions().width < 360;
