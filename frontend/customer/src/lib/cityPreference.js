const KEY = 'cpse.deliveryCity';
let fallback = '';

export function readSelectedCity() {
  let city = fallback;
  try {
    city = window.localStorage.getItem(KEY) ?? fallback;
  } catch {
    // Use the current tab's copy if browser storage is unavailable.
  }
  return city;
}

export function saveSelectedCity(city) {
  fallback = city ?? '';
  try {
    if (fallback) window.localStorage.setItem(KEY, fallback);
    else window.localStorage.removeItem(KEY);
  } catch {
    // The in-page state still works when browser storage is unavailable.
  }
  window.dispatchEvent(new Event('cpse:city-changed'));
}
