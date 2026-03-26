// src/app/runtime-config.ts
export type RuntimeConfig = { APP_TITLE: string; COMPANY_NAME: string; };
declare global { interface Window { __RUNTIME_CONFIG__?: RuntimeConfig; } }
export const RUNTIME_CONFIG = window.__RUNTIME_CONFIG__ ?? { APP_TITLE: 'بيئة تطويرية', COMPANY_NAME: 'Company Name' };
