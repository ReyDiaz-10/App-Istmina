import React, { useMemo } from 'react';
import { Text as NativeText, TextInput as NativeTextInput, StyleSheet } from 'react-native';
import { usePreferencesStore } from '../store/preferencesStore';
import { scaleTextStyle } from '../utils/fontScale.mjs';

function useScaledStyle(style) {
  const fontScale = usePreferencesStore((state) => state.fontScale);
  return useMemo(
    () => scaleTextStyle(StyleSheet.flatten(style) || {}, fontScale || 1),
    [fontScale, style],
  );
}

export const AppText = React.forwardRef(function AppText({ style, ...props }, ref) {
  return <NativeText ref={ref} style={useScaledStyle(style)} {...props} />;
});

export const AppTextInput = React.forwardRef(function AppTextInput({ style, ...props }, ref) {
  return <NativeTextInput ref={ref} style={useScaledStyle(style)} {...props} />;
});
