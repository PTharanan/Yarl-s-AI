export const environment = {
  production: true,
  apiBaseUrl: (window as any).__env?.API_URL || 'https://tharanan.pythonanywhere.com/api'
};
