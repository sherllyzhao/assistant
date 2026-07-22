import * as SecureStore from "expo-secure-store";

const AUTH_KEY = "sherlly.mobile.auth.v1";

export async function getStoredAuth() {
  const value = await SecureStore.getItemAsync(AUTH_KEY);

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    await SecureStore.deleteItemAsync(AUTH_KEY);
    return null;
  }
}

export async function saveStoredAuth(auth) {
  await SecureStore.setItemAsync(AUTH_KEY, JSON.stringify(auth));
  return auth;
}

export function clearStoredAuth() {
  return SecureStore.deleteItemAsync(AUTH_KEY);
}
