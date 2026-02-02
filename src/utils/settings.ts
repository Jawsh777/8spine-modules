/**
 * Shared settings utilities for 8spine modules
 */

import type { SettingValue } from '../../types';

/**
 * Extract the string value from a setting that may be either a string or a SettingValue object.
 * The host app may pass settings in either format depending on context.
 *
 * @param setting - The setting value (string, SettingValue, or undefined)
 * @param defaultValue - Optional default value if setting is undefined or has no value
 * @returns The extracted string value, or undefined if not available
 */
export function getSettingValue(
  setting: string | SettingValue | undefined,
  defaultValue?: string
): string | undefined {
  if (setting === undefined || setting === null) {
    return defaultValue;
  }
  if (typeof setting === 'string') {
    return setting || defaultValue;
  }
  return setting.value || defaultValue;
}

/**
 * Get a required setting value, throwing an error if not found.
 *
 * @param setting - The setting value
 * @param settingName - Name of the setting (for error message)
 * @returns The extracted string value
 * @throws Error if the setting is not configured
 */
export function requireSettingValue(
  setting: string | SettingValue | undefined,
  settingName: string
): string {
  const value = getSettingValue(setting);
  if (!value) {
    throw new Error(`Required setting "${settingName}" not configured`);
  }
  return value;
}

/**
 * Type guard to check if a value is a SettingValue object.
 */
export function isSettingValue(
  value: SettingValue | string | undefined
): value is SettingValue {
  return typeof value === 'object' && value !== null && 'value' in value;
}
