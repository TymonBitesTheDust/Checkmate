// The connector answers Claude in English; task text itself is kept as typed.
export const LANGUAGES = [];
export const lang = () => 'en';
export const isZh = () => false;
export function t(s, vars) {
  let out = s;
  if (vars) {
    if (vars.n != null && out.includes('{s}')) out = out.replace(/\{s\}/g, vars.n === 1 ? '' : 's');
    out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
  }
  return out.replace(/\{s\}/g, 's');
}
export const tr = t;
export const pick = (en) => en;
